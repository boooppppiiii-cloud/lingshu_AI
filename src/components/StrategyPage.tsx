import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Compass, ArrowUp, Brain, Loader2, Sparkles, LayoutGrid, MessageSquare, X, BarChart3 } from 'lucide-react';
import AgentWorkspace from './AgentWorkspace';
import StrategyDataBoard from './StrategyDataBoard';
import AgentReply from './AgentReply';
import { authHeader } from '../lib/auth';
import type { ConversationContext, Message, RestoreSignal, KickoffSignal, AgentAction } from '../App';

type ViewMode = 'chat' | 'workspace' | 'board';

interface EnterpriseProfileLite {
  company?: { mainMarkets?: string };
  products?: {
    categories?: string;
    items?: Array<{ name?: string; category?: string }>;
  };
  strategy?: {
    currentGoal?: string;
    focusProducts?: string;
    focusMarkets?: string;
  };
}

const FALLBACK_SUGGESTIONS = [
  '复盘重点市场转化机会',
  '规划本季主推品动作',
  '判断目标市场优先级',
  '整理旺季备货决策',
];

function splitProfileList(value?: string): string[] {
  return (value || '')
    .split(/[、,，;；\n]/)
    .map(item => item.trim())
    .filter(Boolean);
}

function compactText(value: string, maxLength: number): string {
  const text = value.replace(/\s+/g, '').trim();
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function currentQuarter(): string {
  return `Q${Math.floor(new Date().getMonth() / 3) + 1}`;
}

function buildSuggestions(profile?: EnterpriseProfileLite | null): string[] {
  if (!profile) return FALLBACK_SUGGESTIONS;
  const markets = [
    ...splitProfileList(profile.strategy?.focusMarkets),
    ...splitProfileList(profile.company?.mainMarkets),
  ];
  const products = [
    ...splitProfileList(profile.strategy?.focusProducts),
    ...(profile.products?.items || []).map(item => item.name || item.category || '').filter(Boolean),
    ...splitProfileList(profile.products?.categories),
  ];
  const primaryMarket = compactText(markets[0] || '重点市场', 9);
  const growthMarket = compactText(markets[1] || markets[0] || '目标市场', 9);
  const primaryProduct = compactText(products[0] || '主推品', 8);
  const backupProduct = compactText(products[1] || products[0] || '核心品类', 8);

  return [
    `复盘${primaryMarket}转化机会`,
    `规划${currentQuarter()}${primaryProduct}主推`,
    `判断${growthMarket}增长优先级`,
    `整理${backupProduct}备货决策`,
  ];
}

interface Props {
  onEnterConversation: (ctx: ConversationContext) => void;
  onLeaveConversation: () => void;
  isInConversation: boolean;
  restore?: RestoreSignal;
  kickoff?: KickoffSignal;
  onAction?: AgentAction;
  onSessionRefresh?: () => void;
}

function mergeConsecutiveAssistant(list: Message[]): Message[] {
  const merged: Message[] = [];
  for (const msg of list) {
    const last = merged[merged.length - 1];
    if (last?.role === 'assistant' && msg.role === 'assistant') {
      last.content = [last.content, msg.content].filter(Boolean).join('\n\n');
      last.sources = msg.sources ?? last.sources;
    } else {
      merged.push({ ...msg });
    }
  }
  return merged;
}

export default function StrategyPage({ onEnterConversation, onLeaveConversation, isInConversation, restore, kickoff, onAction, onSessionRefresh }: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>('board');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [suggestions, setSuggestions] = useState(FALLBACK_SUGGESTIONS);
  const [loading, setLoading] = useState(false);
  const [deepThinking, setDeepThinking] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inFlightRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const sentKickoffKeysRef = useRef(new Set<string>());
  const latestMessagesRef = useRef<Message[]>([]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  useEffect(() => { latestMessagesRef.current = messages; }, [messages]);
  useEffect(() => {
    fetch('/api/overseas/enterprise/profile', { headers: authHeader() })
      .then(response => response.ok ? response.json() : null)
      .then((profile: EnterpriseProfileLite | null) => setSuggestions(buildSuggestions(profile)))
      .catch(() => setSuggestions(FALLBACK_SUGGESTIONS));
  }, []);
  // 从近期会话恢复 / 新建（清空）
  useEffect(() => {
    if (!restore) return;
    setMessages(mergeConsecutiveAssistant(restore.messages));
    setViewMode(restore.messages.length ? 'chat' : 'board');
  }, [restore?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  // 一键执行：自动发起任务（新开一段对话）
  useEffect(() => {
    if (!kickoff || sentKickoffKeysRef.current.has(kickoff.key)) return;
    sentKickoffKeysRef.current.add(kickoff.key);
    setViewMode('chat');
    void send(kickoff.text, []);
  }, [kickoff?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (text: string, base?: Message[]) => {
    if (!text.trim() || loading || inFlightRef.current) return;
    inFlightRef.current = true;
    const userMsg: Message = { role: 'user', content: text };
    const nextMessages = [...mergeConsecutiveAssistant(base ?? messages), userMsg];
    let assistantStarted = false;
    latestMessagesRef.current = nextMessages;
    setMessages(nextMessages);
    setInput('');
    setLoading(true);
    onEnterConversation({ agent: 'strategy', messages: nextMessages });

    const ensureAssistant = () => {
      if (assistantStarted) return;
      assistantStarted = true;
      setMessages(prev => {
        const next = [...prev, { role: 'assistant' as const, content: '' }];
        latestMessagesRef.current = next;
        return next;
      });
      setLoading(false);
    };
    const updateAssistant = (patch: (msg: Message) => Message) => {
      ensureAssistant();
      setMessages(prev => {
        const copy = [...prev];
        const idx = copy.length - 1;
        copy[idx] = patch(copy[idx]);
        latestMessagesRef.current = copy;
        return copy;
      });
    };

    let timeout: number | undefined;
    try {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const timeoutMs = deepThinking ? 75_000 : 45_000;
      timeout = window.setTimeout(() => controller.abort(), timeoutMs);
      const resp = await fetch('/api/overseas/strategy/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ messages: nextMessages, deepThinking }),
        signal: controller.signal,
      });
      if (!resp.ok || !resp.body) {
        const err = await resp.json().catch(() => ({}));
        if (resp.status === 402 || err.error === 'demo_expired') throw new Error('试用已到期，请联系服务顾问开通或延长试用。');
        if (resp.status === 429 || err.error === 'demo_quota_exceeded') throw new Error('今日试用额度已用完，请明天再试或联系服务顾问开通更多额度。');
        throw new Error('API error');
      }

      ensureAssistant();

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let finished = false;
      const consumeLine = (line: string) => {
        if (!line.startsWith('data: ')) return;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') {
          finished = true;
          return;
        }
        try {
          const obj = JSON.parse(payload) as { text?: string; sources?: { title: string; uri: string }[]; error?: string };
          if (obj.text) {
            updateAssistant(msg => ({ ...msg, role: 'assistant', content: msg.content + obj.text }));
          } else if (obj.error) {
            updateAssistant(msg => ({ ...msg, content: msg.content || `抱歉，模型连接断开了：${obj.error}` }));
            finished = true;
          } else if (obj.sources?.length) {
            updateAssistant(msg => ({ ...msg, sources: obj.sources }));
          }
        } catch { /* malformed chunk */ }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          consumeLine(line);
          if (finished) break;
        }
        if (finished) break;
      }
      if (buf.trim()) consumeLine(buf);
    } catch (err: any) {
      const message = err?.name === 'AbortError'
        ? '这次对话响应超时了，已自动停止。你可以直接再发一次，或先关闭“深度思考”降低延迟。'
        : err?.message || '抱歉，请求失败，请稍后重试。';
      if (assistantStarted) {
        updateAssistant(msg => ({ ...msg, content: msg.content ? `${msg.content}\n\n${message}` : message }));
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: message }]);
      }
    } finally {
      if (timeout) window.clearTimeout(timeout);
      const finalMessages = mergeConsecutiveAssistant(latestMessagesRef.current);
      if (finalMessages.some(msg => msg.role === 'assistant' && msg.content.trim().length > 12)) {
        onEnterConversation({ agent: 'strategy', messages: finalMessages });
      }
      setLoading(false);
      inFlightRef.current = false;
      abortRef.current = null;
      onSessionRefresh?.();
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
          <span className="text-sm font-semibold text-text-primary">首页</span>
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
              <StrategyDataBoard onAction={onAction} />
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
                      <p className="text-base font-bold text-text-primary font-display">首页经营助手</p>
                      <p className="text-sm text-text-muted mt-1">跨三侧策略编排 · 经营分析 · 多 Agent 协调</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 max-w-lg w-full">
                      {suggestions.map((s, index) => (
                        <button
                          key={s}
                          data-demo-target={index === 0 ? 'strategy_prompt' : undefined}
                          onClick={() => {
                            void send(s);
                          }}
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
                    placeholder="告诉我你的目标或问题..." rows={2}
                    className="w-full px-4 pt-3 pb-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted resize-none outline-none" />
                  <div className="flex items-center justify-between px-3 pb-3 pt-1">
                    <button type="button" onClick={() => setDeepThinking(v => !v)}
                      title="打开后会多花一点时间做更细判断"
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                        deepThinking
                          ? 'bg-surface text-text-primary shadow-sm'
                          : 'text-text-muted hover:text-text-secondary hover:bg-surface'
                      }`}>
                      <Brain size={12} />
                      <span>深度思考</span>
                    </button>
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
