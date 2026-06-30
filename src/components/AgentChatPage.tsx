import { useState, useRef, useEffect, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowUp, Brain, Loader2, X } from 'lucide-react';
import type { AgentType, ConversationContext, Message, KickoffSignal, AgentAction } from '../App';
import AgentReply from './AgentReply';
import { authHeader } from '../lib/auth';

interface AgentConfig {
  type: AgentType;
  apiPath: string;       // e.g. '/api/overseas/agents/conversion/chat'
  color: string;
  bg: string;
  icon: ReactNode;
  name: string;
  tagline: string;
  suggestions: string[];
}

interface Props {
  config: AgentConfig;
  onEnterConversation: (ctx: ConversationContext) => void;
  onLeaveConversation: () => void;
  isInConversation: boolean;
  headerExtra?: ReactNode;
  restoreKey?: string;
  restoreMessages?: Message[];
  kickoff?: KickoffSignal;
  onAction?: AgentAction;
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

export default function AgentChatPage({ config, onEnterConversation, onLeaveConversation, headerExtra, restoreKey, restoreMessages, kickoff, onAction }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [deepThinking, setDeepThinking] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inFlightRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const sentKickoffKeysRef = useRef(new Set<string>());

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  // 从近期会话恢复 / 新建（清空）
  useEffect(() => { if (restoreKey !== undefined) setMessages(mergeConsecutiveAssistant(restoreMessages ?? [])); }, [restoreKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // 一键执行：从别处跳来并自动发起任务（新开一段对话）
  useEffect(() => {
    if (!kickoff || sentKickoffKeysRef.current.has(kickoff.key)) return;
    sentKickoffKeysRef.current.add(kickoff.key);
    void send(kickoff.text, []);
  }, [kickoff?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (text: string, base?: Message[]) => {
    if (!text.trim() || loading || inFlightRef.current) return;
    inFlightRef.current = true;
    const userMsg: Message = { role: 'user', content: text };
    const next = [...mergeConsecutiveAssistant(base ?? messages), userMsg];
    let assistantStarted = false;
    setMessages(next);
    setInput('');
    setLoading(true);
    onEnterConversation({ agent: config.type, messages: next });

    const ensureAssistant = () => {
      if (assistantStarted) return;
      assistantStarted = true;
      setMessages(prev => [...prev, { role: 'assistant', content: '' }]);
      setLoading(false);
    };
    const updateAssistant = (patch: (msg: Message) => Message) => {
      ensureAssistant();
      setMessages(prev => {
        const copy = [...prev];
        const idx = copy.length - 1;
        copy[idx] = patch(copy[idx]);
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
      const resp = await fetch(config.apiPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ messages: next, deepThinking }),
        signal: controller.signal,
      });
      if (!resp.ok || !resp.body) {
        const err = await resp.json().catch(() => ({}));
        if (resp.status === 402 || err.error === 'demo_expired') throw new Error('试用已到期，请联系管理员开通或延长试用。');
        if (resp.status === 429 || err.error === 'demo_quota_exceeded') throw new Error('今日试用额度已用完，请明天再试或联系管理员开通更多额度。');
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
        } catch { /* skip */ }
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
        : err?.message || '请求失败，请稍后重试。';
      if (assistantStarted) {
        updateAssistant(msg => ({ ...msg, content: msg.content ? `${msg.content}\n\n${message}` : message }));
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: message }]);
      }
    } finally {
      if (timeout) window.clearTimeout(timeout);
      setLoading(false);
      inFlightRef.current = false;
      abortRef.current = null;
    }
  };

  const handleClose = () => { setMessages([]); onLeaveConversation(); };
  const hasConversation = messages.length > 0;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="h-12 flex items-center justify-between px-5 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: config.bg, color: config.color }}>
            {config.icon}
          </div>
          <span className="text-sm font-semibold text-text-primary">{config.name}</span>
          {hasConversation && (
            <button onClick={handleClose} className="ml-1 p-1 rounded-md hover:bg-surface-2 text-text-muted transition-colors">
              <X size={13} />
            </button>
          )}
        </div>
        {headerExtra}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <AnimatePresence mode="wait">
          {!hasConversation ? (
            <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center h-full gap-5">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: config.bg, color: config.color }}>
                <span className="scale-[2]">{config.icon}</span>
              </div>
              <div className="text-center">
                <p className="text-base font-bold text-text-primary font-display">{config.name}</p>
                <p className="text-sm text-text-muted mt-1">{config.tagline}</p>
              </div>
              <div className="grid grid-cols-2 gap-2 max-w-lg w-full">
                {config.suggestions.map(s => (
                  <button key={s} onClick={() => void send(s)}
                    className="text-left px-3 py-2.5 rounded-xl border border-border bg-surface text-xs text-text-secondary hover:border-border-bright hover:text-text-primary transition-all leading-relaxed">
                    {s}
                  </button>
                ))}
              </div>
            </motion.div>
          ) : (
            <motion.div key="chat" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-2xl mx-auto space-y-4">
              {messages.map((msg, i) => (
                <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                  {msg.role === 'assistant' && (
                    <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                      style={{ background: config.color }}>
                      <span className="text-white scale-75">{config.icon}</span>
                    </div>
                  )}
                  <div className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                    msg.role === 'user'
                      ? 'rounded-tr-sm bg-accent text-white whitespace-pre-line'
                      : 'rounded-tl-sm bg-surface-2 border border-border text-text-primary'
                  }`}>
                    {msg.role === 'assistant'
                      ? (msg.content ? <AgentReply content={msg.content} sources={msg.sources} onAction={onAction} /> : <span className="opacity-40">...</span>)
                      : msg.content}
                  </div>
                </motion.div>
              ))}
              {loading && (
                <div className="flex gap-3">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: config.color }}>
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
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Input */}
      <div className="px-6 pb-5 flex-shrink-0">
        <div className="max-w-2xl mx-auto rounded-2xl border border-border bg-surface-2 overflow-hidden focus-within:border-border-bright transition-colors">
          <textarea value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(input); } }}
            placeholder={`向 ${config.name} 提问…`} rows={2}
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
              style={{ background: config.color, boxShadow: `0 2px 8px ${config.color}44` }}>
              {loading ? <Loader2 size={13} className="text-white animate-spin" /> : <ArrowUp size={13} className="text-white" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
