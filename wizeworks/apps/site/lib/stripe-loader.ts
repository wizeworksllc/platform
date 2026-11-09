// One Stripe.js loader for the whole storefront.
//
// `loadStripe` is meant to run once per (publishable key, connected account), and
// the cache is keyed rather than a single slot: two tenants on different Stripe
// accounts in the same browser session must not hand each other's Elements the
// wrong account.
//
// Shared by checkout (paying), the save-card page (vaulting) and the booking
// deposit step — they mount the same Elements against the same account, so a
// second cache would mean a second Stripe.js load and, worse, two places to fix
// when the key resolution changes.

import { loadStripe, type Stripe } from '@stripe/stripe-js';

// sparx's own publishable key, inlined at BUILD time (see wizeworks/apps/site/Dockerfile).
// sparx Pay uses it together with the merchant's connected account (`stripeAccount`),
// because its intents are direct charges made ON that account. A `stripe_direct`
// tenant's intent lives on the merchant's own account and comes back with its own
// `publishableKey`, which wins over this.
export const PLATFORM_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';

const stripePromises = new Map<string, Promise<Stripe | null>>();

/** Stripe.js for a publishable key, and for the connected account the intent was
 *  made on when there is one (sparx Pay). Without the account, Stripe.js looks
 *  for the intent on the platform and says "No such payment_intent". */
export function getStripe(publishableKey: string, stripeAccount?: string): Promise<Stripe | null> {
  const cacheKey = stripeAccount ? `${publishableKey}|${stripeAccount}` : publishableKey;
  let promise = stripePromises.get(cacheKey);
  if (!promise) {
    promise = stripeAccount
      ? loadStripe(publishableKey, { stripeAccount })
      : loadStripe(publishableKey);
    stripePromises.set(cacheKey, promise);
  }
  return promise;
}
