import { store } from '../storage/index.js';

export interface AuditLogInput {
  tenantId: string;
  actorUserId: string;
  actorEmail?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}

export async function writeAuditLog(input: AuditLogInput): Promise<void> {
  const tenantId = String(input.tenantId || '').trim();
  const actorUserId = String(input.actorUserId || '').trim();
  if (!tenantId || !actorUserId || !input.action) return;

  const created = await store.create('audit_logs', {
    tenantId,
    actorUserId,
    actorEmail: String(input.actorEmail || '').trim().toLowerCase(),
    action: input.action,
    targetType: String(input.targetType || ''),
    targetId: String(input.targetId || ''),
    metadata: input.metadata || {},
    createdAt: new Date().toISOString(),
  });
  if (!created && process.env.NODE_ENV === 'production') {
    throw new Error('audit_log_write_failed');
  }
}
