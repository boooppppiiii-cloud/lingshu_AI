import { useState } from 'react';
import { Zap, MessageSquare, LayoutGrid, Wand2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import InspirationDashboard from './InspirationDashboard';
import AiCreateStudio from './AiCreateStudio';
import type { ConversationContext } from '../App';

type ViewMode = 'dashboard' | 'create' | 'chat';

interface Props {
  onEnterConversation: (ctx: ConversationContext) => void;
  onLeaveConversation: () => void;
  isInConversation: boolean;
}

export default function TrafficPage({ onEnterConversation, isInConversation }: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>('dashboard');

  const handleEnterChat = () => {
    setViewMode('chat');
    onEnterConversation({ agent: 'traffic' });
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
              社媒 Agent 运行中
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
              <InspirationDashboard />
            </motion.div>
          ) : viewMode === 'create' ? (
            <motion.div key="create" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full">
              <AiCreateStudio />
            </motion.div>
          ) : (
            <motion.div key="chat" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: 'rgba(217,119,6,0.08)', color: '#d97706' }}>
                  <Zap size={28} />
                </div>
                <p className="text-base font-bold text-text-primary font-display">社媒 Agent</p>
                <p className="text-sm text-text-muted mt-1">竞品视频克隆 · 脚本生成 · 素材去重矩阵</p>
                <p className="text-xs text-text-muted mt-4">社媒 Agent 对话功能开发中</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
