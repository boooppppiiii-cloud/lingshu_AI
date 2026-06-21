import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { auth } from '../storage/index.js';
import { pbGet } from '../storage/pb.js';
import type { AuthLocals } from './auth.js';

/* ──────────────────────────────────────────────────────────────────────────
   订阅收费墙
   - 由 SUBSCRIPTION_ENFORCED 开关控制：
       未设 / 'false' → 直通（保持接口现有开放行为，不破坏 demo / 本地开发）
       'true'         → 要求登录 + 租户有有效订阅，否则 401 / 402
   - 订阅状态挂在 PocketBase `tenants` 集合（B2B 按公司订阅），可后台手动设置，
     真实支付（Stripe 等）以后通过 webhook 回写同样的字段即可，中间件无需改动。
─────────────────────────────────────────────────────────────────────────── */

export type SubscriptionStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'canceled'
  | 'expired'
  | 'none';

export interface Subscription {
  status: SubscriptionStatus;
  plan: string | null;
  expiresAt: string | null; // ISO，null = 不过期
}

export interface SubscriptionLocals extends AuthLocals {
  subscription: Subscription;
}

const TENANT_COL = 'tenants';
const ENTITLED_STATUSES: SubscriptionStatus[] = ['active', 'trialing'];

/** 是否启用强制订阅校验 */
export function isSubscriptionEnforced(): boolean {
  return process.env.SUBSCRIPTION_ENFORCED === 'true';
}

/** 读取租户当前订阅；记录缺失时返回 none */
export async function getTenantSubscription(tenantId: string): Promise<Subscription> {
  const record = await pbGet(TENANT_COL, tenantId);
  if (!record) return { status: 'none', plan: null, expiresAt: null };
  return {
    status: (record.subscriptionStatus as SubscriptionStatus) ?? 'none',
    plan: (record.subscriptionPlan as string) ?? null,
    expiresAt: (record.subscriptionExpiresAt as string) ?? null,
  };
}

/** 订阅是否仍有效：状态在白名单内且未过期 */
export function isEntitled(sub: Subscription): boolean {
  if (!ENTITLED_STATUSES.includes(sub.status)) return false;
  if (sub.expiresAt && new Date(sub.expiresAt).getTime() < Date.now()) return false;
  return true;
}

/**
 * 收费墙中间件：未启用强制时直通；启用后校验登录 + 有效订阅。
 * 自带鉴权（无需在前面再挂 requireAuth），通过后在 res.locals 注入
 * userId / tenantId / subscription。
 */
export function entitlementGate(): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!isSubscriptionEnforced()) {
      next();
      return;
    }

    const result = await auth.verifyToken(req.headers.authorization);
    if (!result) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const locals = res.locals as SubscriptionLocals;
    locals.userId = result.userId;
    locals.tenantId = result.tenantId;

    const sub = await getTenantSubscription(result.tenantId);
    if (!isEntitled(sub)) {
      res.status(402).json({
        error: 'subscription_required',
        status: sub.status,
        plan: sub.plan,
        expiresAt: sub.expiresAt,
      });
      return;
    }

    locals.subscription = sub;
    next();
  };
}
