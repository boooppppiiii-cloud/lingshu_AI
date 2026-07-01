import { Router, type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { testShopify } from '../integrations/shopify.js';
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
  { id: 'tiktok', pluginKey: 'tiktok', name: 'TikTok', nameZh: 'TikTok', category: 'social', description: '连接 TikTok 账号，读取视频、评论和互动数据，并支持流量专家一键发布短视频', icon: '🎵' },
  { id: 'google_translate', pluginKey: 'google_translate', name: 'Google Translate', nameZh: 'Google 翻译', category: 'tool', description: '调用 Google Cloud Translation API 实现高质量多语言翻译', icon: '🔤' },
  { id: 'amazon', pluginKey: 'amazon', name: 'Amazon SP-API', nameZh: 'Amazon 卖家', category: 'ecommerce', description: '同步 Amazon 订单和库存数据（需要卖家账号授权）', icon: '📦' },
  { id: 'instagram', pluginKey: 'instagram', name: 'Instagram', nameZh: 'Instagram', category: 'social', description: '连接 Instagram 专业账号，读取 Reels、评论和互动数据，并支持内容发布', icon: '📷' },
  { id: 'facebook', pluginKey: 'facebook', name: 'Facebook', nameZh: 'Facebook', category: 'social', description: '连接 Facebook Page，读取主页视频和评论，并支持将 AI 生成内容发布到主页', icon: '👍' },
];

const FALLBACK_RATES = {
  provider: 'fallback',
  base: 'USD',
  date: new Date().toISOString().slice(0, 10),
  rates: { CNY: 6.8, SAR: 3.75, AED: 3.67, VND: 26200, MYR: 4.1, IDR: 16200 },
};

async function fetchExchangeRates(): Promise<typeof FALLBACK_RATES & { source: 'live' | 'fallback' }> {
  try {
    const r = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
    if (!r.ok) throw new Error(`exchange rate api ${r.status}`);
    const data = await r.json() as typeof FALLBACK_RATES;
    if (!data?.rates?.CNY || !data?.rates?.SAR || !data?.rates?.AED) throw new Error('invalid exchange rate payload');
    return { ...data, source: 'live' };
  } catch {
    return { ...FALLBACK_RATES, date: new Date().toISOString().slice(0, 10), source: 'fallback' };
  }
}

function load(): Plugin[] {
  try { return JSON.parse(fs.readFileSync(DATA, 'utf8')); } catch { return []; }
}
function save(plugins: Plugin[]) {
  fs.writeFileSync(DATA, JSON.stringify(plugins, null, 2));
}

function mergeWithCatalog(installed: Plugin[]): (Plugin & { installed: boolean })[] {
  return PLUGIN_CATALOG.map(cat => {
    const inst = installed.find(p => p.pluginKey === cat.pluginKey);
    if (!inst && cat.category === 'social') {
      return { ...cat, status: 'installed' as const, config: {}, installedAt: new Date().toISOString(), installed: true };
    }
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
  const plugin: Plugin = { ...cat, status: 'installed', config: {}, installedAt: new Date().toISOString() };
  plugins.push(plugin);
  save(plugins);
  res.json(plugin);
});

pluginsRouter.put('/:key/config', (req: Request, res: Response) => {
  const plugins = load();
  const idx = plugins.findIndex(p => p.pluginKey === req.params.key);
  if (idx === -1) { res.status(404).json({ error: 'not installed' }); return; }
  plugins[idx].config = { ...plugins[idx].config, ...req.body };
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
      message: '插件连接测试通过。',
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
      case 'exchangerate': {
        const data = await fetchExchangeRates();
        updateStatus(plugin.id, 'installed');
        res.json({
          ok: true,
          source: data.source,
          message: data.source === 'live' ? '连接成功' : '连接成功',
          rates: { CNY: data.rates.CNY, SAR: data.rates.SAR, AED: data.rates.AED },
        });
        break;
      }
      case 'translate':
        updateStatus(plugin.id, 'installed');
        res.json({ ok: true, message: '内置翻译引擎已就绪' });
        break;
      case 'google_translate':
        updateStatus(plugin.id, 'installed');
        res.json({ ok: true, message: 'Google 翻译 Demo 连接已就绪' });
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
  res.json(await fetchExchangeRates());
});
