import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, '../../data/channels.json');

export interface ChannelConfigRecord {
  id: string;
  type: 'whatsapp' | 'youtube' | 'tiktok' | 'instagram' | 'facebook' | 'telegram' | 'dingtalk' | 'feishu' | 'wechat' | 'shopify';
  label: string;
  enabled: boolean;
  config: Record<string, string>;
  status: 'connected' | 'disconnected' | 'error';
  connectedAt?: string;
  lastActivity?: string;
  stats: { sent: number; received: number };
}

export function loadChannels(): ChannelConfigRecord[] {
  try { return JSON.parse(fs.readFileSync(DATA, 'utf8')) as ChannelConfigRecord[]; } catch { return []; }
}

export function saveChannels(channels: ChannelConfigRecord[]): void {
  fs.writeFileSync(DATA, JSON.stringify(channels, null, 2));
}

export function getChannelById(id: string): ChannelConfigRecord | null {
  return loadChannels().find(channel => channel.id === id) ?? null;
}

export function touchChannel(id: string, patch: Partial<ChannelConfigRecord> = {}): void {
  const channels = loadChannels();
  const index = channels.findIndex(channel => channel.id === id);
  if (index === -1) return;
  channels[index] = {
    ...channels[index],
    ...patch,
    stats: { ...channels[index].stats, ...(patch.stats ?? {}) },
    lastActivity: new Date().toISOString(),
  };
  saveChannels(channels);
}

export function ensureDevWhatsAppChannel(tenantId: string): ChannelConfigRecord {
  const channels = loadChannels();
  const existing = channels.find(channel => channel.type === 'whatsapp' && (channel.config.tenantId === tenantId || !channel.config.tenantId));
  if (existing) {
    if (!existing.config.tenantId) existing.config.tenantId = tenantId;
    existing.config.phoneNumberId ||= '';
    existing.config.accessToken ||= '';
    existing.config.verifyToken ||= 'dev_verify_token';
    existing.label ||= 'WhatsApp Business 模拟账号';
    existing.stats ||= { sent: 0, received: 0 };
    existing.enabled = true;
    saveChannels(channels);
    return existing;
  }
  const channel: ChannelConfigRecord = {
    id: `wa_dev_${Date.now()}`,
    type: 'whatsapp',
    label: 'WhatsApp Business 模拟账号',
    enabled: true,
    config: { tenantId, phoneNumberId: '', accessToken: '', verifyToken: 'dev_verify_token' },
    status: 'disconnected',
    stats: { sent: 0, received: 0 },
  };
  channels.push(channel);
  saveChannels(channels);
  return channel;
}
