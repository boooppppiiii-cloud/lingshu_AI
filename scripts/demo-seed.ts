import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const dataDir = path.join(root, 'data');

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8')) as T;
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, file), JSON.stringify(value, null, 2), 'utf8');
}

const templates = readJson<{ id: string; profile: unknown }[]>('demo-templates.json');
const first = templates[0];
if (!first) throw new Error('data/demo-templates.json is empty');

writeJson('enterprise.json', first.profile);
writeJson('channels.json', [
  { id: 'demo_whatsapp', type: 'whatsapp', label: 'WhatsApp Demo', enabled: true, config: {}, status: 'connected', connectedAt: new Date().toISOString(), stats: { sent: 0, received: 0 } },
  { id: 'demo_feishu', type: 'feishu', label: 'Feishu Demo', enabled: true, config: {}, status: 'connected', connectedAt: new Date().toISOString(), stats: { sent: 0, received: 0 } },
]);
writeJson('plugins.json', [
  { id: 'shopify', pluginKey: 'shopify', name: 'Shopify', nameZh: 'Shopify 店铺', category: 'ecommerce', description: 'Demo 模拟连接，真实 OAuth/同步由平台集成模块实现', icon: '🛍️', status: 'installed', config: {}, installedAt: new Date().toISOString() },
  { id: 'exchangerate', pluginKey: 'exchangerate', name: 'Exchange Rate', nameZh: '实时汇率', category: 'tool', description: 'Demo 汇率插件', icon: '💱', status: 'installed', config: {}, installedAt: new Date().toISOString() },
]);
writeJson('tasks.json', [
  { id: 'demo_trend_report', name: 'Demo 每日趋势简报', category: 'daily', taskType: 'trend_report', cronExpr: '0 9 * * *', cronLabel: '每天 09:00', enabled: true, channelId: 'demo_feishu', config: {}, createdAt: new Date().toISOString() },
]);
writeJson('studio-projects.json', []);
writeJson('demo-usage.json', {});

console.log('[demo] seeded placeholder demo data');
