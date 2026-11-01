// What the platform holds about Piggles must equal what Piggles says.
//
// The platform keeps Piggles' billing plan and drawn logo in
// @wizeworks/brand-registry, because api-rest and the site renderer serve every
// brand and may not import Piggles' code. That is a second copy of each fact,
// and both drift silently: a price change here and not there quotes $99 while
// Stripe charges something else, and a re-drawn logo here and not there puts
// last year's mark on every tenant site. This test is the Piggles half of the
// guard; scripts/check-billing-plans.mjs and scripts/check-brand-wordmark.mjs
// hold the registry to the deployed ConfigMap.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { WORDMARK_ENV_VALUE } from '@piggles/brand';
import { describe, expect, it } from 'vitest';

import { PRICE_LABEL, PRICE_MONTHLY } from './pricing';

const require = createRequire(import.meta.url);
const registry = (file: string): unknown =>
  JSON.parse(readFileSync(require.resolve(`@wizeworks/brand-registry/piggles/${file}`), 'utf8'));

describe('the platform brand registry', () => {
  it('bills the price Piggles quotes', () => {
    const plan = registry('billing-plan.json') as { base: { monthlyCents: number } };
    expect(plan.base.monthlyCents).toBe(PRICE_MONTHLY * 100);
    expect(PRICE_LABEL).toBe(`$${PRICE_MONTHLY}`);
  });

  it('draws the logo Piggles draws', () => {
    // A failure here means the logo was re-drawn. Copy WORDMARK_ENV_VALUE into
    // the registry's wordmark.json, then run `pnpm check:brand-wordmark --update`.
    expect(JSON.stringify(registry('wordmark.json'))).toBe(WORDMARK_ENV_VALUE);
  });
});
