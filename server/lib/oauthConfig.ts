import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Request } from 'express';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = path.join(__dirname, '../../data/oauth-config.json');

export interface StoredOAuthConfig {
  youtubeOAuthClientId?: string;
  youtubeOAuthClientSecret?: string;
  metaSocialAppId?: string;
  metaSocialAppSecret?: string;
  tiktokClientKey?: string;
  tiktokClientSecret?: string;
  advancedManualConnectEnabled?: boolean;
  updatedAt?: string;
}

export interface EffectiveOAuthConfig {
  youtubeOAuthClientId: string;
  youtubeOAuthClientSecret: string;
  metaSocialAppId: string;
  metaSocialAppSecret: string;
  tiktokClientKey: string;
  tiktokClientSecret: string;
  advancedManualConnectEnabled: boolean;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function envText(key: string): string {
  return text(process.env[key]);
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export function readOAuthConfig(): StoredOAuthConfig {
  return readJson<StoredOAuthConfig>(CONFIG_FILE, {});
}

export function writeOAuthConfig(patch: Partial<StoredOAuthConfig>): StoredOAuthConfig {
  const current = readOAuthConfig();
  const next: StoredOAuthConfig = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2), 'utf8');
  try {
    fs.chmodSync(CONFIG_FILE, 0o600);
  } catch {
    // Windows and some containers may ignore POSIX file modes.
  }
  return next;
}

export function effectiveOAuthConfig(): EffectiveOAuthConfig {
  const stored = readOAuthConfig();
  return {
    youtubeOAuthClientId: text(stored.youtubeOAuthClientId) || envText('YOUTUBE_OAUTH_CLIENT_ID'),
    youtubeOAuthClientSecret: text(stored.youtubeOAuthClientSecret) || envText('YOUTUBE_OAUTH_CLIENT_SECRET'),
    metaSocialAppId: text(stored.metaSocialAppId) || envText('META_SOCIAL_APP_ID') || envText('WHATSAPP_EMBEDDED_SIGNUP_APP_ID'),
    metaSocialAppSecret: text(stored.metaSocialAppSecret) || envText('META_SOCIAL_APP_SECRET') || envText('WHATSAPP_EMBEDDED_SIGNUP_APP_SECRET'),
    tiktokClientKey: text(stored.tiktokClientKey) || envText('TIKTOK_CLIENT_KEY'),
    tiktokClientSecret: text(stored.tiktokClientSecret) || envText('TIKTOK_CLIENT_SECRET'),
    advancedManualConnectEnabled: stored.advancedManualConnectEnabled ?? envText('ADVANCED_MANUAL_CONNECT_ENABLED') === 'true',
  };
}

export function getYouTubeOAuthClient(): { clientId: string; clientSecret: string } | null {
  const config = effectiveOAuthConfig();
  if (!config.youtubeOAuthClientId || !config.youtubeOAuthClientSecret) return null;
  return { clientId: config.youtubeOAuthClientId, clientSecret: config.youtubeOAuthClientSecret };
}

export function getMetaOAuthClient(): { appId: string; appSecret: string } | null {
  const config = effectiveOAuthConfig();
  if (!config.metaSocialAppId || !config.metaSocialAppSecret) return null;
  return { appId: config.metaSocialAppId, appSecret: config.metaSocialAppSecret };
}

export function getTikTokOAuthClient(): { clientKey: string; clientSecret: string } | null {
  const config = effectiveOAuthConfig();
  if (!config.tiktokClientKey || !config.tiktokClientSecret) return null;
  return { clientKey: config.tiktokClientKey, clientSecret: config.tiktokClientSecret };
}

export function advancedManualConnectEnabled(): boolean {
  return effectiveOAuthConfig().advancedManualConnectEnabled;
}

export function getPublicOrigin(req: Request): string {
  const configured = envText('PUBLIC_BASE_URL').replace(/\/$/, '');
  if (configured && !configured.includes('your-domain.com')) return configured;

  const forwardedProto = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim();
  const proto = forwardedProto || req.protocol || 'http';
  const host = req.get('host') || `localhost:${process.env.PORT ?? 8788}`;
  return `${proto}://${host}`;
}

export function oauthCallbackUrls(req: Request) {
  const origin = getPublicOrigin(req);
  return {
    youtube: `${origin}/api/overseas/youtube/oauth/callback`,
    instagram: `${origin}/api/overseas/social/oauth/instagram/callback`,
    facebook: `${origin}/api/overseas/social/oauth/facebook/callback`,
    tiktok: `${origin}/api/overseas/social/oauth/tiktok/callback`,
  };
}
