import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Building2, Loader2, Lock, Mail, Ticket } from 'lucide-react';
import { authApi, setToken, type AuthSession } from '../lib/auth';

const initialInviteCode = () => new URLSearchParams(window.location.search).get('invite')?.trim() || '';
const initialCompanyName = () => new URLSearchParams(window.location.search).get('company')?.trim() || '';

export default function AuthScreen({ onAuthed }: { onAuthed: (s: AuthSession) => void }) {
  const linkedInviteCode = initialInviteCode();
  const linkedCompanyName = initialCompanyName();
  const [mode, setMode] = useState<'login' | 'register'>(() => linkedInviteCode ? 'register' : 'login');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [registrationCompany, setRegistrationCompany] = useState(linkedCompanyName);
  const [registrationCompanyLocked, setRegistrationCompanyLocked] = useState(Boolean(linkedCompanyName));
  const [registrationEmail, setRegistrationEmail] = useState('');
  const [registrationPassword, setRegistrationPassword] = useState('');
  const [registrationFieldsUnlocked, setRegistrationFieldsUnlocked] = useState(false);
  const [inviteCode, setInviteCode] = useState(initialInviteCode);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== 'register') return;
    const code = inviteCode.trim();
    if (!code) {
      setRegistrationCompany(linkedCompanyName);
      setRegistrationCompanyLocked(Boolean(linkedCompanyName));
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void authApi.invite(code)
        .then(result => {
          if (cancelled) return;
          setRegistrationCompany(result.companyName || linkedCompanyName);
          setRegistrationCompanyLocked(Boolean(result.companyName || linkedCompanyName));
          setError(result.valid ? null : '邀请码已使用，请联系管理员重新生成');
        })
        .catch(err => {
          if (cancelled) return;
          setRegistrationCompany(linkedCompanyName);
          setRegistrationCompanyLocked(Boolean(linkedCompanyName));
          setError(err instanceof Error ? err.message : '邀请码无效或已使用');
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [inviteCode, linkedCompanyName, mode]);

  const submit = async () => {
    setError(null);
    const email = mode === 'register' ? registrationEmail.trim() : loginEmail.trim();
    const password = mode === 'register' ? registrationPassword : loginPassword;
    if (!email || !password) { setError('请填写邮箱和密码'); return; }
    if (password.length < 8) { setError('密码至少 8 位'); return; }
    if (mode === 'register' && !inviteCode.trim()) { setError('请输入管理员提供的邀请码'); return; }
    setLoading(true);
    try {
      const r = mode === 'register'
        ? await authApi.register(email, password, inviteCode)
        : await authApi.login(email, password);
      setToken(r.token);
      onAuthed({ user: r.user, tenant: r.tenant, demo: r.demo });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '请求失败');
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (nextMode: 'login' | 'register') => {
    setMode(nextMode);
    setError(null);
    if (nextMode === 'register') {
      setRegistrationCompany(linkedCompanyName);
      setRegistrationCompanyLocked(Boolean(linkedCompanyName));
      setRegistrationEmail('');
      setRegistrationPassword('');
      setRegistrationFieldsUnlocked(false);
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
          <div className="mb-6 grid grid-cols-2 rounded-xl bg-surface-2 p-1">
            {[
              { id: 'login' as const, label: '账号登录' },
              { id: 'register' as const, label: '注册账号' },
            ].map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => switchMode(item.id)}
                className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                  mode === item.id
                    ? 'bg-white text-text-primary shadow-sm'
                    : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <h1 className="text-base font-bold text-text-primary mb-1">{mode === 'register' ? '注册' : '登录'}</h1>
          <p className="text-xs text-text-muted mb-5">
            {mode === 'register'
              ? '使用管理员提供的邀请码注册正式客户账号'
              : '正式客户账号与管理员提供的试用账号均可直接登录'}
          </p>

          {mode === 'register' ? (
            <form
              key={`registration-${linkedInviteCode || 'manual'}`}
              autoComplete="off"
              onSubmit={event => {
                event.preventDefault();
                void submit();
              }}
            >
              <div className="space-y-3">
                <div className="relative">
                  <Building2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                  <input
                    name="customer-registration-company"
                    autoComplete="off"
                    readOnly
                    value={registrationCompany}
                    placeholder="公司名称由管理员填写"
                    className={`${inputCls} ${registrationCompanyLocked ? 'cursor-default' : ''}`}
                  />
                </div>
                <div className="relative">
                  <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                  <input
                    type="email"
                    name="customer-registration-email"
                    autoComplete="off"
                    data-1p-ignore="true"
                    data-lpignore="true"
                    readOnly={!registrationFieldsUnlocked}
                    value={registrationEmail}
                    onFocus={() => setRegistrationFieldsUnlocked(true)}
                    onChange={event => setRegistrationEmail(event.target.value)}
                    placeholder="请客户填写注册邮箱"
                    className={inputCls}
                  />
                </div>
                <div className="relative">
                  <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                  <input
                    type="password"
                    name="customer-registration-new-password"
                    autoComplete="new-password"
                    data-1p-ignore="true"
                    data-lpignore="true"
                    readOnly={!registrationFieldsUnlocked}
                    value={registrationPassword}
                    onFocus={() => setRegistrationFieldsUnlocked(true)}
                    onChange={event => setRegistrationPassword(event.target.value)}
                    placeholder="请客户设置登录密码（至少 8 位）"
                    className={inputCls}
                  />
                </div>
                <div className="relative">
                  <Ticket size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                  <input
                    name="customer-registration-invite"
                    autoComplete="off"
                    value={inviteCode}
                    onChange={event => setInviteCode(event.target.value)}
                    placeholder="管理员邀请码"
                    className={inputCls}
                  />
                </div>
              </div>
              {error && <p className="text-xs text-red mt-3">{error}</p>}
              <button type="submit" disabled={loading}
                className="btn-primary w-full mt-5 flex items-center justify-center gap-2 disabled:opacity-60">
                {loading ? <Loader2 size={15} className="animate-spin" /> : null}
                注册并进入工作台
              </button>
            </form>
          ) : (
            <form
              key="account-login"
              autoComplete="on"
              onSubmit={event => {
                event.preventDefault();
                void submit();
              }}
            >
              <div className="space-y-3">
                <div className="relative">
                  <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                  <input
                    type="email"
                    name="email"
                    autoComplete="username"
                    value={loginEmail}
                    onChange={event => setLoginEmail(event.target.value)}
                    placeholder="邮箱"
                    className={inputCls}
                  />
                </div>
                <div className="relative">
                  <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                  <input
                    type="password"
                    name="password"
                    autoComplete="current-password"
                    value={loginPassword}
                    onChange={event => setLoginPassword(event.target.value)}
                    placeholder="密码"
                    className={inputCls}
                  />
                </div>
              </div>
              {error && <p className="text-xs text-red mt-3">{error}</p>}
              <button type="submit" disabled={loading}
                className="btn-primary w-full mt-5 flex items-center justify-center gap-2 disabled:opacity-60">
                {loading ? <Loader2 size={15} className="animate-spin" /> : null}
                登录工作台
              </button>
            </form>
          )}

          <div className="mt-4 flex items-center justify-center border-t border-border pt-4 text-[11px] font-semibold text-text-muted">
            <a href="/privacy" className="transition-colors hover:text-accent">隐私政策</a>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
