import axios from 'axios';
import cron, { type ScheduledTask } from 'node-cron';
import {
  decryptSecret,
  encryptSecret,
  listTenantPlatformApps,
  markTenantPlatformStatus,
  notifyDeliveryTeam,
  type TenantPlatformAppRecord,
} from '../lib/tenantPlatformApps.js';
import { store } from '../storage/index.js';

let job: ScheduledTask | null = null;

function graphVersion() {
  return process.env.META_GRAPH_VERSION?.trim() || 'v25.0';
}

function daysUntil(value?: string): number {
  if (!value) return Number.POSITIVE_INFINITY;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return Number.POSITIVE_INFINITY;
  return Math.ceil((time - Date.now()) / (24 * 3600 * 1000));
}

function isMetaTokenExpiredError(error: any): boolean {
  const code = error?.response?.data?.error?.code;
  const message = String(error?.response?.data?.error?.message || error?.message || '').toLowerCase();
  return Number(code) === 190 || message.includes('error validating access token') || message.includes('session has expired');
}

async function refreshMetaUserToken(app: TenantPlatformAppRecord): Promise<void> {
  const accessToken = decryptSecret(app.access_token);
  const appSecret = decryptSecret(app.app_secret);
  if (!accessToken || !app.app_id || !appSecret) throw new Error('missing_meta_credentials');

  const res = await axios.get(`https://graph.facebook.com/${graphVersion()}/oauth/access_token`, {
    params: {
      grant_type: 'fb_exchange_token',
      client_id: app.app_id,
      client_secret: appSecret,
      fb_exchange_token: accessToken,
    },
  });
  const nextToken = String(res.data?.access_token || '');
  if (!nextToken) throw new Error('meta_refresh_returned_empty_token');
  const expiresIn = Number(res.data?.expires_in || 60 * 24 * 3600);
  await store.update('tenant_platform_apps', app.id, {
    access_token: encryptSecret(nextToken),
    token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
    status: 'active',
  });
}

export async function checkTenantPlatformTokens(): Promise<void> {
  const apps = await listTenantPlatformApps();
  for (const app of apps) {
    if (app.platform !== 'meta' || app.token_type !== 'user_60d') continue;
    if (daysUntil(app.token_expires_at) >= 14) continue;

    try {
      await refreshMetaUserToken(app);
    } catch (error: any) {
      const expired = isMetaTokenExpiredError(error);
      await markTenantPlatformStatus(app.id, expired ? 'token_expired' : 'error', error?.message || 'token refresh failed');
      await notifyDeliveryTeam([
        '【灵枢交付提醒】租户 Meta Token 需要处理',
        `租户：${app.tenant_id}`,
        `平台：${app.platform}`,
        `状态：${expired ? 'token_expired' : 'error'}`,
        `错误：${error?.response?.data?.error?.message || error?.message || 'unknown'}`,
      ].join('\n'));
    }
  }
}

export function initTenantPlatformTokenMonitor(): void {
  if (job) return;
  job = cron.schedule('15 3 * * *', () => {
    void checkTenantPlatformTokens().catch(error => {
      console.error('[tenant-platform-token-monitor] failed:', error);
    });
  });
  console.log('[tenant-platform-token-monitor] initialized');
}
