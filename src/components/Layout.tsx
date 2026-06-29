import { type ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Compass, Zap, MessageSquare, RefreshCw,
  Building2, Puzzle, Clock, Radio,
  Globe, ChevronRight, Plus, LogOut,
} from 'lucide-react';
import type { Page, ConversationContext, Conversation, AgentAction } from '../App';
import RightPanel from './RightPanel';
import DemoGuide from './DemoGuide';

interface NavSection {
  items: { id: Page; label: string; icon: ReactNode }[];
}

const PRIMARY_NAV: NavSection = {
  items: [
    { id: 'strategy',   label: '策略专家', icon: <Compass size={16} /> },
    { id: 'traffic',    label: '流量专家', icon: <Zap size={16} /> },
    { id: 'conversion', label: '转化专家', icon: <MessageSquare size={16} /> },
    { id: 'retention',  label: '留存专家', icon: <RefreshCw size={16} /> },
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

interface LayoutProps {
  page: Page;
  onNavigate: (p: Page) => void;
  conversation: ConversationContext | null;
  children: ReactNode;
  session?: import('../lib/auth').AuthSession | null;
  onLogout?: () => void;
  conversations?: Conversation[];
  activeConvId?: string | null;
  onOpenConversation?: (id: string) => void;
  onNewConversation?: () => void;
  suppressRightPanel?: boolean;
  onAction?: AgentAction;
}

const relTime = (ts: number) => {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
};

const SUB_LABEL: Record<string, string> = {
  trialing: '试用中', active: '已订阅', past_due: '续费逾期', canceled: '已取消', expired: '已过期', none: '未订阅',
};

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

export default function Layout({ page, onNavigate, conversation, children, session, onLogout, conversations, activeConvId, onOpenConversation, onNewConversation, suppressRightPanel, onAction }: LayoutProps) {
  const recent = (conversations ?? []).filter(c => c.messages.length > 0);
  const isInConversation = conversation !== null && !suppressRightPanel;
  const tenantName = session?.tenant?.name || session?.user?.name || session?.user?.email?.split('@')[0] || '未命名';
  const subStatus = session?.tenant?.subscriptionStatus || session?.subscription?.status || 'none';
  const initial = (tenantName[0] || '灵').toUpperCase();
  const demo = session?.demo;

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

        {session?.demo?.enabled && (
          <DemoGuide onNavigate={onNavigate} onAction={onAction} />
        )}

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
            <button onClick={() => onNewConversation?.()} title="新建会话"
              className="p-1 rounded-md hover:bg-black/5 text-text-muted transition-colors">
              <Plus size={12} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-3 space-y-0.5 pb-2">
            {recent.length === 0 && (
              <p className="px-3 py-2 text-[11px] text-text-muted leading-relaxed">还没有会话，去和某位专家对话后会出现在这里。</p>
            )}
            {recent.map(conv => (
              <button
                key={conv.id}
                onClick={() => onOpenConversation?.(conv.id)}
                className="w-full flex items-start gap-2.5 px-3 py-2 rounded-xl text-left transition-colors group"
                style={conv.id === activeConvId ? { background: 'rgba(255,255,255,0.8)' } : undefined}
              >
                <span
                  className="mt-0.5 w-2 h-2 rounded-full flex-shrink-0"
                  style={{ background: AGENT_COLORS[conv.agent] }}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-text-secondary truncate leading-snug group-hover:text-text-primary transition-colors">
                    {conv.title}
                  </p>
                  <p className="text-[10px] text-text-muted mt-0.5">{relTime(conv.updatedAt)}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Bottom user */}
        <div className="px-3 py-3 border-t border-border flex-shrink-0">
          {demo?.enabled && (
            <div className="mb-2 rounded-lg bg-white/70 border border-border px-2.5 py-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-semibold text-text-secondary">Demo 试用</span>
                <span className={`text-[10px] font-bold ${demo.expired ? 'text-red-600' : 'text-accent'}`}>
                  {demo.expired ? '已到期' : `剩余 ${demo.daysRemaining ?? '-'} 天`}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-1 text-center">
                <div className="rounded-md bg-surface-2 px-1 py-1">
                  <p className="text-[10px] font-bold text-text-primary">{demo.remaining.aiChat}</p>
                  <p className="text-[9px] text-text-muted">对话</p>
                </div>
                <div className="rounded-md bg-surface-2 px-1 py-1">
                  <p className="text-[10px] font-bold text-text-primary">{demo.remaining.generation}</p>
                  <p className="text-[9px] text-text-muted">生成</p>
                </div>
                <div className="rounded-md bg-surface-2 px-1 py-1">
                  <p className="text-[10px] font-bold text-text-primary">{demo.remaining.render}</p>
                  <p className="text-[9px] text-text-muted">预览</p>
                </div>
                <div className="rounded-md bg-surface-2 px-1 py-1">
                  <p className="text-[10px] font-bold text-text-primary">{demo.remaining.videoGeneration ?? 0}</p>
                  <p className="text-[9px] text-text-muted">视频</p>
                </div>
              </div>
            </div>
          )}
          <div className="flex items-center gap-2.5">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, #4ade80, #16a34a)' }}
            >
              {initial}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-text-primary truncate">{tenantName}</p>
              <p className="text-[10px] text-text-muted truncate">{SUB_LABEL[subStatus] ?? subStatus}</p>
            </div>
            {onLogout && (
              <button onClick={onLogout} title="退出登录"
                className="relative p-1 rounded-md hover:bg-black/5 text-text-muted hover:text-text-primary transition-colors flex-shrink-0">
                <LogOut size={13} />
              </button>
            )}
          </div>
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
            <RightPanel conversation={conversation} onAction={onAction} />
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );
}
