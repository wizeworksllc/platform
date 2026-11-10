// Connected accounts through Stripe's Accounts v2 API.
//
// Every sparx Pay onboarding failed with a 500: the platform created v1 accounts
// with `type: 'express'` and itself as the loss collector, which Stripe now
// refuses. What this pins:
//
//   1. A sparx Pay merchant account has no `type`, and Stripe collects its fees
//      and carries its losses (Managed Risk), with the full Stripe Dashboard.
//   2. A partner payout account only receives transfers, on the Express Dashboard.
//   3. Both go to the v2 endpoint on the pinned v2 API version, with the country
//      Stripe expects (lower case, the US when unknown).
//   4. The onboarding link asks for the configuration the account was made with.

import type Stripe from 'stripe';
import { describe, expect, it, vi } from 'vitest';

import {
  createMerchantAccount,
  createOnboardingLink,
  createRecipientAccount,
  hasExpressDashboard,
  STRIPE_V2_API_VERSION,
} from './stripe-connect-accounts.js';

function fakeStripe(response: Record<string, unknown>) {
  const rawRequest = vi.fn().mockResolvedValue(response);
  return { stripe: { rawRequest } as unknown as Stripe, rawRequest };
}

describe('createMerchantAccount', () => {
  it('makes a Managed Risk account with no legacy type', async () => {
    const { stripe, rawRequest } = fakeStripe({ id: 'acct_new' });
    const id = await createMerchantAccount(stripe, {
      email: 'owner@shop.example',
      displayName: 'Juniper Row',
      country: 'CA',
      metadata: { sparx_tenant_id: 't-1' },
    });

    expect(id).toBe('acct_new');
    const [method, path, params, opts] = rawRequest.mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
      { apiVersion: string },
    ];
    expect(method).toBe('POST');
    expect(path).toBe('/v2/core/accounts');
    expect(opts.apiVersion).toBe(STRIPE_V2_API_VERSION);
    expect(params).not.toHaveProperty('type');
    expect(params).toMatchObject({
      contact_email: 'owner@shop.example',
      display_name: 'Juniper Row',
      dashboard: 'full',
      identity: { country: 'ca' },
      configuration: { merchant: { capabilities: { card_payments: { requested: true } } } },
      defaults: { responsibilities: { fees_collector: 'stripe', losses_collector: 'stripe' } },
      metadata: { sparx_tenant_id: 't-1' },
    });
  });

  it('uses the US when the shop has not said where it is', async () => {
    for (const country of [null, undefined, '', 'United States']) {
      const { stripe, rawRequest } = fakeStripe({ id: 'acct_new' });
      await createMerchantAccount(stripe, {
        email: 'owner@shop.example',
        displayName: 'Juniper Row',
        country,
        metadata: {},
      });
      const params = rawRequest.mock.calls[0]?.[2] as { identity: { country: string } };
      expect({ country, sent: params.identity.country }).toEqual({ country, sent: 'us' });
    }
  });
});

describe('createRecipientAccount', () => {
  it('makes a transfers-only account on the Express Dashboard', async () => {
    const { stripe, rawRequest } = fakeStripe({ id: 'acct_partner' });
    const id = await createRecipientAccount(stripe, {
      email: 'partner@agency.example',
      displayName: 'Agency',
      country: 'us',
      metadata: { sparx_partner_tenant_id: 't-2' },
    });

    expect(id).toBe('acct_partner');
    const params = rawRequest.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(params).not.toHaveProperty('type');
    expect(params).toMatchObject({
      dashboard: 'express',
      configuration: {
        recipient: {
          capabilities: { stripe_balance: { stripe_transfers: { requested: true } } },
        },
      },
      defaults: {
        responsibilities: { fees_collector: 'application', losses_collector: 'application' },
      },
    });
  });
});

describe('createOnboardingLink', () => {
  it('asks Stripe-hosted onboarding for the account’s configuration', async () => {
    const { stripe, rawRequest } = fakeStripe({ url: 'https://connect.stripe.com/setup/x' });
    const url = await createOnboardingLink(stripe, {
      accountId: 'acct_new',
      configuration: 'merchant',
      returnUrl: 'https://app.example/back',
      refreshUrl: 'https://app.example/again',
    });

    expect(url).toBe('https://connect.stripe.com/setup/x');
    const [, path, params] = rawRequest.mock.calls[0] as [string, string, unknown];
    expect(path).toBe('/v2/core/account_links');
    expect(params).toEqual({
      account: 'acct_new',
      use_case: {
        type: 'account_onboarding',
        account_onboarding: {
          configurations: ['merchant'],
          return_url: 'https://app.example/back',
          refresh_url: 'https://app.example/again',
        },
      },
    });
  });
});

describe('hasExpressDashboard', () => {
  it('knows a login link opens only an Express Dashboard', () => {
    const account = (a: object) => a as Stripe.Account;
    expect(
      hasExpressDashboard(account({ controller: { stripe_dashboard: { type: 'express' } } }))
    ).toBe(true);
    expect(hasExpressDashboard(account({ type: 'express' }))).toBe(true);
    expect(
      hasExpressDashboard(account({ controller: { stripe_dashboard: { type: 'full' } } }))
    ).toBe(false);
    expect(hasExpressDashboard(account({ type: 'standard' }))).toBe(false);
  });
});
