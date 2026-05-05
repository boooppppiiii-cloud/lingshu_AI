import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';
import { ClientResponseError } from 'pocketbase';
import { useAuth, type SignUpInput } from '../lib/AuthContext';

function formatPbError(err: unknown): string {
  if (err instanceof ClientResponseError) {
    const raw = err.response?.data as { data?: Record<string, { message?: string }>; message?: string } | undefined;
    if (raw?.data && typeof raw.data === 'object') {
      for (const v of Object.values(raw.data)) {
        if (v && typeof v === 'object' && typeof v.message === 'string') return v.message;
      }
    }
    if (typeof raw?.message === 'string' && raw.message) return raw.message;
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return '请求失败，请稍后重试';
}

interface AuthModalProps {
  open: boolean;
  onClose: () => void;
}

export default function AuthModal({ open, onClose }: AuthModalProps) {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSubmitting(false);
  }, [open, mode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password) {
      setError('请填写邮箱和密码');
      return;
    }
    if (mode === 'register') {
      if (password !== passwordConfirm) {
        setError('两次输入的密码不一致');
        return;
      }
      if (password.length < 8) {
        setError('密码至少 8 位');
        return;
      }
    }

    setSubmitting(true);
    try {
      if (mode === 'login') {
        await signIn(email, password);
      } else {
        const payload: SignUpInput = {
          email,
          password,
          passwordConfirm,
          name: name.trim() || undefined,
        };
        await signUp(payload);
      }
      onClose();
      setPassword('');
      setPasswordConfirm('');
    } catch (err) {
      setError(formatPbError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <button
            type="button"
            aria-label="关闭"
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm cursor-default"
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="auth-modal-title"
            className="relative w-full max-w-md glass-card p-8 shadow-xl"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 380, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={onClose}
              className="absolute top-4 right-4 p-2 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
              aria-label="关闭"
            >
              <X className="w-5 h-5" />
            </button>

            <h2 id="auth-modal-title" className="text-xl font-bold text-primary-blue mb-1">
              {mode === 'login' ? '登录' : '注册账号'}
            </h2>
            <p className="text-sm text-slate-500 mb-6">
              {mode === 'login' ? '使用 PocketBase 账号登录' : '创建新账号以保存资产与灵感'}
            </p>

            <div className="flex gap-2 mb-6 p-1 bg-slate-100 rounded-xl">
              <button
                type="button"
                className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-colors cursor-pointer ${
                  mode === 'login' ? 'bg-white text-primary-blue shadow-sm' : 'text-slate-500'
                }`}
                onClick={() => setMode('login')}
              >
                登录
              </button>
              <button
                type="button"
                className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-colors cursor-pointer ${
                  mode === 'register' ? 'bg-white text-primary-blue shadow-sm' : 'text-slate-500'
                }`}
                onClick={() => setMode('register')}
              >
                注册
              </button>
            </div>

            <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
              {mode === 'register' && (
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                    昵称（可选）
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-800 outline-none focus:border-accent-blue/50"
                    placeholder="显示名称"
                    autoComplete="name"
                  />
                </div>
              )}
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">邮箱</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-800 outline-none focus:border-accent-blue/50"
                  placeholder="you@example.com"
                  autoComplete="email"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">密码</label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-800 outline-none focus:border-accent-blue/50"
                  placeholder="••••••••"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                />
              </div>
              {mode === 'register' && (
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                    确认密码
                  </label>
                  <input
                    type="password"
                    required
                    value={passwordConfirm}
                    onChange={(e) => setPasswordConfirm(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-800 outline-none focus:border-accent-blue/50"
                    placeholder="再次输入密码"
                    autoComplete="new-password"
                  />
                </div>
              )}

              {error && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{error}</p>
              )}

              <button type="submit" disabled={submitting} className="btn-primary w-full mt-2">
                {submitting ? '请稍候…' : mode === 'login' ? '登录' : '注册并登录'}
              </button>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
