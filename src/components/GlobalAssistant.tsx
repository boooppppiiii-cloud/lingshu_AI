import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  ArrowLeft,
  ArrowUp,
  Bot,
  Compass,
  Loader2,
  ShoppingCart,
  Users,
  X,
  Zap,
} from 'lucide-react';
import type { AgentAction, AgentType, Message, Page } from '../App';
import { authHeader } from '../lib/auth';
import { ORBIT_AGENT_IDS, type OrbitAgentId, useAssistantStore } from '../stores/assistantStore';
import AgentReply from './AgentReply';

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
  suppressForRightSidebar?: boolean;
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
    suggestions: ['复盘本周经营重点', '拆解下一步增长动作', '判断目标市场优先级'],
  },
  traffic: {
    agent: 'traffic',
    label: '我的社媒',
    summary: '当前在我的社媒，适合做素材筛选、脚本生成、发布节奏和内容复盘。',
    suggestions: ['生成主推品短视频脚本', '拆解爆款素材方向', '规划本周发布节奏'],
  },
  conversion: {
    agent: 'conversion',
    label: '我的客户',
    summary: '当前在我的客户，适合做高质量询盘筛选、自动回复、跟单建议和老客唤醒。',
    suggestions: ['筛选高质量询盘', '生成 WhatsApp 跟进话术', '整理老客唤醒批次'],
  },
  orders: {
    agent: 'conversion',
    label: '我的订单',
    summary: '当前在我的订单，订单数据待接入，可先围绕订单履约、复购和客户跟进设计流程。',
    suggestions: ['设计订单跟进流程', '规划履约异常提醒', '生成成交客户复购动作'],
  },
  enterprise: {
    agent: 'strategy',
    label: '企业中心',
    summary: '当前在企业中心，适合完善企业资料、产品画像和全局知识。',
    suggestions: ['检查企业资料缺口', '整理产品卖点', '生成客户画像字段'],
  },
  scheduled: {
    agent: 'strategy',
    label: '定时任务',
    summary: '当前在定时任务，适合配置自动复盘、社媒采集、客户唤醒和报价提醒。',
    suggestions: ['规划每周自动复盘', '配置老客唤醒任务', '设计社媒趋势日报'],
  },
  plugins: {
    agent: 'strategy',
    label: '集成中心',
    summary: '当前在集成中心，适合判断要先接入哪些渠道和数据。',
    suggestions: ['推荐优先接入渠道', '梳理 WhatsApp 接入步骤', '规划社媒账号授权'],
  },
};

const SKILL_AGENTS: Array<{
  id: OrbitAgentId;
  label: string;
  agentType: AgentType;
  color: string;
  bg: string;
  Icon: typeof Compass;
  position: { x: number; y: number };
}> = [
  { id: 'strategy', label: '策略助手', agentType: 'strategy', color: '#16A34A', bg: '#DCFCE7', Icon: Compass, position: { x: 0, y: -1 } },
  { id: 'content', label: '内容助手', agentType: 'traffic', color: '#16A34A', bg: '#DCFCE7', Icon: Zap, position: { x: -0.5, y: -0.866 } },
  { id: 'customer', label: '客户助手', agentType: 'conversion', color: '#0891B2', bg: '#E0F7FA', Icon: Users, position: { x: -0.866, y: -0.5 } },
  { id: 'retention', label: '唤醒助手', agentType: 'retention', color: '#16A34A', bg: '#DCFCE7', Icon: ShoppingCart, position: { x: -1, y: 0 } },
];

function pageKey(page: Page) {
  if (page === 'youtube' || page === 'channels') return 'plugins';
  if (page === 'retention') return 'conversion';
  return page;
}

function orbitIdForAgent(agent: AgentType): OrbitAgentId {
  if (agent === 'traffic') return 'content';
  if (agent === 'conversion') return 'customer';
  return agent;
}

function agentForOrbit(id: OrbitAgentId): AgentType {
  return SKILL_AGENTS.find(agent => agent.id === id)?.agentType ?? 'strategy';
}

function contextForOrbit(id: OrbitAgentId, fallback: AssistantContext): AssistantContext {
  if (id === 'content') return DEFAULT_CONTEXT.traffic;
  if (id === 'customer') return DEFAULT_CONTEXT.conversion;
  if (id === 'retention') {
    return {
      ...DEFAULT_CONTEXT.conversion,
      agent: 'retention',
      label: '唤醒助手',
      summary: '当前在客户唤醒场景，适合整理老客分层、复购触达和再次跟进话术。',
      suggestions: ['整理老客唤醒名单', '生成复购触达话术', '规划沉默客户跟进节奏'],
    };
  }
  if (id === orbitIdForAgent(fallback.agent)) return fallback;
  return DEFAULT_CONTEXT.strategy;
}

function compactText(text: string, maxLength = 900) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
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

function quickQuestions(context: AssistantContext) {
  return context.suggestions.length ? context.suggestions : DEFAULT_CONTEXT.strategy.suggestions;
}

export default function GlobalAssistant({
  page,
  restore,
  kickoff,
  suppressForRightSidebar = false,
  onKickoffConsumed,
  onAction,
  onSessionRefresh,
}: Props) {
  const reduceMotion = useReducedMotion();
  const [mode, setMode] = useState<'breathing' | 'expanded' | 'chat'>('breathing');
  const [activeAgent, setActiveAgent] = useState<OrbitAgentId>('strategy');
  const [liveContext, setLiveContext] = useState<AssistantContext | null>(null);
  const [enterpriseContext, setEnterpriseContext] = useState('');
  const [loading, setLoading] = useState(false);
  const longPressRef = useRef<number | null>(null);
  const longPressedRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const handledKickoffs = useRef(new Set<string>());
  const handledRestores = useRef(new Set<string>());

  const threads = useAssistantStore(state => state.threads);
  const setMessages = useAssistantStore(state => state.setMessages);
  const setDraftInput = useAssistantStore(state => state.setDraftInput);
  const setScrollPosition = useAssistantStore(state => state.setScrollPosition);
  const setUnreadCount = useAssistantStore(state => state.setUnreadCount);
  const hydrateThread = useAssistantStore(state => state.hydrateThread);

  const pageContext = useMemo(() => liveContext ?? DEFAULT_CONTEXT[pageKey(page)] ?? DEFAULT_CONTEXT.strategy, [liveContext, page]);
  const activeContext = useMemo(() => contextForOrbit(activeAgent, pageContext), [activeAgent, pageContext]);
  const activeThread = threads[activeAgent];
  const radius = 110;

  const persistThread = useCallback((agentId: OrbitAgentId) => {
    const thread = useAssistantStore.getState().threads[agentId];
    fetch(`/api/overseas/assistant-threads/${agentId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify(thread),
    }).catch(() => {});
  }, []);

  const openAgent = useCallback((agentId: OrbitAgentId) => {
    setActiveAgent(agentId);
    setUnreadCount(agentId, 0);
    setMode('chat');
    window.setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' }), 60);
    persistThread(agentId);
  }, [persistThread, reduceMotion, setUnreadCount]);

  const openCurrentPageAgent = useCallback(() => {
    openAgent(orbitIdForAgent(pageContext.agent));
  }, [openAgent, pageContext.agent]);

  const send = useCallback(async (text: string, targetAgent = activeAgent, forcedContext?: AssistantContext) => {
    const visibleText = text.trim();
    if (!visibleText || loading) return;

    const thread = useAssistantStore.getState().threads[targetAgent];
    const context = forcedContext ?? contextForOrbit(targetAgent, pageContext);
    const enterpriseBrief = compactText(enterpriseContext);
    const nextVisible = [...mergeConsecutiveAssistant(thread.messages), { role: 'user' as const, content: visibleText }];
    const apiMessages: Message[] = [
      ...mergeConsecutiveAssistant(thread.messages),
      {
        role: 'user',
        content: [
          `【当前页面上下文】${context.summary}`,
          `【当前模块】${context.label}`,
          enterpriseBrief ? `【企业中心摘要】${enterpriseBrief}` : '【企业中心摘要】当前未读取到企业中心资料。',
          `用户问题：${visibleText}`,
        ].join('\n'),
      },
    ];

    setMessages(targetAgent, nextVisible);
    setDraftInput(targetAgent, '');
    setLoading(true);
    openAgent(targetAgent);

    let assistantStarted = false;
    const ensureAssistant = () => {
      if (assistantStarted) return;
      assistantStarted = true;
      const current = useAssistantStore.getState().threads[targetAgent].messages;
      setMessages(targetAgent, [...current, { role: 'assistant', content: '' }]);
      setLoading(false);
    };
    const patchAssistant = (patch: (msg: Message) => Message) => {
      ensureAssistant();
      const current = [...useAssistantStore.getState().threads[targetAgent].messages];
      current[current.length - 1] = patch(current[current.length - 1]);
      setMessages(targetAgent, current);
    };

    try {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const resp = await fetch(API_PATH[agentForOrbit(targetAgent)], {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ messages: apiMessages, deepThinking: false }),
        signal: controller.signal,
      });
      if (!resp.ok || !resp.body) throw new Error('API error');
      ensureAssistant();
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const consumeLine = (line: string) => {
        if (!line.startsWith('data: ')) return;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') return;
        try {
          const obj = JSON.parse(payload) as { text?: string; sources?: { title: string; uri: string }[]; error?: string };
          if (obj.text) patchAssistant(msg => ({ ...msg, content: msg.content + obj.text }));
          else if (obj.sources?.length) patchAssistant(msg => ({ ...msg, sources: obj.sources }));
          else if (obj.error) patchAssistant(msg => ({ ...msg, content: msg.content || `模型连接断开：${obj.error}` }));
        } catch {
          // Ignore malformed stream chunks.
        }
      };
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) consumeLine(line);
      }
      if (buffer.trim()) consumeLine(buffer);
    } catch (err: any) {
      const message = err?.name === 'AbortError' ? '这次响应已停止。' : '请求失败，请稍后重试。';
      if (assistantStarted) patchAssistant(msg => ({ ...msg, content: msg.content ? `${msg.content}\n\n${message}` : message }));
      else setMessages(targetAgent, [...useAssistantStore.getState().threads[targetAgent].messages, { role: 'assistant', content: message }]);
    } finally {
      setLoading(false);
      abortRef.current = null;
      persistThread(targetAgent);
      onSessionRefresh?.();
    }
  }, [activeAgent, enterpriseContext, loading, onSessionRefresh, openAgent, pageContext, persistThread, setDraftInput, setMessages]);

  useEffect(() => {
    fetch('/api/overseas/assistant-threads', { headers: authHeader() })
      .then(resp => resp.ok ? resp.json() : null)
      .then(data => {
        if (!Array.isArray(data?.items)) return;
        for (const item of data.items) {
          if (!ORBIT_AGENT_IDS.includes(item.agentId)) continue;
          hydrateThread(item.agentId, {
            messages: Array.isArray(item.messages) ? item.messages : [],
            draftInput: typeof item.draftInput === 'string' ? item.draftInput : '',
            scrollPosition: Number(item.scrollPosition ?? 0),
            unreadCount: Number(item.unreadCount ?? 0),
          });
        }
      })
      .catch(() => {});
    fetch('/api/overseas/enterprise/context', { headers: authHeader() })
      .then(resp => resp.ok ? resp.json() : null)
      .then(data => {
        if (typeof data?.context === 'string') setEnterpriseContext(data.context);
      })
      .catch(() => setEnterpriseContext(''));
  }, [hydrateThread]);

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
      let targetContext = pageContext;
      if (detail?.context?.agent && detail.context.label && detail.context.summary) {
        targetContext = {
          agent: detail.context.agent,
          label: detail.context.label,
          summary: detail.context.summary,
          suggestions: detail.context.suggestions?.length ? detail.context.suggestions : pageContext.suggestions,
        };
        setLiveContext(targetContext);
      }
      const targetAgent = orbitIdForAgent(targetContext.agent);
      openAgent(targetAgent);
      const text = detail?.text?.trim();
      if (text) window.setTimeout(() => void send(text, targetAgent, targetContext), 0);
    };
    window.addEventListener('lingshu-assistant-open', handler);
    return () => window.removeEventListener('lingshu-assistant-open', handler);
  }, [openAgent, pageContext, send]);

  useEffect(() => {
    if (!kickoff || handledKickoffs.current.has(kickoff.key)) return;
    handledKickoffs.current.add(kickoff.key);
    void send(kickoff.text, orbitIdForAgent(kickoff.agent));
    onKickoffConsumed?.();
  }, [kickoff, onKickoffConsumed, send]);

  useEffect(() => {
    if (!restore || handledRestores.current.has(restore.key)) return;
    handledRestores.current.add(restore.key);
    const targetAgent = orbitIdForAgent(restore.agent);
    setMessages(targetAgent, mergeConsecutiveAssistant(restore.messages));
    openAgent(targetAgent);
  }, [openAgent, restore, setMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
  }, [activeThread.messages, mode, reduceMotion]);

  useEffect(() => {
    setLiveContext(null);
  }, [page]);

  useEffect(() => {
    if (mode !== 'chat') return;
    const timer = window.setTimeout(() => persistThread(activeAgent), 500);
    return () => window.clearTimeout(timer);
  }, [activeAgent, activeThread.draftInput, activeThread.messages, activeThread.scrollPosition, activeThread.unreadCount, mode, persistThread]);

  const handlePointerDown = () => {
    if (longPressRef.current) window.clearTimeout(longPressRef.current);
    longPressedRef.current = false;
    longPressRef.current = window.setTimeout(() => {
      longPressedRef.current = true;
      setMode('expanded');
    }, 300);
  };

  const handlePointerUp = () => {
    if (longPressRef.current) window.clearTimeout(longPressRef.current);
    longPressRef.current = null;
  };

  const handleLauncherClick = () => {
    if (longPressedRef.current) {
      longPressedRef.current = false;
      return;
    }
    if (mode === 'expanded') openCurrentPageAgent();
    else setMode('expanded');
  };

  if (suppressForRightSidebar) return null;

  return (
    <div data-global-assistant className="fixed bottom-5 right-5 z-[75]">
      <AnimatePresence>
        {mode === 'expanded' && (
          <motion.div
            className="pointer-events-none absolute bottom-0 right-0 h-52 w-52"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="absolute bottom-6 right-6 h-36 w-36 rounded-full border border-dashed border-text-muted/40" />
            <div className="absolute bottom-6 right-6 h-24 w-24 rounded-full border border-dashed border-text-muted/30" />
            {SKILL_AGENTS.map((agent, index) => {
              const Icon = agent.Icon;
              const unread = threads[agent.id].unreadCount;
              const x = agent.position.x * radius;
              const y = agent.position.y * radius;
              return (
                <motion.button
                  key={agent.id}
                  type="button"
                  title={agent.label}
                  onClick={() => openAgent(agent.id)}
                  className="pointer-events-auto absolute bottom-2 right-2 flex h-12 w-12 items-center justify-center rounded-full border bg-white shadow-[0_12px_28px_rgba(15,23,42,0.14)]"
                  style={{ borderColor: agent.color, color: agent.color, backgroundColor: agent.bg }}
                  initial={{ x: 0, y: 0, opacity: 0, scale: 0.72 }}
                  animate={reduceMotion ? { opacity: 1, scale: 1 } : { x, y, opacity: 1, scale: 1 }}
                  exit={reduceMotion ? { opacity: 0 } : { x: 0, y: 0, opacity: 0, scale: 0.72 }}
                  transition={reduceMotion ? { duration: 0.16 } : { type: 'spring', stiffness: 260, damping: 18, delay: index * 0.06 }}
                >
                  <Icon size={20} />
                  {unread > 0 && <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red px-1 text-[11px] font-bold text-white">{unread}</span>}
                </motion.button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {mode === 'chat' && (
          <motion.section
            data-global-assistant="panel"
            layoutId={`assistant-${activeAgent}`}
            initial={{ opacity: 0, y: 18, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 18, scale: 0.96 }}
            transition={reduceMotion ? { duration: 0.16 } : { type: 'spring', stiffness: 240, damping: 24 }}
            className="absolute bottom-14 right-0 flex h-[min(720px,calc(100vh-112px))] w-[420px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-2xl border border-border bg-white shadow-2xl"
          >
            <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
              <div className="flex min-w-0 items-center gap-2">
                <button type="button" onClick={() => setMode('expanded')} className="rounded-lg p-1.5 text-text-muted hover:bg-surface-2" title="返回展开态">
                  <ArrowLeft size={16} />
                </button>
                <div className="min-w-0">
                  <p className="truncate text-sm font-black text-text-primary">{SKILL_AGENTS.find(agent => agent.id === activeAgent)?.label ?? '灵枢助手'}</p>
                  <p className="truncate text-[11px] text-text-muted">当前：{activeContext.label}</p>
                </div>
              </div>
              <button type="button" onClick={() => setMode('breathing')} className="rounded-lg p-1.5 text-text-muted hover:bg-surface-2" title="收回">
                <X size={15} />
              </button>
            </header>

            <div
              className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
              onScroll={event => setScrollPosition(activeAgent, event.currentTarget.scrollTop)}
            >
              {!activeThread.messages.length ? (
                <div className="flex h-full flex-col justify-center gap-4">
                  <div>
                    <p className="text-sm font-bold text-text-primary">我是{SKILL_AGENTS.find(agent => agent.id === activeAgent)?.label}</p>
                    <p className="mt-1 text-sm leading-relaxed text-text-muted">我会结合当前页面上下文继续帮你处理。</p>
                  </div>
                  <div className="grid gap-2">
                    {quickQuestions(activeContext).map(item => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => void send(item)}
                        className="rounded-xl border border-border bg-surface px-3 py-2 text-left text-xs font-semibold text-text-secondary hover:border-slate-300 hover:text-text-primary"
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {activeThread.messages.map((msg, index) => (
                    <div key={index} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                      {msg.role === 'assistant' && <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-950 text-white"><Bot size={13} /></div>}
                      <div className={`max-w-[82%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${msg.role === 'user' ? 'rounded-tr-sm bg-accent text-white whitespace-pre-line' : 'rounded-tl-sm border border-border bg-surface-2 text-text-primary'}`}>
                        {msg.role === 'assistant'
                          ? (msg.content ? <AgentReply content={msg.content} sources={msg.sources} onAction={onAction} /> : <span className="opacity-40">...</span>)
                          : msg.content}
                      </div>
                    </div>
                  ))}
                  {loading && (
                    <div className="flex gap-2">
                      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-950 text-white"><Loader2 size={13} className="animate-spin" /></div>
                      <div className="rounded-2xl rounded-tl-sm border border-border bg-surface-2 px-3 py-2 text-sm text-text-muted">思考中...</div>
                    </div>
                  )}
                  <div ref={bottomRef} />
                </div>
              )}
            </div>

            <div className="shrink-0 border-t border-border p-3">
              <div className="rounded-2xl border border-border bg-surface-2">
                <textarea
                  value={activeThread.draftInput}
                  onChange={event => setDraftInput(activeAgent, event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      void send(activeThread.draftInput);
                    }
                  }}
                  rows={2}
                  placeholder="问灵枢助手..."
                  className="w-full resize-none bg-transparent px-3 pt-3 text-sm outline-none placeholder:text-text-muted"
                />
                <div className="flex items-center justify-end px-2 pb-2">
                  <button type="button" onClick={() => void send(activeThread.draftInput)} disabled={!activeThread.draftInput.trim() || loading} className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-950 text-white disabled:opacity-40">
                    {loading ? <Loader2 size={13} className="animate-spin" /> : <ArrowUp size={13} />}
                  </button>
                </div>
              </div>
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      {mode !== 'chat' && (
        <div className="relative h-16 w-16">
          <motion.span
            className="absolute inset-0 rounded-full border border-dashed border-text-muted/60"
            animate={mode === 'breathing' && !reduceMotion ? { scale: [1, 1.08, 1], opacity: [0.4, 0.7, 0.4] } : { scale: 1, opacity: 0.72 }}
            transition={{ duration: 2.4, ease: 'easeInOut', repeat: mode === 'breathing' && !reduceMotion ? Infinity : 0 }}
          />
          <motion.span
            className="absolute inset-2 rounded-full border border-dashed border-text-muted/50"
            animate={mode === 'breathing' && !reduceMotion ? { scale: [1, 1.08, 1], opacity: [0.4, 0.7, 0.4] } : { scale: 1, opacity: 0.65 }}
            transition={{ duration: 2.4, ease: 'easeInOut', repeat: mode === 'breathing' && !reduceMotion ? Infinity : 0, delay: 0.18 }}
          />
          <button
            type="button"
            data-global-assistant="launcher"
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
            onClick={handleLauncherClick}
            className="absolute left-1/2 top-1/2 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-slate-950 text-white shadow-[0_16px_38px_rgba(15,23,42,0.22)]"
            title={mode === 'expanded' ? '打开当前页面助手' : '展开灵枢助手'}
          >
            <Bot size={21} />
          </button>
        </div>
      )}
    </div>
  );
}
