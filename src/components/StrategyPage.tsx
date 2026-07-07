import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Compass, LayoutGrid, BarChart3 } from 'lucide-react';
import AgentWorkspace from './AgentWorkspace';
import StrategyDataBoard from './StrategyDataBoard';
import type { AgentAction, ConversationContext, KickoffSignal, RestoreSignal } from '../App';

type ViewMode = 'workspace' | 'board';

interface Props {
  onEnterConversation: (ctx: ConversationContext) => void;
  onLeaveConversation?: () => void;
  isInConversation?: boolean;
  restore?: RestoreSignal;
  kickoff?: KickoffSignal;
  onAction?: AgentAction;
  onSessionRefresh?: () => void;
}

export default function StrategyPage({ onAction }: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>('board');

  return (
    <div className="flex flex-col h-full">
      <div className="h-12 flex items-center justify-between px-5 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: 'rgba(22,163,74,0.1)', color: '#16a34a' }}>
            <Compass size={13} />
          </div>
          <span className="text-sm font-semibold text-text-primary">首页</span>
        </div>
        <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-surface-2 border border-border">
          {([
            { mode: 'workspace' as ViewMode, icon: <LayoutGrid size={12} />, label: 'AI 智囊团' },
            { mode: 'board' as ViewMode, icon: <BarChart3 size={12} />, label: '数据大屏' },
          ]).map(({ mode, icon, label }) => (
            <button key={mode} onClick={() => setViewMode(mode)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-all ${viewMode === mode ? 'bg-surface text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'}`}>
              {icon}<span>{label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        <AnimatePresence mode="wait">
          {viewMode === 'board' ? (
            <motion.div key="board" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full">
              <StrategyDataBoard onAction={onAction} />
            </motion.div>
          ) : (
            <motion.div key="workspace" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full">
              <AgentWorkspace />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
