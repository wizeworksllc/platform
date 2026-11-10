// Pure-logic tests for @wizeworksllc/payments — the fee rule, the registry, and webhook
// normalization. The gateways' Stripe calls + PaymentService's DB writes are exercised
// by integration tests; here we lock the parts that decide money + routing.

import type Stripe from 'stripe';
import { afterEach, describe, expect, it } from 'vitest';

import { formatPayFee, payFeeBps, SPARX_PAY_FEE_RATE, sparxPayFeeCents } from './fee';
import { GatewayNotFoundError, gatewayRegistry, registerBuiltInGateways } from './registry';
import { normalizeStripeEvent } from './stripe-util';
import { constructEventWithAnySecret, parseWebhookSecrets } from './webhook-secrets';
import { SparxPayGateway, SPARX_PAY_ID } from './gateways/sparx-pay';
import { StripeDirectGateway, STRIPE_DIRECT_ID } from './gateways/stripe-direct';

describe('fee rule (docs/94 §8)', () => {
  it('is a flat 0.5%', () => {
    expect(SPARX_PAY_FEE_RATE).toBe(0.005);
    expect(sparxPayFeeCents(100_00)).toBe(50); // $100 → $0.50
    expect(sparxPayFeeCents(0)).toBe(0);
    expect(sparxPayFeeCents(199)).toBe(1); // rounds (0.995 → 1)
  });

  it('takes a brand’s own rate, in basis points', () => {
    expect(sparxPayFeeCents(100_00, 0)).toBe(0);
    expect(sparxPayFeeCents(100_00, 25)).toBe(25);
  });
});

describe('a brand’s Pay fee rate', () => {
  const VAR = 'FEETEST_PAY_FEE_BPS';
  afterEach(() => {
    delete process.env[VAR];
  });

  it('is the default 0.5% when the brand sets none', () => {
    expect(payFeeBps('feetest')).toBe(50);
    expect(payFeeBps(null)).toBe(50);
  });

  it('is the brand’s own setting, zero included', () => {
    process.env[VAR] = '0';
    expect(payFeeBps('feetest')).toBe(0);
    process.env[VAR] = '25';
    expect(payFeeBps('feetest')).toBe(25);
  });

  it('refuses a value that is not a whole number of basis points from 0 to 1000', () => {
    for (const bad of ['0.5', '-1', '1001', 'half']) {
      process.env[VAR] = bad;
      expect(() => payFeeBps('feetest')).toThrow(VAR);
    }
  });

  it('reads as a percentage', () => {
    expect(formatPayFee(50)).toBe('0.5%');
    expect(formatPayFee(25)).toBe('0.25%');
    expect(formatPayFee(100)).toBe('1%');
  });
});

describe('gateway registry', () => {
  it('registers and resolves the built-in gateways by id', () => {
    registerBuiltInGateways([new SparxPayGateway(), new StripeDirectGateway()]);
    expect(gatewayRegistry.get(SPARX_PAY_ID).name).toBe('sparx Pay');
    expect(gatewayRegistry.get(STRIPE_DIRECT_ID).id).toBe('stripe_direct');
    expect(gatewayRegistry.has(SPARX_PAY_ID)).toBe(true);
  });

  it('throws for an unknown gateway id', () => {
    expect(() => gatewayRegistry.get('does_not_exist')).toThrow(GatewayNotFoundError);
  });
});

describe('normalizeStripeEvent (docs/94 §10)', () => {
  const event = (type: string, object: unknown): Stripe.Event =>
    ({ id: 'evt_1', type, data: { object } }) as unknown as Stripe.Event;

  it('maps payment_intent.succeeded → payment.succeeded with the tenant from metadata', () => {
    const out = normalizeStripeEvent(
      event('payment_intent.succeeded', { metadata: { tenantId: 't1' } })
    );
    expect(out).toMatchObject({
      type: 'payment.succeeded',
      tenantId: 't1',
      externalId: 'evt_1',
      providerEventType: 'payment_intent.succeeded',
    });
  });

  it('maps payment_intent.payment_failed → payment.failed', () => {
    expect(normalizeStripeEvent(event('payment_intent.payment_failed', {})).type).toBe(
      'payment.failed'
    );
  });

  it('maps charge.refunded → payment.refunded', () => {
    expect(normalizeStripeEvent(event('charge.refunded', {})).type).toBe('payment.refunded');
  });

  it('maps disputes and account.updated', () => {
    expect(normalizeStripeEvent(event('charge.dispute.created', {})).type).toBe('dispute.created');
    expect(normalizeStripeEvent(event('account.updated', {})).type).toBe('account.updated');
  });

  it('marks unknown event types ignored', () => {
    expect(normalizeStripeEvent(event('invoice.created', {})).type).toBe('ignored');
  });
});

describe('webhook secrets', () => {
  it('parses a single secret exactly like a plain value', () => {
    expect(parseWebhookSecrets('whsec_one')).toEqual(['whsec_one']);
    expect(parseWebhookSecrets('  whsec_one  ')).toEqual(['whsec_one']);
  });

  it('parses the two-endpoint case (account events + connect events)', () => {
    expect(parseWebhookSecrets('whsec_account,whsec_connect')).toEqual([
      'whsec_account',
      'whsec_connect',
    ]);
  });

  it('tolerates whitespace, newlines, and trailing separators', () => {
    expect(parseWebhookSecrets('whsec_a, whsec_b,\n whsec_c,')).toEqual([
      'whsec_a',
      'whsec_b',
      'whsec_c',
    ]);
  });

  it('dedupes so a doubled rotation value is tried once', () => {
    expect(parseWebhookSecrets('whsec_a,whsec_a')).toEqual(['whsec_a']);
  });

  it('treats unset/empty as no secrets — the caller warn-and-acks', () => {
    expect(parseWebhookSecrets(undefined)).toEqual([]);
    expect(parseWebhookSecrets('')).toEqual([]);
    expect(parseWebhookSecrets('   ,  ,')).toEqual([]);
  });

  it('returns null when no configured secret verifies the signature', () => {
    expect(
      constructEventWithAnySecret(Buffer.from('{}'), 't=1,v1=deadbeef', ['whsec_a', 'whsec_b'])
    ).toBeNull();
    expect(constructEventWithAnySecret(Buffer.from('{}'), 't=1,v1=x', [])).toBeNull();
  });
});
