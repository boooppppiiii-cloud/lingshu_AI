import { Router } from 'express';
import { decryptSecret, getTenantPlatformApp, verifyMetaSignature } from '../lib/tenantPlatformApps.js';
import { handleMetaWebhook } from '../whatsapp/historyImport.js';
import { decryptWeComEcho, verifyWeComSignature } from '../integrations/wecom.js';

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

  void handleMetaWebhook(tenantId, req.body).catch(error => console.error('[meta-webhook-ingest]', error));
  console.log('[meta-webhook]', tenantId, JSON.stringify(req.body).slice(0, 500));
  res.json({ ok: true });
});

webhookRouter.get('/wecom/:tenantId', async (req, res) => {
  const tenantId = text(req.params.tenantId);
  const app = await getTenantPlatformApp(tenantId, 'wecom');
  const token = text(app?.webhook_verify_token);
  const encodingAesKey = decryptSecret(app?.wecom_encoding_aes_key);
  const signature = text(req.query.msg_signature);
  const timestamp = text(req.query.timestamp);
  const nonce = text(req.query.nonce);
  const echostr = text(req.query.echostr);

  if (!app || !token || !encodingAesKey || !signature || !timestamp || !nonce || !echostr) {
    res.status(403).send('forbidden');
    return;
  }
  if (!verifyWeComSignature({ token, timestamp, nonce, encrypted: echostr, signature })) {
    res.status(403).send('invalid_signature');
    return;
  }

  try {
    res.status(200).send(decryptWeComEcho({
      encodingAesKey,
      encryptedEcho: echostr,
      corpId: text(app.app_id),
    }));
  } catch (error) {
    console.error('[wecom-webhook-verify]', error);
    res.status(400).send('decrypt_failed');
  }
});

webhookRouter.post('/wecom/:tenantId', async (req, res) => {
  const tenantId = text(req.params.tenantId);
  const app = await getTenantPlatformApp(tenantId, 'wecom');
  if (!app) {
    res.status(404).json({ error: 'tenant_wecom_app_not_configured' });
    return;
  }
  console.log('[wecom-webhook]', tenantId, JSON.stringify(req.body ?? {}).slice(0, 500));
  res.json({ ok: true });
});
