import { Router, type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { testShopify } from '../integrations/shopify.js';

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
];

function load(): Plugin[] {
  try { return JSON.parse(fs.readFileSync(DATA, 'utf8')); } catch { return []; }
}
function save(plugins: Plugin[]) {
  fs.writeFileSync(DATA, JSON.stringify(plugins, null, 2));
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

  try {
    switch (plugin.pluginKey) {
      case 'shopify': {
        const result = await testShopify(plugin.config as any);
        updateStatus(plugin.id, result.ok ? 'installed' : 'error');
        res.json(result);
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
