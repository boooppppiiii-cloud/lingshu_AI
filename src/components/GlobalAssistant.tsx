import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowUp, Bot, Brain, FileText, Loader2, Paperclip, UploadCloud, X } from 'lucide-react';
import type { AgentAction, AgentType, Message, Page } from '../App';
import AgentReply from './AgentReply';
import { authApi, authHeader } from '../lib/auth';

interface AssistantContext {
  agent: AgentType;
  label: string;
  summary: string;
  suggestions: string[];
}

interface ProactiveTip {
  category: string;
  text: string;
  action: string;
  tone: 'guide' | 'encourage' | 'news' | 'risk';
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

const TIP_FIRST_DELAY_MS = 6_000;
const TIP_VISIBLE_MS = 8_000;
const TIP_REAPPEAR_DELAY_MS = 24_000;
const ASSISTANT_BUBBLE_CLASS = 'border-emerald-100 bg-emerald-50/95 text-emerald-950';

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
    suggestions: ['AI帮我填写企业资料', '从文件提取企业字段', '检查企业资料缺口', '生成客户画像字段'],
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

function localGreeting() {
  const hour = new Date().getHours();
  if (hour < 5) return '夜深了';
  if (hour < 11) return '早上好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

function compactText(text: string, maxLength = 900) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function displayUserName(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return '';
  const localPart = trimmed.includes('@') ? trimmed.split('@')[0] : trimmed;
  return localPart.length > 10 ? `${localPart.slice(0, 10)}...` : localPart;
}

function buildQuickQuestions(context: AssistantContext, enterpriseContext: string) {
  const enterpriseHint = enterpriseContext.trim()
    ? '结合企业中心资料'
    : '先提示我企业中心还缺哪些资料';
  const industryHint = '联网核验外贸行业趋势';
  const pageHint = `基于当前「${context.label}」页面`;

  if (context.label === '企业中心') {
    return [
      '开启企业资料采集模式，用3轮以内问完必要信息并帮我整理可写入字段',
      '我会拖入产品表、报价表或公司资料，请提取企业中心可填写的信息',
      `${enterpriseHint}，按企业中心字段列出已完整、待确认和缺失的信息`,
      '根据企业中心现有资料，生成客户画像、高价值客户信号和跟进偏好',
    ];
  }

  if (context.agent === 'traffic') {
    return [
      `${pageHint}和企业中心主推品，推荐4个可拍短视频角度`,
      `${industryHint}，拆解适合当前品类的社媒内容机会`,
      `${enterpriseHint}，生成一条可直接拍摄的短视频脚本`,
      `${pageHint}，规划本周TikTok/Instagram/YouTube发布节奏`,
    ];
  }
  if (context.agent === 'conversion') {
    return [
      `${pageHint}，判断现在最该优先跟进的客户类型`,
      `${enterpriseHint}，生成WhatsApp首响和报价跟进话术`,
      `${industryHint}，补充目标市场买家常见顾虑`,
      `${pageHint}，整理3个提高询盘转化率的动作`,
    ];
  }
  return [
    `${pageHint}，给我今天最重要的3个经营动作`,
    `${enterpriseHint}，检查目前策略判断还缺哪些真实数据`,
    `${industryHint}，判断目标市场最近有什么机会`,
    `${pageHint}，把社媒、询盘、客户动作串成一周计划`,
  ];
}

function localProactiveTips(context: AssistantContext): ProactiveTip[] {
  if (context.agent === 'traffic') {
    return [
      {
        category: '互动引导',
        text: '要不要把这批素材顺手拆成脚本方向？',
        action: `基于当前「${context.label}」页面，帮我拆出3个可拍脚本方向`,
        tone: 'guide',
      },
      {
        category: '脚本提醒',
        text: '我可以按当前爆款节奏，改成一条能直接拍的主推品脚本。',
        action: `基于当前「${context.label}」页面，把选中的爆款结构改成主推品脚本`,
        tone: 'encourage',
      },
      {
        category: '发布节奏',
        text: '这页素材可以顺手排一版本周发布节奏。',
        action: `基于当前「${context.label}」页面，规划本周社媒发布节奏`,
        tone: 'guide',
      },
      {
        category: '素材检查',
        text: '如果要提高成片成功率，我可以先帮你列缺哪些镜头。',
        action: `基于当前「${context.label}」页面，列出下一步需要补拍的素材`,
        tone: 'risk',
      },
    ];
  }
  if (context.agent === 'conversion') {
    return [
      {
        category: '经营风险',
        text: '有些客户可能该优先跟进了，我可以帮你排一下。',
        action: `基于当前「${context.label}」页面，帮我判断优先跟进顺序`,
        tone: 'risk',
      },
      {
        category: '话术助手',
        text: '要不要把当前客户状态整理成一版 WhatsApp 跟进话术？',
        action: `基于当前「${context.label}」页面，生成WhatsApp跟进话术`,
        tone: 'guide',
      },
      {
        category: '转化提醒',
        text: '我可以帮你找出最容易推进成交的下一步动作。',
        action: `基于当前「${context.label}」页面，整理3个提高转化率的动作`,
        tone: 'encourage',
      },
    ];
  }
  return [
    {
      category: '鼓励提醒',
      text: '今天也可以从一个小动作开始推进增长～',
      action: `基于当前「${context.label}」页面，给我一个最小可执行动作`,
      tone: 'encourage',
    },
    {
      category: '动作整理',
      text: '我可以把当前页面整理成 3 个下一步动作。',
      action: `基于当前「${context.label}」页面，帮我整理3个下一步动作`,
      tone: 'guide',
    },
    {
      category: '资料检查',
      text: '如果企业资料还不完整，我可以先帮你补缺口清单。',
      action: `基于当前「${context.label}」页面，检查企业中心资料缺口`,
      tone: 'risk',
    },
  ];
}

function pickProactiveTip(context: AssistantContext, index: number): ProactiveTip {
  const tips = localProactiveTips(context);
  return tips[index % tips.length] ?? tips[0]!;
}

function hasVisibleRightSidebar(): boolean {
  if (typeof window === 'undefined') return false;
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  const candidates = Array.from(document.querySelectorAll<HTMLElement>('aside, [class*="right-0"], [class*="border-l"]'));

  return candidates.some(element => {
    if (element.closest('[data-global-assistant]')) return false;
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;

    const rect = element.getBoundingClientRect();
    if (rect.width < 240 || rect.height < viewportHeight * 0.55) return false;
    if (rect.right < viewportWidth - 8 || rect.left < viewportWidth * 0.42) return false;

    const isFixedRightDrawer = style.position === 'fixed' && rect.right >= viewportWidth - 8;
    const isLayoutRightPanel = element.tagName === 'ASIDE' && rect.right >= viewportWidth - 8 && rect.left > viewportWidth * 0.5;
    return isFixedRightDrawer || isLayoutRightPanel;
  });
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

const FILE_TEXT_LIMIT = 12_000;
const FILE_TOTAL_LIMIT = 32_000;

function fileExt(name: string) {
  return name.split('.').pop()?.toLowerCase() || '';
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('file_read_failed'));
    reader.readAsText(file);
  });
}

async function extractSpreadsheetText(file: File): Promise<string> {
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  return workbook.SheetNames.slice(0, 4).map(sheetName => {
    const sheet = workbook.Sheets[sheetName];
    const csv = sheet ? XLSX.utils.sheet_to_csv(sheet, { FS: ',', RS: '\n' }) : '';
    return `# Sheet: ${sheetName}\n${csv}`;
  }).join('\n\n');
}

async function extractAssistantFileText(file: File): Promise<{ name: string; type: string; text: string; supported: boolean }> {
  const ext = fileExt(file.name);
  const isSpreadsheet = ['xlsx', 'xls', 'csv', 'tsv'].includes(ext);
  const isText = file.type.startsWith('text/')
    || ['txt', 'md', 'markdown', 'json', 'csv', 'tsv', 'html', 'htm', 'xml', 'log'].includes(ext);
  try {
    const raw = isSpreadsheet && ext !== 'csv' && ext !== 'tsv'
      ? await extractSpreadsheetText(file)
      : isText || isSpreadsheet
        ? await readFileAsText(file)
        : '';
    const text = raw.replace(/\u0000/g, '').trim();
    return { name: file.name, type: file.type || ext || 'unknown', text: text.slice(0, FILE_TEXT_LIMIT), supported: Boolean(text) };
  } catch {
    return { name: file.name, type: file.type || ext || 'unknown', text: '', supported: false };
  }
}

function buildEnterpriseFilePrompt(files: Array<{ name: string; type: string; text: string; supported: boolean }>) {
  const supported = files.filter(file => file.supported && file.text);
  const unsupported = files.filter(file => !file.supported);
  const body = supported.map(file => {
    const header = `【文件】${file.name}\n【类型】${file.type}`;
    return `${header}\n【内容节选】\n${file.text}`;
  }).join('\n\n---\n\n').slice(0, FILE_TOTAL_LIMIT);
  const unsupportedLine = unsupported.length
    ? `\n\n【未能解析的文件】${unsupported.map(file => file.name).join('、')}。请提醒用户换成 xlsx/csv/txt/json/md 或直接复制关键内容。`
    : '';

  return `【企业中心资料采集模式】
用户刚拖入文件，希望你从文件里智能分析并捕捉可写入企业中心的信息。

请按企业中心字段输出：
1. 可直接写入：字段名 / 建议值 / 来源文件 / 可信度。
2. 待确认推断：字段名 / 推断值 / 为什么需要用户确认。
3. 缺失信息：还需要用户补充什么表格、文件或必要信息。
4. 下一轮只问最关键的 2-3 个问题，把对话压缩在 3 轮以内。

字段范围包括：公司基础、主营产品、价格区间、MOQ、认证资质、产品优势、目标市场、业务语言、客户画像、高价值客户信号、低质量询盘、常见问题、跟进偏好、交期、定制能力、物流、付款条款、品牌语气、禁忌话题、Agent 执行权限。

要求：
- 不要把没有来源的内容写成事实。
- 每条建议都标注来源文件。
- 暂时不要说“已经写入系统”，只输出可确认的回填草案。
${unsupportedLine}

${body || '没有解析到可用文本。'}`;
}

export default function GlobalAssistant({ page, restore, kickoff, suppressForRightSidebar = false, onKickoffConsumed, onAction, onSessionRefresh }: Props) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [fileReading, setFileReading] = useState(false);
  const [draggingFile, setDraggingFile] = useState(false);
  const [deepThinking, setDeepThinking] = useState(false);
  const [liveContext, setLiveContext] = useState<AssistantContext | null>(null);
  const [enterpriseContext, setEnterpriseContext] = useState('');
  const [proactiveTip, setProactiveTip] = useState<ProactiveTip | null>(null);
  const [proactiveTipIndex, setProactiveTipIndex] = useState(0);
  const [proactiveDelay, setProactiveDelay] = useState(TIP_FIRST_DELAY_MS);
  const [assistantHiddenByRightSidebar, setAssistantHiddenByRightSidebar] = useState(false);
  const [userName, setUserName] = useState('');
  const latestMessagesRef = useRef<Message[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inFlightRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const handledKickoffs = useRef(new Set<string>());
  const handledRestores = useRef(new Set<string>());

  const context = useMemo(() => liveContext ?? DEFAULT_CONTEXT[pageKey(page)] ?? DEFAULT_CONTEXT.strategy, [liveContext, page]);
  const [greeting, setGreeting] = useState(() => localGreeting());
  const quickQuestions = useMemo(() => buildQuickQuestions(context, enterpriseContext), [context, enterpriseContext]);
  const proactiveTitle = userName ? `hi，${displayUserName(userName)}` : 'hi';
  const assistantSuppressed = suppressForRightSidebar || assistantHiddenByRightSidebar;
  const enterpriseAssistMode = context.label === '企业中心';

  useEffect(() => {
    let cancelled = false;
    authApi.me()
      .then(session => {
        if (!cancelled) setUserName(session?.user.name || session?.user.email || '');
      })
      .catch(() => {
        if (!cancelled) setUserName('');
      });
    fetch('/api/overseas/enterprise/context', { headers: authHeader() })
      .then(resp => resp.ok ? resp.json() : null)
      .then(data => {
        if (!cancelled && typeof data?.context === 'string') setEnterpriseContext(data.context);
      })
      .catch(() => {
        if (!cancelled) setEnterpriseContext('');
      });
    return () => { cancelled = true; };
  }, [page]);

  useEffect(() => {
    const timer = window.setInterval(() => setGreeting(localGreeting()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (suppressForRightSidebar) {
      setOpen(false);
      setProactiveTip(null);
    }
  }, [suppressForRightSidebar]);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const hidden = hasVisibleRightSidebar();
        setAssistantHiddenByRightSidebar(hidden);
        if (hidden) setProactiveTip(null);
      });
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, { attributes: true, childList: true, subtree: true, attributeFilter: ['class', 'style', 'data-state'] });
    window.addEventListener('resize', update);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [page, open]);

  useEffect(() => {
    if (open || assistantSuppressed) {
      setProactiveTip(null);
      return;
    }
    let cancelled = false;
    let hideTimer: number | undefined;
    const showTimer = window.setTimeout(() => {
      if (cancelled) return;
      setProactiveTip(pickProactiveTip(context, proactiveTipIndex));
      hideTimer = window.setTimeout(() => {
        if (cancelled) return;
        setProactiveTip(null);
        setProactiveDelay(TIP_REAPPEAR_DELAY_MS);
        setProactiveTipIndex(index => index + 1);
      }, TIP_VISIBLE_MS);
    }, proactiveDelay);
    return () => {
      cancelled = true;
      window.clearTimeout(showTimer);
      if (hideTimer) window.clearTimeout(hideTimer);
    };
  }, [context, open, assistantSuppressed, proactiveDelay, proactiveTipIndex]);

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

  const send = async (text: string, base?: Message[], forcedContext?: AssistantContext, visibleOverride?: string) => {
    const modelText = text.trim();
    const visibleText = (visibleOverride ?? text).trim();
    if (!modelText || !visibleText || loading || inFlightRef.current) return;
    const activeContext = forcedContext ?? context;
    const enterpriseBrief = compactText(enterpriseContext);
    inFlightRef.current = true;
    const visibleUserMsg: Message = { role: 'user', content: visibleText };
    const nextVisible = [...mergeConsecutiveAssistant(base ?? messages), visibleUserMsg];
    const apiMessages = [
      ...mergeConsecutiveAssistant(base ?? messages),
      {
        role: 'user' as const,
        content: [
          `【当前页面上下文】${activeContext.summary}`,
          `【当前模块】${activeContext.label}`,
          enterpriseBrief ? `【企业中心摘要】${enterpriseBrief}` : '【企业中心摘要】当前未读取到企业中心资料；回答时请提示需要补齐的企业信息。',
          '【联网要求】涉及外贸行业趋势、目标市场、平台规则、竞品或品类机会时，请联网检索公开来源，并在回答中保留可核验来源；不要把假设当成事实。',
          '【连续对话要求】请承接本窗口已有上下文回答，必要时先说明缺少哪些真实数据，再给可执行下一步。',
          `用户问题：${modelText}`,
        ].join('\n'),
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

  const handleAssistantFiles = async (fileList: FileList | File[]) => {
    const picked = Array.from(fileList).slice(0, 6);
    if (!picked.length || fileReading || loading) return;
    setOpen(true);
    setDraggingFile(false);
    setFileReading(true);
    try {
      const extracted = await Promise.all(picked.map(extractAssistantFileText));
      const prompt = buildEnterpriseFilePrompt(extracted);
      const visible = `已拖入 ${picked.length} 个文件：${picked.map(file => file.name).join('、')}\n请帮我分析并捕捉企业中心可填写信息。`;
      void send(prompt, undefined, DEFAULT_CONTEXT.enterprise, visible);
    } finally {
      setFileReading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
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
      <AnimatePresence>
        {!open && !assistantSuppressed && proactiveTip && (
          <motion.div
            data-global-assistant="bubble"
            initial={{ opacity: 0, x: 12, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 10, y: 6, scale: 0.96 }}
            transition={{ duration: 0.2 }}
            className={`fixed bottom-24 right-20 z-[74] max-w-[min(560px,calc(100vw-112px))] rounded-2xl border px-4 py-3 pr-10 text-left shadow-[0_14px_36px_rgba(15,23,42,0.14)] backdrop-blur ${ASSISTANT_BUBBLE_CLASS}`}
          >
            <button
              type="button"
              onClick={() => {
                setProactiveTip(null);
                setProactiveDelay(TIP_REAPPEAR_DELAY_MS);
                setProactiveTipIndex(index => index + 1);
              }}
              className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full text-current opacity-55 transition hover:bg-black/5 hover:opacity-90"
              aria-label="关闭提示"
              title="关闭提示"
            >
              <X size={12} />
            </button>
            <button
              type="button"
              onClick={() => {
                const action = proactiveTip.action;
                setProactiveTip(null);
                setProactiveDelay(TIP_REAPPEAR_DELAY_MS);
                setProactiveTipIndex(index => index + 1);
                void send(action);
              }}
              className="block w-full text-left"
            >
              <span className="block text-xs font-black leading-5">{proactiveTitle}</span>
              <span className="block max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-xs font-semibold leading-5">
                {proactiveTip.text}
              </span>
            </button>
            <span className="absolute -right-1.5 bottom-4 h-3 w-3 rotate-45 border-r border-t bg-inherit" />
          </motion.div>
        )}
      </AnimatePresence>

      {!assistantSuppressed && (
        <button
          type="button"
          data-global-assistant="launcher"
          onClick={() => setOpen(true)}
          className="fixed bottom-24 right-5 z-[75] flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-[0_16px_38px_rgba(15,23,42,0.22)] transition-transform hover:scale-105"
          title="灵枢助手"
        >
          <Bot size={21} />
        </button>
      )}

      <AnimatePresence>
        {open && (
          <motion.section
            data-global-assistant="panel"
            initial={{ opacity: 0, y: 18, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 18, scale: 0.97 }}
            transition={{ duration: 0.18 }}
            className="fixed bottom-40 right-5 z-[76] flex h-[min(720px,calc(100vh-192px))] w-[420px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-2xl border border-border bg-white shadow-2xl"
            onDragOver={event => {
              if (!enterpriseAssistMode) return;
              event.preventDefault();
              setDraggingFile(true);
            }}
            onDragLeave={event => {
              if (!enterpriseAssistMode) return;
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDraggingFile(false);
            }}
            onDrop={event => {
              if (!enterpriseAssistMode) return;
              event.preventDefault();
              void handleAssistantFiles(event.dataTransfer.files);
            }}
          >
            {enterpriseAssistMode && draggingFile && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/88 p-6 backdrop-blur-sm">
                <div className="flex max-w-xs flex-col items-center rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-center text-emerald-950 shadow-xl">
                  <UploadCloud size={24} />
                  <p className="mt-2 text-sm font-black">松开文件，开始分析企业资料</p>
                  <p className="mt-1 text-xs leading-relaxed text-emerald-800">支持 xlsx、csv、txt、json、md 等文本资料，会按企业中心字段提取可写入信息。</p>
                </div>
              </div>
            )}
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
                    <p className="text-sm font-bold text-text-primary">{greeting}，我是你的外贸智脑灵小枢～</p>
                    <p className="mt-1 text-sm leading-relaxed text-text-muted">
                      {enterpriseAssistMode
                        ? '你可以直接说企业信息，也可以把产品表、报价表、公司资料拖进来，我会捕捉可回填字段。'
                        : '我会结合当前页面、企业中心资料和可联网核验的外贸行业信息来回答。'}
                    </p>
                  </div>
                  {enterpriseAssistMode && (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex items-center gap-2 rounded-xl border border-dashed border-emerald-200 bg-emerald-50/80 px-3 py-2 text-left text-xs font-semibold text-emerald-900 hover:border-emerald-300"
                    >
                      <FileText size={14} />
                      拖入产品表/报价表/公司资料，或点击选择文件
                    </button>
                  )}
                  <div className="grid gap-2">
                    {quickQuestions.map(item => (
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
                      <div className={`max-w-[82%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${msg.role === 'user' ? 'rounded-tr-sm bg-accent text-white whitespace-pre-line' : `rounded-tl-sm border ${ASSISTANT_BUBBLE_CLASS}`}`}>
                        {msg.role === 'assistant'
                          ? (msg.content ? <AgentReply content={msg.content} sources={msg.sources} onAction={onAction} /> : <span className="opacity-40">...</span>)
                          : msg.content}
                      </div>
                    </div>
                  ))}
                  {loading && (
                    <div className="flex gap-2">
                      <div className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-slate-950 text-white"><Loader2 size={13} className="animate-spin" /></div>
                      <div className={`rounded-2xl rounded-tl-sm border px-3 py-2 text-sm ${ASSISTANT_BUBBLE_CLASS}`}>思考中...</div>
                    </div>
                  )}
                  <div ref={bottomRef} />
                </div>
              )}
            </div>

            <div className="flex-shrink-0 border-t border-border p-3">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".xlsx,.xls,.csv,.tsv,.txt,.md,.markdown,.json,.html,.htm,.xml,.log,text/*,application/json"
                className="hidden"
                onChange={event => { if (event.target.files) void handleAssistantFiles(event.target.files); }}
              />
              {enterpriseAssistMode && (
                <div className="mb-2 flex items-center justify-between rounded-xl border border-dashed border-border bg-white px-3 py-2 text-xs text-text-muted">
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <UploadCloud size={13} className="text-emerald-600" />
                    <span className="truncate">{fileReading ? '正在读取文件...' : '可拖入表格/文档，自动提取企业中心字段'}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={fileReading || loading}
                    className="ml-2 rounded-lg px-2 py-1 font-bold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                  >
                    选择
                  </button>
                </div>
              )}
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
                  <div className="flex items-center gap-1">
                    {enterpriseAssistMode && (
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={fileReading || loading}
                        className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-bold text-text-muted hover:bg-white hover:text-text-primary disabled:opacity-50"
                        title="上传资料"
                      >
                        <Paperclip size={12} />资料
                      </button>
                    )}
                    <button type="button" onClick={() => setDeepThinking(v => !v)}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-bold ${deepThinking ? 'bg-white text-text-primary shadow-sm' : 'text-text-muted'}`}>
                      <Brain size={12} />深度思考
                    </button>
                  </div>
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
