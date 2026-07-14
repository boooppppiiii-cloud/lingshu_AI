import { Router } from 'express';
import { isDemoMode } from '../lib/demo.js';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import { getTenantPlatformApp } from '../lib/tenantPlatformApps.js';

export const platformIntegrationsRouter = Router();

const SUPPORTED = ['shopify', 'tiktok', 'instagram', 'facebook', 'youtube', 'whatsapp'] as const;

platformIntegrationsRouter.get('/providers', (_req, res) => {
  res.json({
    providers: SUPPORTED.map(id => ({
      id,
      oauth: ['shopify', 'tiktok', 'instagram', 'facebook', 'youtube'].includes(id),
      messaging: ['whatsapp'].includes(id),
      implemented: false,
      owner: 'platform-integrations',
    })),
  });
});

platformIntegrationsRouter.post('/:provider/connect', (req, res) => {
  const { provider } = req.params;
  if (!SUPPORTED.includes(provider as any)) { res.status(404).json({ error: 'unsupported_provider' }); return; }
  if (isDemoMode()) {
    res.json({
      ok: true,
      source: 'demo',
      provider,
      account: { id: `demo_${provider}`, name: `${provider} Demo Account` },
      message: '账号连接测试通过。',
    });
    return;
  }
  res.status(501).json({ error: 'not_implemented', provider, expectedOwner: 'platform-integrations' });
});

platformIntegrationsRouter.get('/:provider/status', requireAuth, async (req, res) => {
  const { provider } = req.params;
  if (!SUPPORTED.includes(provider as any)) { res.status(404).json({ error: 'unsupported_provider' }); return; }
  const { tenantId } = res.locals as AuthLocals;
  const appPlatform = ['whatsapp', 'facebook', 'instagram'].includes(provider)
    ? 'meta'
    : provider === 'youtube'
      ? 'google'
      : null;
  if (appPlatform) {
    const app = await getTenantPlatformApp(tenantId, appPlatform);
    if (app) {
      const userStatus = app.status === 'active'
        ? 'connected'
        : app.status === 'waiting_customer'
          ? 'waiting_customer'
          : app.status === 'importing_history'
            ? 'importing'
            : app.status === 'token_expired' || app.status === 'error'
              ? 'needs_service'
              : 'advisor_configuring';
      const label = userStatus === 'connected'
        ? '\u5df2\u7531\u4e13\u5c5e\u987e\u95ee\u914d\u7f6e \u2713'
        : userStatus === 'waiting_customer'
          ? '\u7b49\u5f85\u4f60\u626b\u7801\u6216\u5b8c\u6210\u6388\u6743'
          : userStatus === 'importing'
            ? '\u6b63\u5728\u5bfc\u5165\u5386\u53f2\u804a\u5929'
            : userStatus === 'needs_service'
              ? '\u9700\u8981\u987e\u95ee\u5904\u7406'
              : '\u4e13\u5c5e\u987e\u95ee\u914d\u7f6e\u4e2d';
      res.json({
        provider,
        connected: app.status === 'active',
        source: 'tenant_platform_app',
        status: userStatus,
        label,
        account: { id: app.id, name: label },
      });
      return;
    }
  }
  res.json({
    provider,
    connected: isDemoMode(),
    source: isDemoMode() ? 'demo' : 'stub',
    account: isDemoMode() ? { id: `demo_${provider}`, name: `${provider} Demo Account` } : null,
  });
});

platformIntegrationsRouter.post('/:provider/sync', (req, res) => {
  const { provider } = req.params;
  if (!SUPPORTED.includes(provider as any)) { res.status(404).json({ error: 'unsupported_provider' }); return; }
  if (isDemoMode()) {
    res.json({ ok: true, source: 'demo', provider, jobId: `demo_sync_${Date.now()}`, syncedAt: new Date().toISOString() });
    return;
  }
  res.status(501).json({ error: 'not_implemented', provider, expectedOwner: 'platform-integrations' });
});

platformIntegrationsRouter.post('/:provider/publish', (req, res) => {
  const { provider } = req.params;
  if (!SUPPORTED.includes(provider as any)) { res.status(404).json({ error: 'unsupported_provider' }); return; }
  if (isDemoMode()) {
    res.json({ ok: true, source: 'demo', provider, postId: `demo_post_${Date.now()}`, payload: req.body ?? {} });
    return;
  }
  res.status(501).json({ error: 'not_implemented', provider, expectedOwner: 'platform-integrations' });
});

platformIntegrationsRouter.delete('/:provider', (req, res) => {
  const { provider } = req.params;
  if (!SUPPORTED.includes(provider as any)) { res.status(404).json({ error: 'unsupported_provider' }); return; }
  res.json({ ok: true, source: isDemoMode() ? 'demo' : 'stub', provider });
});
