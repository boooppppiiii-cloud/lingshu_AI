import { useEffect, useState } from 'react';
import { Loader2, RefreshCcw, ShieldCheck } from 'lucide-react';
import { authHeader } from '../lib/auth';

interface AdminAccount {
  email: string;
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

const fmtDate = (value?: string | null) => {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
};

const fmtTokens = (value: number) => value.toLocaleString('en-US');

export default function AdminDashboard() {
  const [accounts, setAccounts] = useState<AdminAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch('/api/overseas/admin/demo-accounts', { headers: authHeader() });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json.error || '读取失败');
      setAccounts(json.accounts ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="h-12 px-5 border-b border-border flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-lg flex items-center justify-center bg-surface-2 text-text-secondary">
            <ShieldCheck size={13} />
          </div>
          <span className="text-sm font-semibold text-text-primary">账号总控</span>
        </div>
        <button onClick={() => void load()} disabled={loading}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-xs font-semibold text-text-secondary hover:text-text-primary hover:bg-surface-2 disabled:opacity-60">
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCcw size={13} />}
          刷新
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-5">
        {error && <p className="mb-3 text-xs text-red">{error}</p>}
        <div className="overflow-auto border border-border rounded-lg">
          <table className="min-w-[1180px] w-full text-xs">
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
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading && (
                <tr><td colSpan={9} className="px-3 py-8 text-center text-text-muted">读取中...</td></tr>
              )}
              {!loading && accounts.map(account => (
                <tr key={account.email} className="hover:bg-surface-2/60">
                  <td className="px-3 py-2 font-semibold text-text-primary whitespace-nowrap">{account.email}</td>
                  <td className="px-3 py-2 font-mono text-text-secondary whitespace-nowrap">{account.password}</td>
                  <td className="px-3 py-2 text-text-secondary whitespace-nowrap">{account.status}</td>
                  <td className="px-3 py-2 text-text-secondary whitespace-nowrap">
                    {account.trialDays ? `第 ${account.trialDay ?? '-'} / ${account.trialDays} 天，剩余 ${account.daysRemaining ?? '-'} 天` : '长期有效'}
                  </td>
                  <td className="px-3 py-2 text-text-secondary whitespace-nowrap">{fmtDate(account.activatedAt)}</td>
                  <td className="px-3 py-2 text-text-secondary whitespace-nowrap">{fmtDate(account.expiresAt)}</td>
                  <td className="px-3 py-2 text-text-secondary whitespace-nowrap">
                    {fmtTokens(account.tokenUsedToday)} / {fmtTokens(account.tokenUsedTotal)}
                    {account.tokenLimit ? ` / ${fmtTokens(account.tokenLimit)}` : ''}
                  </td>
                  <td className="px-3 py-2 text-text-secondary whitespace-nowrap">
                    对话 {account.aiChatToday} · 生成 {account.generationToday} · 渲染 {account.renderToday} · 视频 {account.videoGenerationToday}
                  </td>
                  <td className="px-3 py-2 text-text-secondary whitespace-nowrap">
                    {account.rotatedAt ? `${fmtDate(account.rotatedAt)} · ${account.rotationPassword ?? '-'}` : '-'}
                  </td>
                </tr>
              ))}
              {!loading && !accounts.length && (
                <tr><td colSpan={9} className="px-3 py-8 text-center text-text-muted">暂无账号</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
