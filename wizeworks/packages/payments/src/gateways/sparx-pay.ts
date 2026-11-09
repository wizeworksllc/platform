// sparx Pay — Stripe Connect DIRECT charges (docs/94 ADR §6, amended 2026-11-09).
//
// Every call is made with the PLATFORM key and `stripeAccount: <merchant acct>`, so
// the PaymentIntent, the Charge, the Customer and the saved card all live on the
// merchant's connected account. The merchant is the merchant of record, pays
// Stripe's processing fee, and handles disputes in their own Stripe Dashboard;
// `application_fee_amount` takes sparx's flat 0.5% off each charge.
//
// Why direct and not destination charges: Stripe stopped letting a platform create
// connected accounts where the platform carries the losses, and an account where
// STRIPE carries them (Managed Risk) is compatible only with direct charges. Under
// destination charges sparx also paid Stripe's card fee out of its 0.5%.
//
// The browser must confirm an intent with Stripe.js loaded for the same account,
// so `stripeAccount` rides back on every intent and setup session.

import type Stripe from 'stripe';

import { getPlatformStripe } from '../client';
import { sparxPayFeeCents } from '../fee';
import type {
  ChargeStoredMethodParams,
  CompleteVaultParams,
  CreatePaymentIntentParams,
  CreatePaymentLinkParams,
  CreateSetupSessionParams,
  LookedUpPayment,
  LookupPaymentParams,
  PaymentGateway,
  PaymentIntent,
  PaymentResult,
  ParsedWebhookEvent,
  RefundParams,
  RefundResult,
  SetupSession,
  StoredChargeResult,
  VaultFromPaymentParams,
  VaultedMethod,
  WebhookEvent,
} from '../gateway';
import { credentialRef, getPaymentSecretReader } from '../secrets';
import {
  lookupStripePayment,
  normalizeStripeEvent,
  toCancelResult,
  toPaymentIntent,
  toPaymentResult,
} from '../stripe-util';
import {
  chargeStripeStoredMethod,
  completeStripeVault,
  createStripeSetupSession,
  stripeSaveForLater,
  vaultStripePayment,
} from '../stripe-vault';
import { constructEventWithAnySecret, parseWebhookSecrets } from '../webhook-secrets';

export const SPARX_PAY_ID = 'sparx_pay';

class SparxPayUnconfiguredError extends Error {
  constructor() {
    super('Card payments are unavailable: the platform Stripe key is not configured.');
    this.name = 'SparxPayUnconfiguredError';
  }
}

/** Capture and cancel reach the merchant's connected account, so they need to
 *  know whose. `paymentService` always passes it. */
function noTenant(action: 'capture' | 'cancel'): PaymentResult {
  return {
    success: false,
    errorMessage: `A ${action} needs the tenant to reach the merchant's account`,
  };
}

export class SparxPayGateway implements PaymentGateway {
  readonly id = SPARX_PAY_ID;
  readonly name = 'sparx Pay';

  private platform(): Stripe {
    const stripe = getPlatformStripe();
    if (!stripe) throw new SparxPayUnconfiguredError();
    return stripe;
  }

  /** The merchant's connected account id (`acct_…`), from Secret Manager. */
  private async merchantAccountId(tenantId: string): Promise<string> {
    return getPaymentSecretReader().read(
      credentialRef(tenantId, SPARX_PAY_ID, 'stripe_account_id')
    );
  }

  /** Request options that make a platform-key call on the merchant's account. */
  private async onMerchant(tenantId: string): Promise<{ stripeAccount: string }> {
    return { stripeAccount: await this.merchantAccountId(tenantId) };
  }

  async createPaymentIntent(params: CreatePaymentIntentParams): Promise<PaymentIntent> {
    const stripe = this.platform();
    const opts = await this.onMerchant(params.tenantId);
    // Keep the card for a repeat order (issue 739). The customer lives on the
    // merchant's account, the same place `createSetupSession` vaults to, so a
    // renewal finds it exactly as it would a card saved from the account page.
    const save = params.saveForLater
      ? await stripeSaveForLater(stripe, params.tenantId, params.saveForLater, opts)
      : null;

    const intent = await stripe.paymentIntents.create(
      {
        amount: params.amount,
        currency: params.currency,
        application_fee_amount: sparxPayFeeCents(params.amount),
        ...(params.captureMethod === 'manual' ? { capture_method: 'manual' as const } : {}),
        ...(save ? save.params : { automatic_payment_methods: { enabled: true } }),
        metadata: {
          tenantId: params.tenantId,
          orderId: params.orderId ?? '',
          invoiceId: params.invoiceId ?? '',
          customerId: params.customerId ?? '',
          ...params.metadata,
        },
      },
      opts
    );

    return {
      ...toPaymentIntent(intent),
      stripeAccount: opts.stripeAccount,
      ...(save ? { customerRef: save.customerRef } : {}),
    };
  }

  // Confirming is driven client-side (Stripe.js loaded for the merchant's
  // account); the intent id alone does not say which account it is on.
  confirmPayment(intentId: string): Promise<PaymentResult> {
    void intentId;
    return Promise.resolve({
      success: false,
      errorMessage: 'This payment confirms in the browser',
    });
  }

  async capturePayment(
    intentId: string,
    amount?: number,
    tenantId?: string
  ): Promise<PaymentResult> {
    if (!tenantId) return noTenant('capture');
    try {
      const intent = await this.platform().paymentIntents.capture(
        intentId,
        amount !== undefined ? { amount_to_capture: amount } : {},
        await this.onMerchant(tenantId)
      );
      return toPaymentResult(intent);
    } catch (err) {
      return {
        success: false,
        errorMessage: err instanceof Error ? err.message : 'capture failed',
      };
    }
  }

  async cancelPayment(intentId: string, tenantId?: string): Promise<PaymentResult> {
    if (!tenantId) return noTenant('cancel');
    try {
      return toCancelResult(
        await this.platform().paymentIntents.cancel(intentId, {}, await this.onMerchant(tenantId))
      );
    } catch (err) {
      return { success: false, errorMessage: err instanceof Error ? err.message : 'cancel failed' };
    }
  }

  async refund(params: RefundParams): Promise<RefundResult> {
    try {
      const refund = await this.platform().refunds.create(
        {
          ...(params.chargeId.startsWith('pi_')
            ? { payment_intent: params.chargeId }
            : { charge: params.chargeId }),
          ...(params.amount !== undefined ? { amount: params.amount } : {}),
          ...(params.reason ? { reason: params.reason } : {}),
          ...(params.metadata ? { metadata: params.metadata } : {}),
        },
        await this.onMerchant(params.tenantId)
      );
      return { success: true, refundId: refund.id, amount: refund.amount };
    } catch (err) {
      return {
        success: false,
        amount: params.amount ?? 0,
        errorMessage: err instanceof Error ? err.message : 'refund failed',
      };
    }
  }

  async createPaymentLink(params: CreatePaymentLinkParams): Promise<string | null> {
    const session = await this.platform().checkout.sessions.create(
      {
        mode: 'payment',
        payment_intent_data: {
          application_fee_amount: sparxPayFeeCents(params.amount),
          // Stamp the intent (not just the session) so the payment webhook can resolve
          // the tenant + invoice from payment_intent.succeeded.
          metadata: { tenantId: params.tenantId, invoiceId: params.invoiceId },
        },
        line_items: [
          {
            price_data: {
              currency: params.currency,
              unit_amount: params.amount,
              product_data: { name: params.description },
            },
            quantity: 1,
          },
        ],
        success_url: params.successUrl,
        ...(params.expiresAt ? { expires_at: Math.floor(params.expiresAt.getTime() / 1000) } : {}),
        metadata: { tenantId: params.tenantId, invoiceId: params.invoiceId },
      },
      await this.onMerchant(params.tenantId)
    );

    return session.url;
  }

  // ── Stored methods (docs/142 §5) ───────────────────────────────────────────
  // The Customer and PaymentMethod live on the merchant's connected account, the
  // same place the charge is made. A card saved on one account cannot be charged
  // on another, so vaulting and charging must always agree on the account.

  async createSetupSession(params: CreateSetupSessionParams): Promise<SetupSession> {
    return createStripeSetupSession(
      this.platform(),
      params,
      null,
      await this.onMerchant(params.tenantId)
    );
  }

  async completeVault(params: CompleteVaultParams): Promise<VaultedMethod | null> {
    return completeStripeVault(
      this.platform(),
      params.setupRef,
      await this.onMerchant(params.tenantId)
    );
  }

  async vaultFromPayment(params: VaultFromPaymentParams): Promise<VaultedMethod | null> {
    return vaultStripePayment(
      this.platform(),
      params.paymentRef,
      await this.onMerchant(params.tenantId)
    );
  }

  /** On the merchant's account, which is where the intent was made. */
  async lookupPayment(params: LookupPaymentParams): Promise<LookedUpPayment | null> {
    return lookupStripePayment(
      this.platform(),
      params.paymentRef,
      await this.onMerchant(params.tenantId)
    );
  }

  async chargeStoredMethod(params: ChargeStoredMethodParams): Promise<StoredChargeResult> {
    // The same direct charge createPaymentIntent makes: on the merchant's account,
    // sparx's flat fee taken off it. A subscription charge is not a different KIND
    // of payment, so it must not earn different economics by taking a different
    // code path.
    return chargeStripeStoredMethod(
      this.platform(),
      params,
      { application_fee_amount: sparxPayFeeCents(params.amount) },
      await this.onMerchant(params.tenantId)
    );
  }

  /** Every secret configured for this endpoint. Comma-separated because ONE URL takes
   *  events from two Stripe endpoints (the platform account's own events, for
   *  sparx.market, + connected-account events, which carry every sparx Pay payment),
   *  each with its own signing secret — and because a rolled secret overlaps with
   *  its predecessor. See webhook-secrets.ts. */
  private secrets(): string[] {
    return parseWebhookSecrets(process.env.STRIPE_WEBHOOK_SECRET_SPARX_PAY);
  }

  verifyWebhookSignature(body: Buffer, signature: string): boolean {
    return constructEventWithAnySecret(body, signature, this.secrets()) !== null;
  }

  parseWebhook(event: WebhookEvent): Promise<ParsedWebhookEvent> {
    const stripeEvent = constructEventWithAnySecret(event.rawBody, event.signature, this.secrets());
    if (!stripeEvent) {
      // The route verifies before calling this, so reaching here means the secrets
      // changed mid-request — surface it rather than silently dropping a payment.
      throw new Error('Webhook signature did not match any configured secret');
    }
    return Promise.resolve(normalizeStripeEvent(stripeEvent));
  }
}
