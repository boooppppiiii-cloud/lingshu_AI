import { Router } from 'express';
import { pbGet } from '../storage/pb.js';
import { demoLimits } from '../lib/demo.js';
import {
  demoUsageForUser,
  readDemoAccountRegistry,
  requireAdminUser,
} from '../lib/demoAccounts.js';

export const adminRouter = Router();

function trialDay(activatedAt?: string | null): number | null {
  if (!activatedAt) return null;
  const start = new Date(activatedAt).getTime();
  if (!Number.isFinite(start)) return null;
  return Math.max(1, Math.floor((Date.now() - start) / (24 * 3600 * 1000)) + 1);
}

function accountStage(entry: { status?: string; activatedAt?: string | null; expiresAt?: string | null; rotatedAt?: string | null }): string {
  if (entry.status === 'admin') return '长期维护';
  if (entry.rotatedAt) return '已到期/已轮换密码';
  if (!entry.activatedAt) return '未激活';
  if (entry.expiresAt && new Date(entry.expiresAt).getTime() <= Date.now()) return '已到期';
  return '试用中';
}

adminRouter.get('/demo-accounts', async (req, res) => {
  const admin = await requireAdminUser(req);
  if (!admin) {
    res.status(403).json({ error: 'admin_required' });
    return;
  }

  const limits = demoLimits();
  const registry = readDemoAccountRegistry();
  const accounts = await Promise.all(Object.values(registry)
    .sort((a, b) => a.email.localeCompare(b.email))
    .map(async entry => {
      const tenant = entry.tenantId ? await pbGet('tenants', entry.tenantId) : null;
      const expiresAt = String(tenant?.subscriptionExpiresAt ?? entry.expiresAt ?? '') || null;
      const activatedAt = entry.activatedAt ?? null;
      const usage = demoUsageForUser(entry.userId);
      const day = trialDay(activatedAt);
      return {
        email: entry.email,
        password: entry.password,
        status: accountStage({ ...entry, expiresAt }),
        activatedAt,
        expiresAt,
        trialDay: day,
        trialDays: entry.status === 'admin' ? null : limits.trialDays,
        daysRemaining: expiresAt ? Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / (24 * 3600 * 1000))) : null,
        tokenUsedToday: usage.todayTokens,
        tokenUsedTotal: usage.totalTokens,
        tokenLimit: entry.status === 'admin' ? null : limits.tokenTotal,
        aiChatToday: usage.aiChat,
        generationToday: usage.generation,
        renderToday: usage.render,
        videoGenerationToday: usage.videoGeneration,
        rotatedAt: entry.rotatedAt ?? null,
        rotationPassword: entry.rotationPassword ?? null,
      };
    }));

  res.json({ admin: admin.email, accounts });
});
