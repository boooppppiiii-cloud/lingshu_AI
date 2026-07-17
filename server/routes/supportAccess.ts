import { Router } from 'express';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import {
  setSupportAccessDefaultAuthorized,
  supportAccessDefaultAuthorized,
} from '../lib/supportAccess.js';
import { writeAuditLog } from '../lib/auditLog.js';

export const supportAccessRouter = Router();

supportAccessRouter.use(requireAuth);

supportAccessRouter.get('/settings', async (_req, res) => {
  const { tenantId, supportAccess } = res.locals as AuthLocals;
  if (supportAccess) {
    res.status(403).json({ error: 'support_session_cannot_change_authorization' });
    return;
  }
  res.setHeader('Cache-Control', 'no-store');
  res.json({ defaultAuthorized: supportAccessDefaultAuthorized(tenantId) });
});

supportAccessRouter.put('/settings', async (req, res) => {
  const { tenantId, userId, supportAccess } = res.locals as AuthLocals;
  if (supportAccess) {
    res.status(403).json({ error: 'support_session_cannot_change_authorization' });
    return;
  }
  const mode = String(req.body?.mode || '');
  if (mode !== 'default' && mode !== 'off') {
    res.status(400).json({ error: 'invalid_support_access_mode' });
    return;
  }

  const defaultAuthorized = mode === 'default';
  setSupportAccessDefaultAuthorized(tenantId, userId, defaultAuthorized);
  await writeAuditLog({
    tenantId,
    actorUserId: userId,
    action: defaultAuthorized ? 'support_access_enabled' : 'support_access_disabled',
    targetType: 'tenant',
    targetId: tenantId,
  });
  res.json({ defaultAuthorized });
});
