import { motion } from 'motion/react';
import { Sparkles, Zap, LayoutGrid, Waves, FolderHeart, User } from 'lucide-react';
import { ViewState } from '../types';
import { useEffect, useState } from 'react';

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

export default function Sidebar({ activeView, onViewChange }: SidebarProps) {
  const [quote, setQuote] = useState('');

  useEffect(() => {
    // Pick a random quote on component mount
    setQuote(POETIC_QUOTES[Math.floor(Math.random() * POETIC_QUOTES.length)]);
  }, []);

  return (
    <aside className="fixed left-0 top-0 h-full w-64 bg-white border-r border-slate-200 z-40 flex flex-col p-6">
      <div className="flex items-center gap-3 mb-12 px-2">
        <div className="p-2 bg-accent-blue/5 rounded-xl">
          <Waves className="w-8 h-8 text-accent-blue" />
        </div>
        <div className="font-bold text-xl text-primary-blue tracking-tight">
          script ai
          <div className="text-[10px] text-accent-blue uppercase tracking-[0.2em]">Creative Studio</div>
        </div>
      </div>

      <nav className="flex-1 space-y-2">
        <SidebarLink
          active={activeView === 'market'}
          onClick={() => onViewChange('market')}
          icon={<Zap className="w-5 h-5" />}
          label="灵感市场"
        />
        <SidebarLink
          active={activeView === 'workshop'}
          onClick={() => onViewChange('workshop')}
          icon={<LayoutGrid className="w-5 h-5" />}
          label="创意工坊"
        />
        <SidebarLink
          active={activeView === 'assets'}
          onClick={() => onViewChange('assets')}
          icon={<FolderHeart className="w-5 h-5" />}
          label="资产卡片"
        />
        <SidebarLink
          active={activeView === 'profile'}
          onClick={() => onViewChange('profile')}
          icon={<User className="w-5 h-5" />}
          label="个人中心"
        />
      </nav>

      <div className="mt-auto p-5 bg-slate-50 rounded-[2rem] border border-slate-100 relative overflow-hidden group">
        <div className="absolute top-0 left-0 w-1 h-full bg-accent-blue scale-y-0 group-hover:scale-y-100 transition-transform origin-top duration-500" />
        <div className="flex items-start gap-3">
          <Sparkles className="w-5 h-5 text-accent-blue shrink-0 mt-0.5 opacity-50" />
          <div className="text-xs text-slate-500 leading-relaxed italic font-medium">
            {quote}
          </div>
        </div>
      </div>
    </aside>
  );
}

function SidebarLink({ active, onClick, icon, label }: { 
  active: boolean, 
  onClick: () => void, 
  icon: React.ReactNode, 
  label: string 
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
