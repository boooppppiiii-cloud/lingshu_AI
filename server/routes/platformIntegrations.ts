import { Router } from 'express';
import { isDemoMode } from '../lib/demo.js';

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

platformIntegrationsRouter.get('/:provider/status', (req, res) => {
  const { provider } = req.params;
  if (!SUPPORTED.includes(provider as any)) { res.status(404).json({ error: 'unsupported_provider' }); return; }
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
