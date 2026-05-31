import { useEffect, useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { USER_ROLE_LABELS } from '../lib/userRoles';
import { User, LogOut } from 'lucide-react';
import {
  GEMINI_MODEL_OPTIONS,
  type GeminiModelChoice,
  readGeminiModelChoice,
  writeGeminiModelChoice,
} from '../lib/geminiModelSelection';

interface HeaderProps {
  onAuthClick: () => void;
}

export default function Header({ onAuthClick }: HeaderProps) {
  const { user, loading, signOut } = useAuth();
  const [modelChoice, setModelChoice] = useState<GeminiModelChoice>('preview');

  useEffect(() => {
    setModelChoice(readGeminiModelChoice());
  }, []);

  const handleModelChange = (next: GeminiModelChoice) => {
    setModelChoice(next);
    writeGeminiModelChoice(next);
  };

  return (
    <header className="h-20 bg-white/80 backdrop-blur-xl border-b border-slate-200 flex items-center justify-end px-8 sticky top-0 z-30 ml-64">
      <div className="flex items-center gap-4">
        <label className="hidden items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500 sm:flex">
          <span className="font-bold text-slate-600">模型</span>
          <select
            value={modelChoice}
            onChange={(e) => handleModelChange(e.target.value as GeminiModelChoice)}
            className="rounded border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 outline-none focus:border-accent-blue"
            title="AI 模型选择"
          >
            {GEMINI_MODEL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {loading ? (
          <div className="h-10 w-40 rounded-lg bg-slate-100 animate-pulse" aria-hidden />
        ) : user ? (
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-sm font-bold text-primary-blue leading-none mb-1">{user.displayName || '用户'}</div>
              <div className="text-[10px] text-slate-500">
                {USER_ROLE_LABELS[user.role]} · {user.email}
              </div>
            </div>
            <button 
              onClick={() => signOut()}
              className="p-2 hover:bg-red-50 text-slate-400 hover:text-red-600 rounded-lg transition-all"
              title="退出登录"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onAuthClick}
            className="btn-primary py-2 px-4 flex items-center gap-2 text-sm"
          >
            <User className="w-4 h-4" />
            登录 / 注册
          </button>
        )}
      </div>
    </header>
  );
}
