import { motion } from 'motion/react';
import { Sparkles, Zap, LayoutGrid, FolderHeart, User, BarChart3, Rocket, Users } from 'lucide-react';
import { ViewState } from '../types';
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { useGameProfile } from '../lib/GameProfileContext';
import { GAME_PROFILE_OPTIONS } from '../lib/gameProfiles';
import { AceMechaLogo, FlowerGameLogo, XiyouWukongLogo } from './gameProfileLogos';
import { getNavItemsForRole, resolveEffectiveRole, type RoleNavItem } from '../lib/userRoles';

interface SidebarProps {
  activeView: ViewState;
  onViewChange: (view: ViewState) => void;
}

const POETIC_QUOTES = [
  "在寂静深处，触碰灵魂的涟漪。",
  "每一个像素，都是通往梦想的星帆。",
  "创新是无垠的深海，勇气是唯一的航向。",
  "于代码之林，种下一枚奇迹的种子。",
  "设计不仅是形状，更是情感的呼吸。",
  "在创意的大海中，每个瞬间都熠熠生辉。"
];

function navIcon(item: RoleNavItem) {
  const cls = 'w-5 h-5';
  switch (item.icon) {
    case 'zap':
      return <Zap className={cls} />;
    case 'bar-chart':
      return <BarChart3 className={cls} />;
    case 'layout-grid':
      return <LayoutGrid className={cls} />;
    case 'folder-heart':
      return <FolderHeart className={cls} />;
    case 'rocket':
      return <Rocket className={cls} />;
    case 'users':
      return <Users className={cls} />;
    case 'user':
    default:
      return <User className={cls} />;
  }
}

export default function Sidebar({ activeView, onViewChange }: SidebarProps) {
  const [quote, setQuote] = useState('');
  const { user } = useAuth();
  const { gameProfileId, setGameProfileId } = useGameProfile();
  const currentGame = GAME_PROFILE_OPTIONS.find((g) => g.id === gameProfileId) ?? GAME_PROFILE_OPTIONS[0];
  const effectiveRole = resolveEffectiveRole(user?.role);
  const navItems = getNavItemsForRole(effectiveRole);

  useEffect(() => {
    setQuote(POETIC_QUOTES[Math.floor(Math.random() * POETIC_QUOTES.length)]);
  }, []);

  return (
    <aside className="fixed left-0 top-0 h-full w-64 bg-white border-r border-slate-200 z-40 flex flex-col p-6">
      <div className="flex flex-col gap-3 mb-10 px-2">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-accent-blue/5 rounded-xl shrink-0 text-accent-blue">
            {gameProfileId === 'xiyou_card' ? (
              <XiyouWukongLogo className="h-8 w-8" />
            ) : gameProfileId === 'ace_mecha' ? (
              <AceMechaLogo className="h-8 w-8" />
            ) : (
              <FlowerGameLogo className="h-8 w-8" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-bold text-xl text-primary-blue tracking-tight leading-tight">{currentGame.label}</div>
            <div className="text-[10px] text-accent-blue uppercase tracking-[0.2em] mt-0.5">{currentGame.subtitle}</div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-1 pl-1">
          {GAME_PROFILE_OPTIONS.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => setGameProfileId(g.id)}
              className={`rounded-lg px-1.5 py-1.5 text-[10px] font-bold transition-all border ${
                gameProfileId === g.id
                  ? 'border-accent-blue bg-accent-blue/10 text-primary-blue shadow-sm'
                  : 'border-slate-200 bg-white text-slate-500 hover:border-accent-blue/30 hover:text-primary-blue'
              }`}
            >
              {g.shortLabel}
            </button>
          ))}
        </div>
      </div>

      <nav className="flex-1 space-y-2">
        {navItems.map((item) => (
          <SidebarLink
            key={item.view}
            active={activeView === item.view}
            onClick={() => onViewChange(item.view)}
            icon={navIcon(item)}
            label={item.label}
          />
        ))}
      </nav>

      <div className="mt-auto p-5 bg-slate-50 rounded-[2rem] border border-slate-100 relative overflow-hidden group">
        <div className="absolute top-0 left-0 w-1 h-full bg-accent-blue scale-y-0 group-hover:scale-y-100 transition-transform origin-top duration-500" />
        <div className="flex items-start gap-3">
          <Sparkles className="w-5 h-5 text-accent-blue shrink-0 mt-0.5 opacity-50" />
          <div className="text-xs text-slate-500 leading-relaxed italic font-medium">{quote}</div>
        </div>
      </div>
    </aside>
  );
}

function SidebarLink({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all relative group ${active ? 'text-accent-blue' : 'text-slate-500 hover:text-primary-blue hover:bg-slate-50'}`}
    >
      {active && (
        <motion.div
          layoutId="sidebar-active"
          className="absolute inset-0 bg-accent-blue/5 rounded-xl border border-accent-blue/10"
        />
      )}
      <span className="relative z-10">{icon}</span>
      <span className="relative z-10 font-bold">{label}</span>
    </button>
  );
}
