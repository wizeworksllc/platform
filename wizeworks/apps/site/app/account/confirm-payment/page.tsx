// Confirm a repeat-order payment the customer's bank wants them to approve
// (docs/142 §5.3).
//
// A renewal is charged with nobody present. Sometimes the bank still asks the
// cardholder to approve it (3-D Secure). The renewal email then links here, and
// this page lets them approve it. Without the page that link was a 404, so the
// renewal sat unpaid, went down the retry ladder, and could cancel a repeat order
// whose card was fine.
//
// Public, like the email-confirm link: the client secret in the link is what lets
// Stripe.js approve this one payment, and nothing else. Signing in first would
// add a step between a customer and money they are trying to pay.

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { ConfirmPaymentFlow } from '@/components/checkout/confirm-payment-flow';
import { resolveSite } from '@/lib/site-context';
import { requireSiteModule } from '@/lib/site-modules';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Confirm your payment',
  robots: { index: false, follow: false },
};

export default async function ConfirmPaymentPage() {
  const site = await resolveSite();
  if (!site) notFound();
  // Repeat orders are part of selling. A site with selling switched off has none.
  requireSiteModule(site, 'commerce');

  return (
    <div className="mx-auto w-full max-w-[560px] px-6 py-8">
      <h1 className="text-base-content mb-2 text-4xl font-semibold tracking-tight">
        Confirm your payment
      </h1>
      <p className="text-md mb-6">
        Your bank wants you to approve this repeat order payment. It takes a moment, and your order
        goes ahead as soon as you do.
      </p>
      {/* useSearchParams needs a Suspense boundary to keep the route from
          opting the whole page out of static rendering. */}
      <Suspense fallback={<div className="skeleton h-[160px]" />}>
        <ConfirmPaymentFlow />
      </Suspense>
    </div>
  );
}
