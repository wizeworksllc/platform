'use client';

// The approve step for a repeat-order payment (docs/142 §5.3). See
// app/account/confirm-payment/page.tsx for why the page exists.
//
// The link carries everything Stripe.js needs and nothing else:
//   secret   the PaymentIntent's client secret
//   account  the merchant's connected account (sparx Pay makes direct charges
//            on it, so Stripe.js must load for it or it cannot find the intent)
//   pk       the merchant's own publishable key (stripe_direct); absent means
//            the platform's key
//
// An off-session charge the bank refused for authentication comes back in one
// of two shapes: `requires_action` (finish the bank step) or
// `requires_payment_method` with the card on `last_payment_error` (confirm again,
// on session, with that card). Both end in the same bank dialog. The webhook
// marks the order paid; this page only reports what Stripe said.
//
// Nothing runs until the customer presses the button. Opening the bank dialog
// the moment a link loads surprises people, and a mail scanner that opens links
// must not start one.

import type { PaymentIntent, Stripe } from '@stripe/stripe-js';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { Alert, Button } from '@wizeworks/silicaui-react';

import { formatMoney } from '@/lib/format';
import { getStripe, PLATFORM_PUBLISHABLE_KEY } from '@/lib/stripe-loader';

const CARDS_PAGE = '/account/payment-methods';
const REPEAT_ORDERS_PAGE = '/account/repeat-orders';

type View =
  | { kind: 'loading' }
  | { kind: 'ready'; intent: PaymentIntent }
  | { kind: 'working'; intent: PaymentIntent }
  | { kind: 'paid' }
  | { kind: 'closed' }
  | { kind: 'error'; message: string; intent?: PaymentIntent };

const BROKEN_LINK =
  'This link is not complete. Open the link in your email again, or contact the shop.';

/** The parts of the link, or null when it cannot be one we sent. */
function readLink(params: URLSearchParams): {
  secret: string;
  account?: string;
  publishableKey: string;
} | null {
  // Stripe appends `payment_intent_client_secret` when the bank step took a
  // full-page redirect and came back here.
  const secret = params.get('secret') ?? params.get('payment_intent_client_secret');
  if (!secret || !/^pi_[A-Za-z0-9]+_secret_[A-Za-z0-9]+$/.test(secret)) return null;
  const account = params.get('account');
  if (account && !/^acct_[A-Za-z0-9]+$/.test(account)) return null;
  const pk = params.get('pk');
  if (pk && !/^pk_(live|test)_[A-Za-z0-9]+$/.test(pk)) return null;
  const publishableKey = pk ?? PLATFORM_PUBLISHABLE_KEY;
  if (!publishableKey) return null;
  return { secret, publishableKey, ...(account ? { account } : {}) };
}

/** Where the intent stands, as the page it should show. */
function viewFor(intent: PaymentIntent): View {
  switch (intent.status) {
    case 'succeeded':
    case 'processing':
    case 'requires_capture':
      return { kind: 'paid' };
    case 'canceled':
      return { kind: 'closed' };
    default:
      return { kind: 'ready', intent };
  }
}

/** The card the declined off-session charge used, to try again with. */
function cardOf(intent: PaymentIntent): string | null {
  const failed = intent.last_payment_error?.payment_method;
  if (failed?.id) return failed.id;
  const pm = intent.payment_method;
  if (!pm) return null;
  return typeof pm === 'string' ? pm : pm.id;
}

export function ConfirmPaymentFlow() {
  const params = useSearchParams();
  const link = readLink(new URLSearchParams(params.toString()));
  const secret = link?.secret;
  const account = link?.account;
  const publishableKey = link?.publishableKey;

  const [stripe, setStripe] = useState<Stripe | null>(null);
  const [view, setView] = useState<View>(
    link ? { kind: 'loading' } : { kind: 'error', message: BROKEN_LINK }
  );

  useEffect(() => {
    if (!secret || !publishableKey) return;
    let live = true;
    void (async () => {
      const loaded = await getStripe(publishableKey, account);
      if (!live) return;
      if (!loaded) {
        setView({ kind: 'error', message: 'The payment form could not load. Please try again.' });
        return;
      }
      setStripe(loaded);
      const { paymentIntent, error } = await loaded.retrievePaymentIntent(secret);
      if (!live) return;
      if (error || !paymentIntent) {
        setView({ kind: 'error', message: BROKEN_LINK });
        return;
      }
      setView(viewFor(paymentIntent));
    })();
    return () => {
      live = false;
    };
  }, [secret, publishableKey, account]);

  const approve = useCallback(
    async (intent: PaymentIntent) => {
      if (!stripe || !secret) return;
      setView({ kind: 'working', intent });

      let result: { paymentIntent?: PaymentIntent; error?: { message?: string } };
      if (intent.status === 'requires_action') {
        result = await stripe.handleNextAction({ clientSecret: secret });
      } else {
        const card = cardOf(intent);
        if (!card) {
          setView({
            kind: 'error',
            message:
              'This payment has no card to approve. Add a card to your account and the shop will try again.',
            intent,
          });
          return;
        }
        result = await stripe.confirmCardPayment(secret, { payment_method: card });
      }

      if (result.error) {
        setView({
          kind: 'error',
          message: result.error.message ?? 'Your bank did not approve the payment.',
          intent,
        });
        return;
      }
      setView(result.paymentIntent ? viewFor(result.paymentIntent) : { kind: 'paid' });
    },
    [stripe, secret]
  );

  if (view.kind === 'loading') {
    return <div className="skeleton h-[160px]" role="status" aria-label="Loading" />;
  }

  if (view.kind === 'paid') {
    return (
      <div className="flex flex-col gap-4">
        <Alert color="success" role="status">
          Thank you. Your payment is approved, and your repeat order goes ahead.
        </Alert>
        <div>
          <Button color="primary" render={<Link href={REPEAT_ORDERS_PAGE} />}>
            See your repeat orders
          </Button>
        </div>
      </div>
    );
  }

  if (view.kind === 'closed') {
    return (
      <div className="flex flex-col gap-4">
        <Alert color="warning" role="status">
          This payment is closed, so there is nothing to approve here. If the shop tried again, the
          newest email has a new link. Your repeat orders page shows where things stand.
        </Alert>
        <div>
          <Button color="primary" render={<Link href={REPEAT_ORDERS_PAGE} />}>
            See your repeat orders
          </Button>
        </div>
      </div>
    );
  }

  const { intent } = view;
  const amount = intent ? formatMoney(intent.amount, intent.currency.toUpperCase()) : null;

  return (
    <div className="flex flex-col gap-4">
      {view.kind === 'error' ? <Alert color="danger">{view.message}</Alert> : null}
      {amount ? <p className="text-2xl font-semibold">{amount}</p> : null}
      <div className="flex flex-wrap gap-3">
        {intent ? (
          <Button
            color="primary"
            size="lg"
            loading={view.kind === 'working'}
            onClick={() => void approve(intent)}
          >
            {view.kind === 'error' ? 'Try again' : 'Approve payment'}
          </Button>
        ) : null}
        {view.kind === 'error' ? (
          <Button variant="outline" size="lg" render={<Link href={CARDS_PAGE} />}>
            Use a different card
          </Button>
        ) : null}
      </div>
    </div>
  );
}
