// The platform fee rule (docs/94 ADR §8). ONE rule, no tiers, no plan-based fees
// ("we don't have tiers, we have modules"):
//   {platform} Pay → a flat rate, collected in-flow via Stripe application_fee_amount
//   everything else (stripe_direct, paypal, manual) → $0: the platform isn't in the flow.
//
// The rate is per BRAND, not per tenant: it is part of what a brand promises its
// owners. The default is 0.5%. A brand whose promise is "no fee on your sales"
// sets `<BRAND>_PAY_FEE_BPS=0`, and its Pay then takes nothing on top of Stripe's
// card fee (docs/94 amendment v1.2). Basis points, because a rate in an
// environment variable must be an integer to be read the same way everywhere.

import { brandEnvName } from '@wizeworksllc/brand-core';

/** Where a fee rate goes in provider text: "plus a flat {payFee}". */
export const PAY_FEE_TOKEN = '{payFee}';

/** The default rate, in basis points: 50 = 0.5%. */
export const DEFAULT_PAY_FEE_BPS = 50;

/** The default rate as a fraction (0.005). */
export const SPARX_PAY_FEE_RATE = DEFAULT_PAY_FEE_BPS / 10_000;

/** The highest rate a brand can set: 10%. Anything above is a typo, not policy. */
const MAX_PAY_FEE_BPS = 1_000;

/**
 * One brand's Pay fee, in basis points, from `<BRAND>_PAY_FEE_BPS`.
 *
 * Unset means the default. A value that is not a whole number from 0 to 1000
 * THROWS: a typo here either overcharges every merchant of the brand or gives
 * away the platform's fee, and both must stop the charge rather than guess.
 */
export function payFeeBps(brand: string | null | undefined): number {
  const name = brandEnvName(brand ?? '', 'PAY_FEE_BPS');
  const raw = typeof process === 'undefined' ? undefined : process.env[name]?.trim();
  if (!raw) return DEFAULT_PAY_FEE_BPS;
  const bps = Number(raw);
  if (!Number.isInteger(bps) || bps < 0 || bps > MAX_PAY_FEE_BPS) {
    throw new Error(`${name} must be a whole number of basis points from 0 to ${MAX_PAY_FEE_BPS}`);
  }
  return bps;
}

/** The rate as people read it: "0.5%", "0.25%", "1%". */
export function formatPayFee(bps: number): string {
  return `${Number((bps / 100).toFixed(2))}%`;
}

/** The Pay fee for an amount, in cents, at a rate in basis points. */
export function sparxPayFeeCents(amountCents: number, bps: number = DEFAULT_PAY_FEE_BPS): number {
  return Math.round((amountCents * bps) / 10_000);
}
