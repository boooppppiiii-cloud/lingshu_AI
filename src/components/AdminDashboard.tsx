import { useEffect, useMemo, useState } from 'react';
import { Loader2, LogIn, RefreshCcw, ShieldCheck, UserCheck } from 'lucide-react';
import {
  authApi,
  authHeader,
  exitSupportSession,
  startSupportSession,
  type AuthSession,
} from '../lib/auth';

interface AdminAccount {
  email: string;
  tenantId: string;
  tenantName: string;
  password: string;
  status: string;
  activatedAt: string | null;
  expiresAt: string | null;
  trialDay: number | null;
  trialDays: number | null;
  daysRemaining: number | null;
  tokenUsedToday: number;
  tokenUsedTotal: number;
  tokenLimit: number | null;
  aiChatToday: number;
  generationToday: number;
  renderToday: number;
  videoGenerationToday: number;
  rotatedAt: string | null;
  rotationPassword: string | null;
}

interface CustomerAccount {
  tenantId: string;
  companyName: string;
  contactName: string;
  industry: string;
  emails: string[];
  password: string;
  inviteCode: string;
  subscriptionPlan: string;
  subscriptionStatus: string;
  createdAt: string | null;
  registeredAt: string | null;
  expiresAt: string | null;
  tokenUsedToday: number;
  tokenUsedTotal: number;
  aiChatToday: number;
  generationToday: number;
  renderToday: number;
  videoGenerationToday: number;
}

interface StyleAdoptionTrend {
  tenantId: string;
  week: string;
  total: number;
  directSent: number;
  rate: number;
}

const fmtDate = (value?: string | null) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-';
const fmtTokens = (value: number) => value.toLocaleString('en-US');

export default function AdminDashboard({ onSupportSessionStarted }: { onSupportSessionStarted: (session: AuthSession) => void }) {
  const [trialAccounts, setTrialAccounts] = useState<AdminAccount[]>([]);
  const [customerAccounts, setCustomerAccounts] = useState<CustomerAccount[]>([]);
  const [styleTrends, setStyleTrends] = useState<StyleAdoptionTrend[]>([]);
  const [loading, setLoading] = useState(true);
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [supportBusyTenantId, setSupportBusyTenantId] = useState<string | null>(null);
  const [supportError, setSupportError] = useState<{ tenantId: string; message: string } | null>(null);
  const [promotingTenantId, setPromotingTenantId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  const industryAccounts = useMemo(() => customerAccounts.reduce<Array<{
    industry: string; customerCount: number; accountCount: number; customers: string[]; activeCount: number;
  }>>((groups, account) => {
    const industry = account.industry.trim() || '未标注行业';
    const group = groups.find(item => item.industry === industry);
    if (group) {
      group.customerCount += 1;
      group.accountCount += account.emails.length;
      group.customers.push(account.companyName);
      if (account.subscriptionStatus === 'active') group.activeCount += 1;
    } else {
      groups.push({ industry, customerCount: 1, accountCount: account.emails.length, customers: [account.companyName], activeCount: account.subscriptionStatus === 'active' ? 1 : 0 });
    }
    return groups;
  }, []).sort((a, b) => b.customerCount - a.customerCount || a.industry.localeCompare(b.industry)), [customerAccounts]);

  const groupedTrends = useMemo(() => Object.entries(styleTrends.reduce<Record<string, StyleAdoptionTrend[]>>((groups, item) => {
    (groups[item.tenantId] ||= []).push(item);
    return groups;
  }, {})).slice(0, 6), [styleTrends]);

  const load = async (options: { silent?: boolean } = {}) => {
    if (!options.silent) setLoading(true);
    setError(null);
    try {
      const [accountResp, trendResp] = await Promise.all([
        fetch(`/api/overseas/admin/demo-accounts?_=${Date.now()}`, {
          headers: authHeader(),
          cache: 'no-store',
        }),
        fetch(`/api/overseas/admin/style-adoption-trends?_=${Date.now()}`, {
          headers: authHeader(),
          cache: 'no-store',
        }),
      ]);
      const accountJson = await accountResp.json().catch(() => ({}));
      if (!accountResp.ok) throw new Error(accountJson.error || '读取失败');
      const trendJson = await trendResp.json().catch(() => ({}));
      setTrialAccounts(Array.isArray(accountJson.trialAccounts) ? accountJson.trialAccounts : accountJson.accounts ?? []);
      setCustomerAccounts(Array.isArray(accountJson.customerAccounts) ? accountJson.customerAccounts : []);
      setAccountsLoaded(true);
      setStyleTrends(trendResp.ok ? trendJson.items ?? [] : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取失败');
    } finally {
      if (!options.silent) setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load({ silent: true });
    }, 10_000);
    const refreshVisible = () => {
      if (document.visibilityState === 'visible') void load({ silent: true });
    };
    window.addEventListener('focus', refreshVisible);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshVisible);
      document.removeEventListener('visibilitychange', refreshVisible);
    };
  }, []);

  const enterTenant = async (target: { tenantId: string; tenantName: string }) => {
    if (!target.tenantId) return;
    setSupportBusyTenantId(target.tenantId);
    setSupportError(null);
    try {
      const response = await fetch('/api/overseas/admin/support-access/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify(target),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.token) {
        throw new Error(data.error === 'support_access_disabled' ? '该租户已关闭技术支持授权' : data.error || '进入失败');
      }
      startSupportSession(data.token);
      const supportSession = await authApi.me();
      if (!supportSession?.supportAccess) {
        exitSupportSession();
        throw new Error('协助会话校验失败，请重试');
      }
      onSupportSessionStarted(supportSession);
    } catch (cause) {
      setSupportError({
        tenantId: target.tenantId,
        message: cause instanceof Error ? cause.message : '进入失败',
      });
      setSupportBusyTenantId(null);
    }
  };

  const promoteTrial = async (account: AdminAccount) => {
    if (!account.tenantId || promotingTenantId) return;
    const confirmed = window.confirm(`将 ${account.email} 转为正式客户？原客户空间、历史内容和社媒授权都会保留。`);
    if (!confirmed) return;
    setPromotingTenantId(account.tenantId);
    setError(null);
    setNotice('');
    try {
      const response = await fetch(`/api/overseas/admin/trial-accounts/${encodeURIComponent(account.tenantId)}/promote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ companyName: account.tenantName || account.email.split('@')[0] }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '转为正式客户失败');
      setNotice(data.message || '已转为正式客户，原客户空间保持不变。');
      await load({ silent: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '转为正式客户失败');
    } finally {
      setPromotingTenantId(null);
    }
  };

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="h-12 px-5 border-b border-border flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-lg flex items-center justify-center bg-surface-2 text-text-secondary"><ShieldCheck size={13} /></div>
          <span className="text-sm font-semibold text-text-primary">账号总控</span>
        </div>
        <button onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-xs font-semibold text-text-secondary hover:text-text-primary hover:bg-surface-2 disabled:opacity-60">
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCcw size={13} />} 刷新
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-5">
        {error && <p className="mb-3 text-xs text-red">{error}</p>}
        {notice && <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">{notice}</p>}

        <section className="mb-6 overflow-hidden rounded-lg border border-border bg-surface">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-xs font-semibold text-text-primary">销售风格采纳率趋势</span>
            <span className="text-[10px] text-text-muted">草稿未修改直接发送率，按周聚合</span>
          </div>
          {!groupedTrends.length ? <p className="px-3 py-4 text-xs text-text-muted">暂无风格学习采纳数据。</p> : (
            <div className="grid gap-2 p-3 md:grid-cols-2">
              {groupedTrends.map(([tenantId, items]) => (
                <div key={tenantId} className="rounded-lg border border-border bg-white p-3">
                  <p className="truncate text-xs font-semibold text-text-primary">tenant {tenantId}</p>
                  <div className="mt-3 space-y-2">
                    {items.slice(0, 6).reverse().map(item => (
                      <div key={`${tenantId}-${item.week}`} className="grid grid-cols-[64px_1fr_48px] items-center gap-2 text-[10px] text-text-muted">
                        <span>{item.week}</span><div className="h-2 rounded-full bg-surface-2"><div className="h-2 rounded-full bg-accent" style={{ width: `${Math.max(4, Math.min(100, item.rate * 100))}%` }} /></div><span className="text-right">{Math.round(item.rate * 100)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section id="admin-trial-accounts" className="scroll-mt-5">
          <div className="mb-2 flex items-center justify-between"><div><h2 className="text-sm font-semibold text-text-primary">试用账号表</h2><p className="mt-0.5 text-xs text-text-muted">备用试用账号无需注册，管理员把账号密码交给测试用户后即可直接登录。</p></div><span className="text-xs text-text-muted">{accountsLoaded ? `${trialAccounts.length} 个账号` : loading ? '读取中' : '读取失败'}</span></div>
          <div className="overflow-auto border border-border rounded-lg">
            <table className="min-w-[1440px] w-full text-xs">
              <thead className="bg-surface-2 text-text-muted">
                <tr className="text-left">
                  <th className="px-3 py-2 font-semibold">账号</th>
                  <th className="px-3 py-2 font-semibold">密码</th>
                  <th className="px-3 py-2 font-semibold">流转状态</th>
                  <th className="px-3 py-2 font-semibold">试用进度</th>
                  <th className="px-3 py-2 font-semibold">激活时间</th>
                  <th className="px-3 py-2 font-semibold">到期时间</th>
                  <th className="px-3 py-2 font-semibold">Token 今日/总计</th>
                  <th className="px-3 py-2 font-semibold">今日功能次数</th>
                  <th className="px-3 py-2 font-semibold">轮换</th>
                  <th className="px-3 py-2 font-semibold">客户状态</th>
                  <th className="px-3 py-2 font-semibold">租户后台</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loading && !accountsLoaded && <tr><td colSpan={11} className="px-3 py-8 text-center text-text-muted">读取中...</td></tr>}
                {(!loading || accountsLoaded) && trialAccounts.map(account => {
                  const busy = supportBusyTenantId === account.tenantId;
                  return (
                    <tr key={account.email} className="hover:bg-surface-2/60">
                      <td className="px-3 py-2 font-semibold text-text-primary whitespace-nowrap">{account.email}</td>
                      <td className="px-3 py-2 font-mono text-text-secondary whitespace-nowrap">{account.password}</td>
                      <td className="px-3 py-2 text-text-secondary whitespace-nowrap">{account.status}</td>
                      <td className="px-3 py-2 text-text-secondary whitespace-nowrap">{account.trialDays ? `第 ${account.trialDay ?? '-'} / ${account.trialDays} 天，剩余 ${account.daysRemaining ?? '-'} 天` : '长期有效'}</td>
                      <td className="px-3 py-2 text-text-secondary whitespace-nowrap">{fmtDate(account.activatedAt)}</td>
                      <td className="px-3 py-2 text-text-secondary whitespace-nowrap">{fmtDate(account.expiresAt)}</td>
                      <td className="px-3 py-2 text-text-secondary whitespace-nowrap">{fmtTokens(account.tokenUsedToday)} / {fmtTokens(account.tokenUsedTotal)}{account.tokenLimit ? ` / ${fmtTokens(account.tokenLimit)}` : ''}</td>
                      <td className="px-3 py-2 text-text-secondary whitespace-nowrap">对话 {account.aiChatToday} · 生成 {account.generationToday} · 渲染 {account.renderToday} · 视频 {account.videoGenerationToday}</td>
                      <td className="px-3 py-2 text-text-secondary whitespace-nowrap">{account.rotatedAt ? `${fmtDate(account.rotatedAt)} · ${account.rotationPassword ?? '-'}` : '-'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => void promoteTrial(account)}
                          disabled={Boolean(promotingTenantId)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                        >
                          {promotingTenantId === account.tenantId ? <Loader2 size={12} className="animate-spin" /> : <UserCheck size={12} />}
                          {promotingTenantId === account.tenantId ? '转正中' : '转为正式客户'}
                        </button>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => void enterTenant({ tenantId: account.tenantId, tenantName: account.tenantName || account.email })}
                          disabled={busy || !account.tenantId}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-2.5 py-1.5 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          {busy ? <Loader2 size={12} className="animate-spin" /> : <LogIn size={12} />}
                          {busy ? '正在进入' : '进入后台'}
                        </button>
                        {supportError?.tenantId === account.tenantId && <p className="mt-1 max-w-36 whitespace-normal text-[10px] leading-4 text-red-600">{supportError.message}</p>}
                      </td>
                    </tr>
                  );
                })}
                {accountsLoaded && !trialAccounts.length && <tr><td colSpan={11} className="px-3 py-8 text-center text-text-muted">暂无试用账号</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <section id="admin-customer-accounts" className="mt-6 scroll-mt-5">
          <div className="mb-2 flex items-center justify-between"><div><h2 className="text-sm font-semibold text-text-primary">客户账号表</h2><p className="mt-0.5 text-xs text-text-muted">注册码无需预设账密；客户完成注册后，账号、初始密码和已使用邀请码会自动出现在这里。</p></div><span className="text-xs text-text-muted">{accountsLoaded ? `${customerAccounts.length} 个客户` : loading ? '读取中' : '读取失败'}</span></div>
          <div className="overflow-auto border border-border rounded-lg">
            <table className="min-w-[1700px] w-full text-xs">
              <thead className="bg-surface-2 text-text-muted">
                <tr className="text-left">
                  <th className="px-3 py-2 font-semibold">客户主体</th>
                  <th className="px-3 py-2 font-semibold">联系人</th>
                  <th className="px-3 py-2 font-semibold">所属行业</th>
                  <th className="px-3 py-2 font-semibold">登录账号</th>
                  <th className="px-3 py-2 font-semibold">初始密码</th>
                  <th className="px-3 py-2 font-semibold">已使用邀请码</th>
                  <th className="px-3 py-2 font-semibold">订阅方案</th>
                  <th className="px-3 py-2 font-semibold">账号状态</th>
                  <th className="px-3 py-2 font-semibold">AI Token 今日/总计</th>
                  <th className="px-3 py-2 font-semibold">今日功能次数</th>
                  <th className="px-3 py-2 font-semibold">注册时间</th>
                  <th className="px-3 py-2 font-semibold">到期时间</th>
                  <th className="px-3 py-2 font-semibold">租户 ID</th>
                  <th className="px-3 py-2 font-semibold">租户后台</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loading && !accountsLoaded && <tr><td colSpan={14} className="px-3 py-8 text-center text-text-muted">读取中...</td></tr>}
                {(!loading || accountsLoaded) && customerAccounts.map(account => {
                  const busy = supportBusyTenantId === account.tenantId;
                  const registered = account.emails.length > 0;
                  return (
                    <tr key={account.tenantId} className="hover:bg-surface-2/60">
                      <td className="px-3 py-2 font-semibold text-text-primary whitespace-nowrap">{account.companyName}</td>
                      <td className="px-3 py-2 text-text-secondary whitespace-nowrap">{account.contactName || '-'}</td>
                      <td className="px-3 py-2 text-text-secondary whitespace-nowrap">{account.industry || '未标注行业'}</td>
                      <td className="px-3 py-2 text-text-secondary">{registered ? account.emails.join('、') : '待客户注册'}</td>
                      <td className="px-3 py-2 font-mono text-text-secondary whitespace-nowrap">{account.password || '待客户注册'}</td>
                      <td className="px-3 py-2 font-mono text-text-secondary whitespace-nowrap">{account.inviteCode || '-'}</td>
                      <td className="px-3 py-2 text-text-secondary whitespace-nowrap">{account.subscriptionPlan}</td>
                      <td className="px-3 py-2 text-text-secondary whitespace-nowrap">{account.subscriptionStatus}</td>
                      <td className="px-3 py-2 text-text-secondary whitespace-nowrap">{fmtTokens(account.tokenUsedToday)} / {fmtTokens(account.tokenUsedTotal)}</td>
                      <td className="px-3 py-2 text-text-secondary whitespace-nowrap">对话 {account.aiChatToday} · 生成 {account.generationToday} · 渲染 {account.renderToday} · 视频 {account.videoGenerationToday}</td>
                      <td className="px-3 py-2 text-text-secondary whitespace-nowrap">{fmtDate(account.registeredAt || account.createdAt)}</td>
                      <td className="px-3 py-2 text-text-secondary whitespace-nowrap">{fmtDate(account.expiresAt)}</td>
                      <td className="px-3 py-2 font-mono text-text-muted whitespace-nowrap">{account.tenantId}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => void enterTenant({ tenantId: account.tenantId, tenantName: account.companyName })}
                          disabled={busy || !registered}
                          title={registered ? `进入 ${account.companyName} 后台` : '客户注册后可进入后台'}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-2.5 py-1.5 font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {busy ? <Loader2 size={12} className="animate-spin" /> : <LogIn size={12} />}
                          {busy ? '正在进入' : '进入后台'}
                        </button>
                        {supportError?.tenantId === account.tenantId && <p className="mt-1 max-w-36 whitespace-normal text-[10px] leading-4 text-red-600">{supportError.message}</p>}
                      </td>
                    </tr>
                  );
                })}
                {accountsLoaded && !customerAccounts.length && <tr><td colSpan={14} className="px-3 py-8 text-center text-text-muted">暂无客户账号</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <section id="admin-industry-accounts" className="mt-6 scroll-mt-5">
          <div className="mb-2 flex items-center justify-between"><div><h2 className="text-sm font-semibold text-text-primary">行业账号表</h2><p className="mt-0.5 text-xs text-text-muted">按客户所属行业汇总客户覆盖和登录账号规模。</p></div><span className="text-xs text-text-muted">{industryAccounts.length} 个行业</span></div>
          <div className="overflow-auto border border-border rounded-lg"><table className="min-w-[840px] w-full text-xs"><thead className="bg-surface-2 text-text-muted"><tr className="text-left"><th className="px-3 py-2 font-semibold">行业</th><th className="px-3 py-2 font-semibold">客户数</th><th className="px-3 py-2 font-semibold">登录账号数</th><th className="px-3 py-2 font-semibold">已开通客户</th><th className="px-3 py-2 font-semibold">客户主体</th></tr></thead><tbody className="divide-y divide-border">{loading ? <tr><td colSpan={5} className="px-3 py-8 text-center text-text-muted">读取中...</td></tr> : industryAccounts.map(account => <tr key={account.industry} className="hover:bg-surface-2/60"><td className="px-3 py-2 font-semibold text-text-primary whitespace-nowrap">{account.industry}</td><td className="px-3 py-2 text-text-secondary whitespace-nowrap">{account.customerCount}</td><td className="px-3 py-2 text-text-secondary whitespace-nowrap">{account.accountCount}</td><td className="px-3 py-2 text-text-secondary whitespace-nowrap">{account.activeCount}</td><td className="px-3 py-2 text-text-secondary">{account.customers.join('、')}</td></tr>)}{!loading && !industryAccounts.length && <tr><td colSpan={5} className="px-3 py-8 text-center text-text-muted">暂无客户行业资料</td></tr>}</tbody></table></div>
        </section>
      </div>
    </div>
  );
}
