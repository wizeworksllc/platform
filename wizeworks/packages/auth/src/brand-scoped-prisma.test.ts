// The client Better Auth's adapter reads through. These prove a sign-in method
// (an `account` row) is read and written on the request's own brand, which is
// what lets one Google identity sign in to both products: Better Auth 1.7 finds
// the account by (provider, account id) BEFORE it finds a user, and an unscoped
// read handed Piggles the sparx row. No database is reached; the Prisma
// delegates are stand-ins that return the arguments they were called with.

import { describe, expect, it, vi } from 'vitest';
import { runAsBrand } from '@wizeworksllc/brand-core/request-scope';

vi.mock('./prisma', () => {
  const echo = () => ({
    findFirst: (args: unknown) => args,
    findMany: (args: unknown) => args,
    update: (args: unknown) => args,
    create: (args: unknown) => args,
  });
  return { authPrisma: { user: echo(), account: echo(), session: echo(), jwks: echo() } };
});

const { brandScopedAuthPrisma } = await import('./brand-scoped-prisma');

type Echo = (args: unknown) => Record<string, unknown>;
const delegate = (model: string) =>
  (brandScopedAuthPrisma as unknown as Record<string, Record<string, Echo>>)[model]!;

describe('the brand-scoped auth client', () => {
  it("finds a Google sign-in only on the request's brand", () => {
    const googleLookup = {
      where: { AND: [{ providerId: 'google' }, { accountId: 'g-1' }] },
      include: { user: true },
    };
    const args = runAsBrand('piggles', () => delegate('account').findMany!(googleLookup));
    expect(args.where).toEqual({ AND: [googleLookup.where, { platformBrand: 'piggles' }] });
    expect(args.include).toEqual({ user: true });
  });

  it('writes a new sign-in method on the brand of the request, whatever the payload says', () => {
    const args = runAsBrand('piggles', () =>
      delegate('account').create!({
        data: { userId: 'u1', providerId: 'google', accountId: 'g-1', platformBrand: 'sparx' },
      })
    );
    expect(args.data).toMatchObject({ accountId: 'g-1', platformBrand: 'piggles' });
  });

  it('keeps an update by id on the same brand', () => {
    const args = runAsBrand('sparx', () =>
      delegate('account').update!({ where: { id: 'a1' }, data: { scope: 'email' } })
    );
    expect(args.where).toEqual({ id: 'a1', platformBrand: 'sparx' });
  });

  it('leaves sessions alone: they reach a brand only through their user', () => {
    const where = { token: 't1' };
    const args = runAsBrand('piggles', () => delegate('session').findFirst!({ where }));
    expect(args.where).toEqual(where);
  });
});
