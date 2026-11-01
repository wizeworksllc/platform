import type { FastifyRequest } from 'fastify';
import { isModuleEnabled } from '@wizeworksllc/auth';
import { requireAuth } from '@wizeworksllc/api-core/auth';
import { moduleDisabled } from '@wizeworksllc/api-core/errors';

export interface DropshipContext {
  tenantId: string;
  userId: string;
}

export function toDropshipContext(request: FastifyRequest): DropshipContext {
  const auth = requireAuth(request);
  return { tenantId: auth.tenantId, userId: auth.actorId };
}

export async function requireDropshipModule(request: FastifyRequest): Promise<void> {
  const auth = requireAuth(request);
  const enabled = await isModuleEnabled(auth.tenantId, 'dropship');
  if (!enabled) throw moduleDisabled('dropship');
}
