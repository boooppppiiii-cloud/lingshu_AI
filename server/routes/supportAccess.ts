import { Router } from 'express';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import { store } from '../storage/index.js';

const COLLECTION = 'tenant_support_settings';

export const supportAccessRouter = Router();

supportAccessRouter.use(requireAuth);

supportAccessRouter.get('/settings', async (_req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const result = await store.list<Record<string, unknown>>(COLLECTION, {
    where: { tenant_id: tenantId },
    page: 1,
    perPage: 1,
  });
  const setting = result.items[0];
  res.json({ defaultAuthorized: setting?.default_authorized !== false });
});

supportAccessRouter.put('/settings', async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  const mode = String(req.body?.mode || '');
  if (mode !== 'default' && mode !== 'off') {
    res.status(400).json({ error: 'invalid_support_access_mode' });
    return;
  }

  const defaultAuthorized = mode === 'default';
  const existing = await store.list<Record<string, unknown>>(COLLECTION, {
    where: { tenant_id: tenantId },
    page: 1,
    perPage: 1,
  });
  const setting = existing.items[0];
  const saved = setting?.id
    ? await store.update(COLLECTION, String(setting.id), { default_authorized: defaultAuthorized, updated_by: userId })
    : Boolean(await store.create(COLLECTION, { tenant_id: tenantId, default_authorized: defaultAuthorized, updated_by: userId }));

  if (!saved) {
    res.status(503).json({ error: 'support_access_settings_unavailable' });
    return;
  }
  res.json({ defaultAuthorized });
});
