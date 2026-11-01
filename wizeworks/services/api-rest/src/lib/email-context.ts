// Bridge between Fastify auth context and @wizeworksllc/email-platform's
// ServiceContext. Mirrors crm-context.ts: every email service function takes
// `(ctx: ServiceContext, args)`; the REST transport derives that ctx and gates
// on the email module being active for the tenant.

import type { FastifyRequest } from 'fastify';
import type { ServiceContext } from '@wizeworksllc/email-platform';
import { isModuleEnabled } from '@wizeworksllc/auth';
import { requireAuth } from '@wizeworksllc/api-core/auth';
import { moduleDisabled } from '@wizeworksllc/api-core/errors';

export function toEmailContext(request: FastifyRequest): ServiceContext {
  const auth = requireAuth(request);
  return { tenantId: auth.tenantId, userId: auth.actorId };
}

/** Throws MODULE_DISABLED (→ 404 envelope) if the caller's tenant doesn't have
 *  the email module active. Pairs with requireAuth — call once per handler
 *  before any service call. */
export async function requireEmailModule(request: FastifyRequest): Promise<void> {
  const auth = requireAuth(request);
  const enabled = await isModuleEnabled(auth.tenantId, 'email');
  if (!enabled) throw moduleDisabled('email');
}
