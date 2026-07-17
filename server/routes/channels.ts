import { Router, type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { verifyWhatsAppWebhook, getPhoneNumberInfo } from '../integrations/whatsapp.js';
import { getBotInfo, sendTelegramMessage } from '../integrations/telegram.js';
import { testDingTalk } from '../integrations/dingtalk.js';
import { testFeishu } from '../integrations/feishu.js';
import { getShopInfo, testShopify } from '../integrations/shopify.js';
import { isDemoMode } from '../lib/demo.js';
import { handleMetaWebhook } from '../whatsapp/historyImport.js';
import { sendTenantWhatsAppText } from '../whatsapp/send.js';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import { requireAdminUser } from '../lib/demoAccounts.js';
import { getTenantPlatformApp, type TenantPlatformAppRecord, type TenantPlatformStatus } from '../lib/tenantPlatformApps.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, '../../data/channels.json');

export interface Channel {
  id: string;
  type: 'whatsapp' | 'youtube' | 'tiktok' | 'instagram' | 'facebook' | 'telegram' | 'dingtalk' | 'feishu' | 'wechat' | 'wecom' | 'shopify';
  label: string;
  enabled: boolean;
  config: Record<string, string>;
  status: 'connected' | 'disconnected' | 'error';
  connectedAt?: string;
  lastActivity?: string;
  stats: { sent: number; received: number };
}

function load(): Channel[] {
  try { return JSON.parse(fs.readFileSync(DATA, 'utf8')); } catch { return []; }
}
function save(channels: Channel[]) {
  fs.writeFileSync(DATA, JSON.stringify(channels, null, 2));
}

export const channelsRouter = Router();

type TenantChannelStatus = 'advisor_configuring' | 'waiting_customer' | 'importing' | 'connected' | 'needs_service';

const USER_CHANNELS = [
  { id: 'whatsapp', name: 'WhatsApp Business', platform: 'meta' as const, oauth: true },
  { id: 'instagram', name: 'Instagram', platform: 'meta' as const, oauth: true },
  { id: 'facebook', name: 'Facebook', platform: 'meta' as const, oauth: true },
  { id: 'youtube', name: 'YouTube', platform: 'google' as const, oauth: true },
  { id: 'wecom', name: '企业微信', platform: 'wecom' as const, oauth: false },
] as const;

function tenantStatus(status?: TenantPlatformStatus): TenantChannelStatus {
  if (status === 'active') return 'connected';
  if (status === 'waiting_customer') return 'waiting_customer';
  if (status === 'importing_history' || status === 'verifying') return 'importing';
  if (status === 'token_expired' || status === 'error' || status === 'needs_permanent_token') return 'needs_service';
  return 'advisor_configuring';
}

function lastCheckedAt(app: TenantPlatformAppRecord | null): string | null {
  if (!app) return null;
  const record = app as TenantPlatformAppRecord & { updated?: string; updatedAt?: string; created?: string; createdAt?: string };
  return record.updated || record.updatedAt || record.created || record.createdAt || null;
}

channelsRouter.get('/status', requireAuth, async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const isAdmin = Boolean(await requireAdminUser(req));
  const metaApp = await getTenantPlatformApp(tenantId, 'meta');
  const googleApp = await getTenantPlatformApp(tenantId, 'google');
  const wecomApp = await getTenantPlatformApp(tenantId, 'wecom');
  const platformApps = { meta: metaApp, google: googleApp, wecom: wecomApp };

  res.json({
    isAdmin,
    channels: USER_CHANNELS.map(channel => {
      const app = platformApps[channel.platform];
      const status = tenantStatus(app?.status);
      return {
        id: channel.id,
        name: channel.name,
        oauth: channel.oauth,
        status,
        lastCheckedAt: lastCheckedAt(app),
        needsAuthorization: status === 'waiting_customer',
      };
    }),
  });
});

channelsRouter.get('/', (_req, res) => res.json(load()));

channelsRouter.post('/', (req: Request, res: Response) => {
  const channels = load();
  const channel: Channel = {
    id: `ch_${Date.now()}`,
    type: req.body.type,
    label: req.body.label ?? req.body.type,
    enabled: false,
    config: req.body.config ?? {},
    status: 'disconnected',
    stats: { sent: 0, received: 0 },
  };
  channels.push(channel);
  save(channels);
  res.json(channel);
});

channelsRouter.put('/:id', (req: Request, res: Response) => {
  const channels = load();
  const idx = channels.findIndex(c => c.id === req.params.id);
  if (idx === -1) { res.status(404).json({ error: 'not found' }); return; }
  channels[idx] = { ...channels[idx], ...req.body };
  save(channels);
  res.json(channels[idx]);
});

channelsRouter.delete('/:id', (req: Request, res: Response) => {
  const channels = load().filter(c => c.id !== req.params.id);
  save(channels);
  res.json({ ok: true });
});

// Test connection
channelsRouter.post('/:id/test', async (req: Request, res: Response) => {
  const channel = load().find(c => c.id === req.params.id);
  if (!channel) { res.status(404).json({ error: 'not found' }); return; }
  const cfg = channel.config;

  if (isDemoMode()) {
    const channels = load();
    const idx = channels.findIndex(c => c.id === req.params.id);
    if (idx !== -1) {
      channels[idx].status = 'connected';
      channels[idx].connectedAt = new Date().toISOString();
      channels[idx].enabled = true;
      save(channels);
    }
    res.json({ ok: true, source: 'demo', info: { message: '连接测试通过。' } });
    return;
  }

  try {
    switch (channel.type) {
      case 'whatsapp': {
        const info = await getPhoneNumberInfo({ phoneNumberId: cfg.phoneNumberId, accessToken: cfg.accessToken, verifyToken: cfg.verifyToken });
        res.json({ ok: true, info });
        break;
      }
      case 'telegram': {
        const info = await getBotInfo({ botToken: cfg.botToken });
        res.json({ ok: true, info });
        break;
      }
      case 'dingtalk': {
        const ok = await testDingTalk({ webhookUrl: cfg.webhookUrl, secret: cfg.secret });
        res.json({ ok });
        break;
      }
      case 'feishu': {
        const ok = await testFeishu({ webhookUrl: cfg.webhookUrl, secret: cfg.secret });
        res.json({ ok });
        break;
      }
      case 'shopify': {
        const result = await testShopify(cfg as any);
        res.json(result);
        break;
      }
      case 'youtube':
      case 'tiktok':
      case 'instagram':
      case 'facebook':
        res.json({ ok: true, info: { account: cfg.accountName ?? cfg.pageName ?? channel.label } });
        break;
      default:
        res.json({ ok: false, error: 'unsupported' });
    }

    // Update status on success
    const channels = load();
    const idx = channels.findIndex(c => c.id === req.params.id);
    if (idx !== -1) {
      channels[idx].status = 'connected';
      channels[idx].connectedAt = new Date().toISOString();
      channels[idx].enabled = true;
      save(channels);
    }
  } catch (err: any) {
    const channels = load();
    const idx = channels.findIndex(c => c.id === req.params.id);
    if (idx !== -1) { channels[idx].status = 'error'; save(channels); }
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Send message via channel
channelsRouter.post('/:id/send', requireAuth, async (req: Request, res: Response) => {
  const { tenantId } = res.locals as AuthLocals;
  const channel = load().find(c => c.id === req.params.id);
  if (!channel) { res.status(404).json({ error: 'not found' }); return; }
  const { to, text } = req.body;
  const cfg = channel.config;

  if (isDemoMode()) {
    const channels = load();
    const idx = channels.findIndex(c => c.id === req.params.id);
    if (idx !== -1) {
      channels[idx].stats.sent++;
      channels[idx].lastActivity = new Date().toISOString();
      save(channels);
    }
    res.json({ ok: true, source: 'demo', messageId: `demo_msg_${Date.now()}`, to, text });
    return;
  }

  try {
    switch (channel.type) {
      case 'whatsapp':
        await sendTenantWhatsAppText(tenantId, to, text);
        break;
      case 'telegram':
        await sendTelegramMessage({ botToken: cfg.botToken }, to ?? cfg.defaultChatId, text);
        break;
      default:
        res.status(400).json({ error: 'send not supported for this channel' }); return;
    }
    const channels = load();
    const idx = channels.findIndex(c => c.id === req.params.id);
    if (idx !== -1) { channels[idx].stats.sent++; channels[idx].lastActivity = new Date().toISOString(); save(channels); }
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// WhatsApp webhook verify
channelsRouter.get('/webhook/whatsapp/:id', (req: Request, res: Response) => {
  const channel = load().find(c => c.id === req.params.id && c.type === 'whatsapp');
  if (!channel) { res.status(404).send('Not found'); return; }
  const result = verifyWhatsAppWebhook(
    channel.config as any,
    req.query['hub.mode'] as string,
    req.query['hub.verify_token'] as string,
    req.query['hub.challenge'] as string
  );
  result ? res.send(result) : res.status(403).send('Forbidden');
});

// WhatsApp webhook receive
channelsRouter.post('/webhook/whatsapp/:id', (req: Request, res: Response) => {
  const channel = load().find(c => c.id === req.params.id && c.type === 'whatsapp');
  if (!channel) { res.status(404).send('Not found'); return; }
  const channels = load();
  const idx = channels.findIndex(c => c.id === req.params.id);
  if (idx !== -1) { channels[idx].stats.received++; channels[idx].lastActivity = new Date().toISOString(); save(channels); }
  void handleMetaWebhook(channel.id, req.body).catch(error => console.error('[whatsapp-channel-webhook]', error));
  res.sendStatus(200);
});

// Telegram webhook receive
channelsRouter.post('/webhook/telegram/:id', (req: Request, res: Response) => {
  const channels = load();
  const idx = channels.findIndex(c => c.id === req.params.id && c.type === 'telegram');
  if (idx !== -1) { channels[idx].stats.received++; channels[idx].lastActivity = new Date().toISOString(); save(channels); }
  // TODO: route message to agent
  res.sendStatus(200);
});
