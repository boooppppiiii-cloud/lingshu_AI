import { useState } from 'react';
import { motion } from 'motion/react';
import { Globe, Loader2, Mail, Lock, Building2 } from 'lucide-react';
import { authApi, setToken, type AuthSession } from '../lib/auth';

export default function AuthScreen({ onAuthed }: { onAuthed: (s: AuthSession) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [company, setCompany] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!email || !password) { setError('请填写邮箱和密码'); return; }
    if (mode === 'register' && password.length < 8) { setError('密码至少 8 位'); return; }
    setLoading(true);
    try {
      const r = mode === 'login'
        ? await authApi.login(email, password)
        : await authApi.register(email, password, company);
      setToken(r.token);
      onAuthed({ user: r.user, tenant: r.tenant });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '请求失败');
    } finally {
      setLoading(false);
    }
  };

  const inputCls = 'w-full pl-9 pr-3 py-2.5 rounded-xl border border-border bg-surface text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent transition-colors';

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2.5 mb-6">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #4ade80, #16a34a)' }}>
            <Globe size={18} className="text-white" />
          </div>
          <span className="text-lg font-bold text-text-primary font-display">灵枢 AI 工作台</span>
        </div>

        <div className="card !rounded-2xl p-6">
          <h1 className="text-base font-bold text-text-primary mb-1">{mode === 'login' ? '登录' : '注册'}</h1>
          <p className="text-xs text-text-muted mb-5">{mode === 'login' ? '欢迎回来，继续你的出海营销' : '创建账号，享 14 天免费试用'}</p>

          <div className="space-y-3">
            {mode === 'register' && (
              <div className="relative">
                <Building2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                <input value={company} onChange={e => setCompany(e.target.value)} placeholder="公司名称（选填）" className={inputCls} />
              </div>
            )}
            <div className="relative">
              <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="邮箱" className={inputCls}
                onKeyDown={e => e.key === 'Enter' && void submit()} />
            </div>
            <div className="relative">
              <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder={mode === 'register' ? '密码（至少 8 位）' : '密码'} className={inputCls}
                onKeyDown={e => e.key === 'Enter' && void submit()} />
            </div>
          </div>

          {error && <p className="text-xs text-red mt-3">{error}</p>}

          <button onClick={() => void submit()} disabled={loading}
            className="btn-primary w-full mt-5 flex items-center justify-center gap-2 disabled:opacity-60">
            {loading ? <Loader2 size={15} className="animate-spin" /> : null}
            {mode === 'login' ? '登录' : '注册并开始试用'}
          </button>

          <div className="text-center mt-4 text-xs text-text-muted">
            {mode === 'login' ? '还没有账号？' : '已有账号？'}
            <button onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null); }}
              className="font-semibold ml-1" style={{ color: 'var(--color-accent)' }}>
              {mode === 'login' ? '注册' : '去登录'}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
