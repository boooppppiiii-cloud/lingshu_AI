import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  ArrowLeft,
  ArrowUp,
  Bot,
  CheckCircle2,
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
import KnowledgeIntakePanel, { type AppliedProfile } from './enterprise/KnowledgeIntakePanel';

interface AssistantContext {
  agent: AgentType;
  label: string;
  summary: string;
  suggestions: string[];
  pendingCount?: number;
  todoItems?: AssistantTodoItem[];
}

interface AssistantTodoItem {
  id: string;
  name: string;
  product: string;
  source?: string;
  headline: string;
  reason: string;
  tone: 'red' | 'amber' | 'blue' | 'green';
  completed: boolean;
}

type AssistantTool = 'knowledge-intake';

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
    suggestions: ['复盘本周经营重点', '拆解下一步增长动作', '判断目标市场优先级', '联网核验目标市场机会'],
  },
  traffic: {
    agent: 'traffic',
    label: '我的社媒',
    summary: '当前在我的社媒，适合做素材筛选、脚本生成、发布节奏和内容复盘。',
    suggestions: ['生成主推品短视频脚本', '拆解爆款素材方向', '规划本周发布节奏', '联网核验平台内容趋势'],
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
  { id: 'strategy', label: '策略助手', agentType: 'strategy', color: '#60A5FA', bg: '#EFF6FF', Icon: Compass, position: { x: 0, y: -1 } },
  { id: 'content', label: '内容助手', agentType: 'traffic', color: '#60A5FA', bg: '#EFF6FF', Icon: Zap, position: { x: -0.5, y: -0.866 } },
  { id: 'customer', label: '客户助手', agentType: 'conversion', color: '#60A5FA', bg: '#EFF6FF', Icon: Users, position: { x: -0.866, y: -0.5 } },
  { id: 'retention', label: '唤醒助手', agentType: 'retention', color: '#60A5FA', bg: '#EFF6FF', Icon: ShoppingCart, position: { x: -1, y: 0 } },
];

const AGENT_DISPLAY_NAME: Record<OrbitAgentId, string> = {
  strategy: '策略助手',
  content: '内容助手',
  customer: '客户助手',
  retention: '唤醒助手',
};

function pageKey(page: Page) {
  if (page === 'youtube' || page === 'channels') return 'plugins';
  if (page === 'retention') return 'conversion';
  return page;
}

type AssistantExpression = 'happy' | 'wink' | 'thinking' | 'excited';

const PAGE_EXPRESSION: Record<Page, AssistantExpression> = {
  strategy: 'happy',
  traffic: 'excited',
  conversion: 'thinking',
  retention: 'happy',
  orders: 'wink',
  enterprise: 'thinking',
  plugins: 'excited',
  scheduled: 'wink',
  admin: 'thinking',
  adminDelivery: 'thinking',
  channels: 'excited',
  youtube: 'excited',
};

const LAUNCHER_MASCOT_CROP_LEFT: Record<AssistantExpression, number> = {
  happy: -26,
  wink: -97,
  thinking: -169,
  excited: -241,
};

function AssistantLauncherMascot({ expression }: { expression: AssistantExpression }) {
  return (
    <span className="relative block h-[72px] w-[60px] overflow-hidden" aria-hidden="true">
      <AnimatePresence initial={false} mode="wait">
        <motion.span
          key={expression}
          className="absolute inset-0"
          initial={{ opacity: 0, scale: 0.9, rotate: -3 }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          exit={{ opacity: 0, scale: 0.92, rotate: 3 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
        >
          <img
            src="/lingshu-expressions-body-transparent.png"
            alt=""
            className="absolute top-[-36px] h-auto max-w-none drop-shadow-[0_5px_8px_rgba(52,196,113,0.14)]"
            style={{ left: LAUNCHER_MASCOT_CROP_LEFT[expression], width: 329 }}
          />
        </motion.span>
      </AnimatePresence>
    </span>
  );
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

function apiHistory(list: Message[]): Message[] {
  return mergeConsecutiveAssistant(list)
    .filter(msg => {
      const text = msg.content.trim();
      return text && text !== '请求失败，请稍后重试。' && text !== 'API error';
    })
    .slice(-8)
    .map(msg => ({
      ...msg,
      content: compactText(msg.content, msg.role === 'assistant' ? 1200 : 800),
    }));
}

async function responseErrorMessage(resp: Response): Promise<string> {
  const data = await resp.json().catch(() => null) as {
    error?: string;
    quota?: string;
    tokenCost?: number;
    demo?: {
      remaining?: { aiChat?: number; tokens?: number };
      totalRemaining?: { tokens?: number };
    };
  } | null;

  if (data?.error === 'demo_token_quota_exceeded') {
    const daily = data.demo?.remaining?.tokens;
    const total = data.demo?.totalRemaining?.tokens;
    const left = Math.min(daily ?? Number.POSITIVE_INFINITY, total ?? Number.POSITIVE_INFINITY);
    const leftText = Number.isFinite(left) ? `当前剩余约 ${Math.max(0, left)} token，` : '';
    const costText = data.tokenCost ? `本次预计需要约 ${data.tokenCost} token，` : '';
    return `试用 Token 不足：${leftText}${costText}请清空一部分对话历史、换更短的问题，或重置/开通更多试用额度。`;
  }
  if (data?.error === 'demo_quota_exceeded') {
    const label = data.quota === 'aiChat' ? '今日对话次数' : '今日试用额度';
    return `${label}已用完，请明天再试或联系服务顾问开通更多额度。`;
  }
  if (data?.error === 'demo_expired') return '试用已到期，请联系服务顾问开通或延长试用。';
  if (data?.error) return data.error;
  return `请求失败（HTTP ${resp.status}），请稍后重试。`;
}

function quickQuestions(context: AssistantContext) {
  return context.suggestions.length ? context.suggestions : DEFAULT_CONTEXT.strategy.suggestions;
}

function todoToneClass(tone: AssistantTodoItem['tone'], completed: boolean) {
  if (completed) return 'border-emerald-100 bg-emerald-50/80 text-emerald-800';
  if (tone === 'red') return 'border-red-100 bg-red-50 text-red-800';
  if (tone === 'amber') return 'border-amber-100 bg-amber-50 text-amber-800';
  if (tone === 'blue') return 'border-sky-100 bg-sky-50 text-sky-800';
  return 'border-emerald-100 bg-emerald-50 text-emerald-800';
}

function todoDotClass(tone: AssistantTodoItem['tone'], completed: boolean) {
  if (completed) return 'bg-emerald-500';
  if (tone === 'red') return 'bg-red-500';
  if (tone === 'amber') return 'bg-amber-500';
  if (tone === 'blue') return 'bg-sky-500';
  return 'bg-emerald-500';
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
  const [panelView, setPanelView] = useState<'todo' | 'chat'>('chat');
  const [activeAgent, setActiveAgent] = useState<OrbitAgentId>('strategy');
  const [assistantTool, setAssistantTool] = useState<AssistantTool | null>(null);
  const [liveContext, setLiveContext] = useState<AssistantContext | null>(null);
  const [enterpriseContext, setEnterpriseContext] = useState('');
  const [loading, setLoading] = useState(false);
  const longPressRef = useRef<number | null>(null);
  const longPressedRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const assistantRootRef = useRef<HTMLDivElement>(null);
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
  const assistantExpression = PAGE_EXPRESSION[page];
  const activeContext = useMemo(() => contextForOrbit(activeAgent, pageContext), [activeAgent, pageContext]);
  const activeThread = threads[activeAgent];
  const todoItems = pageContext.todoItems ?? [];
  const activeTodoItems = todoItems.filter(item => !item.completed);
  const completedTodoItems = todoItems.filter(item => item.completed);
  const orderedTodoItems = [...activeTodoItems, ...completedTodoItems];
  const pendingCount = todoItems.length ? activeTodoItems.length : Math.max(0, Number(pageContext.pendingCount ?? 0));
  const pendingBadge = pendingCount > 9 ? '9+' : String(pendingCount);
  const activeAgentLabel = SKILL_AGENTS.find(agent => agent.id === activeAgent)?.label ?? '灵枢助手';
  const isCustomerTodoView = panelView === 'todo' && activeAgent === 'customer' && pageContext.agent === 'conversion';
  const panelTitle = assistantTool === 'knowledge-intake' ? '灵小枢 · 快速采集' : isCustomerTodoView ? '今日待办' : activeAgentLabel;
  const panelSubtitle = assistantTool === 'knowledge-intake' ? '当前：智能客服规范' : isCustomerTodoView ? '当前：我的客户' : `当前：${activeContext.label}`;
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
    setAssistantTool(null);
    setActiveAgent(agentId);
    setPanelView(agentId === 'customer' && pageContext.agent === 'conversion' && (pendingCount > 0 || todoItems.length > 0) ? 'todo' : 'chat');
    setUnreadCount(agentId, 0);
    setMode('chat');
    window.setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' }), 60);
    persistThread(agentId);
  }, [pageContext.agent, pendingCount, persistThread, reduceMotion, setUnreadCount, todoItems.length]);

  const openCurrentPageAgent = useCallback(() => {
    openAgent(orbitIdForAgent(pageContext.agent));
  }, [openAgent, pageContext.agent]);

  const send = useCallback(async (text: string, targetAgent = activeAgent, forcedContext?: AssistantContext) => {
    const visibleText = text.trim();
    if (!visibleText || loading) return;

    const thread = useAssistantStore.getState().threads[targetAgent];
    const context = forcedContext ?? contextForOrbit(targetAgent, pageContext);
    const enterpriseBrief = compactText(enterpriseContext);
    const historyForApi = apiHistory(thread.messages);
    const nextVisible = [...mergeConsecutiveAssistant(thread.messages), { role: 'user' as const, content: visibleText }];
    const apiMessages: Message[] = [
      ...historyForApi,
      {
        role: 'user',
        content: [
          `【当前页面上下文】${context.summary}`,
          `【当前模块】${context.label}`,
          enterpriseBrief ? `【企业中心摘要】${enterpriseBrief}` : '【企业中心摘要】当前未读取到企业中心资料。',
          '【联网要求】涉及外贸行业趋势、目标市场、平台规则、竞品或品类机会时，请联网检索公开来源，并在回答中保留可核验来源；不要把假设当成事实。',
          '【连续对话要求】请承接本窗口已有上下文回答，必要时先说明缺少哪些真实数据，再给可执行下一步。',
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
      if (!resp.ok) throw new Error(await responseErrorMessage(resp));
      if (!resp.body) throw new Error('模型响应为空，请稍后重试。');
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
      const message = err?.name === 'AbortError' ? '这次响应已停止。' : (err?.message || '请求失败，请稍后重试。');
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
        pendingCount: typeof detail.pendingCount === 'number' ? detail.pendingCount : undefined,
        todoItems: Array.isArray(detail.todoItems) ? detail.todoItems : undefined,
      });
    };
    window.addEventListener('lingshu-assistant-context', handler);
    return () => window.removeEventListener('lingshu-assistant-context', handler);
  }, [page]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ text?: string; context?: Partial<AssistantContext>; tool?: AssistantTool }>).detail;
      let targetContext = pageContext;
      if (detail?.context?.agent && detail.context.label && detail.context.summary) {
        targetContext = {
          agent: detail.context.agent,
          label: detail.context.label,
          summary: detail.context.summary,
          suggestions: detail.context.suggestions?.length ? detail.context.suggestions : pageContext.suggestions,
          pendingCount: typeof detail.context.pendingCount === 'number' ? detail.context.pendingCount : pageContext.pendingCount,
          todoItems: Array.isArray(detail.context.todoItems) ? detail.context.todoItems : pageContext.todoItems,
        };
        setLiveContext(targetContext);
      }
      const targetAgent = orbitIdForAgent(targetContext.agent);
      openAgent(targetAgent);
      if (detail?.tool === 'knowledge-intake') setAssistantTool('knowledge-intake');
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
    if (page === 'enterprise' || assistantTool !== 'knowledge-intake') return;
    setAssistantTool(null);
    setMode('breathing');
  }, [assistantTool, page]);

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
    if (assistantTool === 'knowledge-intake') {
      setMode('chat');
      return;
    }
    if (mode === 'expanded') {
      openCurrentPageAgent();
      return;
    }
    else setMode('expanded');
  };

  useEffect(() => {
    if (mode !== 'expanded') return;
    const handleOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (assistantRootRef.current?.contains(target)) return;
      setMode('breathing');
    };
    document.addEventListener('pointerdown', handleOutsidePointerDown, true);
    return () => document.removeEventListener('pointerdown', handleOutsidePointerDown, true);
  }, [mode]);

  if (suppressForRightSidebar) return null;

  return (
    <div ref={assistantRootRef} data-global-assistant className="fixed bottom-5 right-5 z-[75]">
      {mode === 'expanded' && (
        <button
          type="button"
          aria-label="收起灵枢助手"
          onClick={() => setMode('breathing')}
          className="fixed inset-0 z-0 cursor-default bg-transparent"
        />
      )}
      <AnimatePresence>
        {mode === 'expanded' && (
          <motion.div
            className="pointer-events-none absolute bottom-0 right-0 z-10 h-52 w-52"
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
                  title={AGENT_DISPLAY_NAME[agent.id]}
                  onClick={() => openAgent(agent.id)}
                  className="group pointer-events-auto absolute bottom-2 right-2 flex h-12 w-12 items-center justify-center rounded-full border bg-white shadow-[0_12px_28px_rgba(15,23,42,0.14)]"
                  style={{ borderColor: agent.color, color: agent.color, backgroundColor: agent.bg }}
                  initial={{ x: 0, y: 0, opacity: 0, scale: 0.72 }}
                  animate={{ x, y, opacity: 1, scale: 1 }}
                  exit={{ x: 0, y: 0, opacity: 0, scale: 0.72 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 18, delay: index * 0.06 }}
                >
                  <Icon size={20} />
                  <span className="pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 whitespace-nowrap rounded-full bg-slate-950 px-2.5 py-1 text-[11px] font-bold text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                    {AGENT_DISPLAY_NAME[agent.id]}
                  </span>
                  {unread > 0 && <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red px-1 text-[11px] font-bold text-white">{unread}</span>}
                </motion.button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {(mode === 'chat' || assistantTool === 'knowledge-intake') && (
          <motion.section
            data-global-assistant="panel"
            layoutId={`assistant-${activeAgent}`}
            initial={{ opacity: 0, y: 18, scale: 0.96 }}
            animate={mode === 'chat' ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 18, scale: 0.96 }}
            exit={{ opacity: 0, y: 18, scale: 0.96 }}
            transition={reduceMotion ? { duration: 0.16 } : { type: 'spring', stiffness: 240, damping: 24 }}
            className={`absolute bottom-14 right-0 z-10 flex h-[min(720px,calc(100vh-112px))] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-2xl border border-border bg-white shadow-2xl ${assistantTool === 'knowledge-intake' ? 'w-[560px]' : 'w-[420px]'} ${mode === 'chat' ? 'pointer-events-auto visible' : 'pointer-events-none invisible'}`}
          >
            <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
              <div className="flex min-w-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (assistantTool === 'knowledge-intake') {
                      setAssistantTool(null);
                      setPanelView('chat');
                    } else if (isCustomerTodoView) setPanelView('chat');
                    else setMode('expanded');
                  }}
                  className="rounded-lg p-1.5 text-text-muted hover:bg-surface-2"
                  title={assistantTool === 'knowledge-intake' ? '返回灵小枢对话' : isCustomerTodoView ? '返回客户助手' : '返回展开态'}
                >
                  <ArrowLeft size={16} />
                </button>
                <div className="min-w-0">
                  <p className="truncate text-sm font-black text-text-primary">{panelTitle}</p>
                  <p className="truncate text-[11px] text-text-muted">{panelSubtitle}</p>
                </div>
              </div>
              <button type="button" onClick={() => setMode('breathing')} className="rounded-lg p-1.5 text-text-muted hover:bg-surface-2" title="收回">
                <X size={15} />
              </button>
            </header>

            {assistantTool === 'knowledge-intake' ? (
              <div className="min-h-0 flex-1 overflow-y-auto bg-surface-2 p-3">
                <KnowledgeIntakePanel
                  mode="center"
                  compact
                  onApplied={(profile: AppliedProfile) => {
                    window.dispatchEvent(new CustomEvent('lingshu:knowledge-intake-applied', { detail: { profile } }));
                    onSessionRefresh?.();
                  }}
                />
              </div>
            ) : isCustomerTodoView ? (
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                <div className="space-y-3">
                  <div className="rounded-2xl border border-cyan-100 bg-cyan-50 p-4">
                    <p className="text-sm font-black text-cyan-950">今日待办（{pendingCount}）</p>
                    <p className="mt-2 text-sm leading-relaxed text-cyan-900">
                      {pendingCount > 0 ? '需要你处理和确认的客户已按优先级排好。' : '今天的待办已处理完。'}
                    </p>
                    <button
                      type="button"
                      onClick={() => setPanelView('chat')}
                      className="mt-4 rounded-xl border border-cyan-200 bg-white px-3 py-2 text-xs font-black text-cyan-800 hover:bg-cyan-100"
                    >
                      客户助手
                    </button>
                  </div>

                  {orderedTodoItems.length > 0 ? (
                    <div className="space-y-2">
                      {orderedTodoItems.map(item => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            window.dispatchEvent(new CustomEvent('lingshu:select-customer', { detail: { id: item.id } }));
                            setPanelView('chat');
                          }}
                          className={`flex w-full items-start gap-3 rounded-xl border px-3 py-3 text-left transition-colors hover:bg-white ${todoToneClass(item.tone, item.completed)}`}
                        >
                          <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${todoDotClass(item.tone, item.completed)}`} />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span className="truncate text-xs font-black text-text-primary">{item.name}</span>
                              {item.completed && (
                                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-700">
                                  <CheckCircle2 size={11} /> 已完成
                                </span>
                              )}
                            </span>
                            <span className="mt-1 block truncate text-[11px] font-bold opacity-80">{item.headline}</span>
                            <span className="mt-1 block line-clamp-2 text-[11px] leading-5 text-text-secondary">{item.reason}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-border bg-surface-2 px-3 py-4 text-center text-xs font-bold text-text-muted">
                      暂无今日待办
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <>
                <div
                  className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
                  onScroll={event => setScrollPosition(activeAgent, event.currentTarget.scrollTop)}
                >
                  {!activeThread.messages.length ? (
                    <div className="flex h-full flex-col justify-center gap-4">
                      <div>
                        <p className="text-sm font-bold text-text-primary">我是{activeAgentLabel}</p>
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
              </>
            )}
          </motion.section>
        )}
      </AnimatePresence>

      {mode !== 'chat' && (
        <div className="relative z-10 h-[72px] w-[60px]">
          <motion.button
            type="button"
            data-global-assistant="launcher"
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
            onClick={handleLauncherClick}
            className="absolute inset-0 flex items-center justify-center rounded-2xl bg-transparent outline-none transition-transform hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-[#6FDBA1] focus-visible:ring-offset-2"
            animate={mode === 'breathing' && pendingCount > 0 && !reduceMotion ? { scale: [1, 1.05, 1], y: [0, -2, 0] } : { scale: 1, y: 0 }}
            transition={{ duration: 2.4, ease: 'easeInOut', repeat: mode === 'breathing' && pendingCount > 0 && !reduceMotion ? Infinity : 0 }}
            title={mode === 'expanded' ? `打开${AGENT_DISPLAY_NAME[orbitIdForAgent(pageContext.agent)]}` : '展开灵枢助手'}
          >
            <AssistantLauncherMascot expression={assistantExpression} />
            {pendingCount > 0 && <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red px-1 text-[11px] font-black text-white">{pendingBadge}</span>}
          </motion.button>
        </div>
      )}
    </div>
  );
}
