import { useState } from 'react';
import { motion } from 'motion/react';
import { Loader2, Mail, Lock } from 'lucide-react';
import { authApi, setToken, type AuthSession } from '../lib/auth';

export default function AuthScreen({ onAuthed }: { onAuthed: (s: AuthSession) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!email || !password) { setError('请填写邮箱和密码'); return; }
    setLoading(true);
    try {
      const r = await authApi.login(email, password);
      setToken(r.token);
      onAuthed({ user: r.user, tenant: r.tenant, demo: r.demo });
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
          <img src="/brand-logo.png" alt="灵枢 AI" className="w-9 h-9 object-contain" />
          <span className="text-lg font-bold text-text-primary font-display">灵枢 AI 工作台</span>
        </div>

        <div className="card !rounded-2xl p-6">
          <h1 className="text-base font-bold text-text-primary mb-1">登录</h1>
          <p className="text-xs text-text-muted mb-5">使用管理员分配的账号密码开始 5 天试用</p>

          <div className="space-y-3">
            <div className="relative">
              <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="邮箱" className={inputCls}
                onKeyDown={e => e.key === 'Enter' && void submit()} />
            </div>
            <div className="relative">
              <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="密码" className={inputCls}
                onKeyDown={e => e.key === 'Enter' && void submit()} />
            </div>
          </div>

          {error && <p className="text-xs text-red mt-3">{error}</p>}

          <button onClick={() => void submit()} disabled={loading}
            className="btn-primary w-full mt-5 flex items-center justify-center gap-2 disabled:opacity-60">
            {loading ? <Loader2 size={15} className="animate-spin" /> : null}
            登录并开始试用
          </button>

          <div className="text-center mt-4 text-xs text-text-muted">
            没有账号？请联系管理员分配测试账号
          </div>
        </div>
      </motion.div>
    </div>
  );
}
