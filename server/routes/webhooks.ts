import { Router } from 'express';
import { decryptSecret, getTenantPlatformApp, verifyMetaSignature } from '../lib/tenantPlatformApps.js';

export const webhookRouter = Router();

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

webhookRouter.get('/meta/:tenantId', async (req, res) => {
  const tenantId = text(req.params.tenantId);
  const mode = text(req.query['hub.mode']);
  const token = text(req.query['hub.verify_token']);
  const challenge = text(req.query['hub.challenge']);
  const app = await getTenantPlatformApp(tenantId, 'meta');

  if (!app?.webhook_verify_token || token !== app.webhook_verify_token || mode !== 'subscribe') {
    res.status(403).send('forbidden');
    return;
  }
  res.status(200).send(challenge);
});

webhookRouter.post('/meta/:tenantId', async (req, res) => {
  const tenantId = text(req.params.tenantId);
  const app = await getTenantPlatformApp(tenantId, 'meta');
  const appSecret = decryptSecret(app?.app_secret);
  if (!app || !appSecret) {
    res.status(404).json({ error: 'tenant_meta_app_not_configured' });
    return;
  }

  const rawBody = (req as any).rawBody instanceof Buffer
    ? (req as any).rawBody as Buffer
    : Buffer.from(JSON.stringify(req.body ?? {}));
  if (!verifyMetaSignature(appSecret, rawBody, req.headers['x-hub-signature-256'])) {
    res.status(403).json({ error: 'invalid_signature' });
    return;
  }

  // The ingestion pipeline can subscribe here later. For now we acknowledge fast,
  // because Meta retries aggressively if the webhook takes too long.
  console.log('[meta-webhook]', tenantId, JSON.stringify(req.body).slice(0, 500));
  res.json({ ok: true });
});
