import { useAuth } from '../lib/AuthContext';
import { User, LogOut } from 'lucide-react';

interface HeaderProps {
  onAuthClick: () => void;
}

export default function Header({ onAuthClick }: HeaderProps) {
  const { user, loading, signOut } = useAuth();

  return (
    <header className="h-20 bg-white/80 backdrop-blur-xl border-b border-slate-200 flex items-center justify-end px-8 sticky top-0 z-30 ml-64">
      <div className="flex items-center gap-4">
        {loading ? (
          <div className="h-10 w-40 rounded-lg bg-slate-100 animate-pulse" aria-hidden />
        ) : user ? (
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-sm font-bold text-primary-blue leading-none mb-1">{user.displayName || '创意师'}</div>
              <div className="text-[10px] text-slate-500">{user.email}</div>
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
