import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Request, Response } from 'express';
import { auth } from '../storage/index.js';
import { getTenantSubscription } from '../middleware/subscription.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USAGE_FILE = path.join(__dirname, '../../data/demo-usage.json');

export type DemoQuotaKind = 'aiChat' | 'generation' | 'render' | 'videoGeneration';

export interface DemoLimits {
  trialDays: number;
  aiChatDaily: number;
  generationDaily: number;
  renderDaily: number;
  videoGenerationDaily: number;
}

export interface DemoUsageDay {
  aiChat: number;
  generation: number;
  render: number;
  videoGeneration: number;
}

export interface DemoStatus {
  enabled: boolean;
  trialDays: number;
  expiresAt: string | null;
  daysRemaining: number | null;
  expired: boolean;
  limits: DemoLimits;
  usage: DemoUsageDay;
  remaining: DemoUsageDay;
}

type UsageStore = Record<string, Record<string, DemoUsageDay>>;

const DEFAULT_USAGE: DemoUsageDay = { aiChat: 0, generation: 0, render: 0, videoGeneration: 0 };

export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === 'true';
}

function intEnv(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function demoLimits(): DemoLimits {
  return {
    trialDays: intEnv('DEMO_TRIAL_DAYS', 7),
    aiChatDaily: intEnv('DEMO_DAILY_AI_CHAT_LIMIT', 20),
    generationDaily: intEnv('DEMO_DAILY_GENERATION_LIMIT', 10),
    renderDaily: intEnv('DEMO_DAILY_RENDER_LIMIT', 3),
    videoGenerationDaily: intEnv('DEMO_VIDEO_GENERATION_LIMIT', intEnv('DEMO_DAILY_VIDEO_GENERATION_LIMIT', 2)),
  };
}

export function demoTrialExpiresAt(from = new Date()): string {
  return new Date(from.getTime() + demoLimits().trialDays * 24 * 3600 * 1000).toISOString();
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function readUsage(): UsageStore {
  try {
    return JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8')) as UsageStore;
  } catch {
    return {};
  }
}

function writeUsage(store: UsageStore): void {
  fs.mkdirSync(path.dirname(USAGE_FILE), { recursive: true });
  fs.writeFileSync(USAGE_FILE, JSON.stringify(store, null, 2), 'utf8');
}

async function identityKey(req: Request): Promise<string> {
  const result = await auth.verifyToken(req.headers.authorization);
  if (result?.tenantId) return `tenant:${result.tenantId}`;
  return `anon:${req.ip || 'local'}`;
}

function emptyUsage(): DemoUsageDay {
  return { ...DEFAULT_USAGE };
}

function totalVideoGenerationUsage(store: UsageStore, key: string): number {
  return Object.values(store[key] ?? {}).reduce((sum, day) => sum + (day.videoGeneration ?? 0), 0);
}

function remaining(usage: DemoUsageDay, limits: DemoLimits, videoGenerationUsed = usage.videoGeneration ?? 0): DemoUsageDay {
  return {
    aiChat: Math.max(0, limits.aiChatDaily - usage.aiChat),
    generation: Math.max(0, limits.generationDaily - usage.generation),
    render: Math.max(0, limits.renderDaily - usage.render),
    videoGeneration: Math.max(0, limits.videoGenerationDaily - videoGenerationUsed),
  };
}

export function isExpired(expiresAt?: string | null): boolean {
  return !!expiresAt && new Date(expiresAt).getTime() < Date.now();
}

export async function buildDemoStatus(req: Request, tenantId?: string, expiresAt?: string | null): Promise<DemoStatus> {
  const limits = demoLimits();
  let resolvedExpiresAt = expiresAt ?? null;
  if (!resolvedExpiresAt && tenantId) {
    const sub = await getTenantSubscription(tenantId);
    resolvedExpiresAt = sub.expiresAt;
  }

  const key = tenantId ? `tenant:${tenantId}` : await identityKey(req);
  const store = readUsage();
  const usage = { ...emptyUsage(), ...(store[key]?.[todayKey()] ?? {}) };
  const videoGenerationUsed = totalVideoGenerationUsage(store, key);
  const expired = isExpired(resolvedExpiresAt);
  const daysRemaining = resolvedExpiresAt
    ? Math.max(0, Math.ceil((new Date(resolvedExpiresAt).getTime() - Date.now()) / (24 * 3600 * 1000)))
    : null;

  return {
    enabled: isDemoMode(),
    trialDays: limits.trialDays,
    expiresAt: resolvedExpiresAt,
    daysRemaining,
    expired,
    limits,
    usage,
    remaining: remaining(usage, limits, videoGenerationUsed),
  };
}

function limitFor(kind: DemoQuotaKind, limits: DemoLimits): number {
  if (kind === 'aiChat') return limits.aiChatDaily;
  if (kind === 'generation') return limits.generationDaily;
  if (kind === 'videoGeneration') return limits.videoGenerationDaily;
  return limits.renderDaily;
}

export async function consumeDemoQuota(req: Request, res: Response, kind: DemoQuotaKind): Promise<boolean> {
  if (!isDemoMode()) return true;

  const id = await auth.verifyToken(req.headers.authorization);
  const sub = id?.tenantId ? await getTenantSubscription(id.tenantId) : null;
  if (sub?.expiresAt && isExpired(sub.expiresAt)) {
    res.status(402).json({ error: 'demo_expired', demo: await buildDemoStatus(req, id?.tenantId, sub.expiresAt) });
    return false;
  }

  const key = id?.tenantId ? `tenant:${id.tenantId}` : await identityKey(req);
  const day = todayKey();
  const store = readUsage();
  const usage = { ...emptyUsage(), ...(store[key]?.[day] ?? {}) };
  const limits = demoLimits();
  const used = kind === 'videoGeneration' ? totalVideoGenerationUsage(store, key) : usage[kind];
  if (used >= limitFor(kind, limits)) {
    res.status(429).json({ error: 'demo_quota_exceeded', quota: kind, demo: await buildDemoStatus(req, id?.tenantId, sub?.expiresAt) });
    return false;
  }

  usage[kind] += 1;
  store[key] = { ...(store[key] ?? {}), [day]: usage };
  writeUsage(store);
  return true;
}

export function resetDemoUsage(): void {
  writeUsage({});
}
