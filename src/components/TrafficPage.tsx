import { useState, useEffect } from 'react';
import { Zap, LayoutGrid, Wand2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import InspirationDashboard from './InspirationDashboard';
import AiCreateStudio from './AiCreateStudio';
import type { ConversationContext, Page, RestoreSignal, KickoffSignal, AgentAction } from '../App';

type ViewMode = 'dashboard' | 'create';

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

export default function TrafficPage({ onNavigate, restore, kickoff, onScriptPanelOpen, onScriptPanelClose }: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>('dashboard');
  useEffect(() => { if (restore || kickoff) setViewMode('dashboard'); }, [restore?.key, kickoff?.key]);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('lingshu-assistant-context', {
      detail: viewMode === 'create'
        ? {
            agent: 'traffic',
            label: '创作室',
            summary: '当前在我的社媒创作室，适合根据商品、目标市场和平台生成短视频脚本、标题、口播钩子和发布文案。',
            suggestions: ['生成一条主推品短视频脚本', '把卖点改成阿语口播', '设计 TikTok 三条发布文案', '优化视频开头 3 秒钩子'],
          }
        : {
            agent: 'traffic',
            label: '我的社媒',
            summary: '当前在我的社媒素材库，适合拆解爆款内容、筛选素材方向、规划发布节奏和把灵感转成创作任务。',
            suggestions: ['拆解当前素材方向', '规划本周发布节奏', '找出适合中东市场的内容角度', '把素材转成脚本任务'],
          },
    }));
  }, [viewMode]);

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
          <span className="text-sm font-semibold text-text-primary">我的社媒</span>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-surface-2 border border-border">
            {([
              { mode: 'dashboard' as ViewMode, icon: <LayoutGrid size={12} />, label: '素材库' },
              { mode: 'create' as ViewMode,    icon: <Wand2 size={12} />, label: 'AI 生成' },
            ]).map(({ mode, icon, label }) => (
              <button key={mode}
                onClick={() => setViewMode(mode)}
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
          ) : (
            <motion.div key="create" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full">
              <AiCreateStudio onNavigate={onNavigate} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
