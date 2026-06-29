import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { testShopify } from '../integrations/shopify.js';
import { getPhoneNumberInfo, verifyWhatsAppWebhook } from '../integrations/whatsapp.js';
import { isDemoMode } from '../lib/demo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, '../../data/plugins.json');

export interface Plugin {
  id: string;
  pluginKey: string;  // 'shopify' | 'exchangerate' | 'translate' | 'tiktok_ads' | ...
  name: string;
  nameZh: string;
  category: 'ecommerce' | 'social' | 'tool' | 'ai';
  description: string;
  icon: string;       // emoji
  status: 'installed' | 'not_installed' | 'error';
  config: Record<string, string>;
  installedAt?: string;
}

const PLUGIN_CATALOG: Omit<Plugin, 'status' | 'config' | 'installedAt'>[] = [
  { id: 'shopify', pluginKey: 'shopify', name: 'Shopify', nameZh: 'Shopify 店铺', category: 'ecommerce', description: '同步 Shopify 订单、商品和客户数据，AI 自动分析店铺经营数据', icon: '🛍️' },
  { id: 'exchangerate', pluginKey: 'exchangerate', name: 'Exchange Rate', nameZh: '实时汇率', category: 'tool', description: '实时获取 USD/CNY/SAR/AED/VND/MYR/IDR 汇率，自动换算报价', icon: '💱' },
  { id: 'translate', pluginKey: 'translate', name: 'AI Translation', nameZh: 'AI 多语言翻译', category: 'ai', description: '支持阿拉伯语、马来语、印尼语、英语等跨境主流语言互译', icon: '🌐' },
  { id: 'tiktok_ads', pluginKey: 'tiktok_ads', name: 'TikTok for Business', nameZh: 'TikTok 广告', category: 'social', description: '连接 TikTok Ads Manager，AI 分析广告效果并自动生成优化建议', icon: '🎵' },
  { id: 'whatsapp_business', pluginKey: 'whatsapp_business', name: 'WhatsApp Business', nameZh: 'WhatsApp 商业版', category: 'social', description: '通过 WhatsApp Business API 批量触达买家，支持模板消息和自动回复', icon: '💬' },
  { id: 'google_translate', pluginKey: 'google_translate', name: 'Google Translate', nameZh: 'Google 翻译', category: 'tool', description: '调用 Google Cloud Translation API 实现高质量多语言翻译', icon: '🔤' },
  { id: 'amazon', pluginKey: 'amazon', name: 'Amazon SP-API', nameZh: 'Amazon 卖家', category: 'ecommerce', description: '同步 Amazon 订单和库存数据（需要卖家账号授权）', icon: '📦' },
  { id: 'instagram', pluginKey: 'instagram', name: 'Instagram', nameZh: 'Instagram 主页', category: 'social', description: '管理 Instagram 企业主页，发布内容并分析互动数据', icon: '📷' },
  { id: 'facebook', pluginKey: 'facebook', name: 'Facebook Page', nameZh: 'Facebook 主页', category: 'social', description: '管理 Facebook 企业主页，发布 Reels / 帖子并分析互动数据', icon: '👍' },
  { id: 'pinterest', pluginKey: 'pinterest', name: 'Pinterest', nameZh: 'Pinterest 商家', category: 'social', description: '发布 Pinterest Idea Pin，追踪曝光、保存与点击数据', icon: '📌' },
];

function load(): Plugin[] {
  try { return JSON.parse(fs.readFileSync(DATA, 'utf8')); } catch { return []; }
}
function save(plugins: Plugin[]) {
  fs.writeFileSync(DATA, JSON.stringify(plugins, null, 2));
}

function createVerifyToken() {
  return `owb_${crypto.randomBytes(18).toString('hex')}`;
}

function getMetaGraphVersion() {
  return process.env.META_GRAPH_VERSION?.trim() || 'v25.0';
}

function getPublicOrigin(req: Request) {
  const configured = process.env.PUBLIC_BASE_URL?.trim();
  if (configured && configured !== 'https://your-domain.com') return configured.replace(/\/$/, '');

  const forwardedProto = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0]?.trim();
  const protocol = forwardedProto || req.protocol || 'http';
  return `${protocol}://${req.get('host')}`;
}

function hasPublicBaseUrl() {
  const value = process.env.PUBLIC_BASE_URL?.trim();
  return Boolean(value && value !== 'https://your-domain.com');
}

function ensureWhatsAppDefaults(plugin: Plugin) {
  if (plugin.pluginKey !== 'whatsapp_business') return false;

  let changed = false;
  if (!plugin.config.verifyToken) {
    plugin.config.verifyToken = createVerifyToken();
    changed = true;
  }
  if (!plugin.config.graphVersion) {
    plugin.config.graphVersion = getMetaGraphVersion();
    changed = true;
  }
  return changed;
}

async function subscribeWhatsAppWebhook(wabaId: string, accessToken: string, graphVersion: string) {
  const url = `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(wabaId)}/subscribed_apps`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ subscribed_fields: ['messages'] }),
  });
  const data = await res.json().catch(() => ({})) as { success?: boolean; error?: { message?: string } };
  if (!res.ok) throw new Error(data.error?.message ?? 'Webhook 订阅失败');
  return data;
}

async function exchangeEmbeddedSignupCode(code: string) {
  const appId = process.env.WHATSAPP_EMBEDDED_SIGNUP_APP_ID?.trim();
  const appSecret = process.env.WHATSAPP_EMBEDDED_SIGNUP_APP_SECRET?.trim();
  if (!appId || !appSecret) throw new Error('Meta 应用参数未配置，无法完成 WhatsApp 授权');

  const params = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    code,
  });
  const res = await fetch(`https://graph.facebook.com/${getMetaGraphVersion()}/oauth/access_token?${params.toString()}`);
  const data = await res.json().catch(() => ({})) as { access_token?: string; error?: { message?: string } };
  if (!res.ok || !data.access_token) throw new Error(data.error?.message ?? 'Meta 授权码换取 Access Token 失败');
  return data.access_token;
}

async function resolvePhoneNumberId(wabaId: string, accessToken: string, graphVersion: string) {
  const res = await fetch(
    `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(wabaId)}/phone_numbers?fields=id,display_phone_number,verified_name`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const data = await res.json().catch(() => ({})) as { data?: { id?: string }[]; error?: { message?: string } };
  if (!res.ok) throw new Error(data.error?.message ?? '无法读取 WhatsApp 号码');
  return data.data?.[0]?.id ?? '';
}

function mergeWithCatalog(installed: Plugin[]): (Plugin & { installed: boolean })[] {
  return PLUGIN_CATALOG.map(cat => {
    const inst = installed.find(p => p.pluginKey === cat.pluginKey);
    return inst
      ? { ...inst, installed: true }
      : { ...cat, status: 'not_installed' as const, config: {}, installed: false };
  });
}

export const pluginsRouter = Router();

pluginsRouter.get('/', (_req, res) => res.json(mergeWithCatalog(load())));

pluginsRouter.post('/:key/install', (req: Request, res: Response) => {
  const plugins = load();
  const cat = PLUGIN_CATALOG.find(p => p.pluginKey === req.params.key);
  if (!cat) { res.status(404).json({ error: 'unknown plugin' }); return; }
  if (plugins.find(p => p.pluginKey === req.params.key)) { res.status(409).json({ error: 'already installed' }); return; }
  const plugin: Plugin = { ...cat, status: 'not_installed', config: {}, installedAt: new Date().toISOString() };
  ensureWhatsAppDefaults(plugin);
  plugins.push(plugin);
  save(plugins);
  res.json(plugin);
});

pluginsRouter.put('/:key/config', (req: Request, res: Response) => {
  const plugins = load();
  const idx = plugins.findIndex(p => p.pluginKey === req.params.key);
  if (idx === -1) { res.status(404).json({ error: 'not installed' }); return; }
  plugins[idx].config = { ...plugins[idx].config, ...req.body };
  if (plugins[idx].pluginKey === 'whatsapp_business') {
    ensureWhatsAppDefaults(plugins[idx]);
    plugins[idx].config.connectionMode = 'manual';
  }
  save(plugins);
  res.json(plugins[idx]);
});

pluginsRouter.delete('/:key', (req: Request, res: Response) => {
  save(load().filter(p => p.pluginKey !== req.params.key));
  res.json({ ok: true });
});

pluginsRouter.post('/:key/test', async (req: Request, res: Response) => {
  const plugin = load().find(p => p.pluginKey === req.params.key);
  if (!plugin) { res.status(404).json({ error: 'not installed' }); return; }

  if (isDemoMode()) {
    updateStatus(plugin.id, 'installed');
    res.json({
      ok: true,
      source: 'demo',
      message: 'Demo 模式：插件测试已模拟通过，真实 OAuth/数据同步由平台集成模块接入。',
      sample: { connectedAccount: `${plugin.nameZh || plugin.name} Demo Account`, syncedAt: new Date().toISOString() },
    });
    return;
  }

  try {
    switch (plugin.pluginKey) {
      case 'shopify': {
        const result = await testShopify(plugin.config as any);
        updateStatus(plugin.id, result.ok ? 'installed' : 'error');
        res.json(result);
        break;
      }
      case 'whatsapp_business': {
        if (!plugin.config.phoneNumberId || !plugin.config.accessToken) {
          res.status(400).json({ ok: false, error: '还没有连接 WhatsApp Business，请先点击“连接 WhatsApp Business”完成授权' });
          return;
        }
        const info = await getPhoneNumberInfo({
          phoneNumberId: plugin.config.phoneNumberId ?? '',
          accessToken: plugin.config.accessToken ?? '',
          verifyToken: plugin.config.verifyToken ?? '',
          graphVersion: plugin.config.graphVersion ?? getMetaGraphVersion(),
        });
        updateStatus(plugin.id, 'installed');
        const name = (info.verified_name ?? info.display_name ?? '') as string;
        const phone = (info.display_phone_number ?? plugin.config.phoneNumberId) as string;
        res.json({ ok: true, message: `连接成功：${name} (${phone})` });
        break;
      }
      case 'exchangerate': {
        const r = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
        const data = await r.json() as { rates: Record<string, number> };
        updateStatus(plugin.id, 'installed');
        res.json({ ok: true, rates: { CNY: data.rates.CNY, SAR: data.rates.SAR, AED: data.rates.AED } });
        break;
      }
      case 'translate':
        updateStatus(plugin.id, 'installed');
        res.json({ ok: true, message: '内置翻译引擎已就绪' });
        break;
      default:
        res.json({ ok: false, message: '该插件需要配置 API Key 后测试' });
    }
  } catch (err: any) {
    updateStatus(plugin.id, 'error');
    res.status(500).json({ ok: false, error: err.message });
  }
});

function updateStatus(id: string, status: Plugin['status']) {
  const plugins = load();
  const idx = plugins.findIndex(p => p.id === id);
  if (idx !== -1) { plugins[idx].status = status; save(plugins); }
}

// Exchange rate shortcut
pluginsRouter.get('/exchangerate/rates', async (_req, res) => {
  try {
    const r = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
    res.json(await r.json());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

pluginsRouter.get('/whatsapp_business/onboarding', (req: Request, res: Response) => {
  const plugins = load();
  const idx = plugins.findIndex(p => p.pluginKey === 'whatsapp_business');
  if (idx === -1) { res.status(404).json({ error: 'WhatsApp 插件尚未安装' }); return; }

  const plugin = plugins[idx];
  if (ensureWhatsAppDefaults(plugin)) save(plugins);

  const appId = process.env.WHATSAPP_EMBEDDED_SIGNUP_APP_ID?.trim() ?? '';
  const configId = process.env.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID?.trim() ?? '';
  const appSecret = process.env.WHATSAPP_EMBEDDED_SIGNUP_APP_SECRET?.trim() ?? '';
  const missingSetup = [
    !appId ? 'WHATSAPP_EMBEDDED_SIGNUP_APP_ID' : '',
    !configId ? 'WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID' : '',
    !appSecret ? 'WHATSAPP_EMBEDDED_SIGNUP_APP_SECRET' : '',
    !hasPublicBaseUrl() ? 'PUBLIC_BASE_URL（生产域名）' : '',
  ].filter(Boolean);

  res.json({
    canUseEmbeddedSignup: Boolean(appId && configId && appSecret),
    appId,
    configId,
    graphVersion: plugin.config.graphVersion ?? getMetaGraphVersion(),
    webhookUrl: `${getPublicOrigin(req)}/api/overseas/plugins/whatsapp_business/webhook`,
    verifyToken: plugin.config.verifyToken,
    missingSetup,
    status: {
      connected: Boolean(plugin.config.phoneNumberId && plugin.config.accessToken),
      connectionMode: plugin.config.connectionMode ?? '',
      phoneNumberId: plugin.config.phoneNumberId ?? '',
      wabaId: plugin.config.wabaId ?? '',
      displayName: plugin.config.displayName ?? '',
      displayPhoneNumber: plugin.config.displayPhoneNumber ?? '',
      webhookSubscribed: plugin.config.webhookSubscribed === 'true',
      webhookSubscribeError: plugin.config.webhookSubscribeError ?? '',
    },
  });
});

pluginsRouter.post('/whatsapp_business/embedded-signup/complete', async (req: Request, res: Response) => {
  const plugins = load();
  const idx = plugins.findIndex(p => p.pluginKey === 'whatsapp_business');
  if (idx === -1) { res.status(404).json({ error: 'WhatsApp 插件尚未安装' }); return; }

  const { code, phoneNumberId, wabaId } = req.body as { code?: string; phoneNumberId?: string; wabaId?: string };
  if (!code) { res.status(400).json({ ok: false, error: '缺少 Meta 授权码' }); return; }

  try {
    const plugin = plugins[idx];
    ensureWhatsAppDefaults(plugin);
    const graphVersion = plugin.config.graphVersion ?? getMetaGraphVersion();
    const accessToken = await exchangeEmbeddedSignupCode(code);
    const resolvedPhoneNumberId = phoneNumberId || (wabaId ? await resolvePhoneNumberId(wabaId, accessToken, graphVersion) : '');

    if (!resolvedPhoneNumberId) {
      throw new Error('Meta 授权成功，但没有返回 WhatsApp 号码，请重新选择号码后再试');
    }

    let displayName = '';
    let displayPhoneNumber = '';
    try {
      const info = await getPhoneNumberInfo({
        phoneNumberId: resolvedPhoneNumberId,
        accessToken,
        verifyToken: plugin.config.verifyToken,
        graphVersion,
      });
      displayName = (info.verified_name ?? info.display_name ?? '') as string;
      displayPhoneNumber = (info.display_phone_number ?? '') as string;
    } catch {
      displayPhoneNumber = resolvedPhoneNumberId;
    }

    let webhookSubscribed = 'false';
    let webhookSubscribeError = '';
    if (wabaId) {
      try {
        await subscribeWhatsAppWebhook(wabaId, accessToken, graphVersion);
        webhookSubscribed = 'true';
      } catch (err: any) {
        webhookSubscribeError = err.message ?? 'Webhook 订阅失败';
      }
    }

    plugins[idx] = {
      ...plugin,
      status: 'installed',
      config: {
        ...plugin.config,
        accessToken,
        phoneNumberId: resolvedPhoneNumberId,
        wabaId: wabaId ?? plugin.config.wabaId ?? '',
        graphVersion,
        connectionMode: 'embedded_signup',
        displayName,
        displayPhoneNumber,
        webhookSubscribed,
        webhookSubscribeError,
      },
    };
    save(plugins);

    res.json({
      ok: true,
      message: `WhatsApp 已连接：${displayName || 'Business'} (${displayPhoneNumber || resolvedPhoneNumberId})`,
      webhookSubscribed: webhookSubscribed === 'true',
      webhookSubscribeError,
    });
  } catch (err: any) {
    updateStatus(plugins[idx].id, 'error');
    res.status(500).json({ ok: false, error: err.message ?? 'WhatsApp 授权失败' });
  }
});

// WhatsApp Business webhook – verify (Meta sends hub.mode / hub.verify_token / hub.challenge)
pluginsRouter.get('/whatsapp_business/webhook', (req: Request, res: Response) => {
  const plugin = load().find(p => p.pluginKey === 'whatsapp_business');
  if (!plugin) { res.status(404).send('Plugin not installed'); return; }
  const challenge = verifyWhatsAppWebhook(
    { phoneNumberId: plugin.config.phoneNumberId ?? '', accessToken: plugin.config.accessToken ?? '', verifyToken: plugin.config.verifyToken ?? '' },
    req.query['hub.mode'] as string,
    req.query['hub.verify_token'] as string,
    req.query['hub.challenge'] as string,
  );
  challenge ? res.send(challenge) : res.status(403).send('Forbidden');
});

// WhatsApp Business webhook – receive incoming messages from Meta
pluginsRouter.post('/whatsapp_business/webhook', (req: Request, res: Response) => {
  // Meta requires 200 within 20 s; message routing to agent can be async
  res.sendStatus(200);
  const body = req.body as { object?: string; entry?: { changes?: { value?: { messages?: { from: string; text?: { body: string }; type: string }[] } }[] }[] };
  if (body.object !== 'whatsapp_business_account') return;
  const messages = body.entry?.[0]?.changes?.[0]?.value?.messages ?? [];
  for (const msg of messages) {
    if (msg.type === 'text') {
      // TODO: forward msg.from + msg.text.body to agent chat
      console.log(`[whatsapp] incoming from ${msg.from}: ${msg.text?.body ?? ''}`);
    }
  }
});
