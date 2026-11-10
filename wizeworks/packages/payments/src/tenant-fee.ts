// The Pay fee for ONE TENANT's charge: its brand's rate (fee.ts), applied.
//
// Kept apart from fee.ts so the catalog, which only needs the rate rules, does
// not pull in a database client.

import { prisma, withSystem } from '@wizeworksllc/db';

import { payFeeBps, sparxPayFeeCents } from './fee';

/** Tenant → brand. A tenant never changes brand, so one read per process is enough. */
const brandByTenant = new Map<string, string | null>();

/**
 * Which brand a tenant signed up under. Read through `withSystem`: `tenants` is
 * the non-RLS dispatch row and carries no tenant policy (see api-rest
 * routes/v1/me.ts).
 */
async function tenantBrand(tenantId: string): Promise<string | null> {
  if (brandByTenant.has(tenantId)) return brandByTenant.get(tenantId) ?? null;
  const tenant = await withSystem(() =>
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { platformBrand: true } })
  );
  const brand = tenant?.platformBrand ?? null;
  brandByTenant.set(tenantId, brand);
  return brand;
}

/** The Pay fee a tenant's charge carries, in cents, at its brand's rate. */
export async function tenantPayFeeCents(tenantId: string, amountCents: number): Promise<number> {
  return sparxPayFeeCents(amountCents, payFeeBps(await tenantBrand(tenantId)));
}

/** Test seam: forget the tenant → brand reads. */
export function resetTenantBrandCache(): void {
  brandByTenant.clear();
}
