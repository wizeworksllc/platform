// The stored sparx Pay switch follows what Stripe says (sparx persona issue 326).
// The site and checkout read only the stored switch. An owner who finished
// Stripe's setup read "Active, taking payments" on Payment providers while her
// checkout said it could not take an order, because the read showed Stripe's
// live answer and saved nothing.
//
// Onboarding makes an account Stripe accepts (2026-11-09). Every "Connect
// payments" click returned a 500 for 30 days: the v1 `type: 'express'` account
// had the platform carrying the losses, which Stripe refuses.

import { beforeEach, describe, expect, it, vi } from 'vitest';

interface Row {
  gatewayId: string;
  isActive: boolean;
  onboardedAt: Date | null;
}

let row: Row;
let account: Record<string, unknown>;
let storedAccountId: string | null;
const updates: Partial<Row>[] = [];
const published: unknown[] = [];
const tenantWrites: unknown[] = [];

const stripe = {
  accounts: {
    retrieve: vi.fn(() => Promise.resolve(account)),
    createLoginLink: vi.fn(() => Promise.resolve({ url: 'https://connect.stripe.com/express/x' })),
  },
  accountLinks: { create: vi.fn() },
  rawRequest: vi.fn(),
};

vi.mock('@wizeworksllc/db', () => {
  const tx = {
    tenantBusiness: {
      findUnique: () => Promise.resolve({ country: 'GB' }),
    },
    tenantPaymentConfig: {
      findUnique: () => Promise.resolve({ ...row }),
      create: () => Promise.resolve({ ...row }),
      update: ({ data }: { data: Partial<Row> }) => {
        updates.push(data);
        row = { ...row, ...data };
        return Promise.resolve({ ...row });
      },
    },
  };
  return {
    prisma: {
      tenant: {
        findUnique: () =>
          Promise.resolve({
            id: TENANT,
            stripeAccountId: storedAccountId,
            email: 'owner@shop.example',
            name: 'Juniper Row LLC',
          }),
        update: ({ data }: { data: { stripeAccountId: string } }) => {
          tenantWrites.push(data);
          storedAccountId = data.stripeAccountId;
          return Promise.resolve({});
        },
      },
    },
    withTenant: (_ctx: unknown, fn: (t: typeof tx) => unknown) => fn(tx),
  };
});
vi.mock('@wizeworksllc/payments', () => ({
  getGatewayDescriptor: () => undefined,
  getPlatformStripe: () => stripe,
}));
vi.mock('@wizeworksllc/events', () => ({
  createPublisher: () => ({}),
  publishEvent: (_p: unknown, type: string) => {
    published.push(type);
    return Promise.resolve();
  },
}));
vi.mock('../env.js', () => ({ env: {} }));
vi.mock('./gateway-credentials.js', () => ({ hasActiveCredentials: () => Promise.resolve(false) }));

const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const {
  getPaymentConfig,
  reconcileSparxPayAccount,
  sparxPayDashboardLink,
  startSparxPayOnboarding,
  STRIPE_DASHBOARD_URL,
} = await import('./payments-onboarding.js');

const LIVE = {
  charges_enabled: true,
  payouts_enabled: true,
  details_submitted: true,
  requirements: { currently_due: [], past_due: [], pending_verification: [] },
};

beforeEach(() => {
  row = { gatewayId: 'sparx_pay', isActive: false, onboardedAt: null };
  account = LIVE;
  storedAccountId = 'acct_test';
  updates.length = 0;
  published.length = 0;
  tenantWrites.length = 0;
  stripe.rawRequest.mockReset();
  stripe.accountLinks.create.mockReset();
  stripe.accounts.createLoginLink.mockClear();
});

const URLS = { returnUrl: 'https://app.example/back', refreshUrl: 'https://app.example/again' };

describe('startSparxPayOnboarding', () => {
  it('makes a Managed Risk account for a new shop, keeps it, and links to onboarding', async () => {
    storedAccountId = null;
    stripe.rawRequest.mockImplementation((_m: string, path: string) =>
      Promise.resolve(
        path === '/v2/core/accounts'
          ? { id: 'acct_new' }
          : { url: 'https://connect.stripe.com/setup/new' }
      )
    );

    const result = await startSparxPayOnboarding({ tenantId: TENANT, ...URLS });

    expect(result).toEqual({ url: 'https://connect.stripe.com/setup/new', accountId: 'acct_new' });
    const [, , params] = stripe.rawRequest.mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(params).not.toHaveProperty('type');
    expect(params).toMatchObject({
      contact_email: 'owner@shop.example',
      display_name: 'Juniper Row LLC',
      identity: { country: 'gb' },
      defaults: { responsibilities: { losses_collector: 'stripe', fees_collector: 'stripe' } },
      metadata: { sparx_tenant_id: TENANT },
    });
    expect(tenantWrites).toEqual([{ stripeAccountId: 'acct_new' }]);
    expect(stripe.accountLinks.create).not.toHaveBeenCalled();
  });

  it('reuses the account a shop already has', async () => {
    stripe.rawRequest.mockResolvedValue({ url: 'https://connect.stripe.com/setup/again' });
    const result = await startSparxPayOnboarding({ tenantId: TENANT, ...URLS });
    expect(result.accountId).toBe('acct_test');
    expect(stripe.rawRequest).toHaveBeenCalledTimes(1);
    expect(stripe.rawRequest.mock.calls[0]?.[1]).toBe('/v2/core/account_links');
    expect(tenantWrites).toEqual([]);
  });

  it('falls back to a v1 link for an account made the old way', async () => {
    stripe.rawRequest.mockRejectedValue(new Error('configs_must_match_to_use_account_links'));
    stripe.accountLinks.create.mockResolvedValue({ url: 'https://connect.stripe.com/setup/v1' });
    const result = await startSparxPayOnboarding({ tenantId: TENANT, ...URLS });
    expect(result.url).toBe('https://connect.stripe.com/setup/v1');
  });

  it('reports Stripe’s v2 error when neither link works', async () => {
    stripe.rawRequest.mockRejectedValue(new Error('v2 said no'));
    stripe.accountLinks.create.mockRejectedValue(new Error('v1 said no'));
    await expect(startSparxPayOnboarding({ tenantId: TENANT, ...URLS })).rejects.toThrow(
      'v2 said no'
    );
  });
});

describe('sparxPayDashboardLink', () => {
  it('sends a full-Dashboard merchant to Stripe’s own sign-in', async () => {
    account = { ...LIVE, controller: { stripe_dashboard: { type: 'full' } } };
    expect(await sparxPayDashboardLink(TENANT)).toBe(STRIPE_DASHBOARD_URL);
    expect(stripe.accounts.createLoginLink).not.toHaveBeenCalled();
  });

  it('opens an Express account made before the change with a login link', async () => {
    account = { ...LIVE, type: 'express', controller: { stripe_dashboard: { type: 'express' } } };
    expect(await sparxPayDashboardLink(TENANT)).toBe('https://connect.stripe.com/express/x');
  });

  it('has nothing to open before onboarding starts', async () => {
    storedAccountId = null;
    expect(await sparxPayDashboardLink(TENANT)).toBeNull();
  });
});

describe('getPaymentConfig', () => {
  it('saves a sparx Pay account Stripe now lets charge, and tells the site', async () => {
    const config = await getPaymentConfig(TENANT);
    expect(config.isActive).toBe(true);
    expect(config.onboardedAt).not.toBeNull();
    expect(row.isActive).toBe(true);
    expect(row.onboardedAt).toBeInstanceOf(Date);
    expect(published).toEqual(['site.updated']);
  });

  it('writes nothing when the stored switch already matches', async () => {
    row = { gatewayId: 'sparx_pay', isActive: true, onboardedAt: new Date() };
    await getPaymentConfig(TENANT);
    expect(updates).toEqual([]);
    expect(published).toEqual([]);
  });

  it('switches off a sparx Pay shop Stripe stopped letting charge', async () => {
    row = { gatewayId: 'sparx_pay', isActive: true, onboardedAt: new Date() };
    account = { ...LIVE, charges_enabled: false };
    const config = await getPaymentConfig(TENANT);
    expect(config.isActive).toBe(false);
    expect(row.isActive).toBe(false);
  });

  it('never touches the switch of a shop that takes payment another way', async () => {
    row = { gatewayId: 'stripe_direct', isActive: true, onboardedAt: new Date() };
    account = { ...LIVE, charges_enabled: false };
    const config = await getPaymentConfig(TENANT);
    expect(config.isActive).toBe(true);
    expect(updates).toEqual([]);
  });

  it('passes on what Stripe still needs, past due first, once each (issue 327)', async () => {
    account = {
      ...LIVE,
      charges_enabled: false,
      requirements: {
        past_due: ['individual.verification.document'],
        currently_due: ['individual.verification.document', 'external_account'],
        pending_verification: [],
      },
    };
    const config = await getPaymentConfig(TENANT);
    expect(config.sparxPay.due).toEqual(['individual.verification.document', 'external_account']);
    expect(config.sparxPay.checking).toBe(false);
  });

  it('says when Stripe is checking what it was given', async () => {
    account = {
      ...LIVE,
      charges_enabled: false,
      requirements: {
        currently_due: [],
        past_due: [],
        pending_verification: ['individual.dob.day'],
      },
    };
    expect((await getPaymentConfig(TENANT)).sparxPay.checking).toBe(true);
  });
});

describe('reconcileSparxPayAccount', () => {
  it('switches a sparx Pay shop on from account.updated', async () => {
    await reconcileSparxPayAccount({ id: 'acct_test', charges_enabled: true });
    expect(row.isActive).toBe(true);
  });

  it('leaves a shop on its own Stripe keys alone when an old sparx Pay account changes', async () => {
    row = { gatewayId: 'stripe_direct', isActive: true, onboardedAt: new Date() };
    await reconcileSparxPayAccount({ id: 'acct_test', charges_enabled: false });
    expect(row.isActive).toBe(true);
    expect(updates).toEqual([]);
  });
});
