// Stripe Connect accounts through the Accounts v2 API (docs/94 ADR §9, amended
// 2026-11-09).
//
// Stripe no longer lets a platform create a connected account with the legacy v1
// `type` field while the platform carries the account's losses. Every sparx Pay
// account creation failed with that error. Two account shapes replace `type`:
//
//   • MERCHANT (sparx Pay): Stripe collects its own fees and carries the losses
//     (Managed Risk). The merchant gets the full Stripe Dashboard and is the
//     merchant of record; sparx charges DIRECT on their account. Managed Risk is
//     compatible with direct charges only, which is why the gateway moved to them.
//   • RECIPIENT (partner payouts): an account that only RECEIVES transfers from the
//     platform balance. Stripe cannot carry losses for a transfers-only account, so
//     the platform does, and the Express Dashboard needs the platform as both fee
//     and loss collector. Creating one needs the loss-liability acknowledgement in
//     the Stripe Dashboard (Settings → Connect → Platform profile).
//
// The installed SDK (stripe@17) has no typed v2 Accounts resource, so these calls
// go through `rawRequest`, which JSON-encodes v2 paths. A v2 account is still an
// `acct_…` id that every v1 endpoint accepts (retrieve, balance, payouts, login
// links), so nothing else changes.

import type Stripe from 'stripe';

/** The API version for the v2 calls below. Pinned here, not on the client: the
 *  rest of the platform stays on the client's v1 version. */
export const STRIPE_V2_API_VERSION = '2026-10-28.endive';

const V2: Stripe.RawRequestOptions = { apiVersion: STRIPE_V2_API_VERSION };

/** The part of a v2 Account (or Account Link) response these callers read. */
interface V2Account {
  id: string;
}
interface V2AccountLink {
  url: string;
}

/** Stripe wants a lower-case ISO country. sparx stores upper-case alpha-2, and a
 *  tenant that never filled in its business details has none. */
function stripeCountry(country: string | null | undefined): string {
  const code = country?.trim().toLowerCase();
  return code && /^[a-z]{2}$/.test(code) ? code : 'us';
}

export interface MerchantAccountInput {
  email: string;
  displayName: string;
  /** ISO 3166-1 alpha-2, any case. Defaults to the US when unknown. */
  country?: string | null;
  metadata: Record<string, string>;
}

/** Create a sparx Pay merchant account: Stripe collects fees and carries losses,
 *  full Stripe Dashboard, card payments requested. Stripe-hosted onboarding
 *  collects everything else. */
export async function createMerchantAccount(
  stripe: Stripe,
  input: MerchantAccountInput
): Promise<string> {
  const account = (await stripe.rawRequest(
    'POST',
    '/v2/core/accounts',
    {
      contact_email: input.email,
      display_name: input.displayName,
      dashboard: 'full',
      identity: { country: stripeCountry(input.country) },
      configuration: {
        merchant: { capabilities: { card_payments: { requested: true } } },
      },
      defaults: {
        responsibilities: { fees_collector: 'stripe', losses_collector: 'stripe' },
      },
      metadata: input.metadata,
    },
    V2
  )) as unknown as V2Account;
  return account.id;
}

export interface RecipientAccountInput {
  email: string;
  displayName: string;
  country?: string | null;
  metadata: Record<string, string>;
}

/** Create a partner payout account: receives transfers from the platform
 *  balance, Express Dashboard for payouts and tax forms. */
export async function createRecipientAccount(
  stripe: Stripe,
  input: RecipientAccountInput
): Promise<string> {
  const account = (await stripe.rawRequest(
    'POST',
    '/v2/core/accounts',
    {
      contact_email: input.email,
      display_name: input.displayName,
      dashboard: 'express',
      identity: { country: stripeCountry(input.country) },
      configuration: {
        recipient: {
          capabilities: { stripe_balance: { stripe_transfers: { requested: true } } },
        },
      },
      defaults: {
        responsibilities: { fees_collector: 'application', losses_collector: 'application' },
      },
      metadata: input.metadata,
    },
    V2
  )) as unknown as V2Account;
  return account.id;
}

/** A single-use link into Stripe-hosted onboarding for one configuration.
 *  `configuration` must match what the account was created with, or Stripe
 *  refuses the link. */
export async function createOnboardingLink(
  stripe: Stripe,
  args: {
    accountId: string;
    configuration: 'merchant' | 'recipient';
    returnUrl: string;
    refreshUrl: string;
  }
): Promise<string> {
  const link = (await stripe.rawRequest(
    'POST',
    '/v2/core/account_links',
    {
      account: args.accountId,
      use_case: {
        type: 'account_onboarding',
        account_onboarding: {
          configurations: [args.configuration],
          return_url: args.returnUrl,
          refresh_url: args.refreshUrl,
        },
      },
    },
    V2
  )) as unknown as V2AccountLink;
  return link.url;
}

/** Whether an account (v1 or v2) uses the Express Dashboard, the only kind a
 *  login link can open. Full-Dashboard merchants sign in to Stripe themselves. */
export function hasExpressDashboard(account: Stripe.Account): boolean {
  return account.controller?.stripe_dashboard?.type === 'express' || account.type === 'express';
}
