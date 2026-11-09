// The link a customer gets when their bank wants them to approve a renewal
// (docs/142 §5.3).
//
// It linked to a page that did not exist, on a host no deployment set: every
// such email was a dead button, and the renewal went down the retry ladder with a
// good card. What this pins:
//
//   1. The link is absolute, on the site the subscription was sold on.
//   2. It carries what Stripe.js needs to find the payment: the connected account
//      for sparx Pay, the merchant's own key for stripe_direct.
//   3. A gateway that hosts its own approval page keeps its link.
//   4. A retry cancels the payments earlier emails asked the customer to approve,
//      so one renewal cannot be paid twice.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const SITE = 'https://juniper.example';

const order = {
  id: 'o-1',
  orderNumber: '1001',
  currency: 'USD',
  total: 20,
  amountPaid: 0,
  paymentStatus: 'unpaid',
  status: 'open',
  createdAt: new Date('2026-11-01T00:00:00Z'),
};
const sub = {
  id: 'sub-1',
  propertyId: 'prop-1',
  customerId: 'c-1',
  billingMode: 'card',
  paymentMethodId: 'pm-row',
  dunningPolicy: null,
};

let priorAttempts: { paymentRef: string | null }[] = [];
let attemptCount = 0;

const tx = {
  subscription: { findFirst: vi.fn(() => Promise.resolve(sub)) },
  order: { findFirst: vi.fn(() => Promise.resolve(order)) },
  customerPaymentMethod: {
    findFirst: vi.fn(() =>
      Promise.resolve({
        id: 'pm-row',
        status: 'active',
        methodRef: 'pm_1',
        customerRef: 'cus_1',
        networkTransId: null,
        originalAuthAmount: null,
      })
    ),
  },
  dunningAttempt: {
    count: vi.fn(() => Promise.resolve(attemptCount)),
    findMany: vi.fn(() => Promise.resolve(priorAttempts)),
  },
  subscriptionEvent: { create: vi.fn(() => Promise.resolve({})) },
};

const resolveSiteOrigin = vi.fn((..._args: unknown[]) => Promise.resolve(SITE));
const chargeStoredMethod = vi.fn();
const cancelPayment = vi.fn((..._args: unknown[]) => Promise.resolve({ success: true }));
const publishCommerceEvent = vi.fn((..._args: unknown[]) => Promise.resolve());

vi.mock('@wizeworksllc/db', () => ({
  withTenant: (_ctx: unknown, fn: (t: typeof tx) => unknown) => fn(tx),
}));
vi.mock('@wizeworksllc/db/site-origin', () => ({
  resolveSiteOrigin: (...args: unknown[]) => resolveSiteOrigin(...args),
  siteUrl: (origin: string, path: string) => `${origin}${path}`,
}));
vi.mock('@wizeworksllc/payments', () => ({
  paymentService: {
    chargeStoredMethod: (...args: unknown[]) => chargeStoredMethod(...args) as unknown,
    cancelPayment: (...args: unknown[]) => cancelPayment(...args),
  },
  PaymentConfigError: class extends Error {},
  StoredMethodsUnsupportedError: class extends Error {},
}));
vi.mock('@wizeworksllc/crm', () => ({ orderPaymentsService: { recordPayment: vi.fn() } }));
vi.mock('../events', () => ({
  publishCommerceEvent: (...args: unknown[]) => publishCommerceEvent(...args),
}));
vi.mock('./site-commerce-service', () => ({
  readTenantDunningPolicy: () => Promise.resolve(null),
}));
vi.mock('./payment-method-service', () => ({ markUsed: vi.fn(), recordCredentialChain: vi.fn() }));
vi.mock('./subscription-service', () => ({ recordDunningAttempt: vi.fn() }));

const { runDueRetry } = await import('./subscription-billing');

const ctx = { tenantId: 't-1' } as Parameters<typeof runDueRetry>[0];

/** The confirm link the authentication_required event carried. */
function confirmUrl(): URL {
  const call = publishCommerceEvent.mock.calls.find(
    ([e]) => (e as { topic: string }).topic === 'subscription.authentication_required'
  );
  if (!call) throw new Error('no authentication_required event');
  return new URL((call[0] as { data: { confirmUrl: string } }).data.confirmUrl);
}

beforeEach(() => {
  vi.clearAllMocks();
  priorAttempts = [];
  attemptCount = 0;
});

describe('the confirm link in a renewal email', () => {
  it('is on the subscription’s own site and names the sparx Pay account', async () => {
    chargeStoredMethod.mockResolvedValue({
      status: 'requires_action',
      paymentRef: 'pi_1',
      actionSecret: 'pi_1_secret_abc',
      stripeAccount: 'acct_merchant',
    });

    const result = await runDueRetry(ctx, 'sub-1');

    expect(result.outcome).toBe('action_required');
    expect(resolveSiteOrigin).toHaveBeenCalledWith(tx, 't-1', 'prop-1');
    const url = confirmUrl();
    expect(url.origin).toBe(SITE);
    expect(url.pathname).toBe('/account/confirm-payment');
    expect(url.searchParams.get('secret')).toBe('pi_1_secret_abc');
    expect(url.searchParams.get('account')).toBe('acct_merchant');
    expect(url.searchParams.has('pk')).toBe(false);
  });

  it('carries a stripe_direct merchant’s own key', async () => {
    chargeStoredMethod.mockResolvedValue({
      status: 'requires_action',
      paymentRef: 'pi_1',
      actionSecret: 'pi_1_secret_abc',
      publishableKey: 'pk_live_merchant',
    });

    await runDueRetry(ctx, 'sub-1');

    const url = confirmUrl();
    expect(url.searchParams.get('pk')).toBe('pk_live_merchant');
    expect(url.searchParams.has('account')).toBe(false);
  });

  it('keeps the page a gateway hosts itself', async () => {
    chargeStoredMethod.mockResolvedValue({
      status: 'requires_action',
      paymentRef: 'sq_1',
      actionUrl: 'https://gateway.example/approve/1',
    });

    await runDueRetry(ctx, 'sub-1');

    expect(confirmUrl().href).toBe('https://gateway.example/approve/1');
  });

  it('sends them to their repeat orders when there is nothing to approve here', async () => {
    chargeStoredMethod.mockResolvedValue({ status: 'requires_action', paymentRef: 'pi_1' });

    await runDueRetry(ctx, 'sub-1');

    expect(confirmUrl().href).toBe(`${SITE}/account/repeat-orders`);
  });
});

describe('a retry', () => {
  it('cancels the payments earlier emails asked the customer to approve, first', async () => {
    attemptCount = 2;
    priorAttempts = [
      { paymentRef: 'pi_old' },
      { paymentRef: 'pi_old' },
      { paymentRef: 'pi_older' },
      { paymentRef: 'ch_not_an_intent' },
      { paymentRef: null },
    ];
    cancelPayment.mockRejectedValueOnce(new Error('already canceled'));
    chargeStoredMethod.mockResolvedValue({ status: 'succeeded', paymentRef: 'pi_new' });

    const result = await runDueRetry(ctx, 'sub-1');

    expect(result.outcome).toBe('charged');
    expect(cancelPayment.mock.calls).toEqual([
      ['t-1', 'pi_old'],
      ['t-1', 'pi_older'],
    ]);
    expect(tx.dunningAttempt.findMany).toHaveBeenCalledWith({
      where: {
        subscriptionId: 'sub-1',
        outcome: 'retry_scheduled',
        attemptedAt: { gte: order.createdAt },
      },
      select: { paymentRef: true },
    });
    expect(cancelPayment.mock.invocationCallOrder[1]).toBeLessThan(
      chargeStoredMethod.mock.invocationCallOrder[0] ?? 0
    );
  });

  it('cancels nothing on the first attempt', async () => {
    chargeStoredMethod.mockResolvedValue({ status: 'succeeded', paymentRef: 'pi_new' });

    await runDueRetry(ctx, 'sub-1');

    expect(tx.dunningAttempt.findMany).not.toHaveBeenCalled();
    expect(cancelPayment).not.toHaveBeenCalled();
  });
});
