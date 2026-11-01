// Module-enablement primitives — the "disabled module = zero overhead" rule
// (locked decision #6). Extracted from @wizeworksllc/auth so it carries NO auth/email/UI
// closure: it only reads `tenants.settings.modules.<slug>.enabled`.
//
// The session-coupled `requireModule(session, …)` stays in @wizeworksllc/auth (it needs
// SparxSession); it composes the session-free `isModuleEnabled` exported here.
//
// Storage: per-tenant flags live in `tenants.settings.modules.<slug>.enabled`.
// The `tenants` table is RLS-exempt by design (the dispatch table — every request
// reads it before tenant context is set), so this helper uses the raw prisma
// client directly rather than wrapping in withTenant.
//
// Caching: a small in-process map keyed by `${tenantId}:${module}` with a 60s TTL
// avoids hammering the DB for the same flag on every request. Invalidation happens
// via the module.activated / module.deactivated event consumer.

import { prisma } from '@wizeworksllc/db';

// The module-preset contract + pure registry index (the reusable install seam).
// Type-only dep on ModuleSlug below, so no runtime cycle.
export * from './presets';
// Industry starters — the second provisioning tier that composes presets across
// modules (definitions + install seam live at the api-rest composition root).
export * from './starters';

// The roster (slugs, bundling and requirement rules, the disabled-module error) is
// pure and lives in @wizeworksllc/module-roster so frontends can install it without
// the database. Re-exported here so every platform import keeps working.
export * from '@wizeworksllc/module-roster';
import { ALL_MODULES, isModuleFlagOn, type ModuleSlug } from '@wizeworksllc/module-roster';

// ── ONE READ PER TENANT, NOT ONE PER MODULE ─────────────────────────────────
//
// Every module's flag lives in the same `tenants.settings` row, so the cache
// holds that row, not one answer per module. It was keyed per (tenant, module):
// a storefront render that asked about builder, commerce, scheduling and cms
// read the same row four times, and `activeModules` read it once per module in
// the platform. Asked at once they all missed together, and on a site visited
// less than once a minute every render is cold. WizeLens counted 565 repeated
// tenant reads across 89 requests in one day (2026-10-20).
//
// The entry is the PROMISE, stored before it settles, so concurrent questions
// share one read. A read that fails is dropped rather than kept, so one database
// blip is not served as "every module off" for a minute.

interface CacheEntry {
  settings: Promise<unknown>;
  expiresAt: number;
}
const TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

function tenantSettings(tenantId: string): Promise<unknown> {
  const hit = cache.get(tenantId);
  if (hit && hit.expiresAt > Date.now()) return hit.settings;

  const settings = prisma.tenant
    .findUnique({ where: { id: tenantId }, select: { settings: true } })
    .then((tenant) => tenant?.settings);
  const entry = { settings, expiresAt: Date.now() + TTL_MS };
  cache.set(tenantId, entry);
  settings.catch(() => {
    if (cache.get(tenantId) === entry) cache.delete(tenantId);
  });
  return settings;
}

/** Drop any cached state for a tenant — called by the module.activated /
 *  module.deactivated event consumer. Exported so tests can call it directly
 *  without waiting for the TTL.
 *
 *  `module` is accepted and no longer narrows anything: one row holds every
 *  flag, and a module switching can change others through BUNDLED_FREE
 *  (Commerce turning on turns invoicing on), so the whole tenant is re-read. */
export function invalidateModuleCache(tenantId?: string, _module?: ModuleSlug): void {
  if (tenantId) cache.delete(tenantId);
  else cache.clear();
}

/**
 * Every module active for this tenant.
 *
 * Reads through the same cache rather than a second query path, so it cannot
 * disagree with `isModuleEnabled` — two answers to "is commerce on" is exactly
 * the bug a helper like this invites.
 */
export async function activeModules(tenantId: string): Promise<ModuleSlug[]> {
  const settings = await tenantSettings(tenantId);
  return ALL_MODULES.filter((m) => isModuleFlagOn(settings, m));
}

/** Check whether a module is enabled for a tenant. Reads tenant.settings
 *  through the per-tenant cache above (60s TTL). */
export async function isModuleEnabled(tenantId: string, module: ModuleSlug): Promise<boolean> {
  // Default-deny: an unset flag means the module is not active. This mirrors the
  // production billing model — modules opt in via Stripe subscription. Dev/test
  // enables modules explicitly via the seed. `isModuleFlagOn` also honors the
  // BUNDLED_FREE graph (e.g. `invoicing` is on for any B2B/Commerce tenant), so
  // the existing per-module gates "just pass" for bundled capabilities.
  return isModuleFlagOn(await tenantSettings(tenantId), module);
}

/** List every module enabled for a tenant in a single `tenants` read. The shell
 *  uses this to filter the sidebar + breadcrumb module switcher so a tenant never
 *  sees modules it hasn't activated. Same default-deny semantics as
 *  `isModuleEnabled`. Not cached — one row read per dashboard render. */
export async function listEnabledModules(tenantId: string): Promise<ModuleSlug[]> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { settings: true },
  });
  // Includes BUNDLED_FREE capabilities (invoicing rides along with B2B/Commerce)
  // so the sidebar / breadcrumb switcher surface them for those tenants.
  return ALL_MODULES.filter((m) => isModuleFlagOn(tenant?.settings, m));
}
