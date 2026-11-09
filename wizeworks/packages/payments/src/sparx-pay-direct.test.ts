// sparx Pay makes DIRECT charges on the merchant's connected account (docs/94 §6,
// amended 2026-11-09).
//
// Stripe refused every sparx Pay account the platform tried to create: the old
// accounts had the platform carrying the losses, and Stripe stopped allowing that.
// An account where Stripe carries the losses works only with direct charges, so
// every sparx Pay call now runs with the platform key ON the merchant's account
// (`stripeAccount`). What this pins:
//
//   1. A payment is made on the merchant's account, takes sparx's 0.5%, and no
//      longer routes money with on_behalf_of / transfer_data.
//   2. The account rides back with the intent and the setup session, because the
//      browser can confirm them only with Stripe.js loaded for that account.
//   3. Refunds, holds, lookups, saved cards and payment links all reach the same
//      account. A card saved on one account cannot be charged on another.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const ACCOUNT = 'acct_merchant';
const ON_MERCHANT = { stripeAccount: ACCOUNT };

const calls = {
  intentCreate: vi.fn(),
  intentCapture: vi.fn(),
  intentCancel: vi.fn(),
  intentRetrieve: vi.fn(),
  refundCreate: vi.fn(),
  customerCreate: vi.fn(),
  setupCreate: vi.fn(),
  sessionCreate: vi.fn(),
};

vi.mock('./client', () => ({
  getPlatformStripe: () => ({
    paymentIntents: {
      create: calls.intentCreate,
      capture: calls.intentCapture,
      cancel: calls.intentCancel,
      retrieve: calls.intentRetrieve,
    },
    refunds: { create: calls.refundCreate },
    customers: { create: calls.customerCreate },
    setupIntents: { create: calls.setupCreate },
    checkout: { sessions: { create: calls.sessionCreate } },
  }),
}));

const { setPaymentSecretReader } = await import('./secrets');
const { SparxPayGateway } = await import('./gateways/sparx-pay');

const intent = {
  id: 'pi_1',
  client_secret: 'pi_1_secret',
  amount: 10_000,
  currency: 'usd',
  status: 'requires_payment_method',
  metadata: {},
  latest_charge: null,
};

beforeEach(() => {
  for (const fn of Object.values(calls)) fn.mockReset();
  setPaymentSecretReader({
    read: (ref) =>
      ref === 'payments/t-1/sparx_pay/stripe_account_id'
        ? Promise.resolve(ACCOUNT)
        : Promise.reject(new Error(`unexpected ref ${ref}`)),
  });
});

describe('a sparx Pay payment', () => {
  it('is made on the merchant’s account and takes sparx’s 0.5%', async () => {
    calls.intentCreate.mockResolvedValue(intent);
    const result = await new SparxPayGateway().createPaymentIntent({
      tenantId: 't-1',
      amount: 10_000,
      currency: 'usd',
      orderId: 'o-1',
    });

    const [params, opts] = calls.intentCreate.mock.calls[0] as [Record<string, unknown>, unknown];
    expect(opts).toEqual(ON_MERCHANT);
    expect(params.application_fee_amount).toBe(50);
    expect(params).not.toHaveProperty('on_behalf_of');
    expect(params).not.toHaveProperty('transfer_data');
    expect(params.metadata).toMatchObject({ tenantId: 't-1', orderId: 'o-1' });
    expect(result.stripeAccount).toBe(ACCOUNT);
    expect(result.clientSecret).toBe('pi_1_secret');
  });

  it('keeps a card on a customer made on the merchant’s account', async () => {
    calls.customerCreate.mockResolvedValue({ id: 'cus_1' });
    calls.intentCreate.mockResolvedValue(intent);
    const result = await new SparxPayGateway().createPaymentIntent({
      tenantId: 't-1',
      amount: 10_000,
      currency: 'usd',
      saveForLater: { customerId: 'c-1' },
    });
    expect(calls.customerCreate.mock.calls[0]?.[1]).toEqual(ON_MERCHANT);
    expect(calls.intentCreate.mock.calls[0]?.[0]).toMatchObject({
      customer: 'cus_1',
      setup_future_usage: 'off_session',
    });
    expect(result.customerRef).toBe('cus_1');
  });
});

describe('everything after the payment reaches the same account', () => {
  it('captures and releases a held card there', async () => {
    calls.intentCapture.mockResolvedValue({ ...intent, status: 'succeeded' });
    calls.intentCancel.mockResolvedValue({ ...intent, status: 'canceled' });
    const gateway = new SparxPayGateway();

    expect((await gateway.capturePayment('pi_1', 2_500, 't-1')).success).toBe(true);
    expect(calls.intentCapture).toHaveBeenCalledWith(
      'pi_1',
      { amount_to_capture: 2_500 },
      ON_MERCHANT
    );
    expect((await gateway.cancelPayment('pi_1', 't-1')).success).toBe(true);
    expect(calls.intentCancel).toHaveBeenCalledWith('pi_1', {}, ON_MERCHANT);
  });

  it('says why when it is not told whose card it is', async () => {
    const gateway = new SparxPayGateway();
    expect((await gateway.capturePayment('pi_1')).success).toBe(false);
    expect((await gateway.cancelPayment('pi_1')).success).toBe(false);
    expect(calls.intentCapture).not.toHaveBeenCalled();
  });

  it('refunds there', async () => {
    calls.refundCreate.mockResolvedValue({ id: 're_1', amount: 500 });
    const result = await new SparxPayGateway().refund({
      tenantId: 't-1',
      chargeId: 'pi_1',
      amount: 500,
    });
    expect(result).toEqual({ success: true, refundId: 're_1', amount: 500 });
    expect(calls.refundCreate).toHaveBeenCalledWith(
      { payment_intent: 'pi_1', amount: 500 },
      ON_MERCHANT
    );
  });

  it('looks a payment up there', async () => {
    calls.intentRetrieve.mockResolvedValue({
      ...intent,
      status: 'succeeded',
      amount_received: 10_000,
    });
    const found = await new SparxPayGateway().lookupPayment({
      tenantId: 't-1',
      paymentRef: 'pi_1',
    });
    expect(found?.status).toBe('succeeded');
    expect(calls.intentRetrieve).toHaveBeenCalledWith('pi_1', {}, ON_MERCHANT);
  });

  it('makes an invoice payment link there, with sparx’s fee and no routing', async () => {
    calls.sessionCreate.mockResolvedValue({ url: 'https://checkout.stripe.com/c/pay/1' });
    const url = await new SparxPayGateway().createPaymentLink({
      tenantId: 't-1',
      amount: 10_000,
      currency: 'usd',
      invoiceId: 'inv-1',
      description: 'Invoice 1',
      successUrl: 'https://shop.example/paid',
    });
    expect(url).toBe('https://checkout.stripe.com/c/pay/1');
    const [params, opts] = calls.sessionCreate.mock.calls[0] as [
      { payment_intent_data: Record<string, unknown> },
      unknown,
    ];
    expect(opts).toEqual(ON_MERCHANT);
    expect(params.payment_intent_data.application_fee_amount).toBe(50);
    expect(params.payment_intent_data).not.toHaveProperty('transfer_data');
    expect(params.payment_intent_data).not.toHaveProperty('on_behalf_of');
  });
});

describe('a saved card', () => {
  it('is vaulted there, and the session names the account for the browser', async () => {
    calls.customerCreate.mockResolvedValue({ id: 'cus_1' });
    calls.setupCreate.mockResolvedValue({ id: 'seti_1', client_secret: 'seti_1_secret' });
    const session = await new SparxPayGateway().createSetupSession({
      tenantId: 't-1',
      customerId: 'c-1',
    });
    expect(calls.setupCreate.mock.calls[0]?.[1]).toEqual(ON_MERCHANT);
    expect(session).toMatchObject({
      clientSecret: 'seti_1_secret',
      stripeAccount: ACCOUNT,
      customerRef: 'cus_1',
      setupRef: 'seti_1',
    });
  });

  it('is charged there for a renewal, with sparx’s fee and the idempotency key', async () => {
    calls.intentCreate.mockResolvedValue({ ...intent, status: 'succeeded' });
    const result = await new SparxPayGateway().chargeStoredMethod({
      tenantId: 't-1',
      amount: 10_000,
      currency: 'usd',
      methodRef: 'pm_1',
      customerRef: 'cus_1',
      idempotencyKey: 'sub-1:occ-1:1',
    });
    expect(result).toEqual({ status: 'succeeded', paymentRef: 'pi_1' });
    const [params, opts] = calls.intentCreate.mock.calls[0] as [Record<string, unknown>, unknown];
    expect(opts).toEqual({ stripeAccount: ACCOUNT, idempotencyKey: 'sub-1:occ-1:1' });
    expect(params.application_fee_amount).toBe(50);
    expect(params).not.toHaveProperty('transfer_data');
  });

  it('names the account when the bank wants the shopper to confirm a renewal', async () => {
    calls.intentCreate.mockResolvedValue({
      ...intent,
      status: 'requires_action',
      client_secret: 'pi_1_secret',
    });
    const result = await new SparxPayGateway().chargeStoredMethod({
      tenantId: 't-1',
      amount: 10_000,
      currency: 'usd',
      methodRef: 'pm_1',
      customerRef: 'cus_1',
      idempotencyKey: 'sub-1:occ-1:1',
    });
    expect(result).toMatchObject({
      status: 'requires_action',
      actionSecret: 'pi_1_secret',
      stripeAccount: ACCOUNT,
    });
  });
});
