import { useState, useEffect } from 'react';
import { Zap, MessageSquare, LayoutGrid, Wand2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import InspirationDashboard from './InspirationDashboard';
import AiCreateStudio from './AiCreateStudio';
import AgentChatPage from './AgentChatPage';
import type { ConversationContext, Page, RestoreSignal, KickoffSignal, AgentAction } from '../App';

type ViewMode = 'dashboard' | 'create' | 'chat';

interface Props {
  onEnterConversation: (ctx: ConversationContext) => void;
  onLeaveConversation: () => void;
  isInConversation: boolean;
  onNavigate?: (p: Page) => void;
  restore?: RestoreSignal;
  kickoff?: KickoffSignal;
  onAction?: AgentAction;
  onScriptPanelOpen?: () => void;
  onScriptPanelClose?: () => void;
  onSessionRefresh?: () => void;
}

export default function TrafficPage({ onEnterConversation, onLeaveConversation, isInConversation, onNavigate, restore, kickoff, onAction, onScriptPanelOpen, onScriptPanelClose, onSessionRefresh }: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>('dashboard');
  useEffect(() => { if (restore) setViewMode('chat'); }, [restore?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (kickoff) setViewMode('chat'); }, [kickoff?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleEnterChat = (ctx: ConversationContext = { agent: 'traffic' }) => {
    setViewMode('chat');
    onEnterConversation(ctx);
  };
  const handleLeave = () => {
    setViewMode('dashboard');
    onLeaveConversation();
  };
  const handleEnterWorkflow = (payload: unknown) => {
    try { localStorage.setItem('ow_video_kickoff', JSON.stringify(payload)); } catch { /* ignore */ }
    setViewMode('create');
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="h-12 flex items-center justify-between px-5 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: 'rgba(217,119,6,0.1)', color: '#d97706' }}>
            <Zap size={13} />
          </div>
          <span className="text-sm font-semibold text-text-primary">流量</span>
          {isInConversation && (
            <span className="flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full ml-1" style={{ background: 'rgba(217,119,6,0.1)', color: '#d97706' }}>
              <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
              流量专家 运行中
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-surface-2 border border-border">
            {([
              { mode: 'dashboard' as ViewMode, icon: <LayoutGrid size={12} />, label: '素材库' },
              { mode: 'create' as ViewMode,    icon: <Wand2 size={12} />, label: 'AI 生成' },
              { mode: 'chat' as ViewMode,      icon: <MessageSquare size={12} />, label: '对话' },
            ]).map(({ mode, icon, label }) => (
              <button key={mode}
                onClick={() => mode === 'chat' ? handleEnterChat() : setViewMode(mode)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-all ${viewMode === mode ? 'bg-surface text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'}`}>
                {icon}<span>{label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <AnimatePresence mode="wait">
          {viewMode === 'dashboard' ? (
            <motion.div key="dashboard" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full overflow-y-auto">
              <InspirationDashboard
                onScriptPanelOpen={onScriptPanelOpen}
                onScriptPanelClose={onScriptPanelClose}
                onNavigate={onNavigate}
                onEnterWorkflow={handleEnterWorkflow}
              />
            </motion.div>
          ) : viewMode === 'create' ? (
            <motion.div key="create" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full">
              <AiCreateStudio onNavigate={onNavigate} />
            </motion.div>
          ) : (
            <motion.div key="chat" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full">
              <AgentChatPage
                config={{
                  type: 'traffic',
                  apiPath: '/api/overseas/agents/traffic/chat',
                  color: '#d97706',
                  bg: 'rgba(217,119,6,0.1)',
                  icon: <Zap size={13} />,
                  name: '流量专家',
                  tagline: '爆款拆解 · 多语言脚本 · 矩阵发布',
                  suggestions: [
                    '主推品脚本方向',
                    '目标市场发布节奏',
                    '卖点口播脚本',
                    '产品亮点钩子',
                  ],
                }}
                onEnterConversation={handleEnterChat}
                onLeaveConversation={handleLeave}
                isInConversation={isInConversation}
                restoreKey={restore?.key}
                restoreMessages={restore?.messages}
                kickoff={kickoff}
                onAction={onAction}
                onSessionRefresh={onSessionRefresh}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
