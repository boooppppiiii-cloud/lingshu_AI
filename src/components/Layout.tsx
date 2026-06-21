import { type ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Compass, Zap, MessageSquare, RefreshCw,
  Building2, Puzzle, Clock, Radio,
  Globe, Bell, ChevronRight, Plus,
} from 'lucide-react';
import type { Page } from '../App';
import type { ConversationContext } from '../App';
import RightPanel from './RightPanel';

interface NavSection {
  items: { id: Page; label: string; icon: ReactNode }[];
}

const PRIMARY_NAV: NavSection = {
  items: [
    { id: 'strategy',   label: '策略',   icon: <Compass size={16} /> },
    { id: 'traffic',    label: '流量',    icon: <Zap size={16} /> },
    { id: 'conversion', label: '转化',    icon: <MessageSquare size={16} /> },
    { id: 'retention',  label: '留存',    icon: <RefreshCw size={16} /> },
  ],
};

const SECONDARY_NAV: NavSection = {
  items: [
    { id: 'enterprise', label: '企业中心', icon: <Building2 size={16} /> },
    { id: 'plugins',    label: '插件',    icon: <Puzzle size={16} /> },
    { id: 'scheduled',  label: '定时任务', icon: <Clock size={16} /> },
    { id: 'channels',   label: '消息渠道', icon: <Radio size={16} /> },
  ],
};

const AGENT_COLORS: Record<string, string> = {
  strategy: '#4f46e5',
  traffic:  '#d97706',
  conversion: '#0891b2',
  retention: '#16a34a',
};

interface RecentConv {
  id: string;
  agent: 'strategy' | 'traffic' | 'conversion' | 'retention';
  title: string;
  time: string;
}

const RECENT_CONVS: RecentConv[] = [
  { id: '1', agent: 'strategy',   title: '斋月中东市场推广机会分析', time: '2小时前' },
  { id: '2', agent: 'traffic',    title: '假发TikTok爆款视频拆解', time: '昨天' },
  { id: '3', agent: 'strategy',   title: '反向推品：越南买家偏好', time: '昨天' },
  { id: '4', agent: 'conversion', title: '阿语客服话术优化建议', time: '2天前' },
  { id: '5', agent: 'retention',  title: '75天未复购老客唤醒方案', time: '3天前' },
];

interface LayoutProps {
  page: Page;
  onNavigate: (p: Page) => void;
  conversation: ConversationContext | null;
  children: ReactNode;
}

function NavItem({
  item,
  active,
  onClick,
}: {
  item: { id: Page; label: string; icon: ReactNode };
  active: boolean;
  onClick: () => void;
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-colors cursor-pointer relative"
      style={
        active
          ? { background: '#ffffff', color: '#0f172a', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }
          : { color: '#64748b' }
      }
    >
      {active && (
        <motion.span
          layoutId="nav-active"
          className="absolute inset-0 rounded-xl"
          style={{ background: '#ffffff', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}
          transition={{ type: 'spring', damping: 30, stiffness: 350 }}
        />
      )}
      <span className="relative flex-shrink-0" style={{ color: active ? 'var(--color-accent)' : undefined }}>
        {item.icon}
      </span>
      <span className="relative flex-1 text-left">{item.label}</span>
      {active && (
        <ChevronRight size={13} className="relative flex-shrink-0" style={{ color: '#94a3b8' }} />
      )}
    </motion.button>
  );
}

export default function Layout({ page, onNavigate, conversation, children }: LayoutProps) {
  const isInConversation = conversation !== null;

  return (
    <div className="flex h-screen overflow-hidden">

      {/* ── Left sidebar ─────────────────────────────── */}
      <aside
        className="w-[220px] flex-shrink-0 flex flex-col border-r border-border"
        style={{ background: '#f2f3f5' }}
      >
        {/* Logo */}
        <div className="h-14 flex items-center px-4 gap-2.5 flex-shrink-0">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #4ade80, #16a34a)' }}
          >
            <Globe size={13} className="text-white" />
          </div>
          <span className="text-sm font-bold text-text-primary font-display">灵枢 AI</span>
        </div>

        {/* Primary nav */}
        <nav className="px-3 space-y-0.5">
          <p className="px-3 pt-1 pb-1.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
            业务中台
          </p>
          {PRIMARY_NAV.items.map(item => (
            <NavItem
              key={item.id}
              item={item}
              active={page === item.id}
              onClick={() => onNavigate(item.id)}
            />
          ))}
        </nav>

        {/* Divider */}
        <div className="mx-4 my-3 border-t border-border" />

        {/* Secondary nav */}
        <nav className="px-3 space-y-0.5">
          <p className="px-3 pb-1.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
            系统设置
          </p>
          {SECONDARY_NAV.items.map(item => (
            <NavItem
              key={item.id}
              item={item}
              active={page === item.id}
              onClick={() => onNavigate(item.id)}
            />
          ))}
        </nav>

        {/* Divider */}
        <div className="mx-4 my-3 border-t border-border" />

        {/* Recent conversations */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <div className="px-3 flex items-center justify-between mb-1.5 flex-shrink-0">
            <p className="px-3 text-[10px] font-semibold text-text-muted uppercase tracking-wider">近期会话</p>
            <button className="p-1 rounded-md hover:bg-black/5 text-text-muted transition-colors">
              <Plus size={12} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-3 space-y-0.5 pb-2">
            {RECENT_CONVS.map(conv => (
              <button
                key={conv.id}
                onClick={() => onNavigate(conv.agent)}
                className="w-full flex items-start gap-2.5 px-3 py-2 rounded-xl text-left hover:bg-white/70 transition-colors group"
              >
                <span
                  className="mt-0.5 w-2 h-2 rounded-full flex-shrink-0"
                  style={{ background: AGENT_COLORS[conv.agent] }}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-text-secondary truncate leading-snug group-hover:text-text-primary transition-colors">
                    {conv.title}
                  </p>
                  <p className="text-[10px] text-text-muted mt-0.5">{conv.time}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Bottom user */}
        <div className="px-3 py-3 border-t border-border flex items-center gap-2.5 flex-shrink-0">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #4ade80, #16a34a)' }}
          >
            义
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-text-primary truncate">义乌商贸</p>
            <p className="text-[10px] text-text-muted truncate">Free Plan</p>
          </div>
          <button className="relative p-1 rounded-md hover:bg-black/5 text-text-muted transition-colors flex-shrink-0">
            <Bell size={13} />
            <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-accent" />
          </button>
        </div>
      </aside>

      {/* ── Main content ─────────────────────────────── */}
      <main className="flex-1 min-w-0 overflow-hidden bg-white flex flex-col">
        {children}
      </main>

      {/* ── Right panel (only in conversation mode) ── */}
      <AnimatePresence>
        {isInConversation && (
          <motion.aside
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 272, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="flex-shrink-0 bg-white flex flex-col overflow-hidden"
            style={{ boxShadow: '-6px 0 24px rgba(0,0,0,0.06)' }}
          >
            <RightPanel conversation={conversation} />
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );
}
