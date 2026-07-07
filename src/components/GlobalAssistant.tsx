import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowUp, Bot, Brain, Loader2, Sparkles, X } from 'lucide-react';
import type { AgentAction, AgentType, Message, Page } from '../App';
import AgentReply from './AgentReply';
import { authHeader } from '../lib/auth';

interface AssistantContext {
  agent: AgentType;
  label: string;
  summary: string;
  suggestions: string[];
}

interface Props {
  page: Page;
  restore?: { agent: AgentType; messages: Message[]; key: string } | null;
  kickoff?: { agent: AgentType; text: string; key: string } | null;
  onKickoffConsumed?: () => void;
  onAction?: AgentAction;
  onSessionRefresh?: () => void;
}

const API_PATH: Record<AgentType, string> = {
  strategy: '/api/overseas/strategy/chat',
  traffic: '/api/overseas/agents/traffic/chat',
  conversion: '/api/overseas/agents/conversion/chat',
  retention: '/api/overseas/agents/retention/chat',
};

const DEFAULT_CONTEXT: Record<string, AssistantContext> = {
  strategy: {
    agent: 'strategy',
    label: '首页',
    summary: '当前在首页，适合做经营复盘、目标拆解和跨模块动作安排。',
    suggestions: ['复盘本周经营重点', '拆解下一步增长动作', '判断目标市场优先级', '整理主推品策略'],
  },
  traffic: {
    agent: 'traffic',
    label: '我的社媒',
    summary: '当前在我的社媒，适合做素材筛选、脚本生成、发布节奏和内容复盘。',
    suggestions: ['生成主推品短视频脚本', '拆解爆款素材方向', '规划本周发布节奏', '优化口播钩子'],
  },
  conversion: {
    agent: 'conversion',
    label: '我的客户',
    summary: '当前在我的客户，适合做高质量询盘筛选、自动回复、跟单建议和老客唤醒。',
    suggestions: ['筛选高质量询盘', '生成 WhatsApp 跟进话术', '整理老客唤醒批次', '优化自动首响规则'],
  },
  orders: {
    agent: 'conversion',
    label: '我的订单',
    summary: '当前在我的订单，订单数据待接入，可先围绕订单履约、复购和客户跟进设计流程。',
    suggestions: ['设计订单跟进流程', '规划履约异常提醒', '生成成交客户复购动作', '整理订单字段需求'],
  },
  enterprise: {
    agent: 'strategy',
    label: '企业中心',
    summary: '当前在企业中心，适合完善企业资料、产品画像和全局知识。',
    suggestions: ['检查企业资料缺口', '整理产品卖点', '生成客户画像字段', '优化品牌禁忌话题'],
  },
  scheduled: {
    agent: 'strategy',
    label: '定时任务',
    summary: '当前在定时任务，适合配置自动复盘、社媒采集、客户唤醒和报价提醒。',
    suggestions: ['规划每周自动复盘', '配置老客唤醒任务', '设计社媒趋势日报', '整理任务执行规则'],
  },
  plugins: {
    agent: 'strategy',
    label: '集成中心',
    summary: '当前在集成中心，适合判断要先接入哪些渠道和数据。',
    suggestions: ['推荐优先接入渠道', '梳理 WhatsApp 接入步骤', '规划社媒账号授权', '整理 ERP 对接字段'],
  },
};

function pageKey(page: Page) {
  if (page === 'youtube' || page === 'channels') return 'plugins';
  if (page === 'retention') return 'conversion';
  return page;
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

export default function GlobalAssistant({ page, restore, kickoff, onKickoffConsumed, onAction, onSessionRefresh }: Props) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [deepThinking, setDeepThinking] = useState(false);
  const [liveContext, setLiveContext] = useState<AssistantContext | null>(null);
  const latestMessagesRef = useRef<Message[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inFlightRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const handledKickoffs = useRef(new Set<string>());
  const handledRestores = useRef(new Set<string>());

  const context = useMemo(() => liveContext ?? DEFAULT_CONTEXT[pageKey(page)] ?? DEFAULT_CONTEXT.strategy, [liveContext, page]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<Partial<AssistantContext>>).detail;
      if (!detail?.agent || !detail.label || !detail.summary) return;
      setLiveContext({
        agent: detail.agent,
        label: detail.label,
        summary: detail.summary,
        suggestions: detail.suggestions?.length ? detail.suggestions : DEFAULT_CONTEXT[pageKey(page)]?.suggestions ?? DEFAULT_CONTEXT.strategy.suggestions,
      });
    };
    window.addEventListener('lingshu-assistant-context', handler);
    return () => window.removeEventListener('lingshu-assistant-context', handler);
  }, [page]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ text?: string; context?: Partial<AssistantContext> }>).detail;
      if (detail?.context?.agent && detail.context.label && detail.context.summary) {
        setLiveContext({
          agent: detail.context.agent,
          label: detail.context.label,
          summary: detail.context.summary,
          suggestions: detail.context.suggestions?.length ? detail.context.suggestions : context.suggestions,
        });
      }
      setOpen(true);
      const text = detail?.text?.trim();
      if (text) window.setTimeout(() => void send(text), 0);
    };
    window.addEventListener('lingshu-assistant-open', handler);
    return () => window.removeEventListener('lingshu-assistant-open', handler);
  }, [context, messages, loading, deepThinking]);

  useEffect(() => {
    setLiveContext(null);
  }, [page]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, open]);
  useEffect(() => { latestMessagesRef.current = messages; }, [messages]);

  const send = async (text: string, base?: Message[], forcedContext?: AssistantContext) => {
    const visibleText = text.trim();
    if (!visibleText || loading || inFlightRef.current) return;
    const activeContext = forcedContext ?? context;
    inFlightRef.current = true;
    const visibleUserMsg: Message = { role: 'user', content: visibleText };
    const nextVisible = [...mergeConsecutiveAssistant(base ?? messages), visibleUserMsg];
    const apiMessages = [
      ...mergeConsecutiveAssistant(base ?? messages),
      {
        role: 'user' as const,
        content: `【当前页面上下文】${activeContext.summary}\n【当前模块】${activeContext.label}\n\n用户问题：${visibleText}`,
      },
    ];
    let assistantStarted = false;
    latestMessagesRef.current = nextVisible;
    setMessages(nextVisible);
    setInput('');
    setLoading(true);
    setOpen(true);

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
      timeout = window.setTimeout(() => controller.abort(), deepThinking ? 75_000 : 45_000);
      const resp = await fetch(API_PATH[activeContext.agent], {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ messages: apiMessages, deepThinking }),
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
        if (payload === '[DONE]') { finished = true; return; }
        try {
          const obj = JSON.parse(payload) as { text?: string; sources?: { title: string; uri: string }[]; error?: string };
          if (obj.text) updateAssistant(msg => ({ ...msg, content: msg.content + obj.text }));
          else if (obj.sources?.length) updateAssistant(msg => ({ ...msg, sources: obj.sources }));
          else if (obj.error) {
            updateAssistant(msg => ({ ...msg, content: msg.content || `抱歉，模型连接断开了：${obj.error}` }));
            finished = true;
          }
        } catch { /* ignore chunk */ }
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
        ? '这次响应超时了，已自动停止。你可以直接再发一次，或先关闭“深度思考”。'
        : err?.message || '请求失败，请稍后重试。';
      if (assistantStarted) updateAssistant(msg => ({ ...msg, content: msg.content ? `${msg.content}\n\n${message}` : message }));
      else setMessages(prev => [...prev, { role: 'assistant', content: message }]);
    } finally {
      if (timeout) window.clearTimeout(timeout);
      setLoading(false);
      inFlightRef.current = false;
      abortRef.current = null;
      onSessionRefresh?.();
    }
  };

  useEffect(() => {
    if (!kickoff || handledKickoffs.current.has(kickoff.key)) return;
    handledKickoffs.current.add(kickoff.key);
    const nextContext = Object.values(DEFAULT_CONTEXT).find(item => item.agent === kickoff.agent) ?? context;
    setOpen(true);
    void send(kickoff.text, [], nextContext);
    onKickoffConsumed?.();
  }, [kickoff?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!restore || handledRestores.current.has(restore.key)) return;
    handledRestores.current.add(restore.key);
    const nextContext = Object.values(DEFAULT_CONTEXT).find(item => item.agent === restore.agent) ?? context;
    setLiveContext(nextContext);
    setMessages(mergeConsecutiveAssistant(restore.messages));
    setOpen(true);
  }, [restore?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-[75] flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-[0_16px_38px_rgba(15,23,42,0.22)] transition-transform hover:scale-105"
        title="灵枢助手"
      >
        <Bot size={21} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.section
            initial={{ opacity: 0, y: 18, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 18, scale: 0.97 }}
            transition={{ duration: 0.18 }}
            className="fixed bottom-20 right-5 z-[76] flex h-[min(720px,calc(100vh-112px))] w-[420px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-2xl border border-border bg-white shadow-2xl"
          >
            <header className="flex h-12 flex-shrink-0 items-center justify-between border-b border-border px-4">
              <div className="min-w-0">
                <p className="text-sm font-black text-text-primary">灵枢助手</p>
                <p className="truncate text-[11px] text-text-muted">当前：{context.label}</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-text-muted hover:bg-surface-2">
                <X size={15} />
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              {!messages.length ? (
                <div className="flex h-full flex-col justify-center gap-4">
                  <div>
                    <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-white">
                      <Sparkles size={20} />
                    </div>
                    <p className="text-sm font-bold text-text-primary">一张脸，四个脑子</p>
                    <p className="mt-1 text-sm leading-relaxed text-text-muted">{context.summary}</p>
                  </div>
                  <div className="grid gap-2">
                    {context.suggestions.map(item => (
                      <button key={item} type="button" onClick={() => void send(item)}
                        className="rounded-xl border border-border bg-surface px-3 py-2 text-left text-xs font-semibold text-text-secondary hover:border-slate-300 hover:text-text-primary">
                        {item}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {messages.map((msg, index) => (
                    <div key={index} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                      {msg.role === 'assistant' && <div className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-slate-950 text-white"><Bot size={13} /></div>}
                      <div className={`max-w-[82%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${msg.role === 'user' ? 'rounded-tr-sm bg-accent text-white whitespace-pre-line' : 'rounded-tl-sm border border-border bg-surface-2 text-text-primary'}`}>
                        {msg.role === 'assistant'
                          ? (msg.content ? <AgentReply content={msg.content} sources={msg.sources} onAction={onAction} /> : <span className="opacity-40">...</span>)
                          : msg.content}
                      </div>
                    </div>
                  ))}
                  {loading && (
                    <div className="flex gap-2">
                      <div className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-slate-950 text-white"><Loader2 size={13} className="animate-spin" /></div>
                      <div className="rounded-2xl rounded-tl-sm border border-border bg-surface-2 px-3 py-2 text-sm text-text-muted">思考中...</div>
                    </div>
                  )}
                  <div ref={bottomRef} />
                </div>
              )}
            </div>

            <div className="flex-shrink-0 border-t border-border p-3">
              <div className="rounded-2xl border border-border bg-surface-2">
                <textarea
                  value={input}
                  onChange={event => setInput(event.target.value)}
                  onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(input); } }}
                  rows={2}
                  placeholder="问灵枢助手..."
                  className="w-full resize-none bg-transparent px-3 pt-3 text-sm outline-none placeholder:text-text-muted"
                />
                <div className="flex items-center justify-between px-2 pb-2">
                  <button type="button" onClick={() => setDeepThinking(v => !v)}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-bold ${deepThinking ? 'bg-white text-text-primary shadow-sm' : 'text-text-muted'}`}>
                    <Brain size={12} />深度思考
                  </button>
                  <button type="button" onClick={() => void send(input)} disabled={!input.trim() || loading}
                    className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-950 text-white disabled:opacity-40">
                    {loading ? <Loader2 size={13} className="animate-spin" /> : <ArrowUp size={13} />}
                  </button>
                </div>
              </div>
            </div>
          </motion.section>
        )}
      </AnimatePresence>
    </>
  );
}
