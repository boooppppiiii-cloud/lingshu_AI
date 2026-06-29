import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Compass, ArrowUp, Loader2, Sparkles, LayoutGrid, MessageSquare, X, BarChart3 } from 'lucide-react';
import AgentWorkspace from './AgentWorkspace';
import StrategyDataBoard from './StrategyDataBoard';
import AgentReply from './AgentReply';
import type { ConversationContext, Message, RestoreSignal, KickoffSignal, AgentAction } from '../App';

type ViewMode = 'chat' | 'workspace' | 'board';

const SUGGESTIONS = [
  '帮我分析斋月期间中东市场的推广机会',
  '生成本周经营复盘报告',
  '启动假发产品的行动建议流水线',
  '我想了解哪些老客最近60天没有互动',
];

interface Props {
  onEnterConversation: (ctx: ConversationContext) => void;
  onLeaveConversation: () => void;
  isInConversation: boolean;
  restore?: RestoreSignal;
  kickoff?: KickoffSignal;
  onAction?: AgentAction;
}

export default function StrategyPage({ onEnterConversation, onLeaveConversation, isInConversation, restore, kickoff, onAction }: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>('chat');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  // 从近期会话恢复 / 新建（清空）
  useEffect(() => { if (restore) { setMessages(restore.messages); setViewMode('chat'); } }, [restore?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  // 一键执行：自动发起任务（新开一段对话）
  useEffect(() => { if (kickoff) { setViewMode('chat'); void send(kickoff.text, []); } }, [kickoff?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (text: string, base?: Message[]) => {
    if (!text.trim() || loading) return;
    const userMsg: Message = { role: 'user', content: text };
    const nextMessages = [...(base ?? messages), userMsg];
    setMessages(nextMessages);
    setInput('');
    setLoading(true);
    onEnterConversation({ agent: 'strategy', messages: nextMessages });

    try {
      const resp = await fetch('/api/overseas/strategy/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: nextMessages }),
      });

      if (!resp.ok || !resp.body) throw new Error('API error');

      setMessages(prev => [...prev, { role: 'assistant', content: '' }]);
      setLoading(false);

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') break;
          try {
            const obj = JSON.parse(payload) as { text?: string; sources?: { title: string; uri: string }[] };
            if (obj.text) {
              setMessages(prev => {
                const copy = [...prev];
                copy[copy.length - 1] = { ...copy[copy.length - 1], role: 'assistant', content: copy[copy.length - 1].content + obj.text };
                return copy;
              });
            } else if (obj.sources?.length) {
              setMessages(prev => {
                const copy = [...prev];
                copy[copy.length - 1] = { ...copy[copy.length - 1], sources: obj.sources };
                return copy;
              });
            }
          } catch { /* malformed chunk */ }
        }
      }
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: '抱歉，请求失败，请稍后重试。' }]);
      setLoading(false);
    }
  };

  const handleClose = () => { setMessages([]); onLeaveConversation(); };

  const hasConversation = messages.length > 0;

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="h-12 flex items-center justify-between px-5 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: 'rgba(22,163,74,0.1)', color: '#16a34a' }}>
            <Compass size={13} />
          </div>
          <span className="text-sm font-semibold text-text-primary">策略</span>
          {hasConversation && (
            <button onClick={handleClose} className="ml-1 p-1 rounded-md hover:bg-surface-2 text-text-muted transition-colors">
              <X size={13} />
            </button>
          )}
        </div>
        {/* View toggle */}
        <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-surface-2 border border-border">
          {([
            { mode: 'chat' as ViewMode, icon: <MessageSquare size={12} />, label: '对话' },
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

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <AnimatePresence mode="wait">
          {viewMode === 'board' ? (
            <motion.div key="board" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full">
              <StrategyDataBoard />
            </motion.div>
          ) : viewMode === 'workspace' ? (
            <motion.div key="workspace" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full">
              <AgentWorkspace onEnterConversation={onEnterConversation} />
            </motion.div>
          ) : (
            <motion.div key="chat" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col h-full">
              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-6 py-4">
                {!hasConversation ? (
                  <div className="flex flex-col items-center justify-center h-full gap-5">
                    <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(22,163,74,0.08)', color: '#16a34a' }}>
                      <Compass size={28} />
                    </div>
                    <div className="text-center">
                      <p className="text-base font-bold text-text-primary font-display">策略专家</p>
                      <p className="text-sm text-text-muted mt-1">跨三侧策略编排 · 经营分析 · 多 Agent 协调</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 max-w-lg w-full">
                      {SUGGESTIONS.map(s => (
                        <button key={s} onClick={() => void send(s)}
                          className="text-left px-3 py-2.5 rounded-xl border border-border bg-surface text-xs text-text-secondary hover:border-border-bright hover:text-text-primary transition-all leading-relaxed">
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="max-w-2xl mx-auto space-y-4">
                    {messages.map((msg, i) => (
                      <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                        className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                        {msg.role === 'assistant' && (
                          <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: 'linear-gradient(135deg, #6366f1, #4f46e5)' }}>
                            <Sparkles size={12} className="text-white" />
                          </div>
                        )}
                        <div className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${msg.role === 'user' ? 'rounded-tr-sm bg-accent text-white whitespace-pre-line' : 'rounded-tl-sm bg-surface-2 border border-border text-text-primary'}`}>
                          {msg.role === 'assistant' ? <AgentReply content={msg.content} sources={msg.sources} onAction={onAction} /> : msg.content}
                        </div>
                      </motion.div>
                    ))}
                    {loading && (
                      <div className="flex gap-3">
                        <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: 'linear-gradient(135deg, #6366f1, #4f46e5)' }}>
                          <Loader2 size={12} className="text-white animate-spin" />
                        </div>
                        <div className="px-4 py-3 rounded-2xl rounded-tl-sm bg-surface-2 border border-border">
                          <div className="flex items-center gap-1">
                            {[0, 150, 300].map(d => <span key={d} className="w-1.5 h-1.5 rounded-full bg-text-muted animate-bounce" style={{ animationDelay: `${d}ms` }} />)}
                          </div>
                        </div>
                      </div>
                    )}
                    <div ref={bottomRef} />
                  </div>
                )}
              </div>

              {/* Input */}
              <div className="px-6 pb-5 flex-shrink-0">
                <div className="max-w-2xl mx-auto rounded-2xl border border-border bg-surface-2 overflow-hidden focus-within:border-border-bright transition-colors">
                  <textarea value={input} onChange={e => setInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(input); } }}
                    placeholder="告诉策略专家 你的目标或问题..." rows={2}
                    className="w-full px-4 pt-3 pb-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted resize-none outline-none" />
                  <div className="flex items-center justify-end px-3 pb-3 pt-1">
                    <button onClick={() => void send(input)} disabled={!input.trim() || loading}
                      className="w-8 h-8 rounded-xl flex items-center justify-center transition-all disabled:opacity-40"
                      style={{ background: '#16a34a', boxShadow: '0 2px 8px rgba(22,163,74,0.3)' }}>
                      {loading ? <Loader2 size={13} className="text-white animate-spin" /> : <ArrowUp size={13} className="text-white" />}
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
