// A sparx Pay event finds its shop from the connected account it happened on.
//
// A sparx Pay charge is now a DIRECT charge on the merchant's connected account
// (2026-11-09), so Stripe delivers its events through the Connect endpoint with
// the account named at the top of the event. A dispute carries no metadata, and
// there is no `on_behalf_of` on a direct charge, so without reading the event's
// account the reconciler could not tell whose dispute it was and skipped it.

import type { FastifyBaseLogger } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const lookups: unknown[] = [];
const recorded: { tenantId: string; eventType: string }[] = [];

vi.mock('@wizeworksllc/db', () => ({
  prisma: {
    tenant: {
      findUnique: ({ where }: { where: { stripeAccountId: string } }) => {
        lookups.push(where);
        return Promise.resolve(
          where.stripeAccountId === 'acct_merchant' ? { id: 'tenant-merchant' } : null
        );
      },
    },
  },
  withTenant: (ctx: { tenantId: string }, fn: (tx: unknown) => unknown) =>
    fn({
      paymentEvent: {
        create: ({ data }: { data: { eventType: string } }) => {
          recorded.push({ tenantId: ctx.tenantId, eventType: data.eventType });
          return Promise.resolve({});
        },
        updateMany: () => Promise.resolve({ count: 1 }),
      },
    }),
}));
vi.mock('@wizeworksllc/crm', () => ({
  billingPaymentService: {},
  heldOrderMoney: {},
  orderPaymentsService: {},
}));
vi.mock('@wizeworksllc/commerce', () => ({ heldOrderPayments: {} }));
vi.mock('@wizeworksllc/api-core/pubsub', () => ({ publish: () => Promise.resolve() }));
vi.mock('@wizeworksllc/payments', () => ({ gatewayRegistry: { get: () => ({}) } }));
vi.mock('./payments-onboarding.js', () => ({ reconcileSparxPayAccount: () => Promise.resolve() }));

const { reconcilePaymentEvent } = await import('./payment-webhook-reconcile.js');

const log = {
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
} as unknown as FastifyBaseLogger;

beforeEach(() => {
  lookups.length = 0;
  recorded.length = 0;
});

describe('a dispute on a sparx Pay direct charge', () => {
  it('is recorded for the shop whose connected account it happened on', async () => {
    await reconcilePaymentEvent(
      log,
      {
        type: 'dispute.created',
        externalId: 'evt_dispute',
        providerEventType: 'charge.dispute.created',
        payload: {
          id: 'evt_dispute',
          account: 'acct_merchant',
          data: { object: { id: 'dp_1', charge: 'ch_1' } },
        },
      },
      { gatewayId: 'sparx_pay' }
    );

    expect(lookups).toEqual([{ stripeAccountId: 'acct_merchant' }]);
    expect(recorded).toEqual([{ tenantId: 'tenant-merchant', eventType: 'dispute.created' }]);
  });

  it('still finds the shop of a destination charge made before the change', async () => {
    await reconcilePaymentEvent(
      log,
      {
        type: 'dispute.created',
        externalId: 'evt_old',
        providerEventType: 'charge.dispute.created',
        payload: { id: 'evt_old', data: { object: { id: 'dp_2', on_behalf_of: 'acct_merchant' } } },
      },
      { gatewayId: 'sparx_pay' }
    );

    expect(recorded).toEqual([{ tenantId: 'tenant-merchant', eventType: 'dispute.created' }]);
  });
});
