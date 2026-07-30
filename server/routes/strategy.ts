import { Router } from 'express';
import { callLLM, callLLMChatStream, type ChatMessage } from '../agents/llm.js';
import { buildStrategyPrompt, type StrategyParams } from '../prompts/strategyPrompts.js';
import { enterpriseRouter as _er, buildEnterpriseContext, readTenantEnterpriseProfile } from './enterprise.js';
import { consumeDemoQuota } from '../lib/demo.js';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import { getWhatsAppCustomers } from '../whatsapp/historyImport.js';

async function getEnterpriseContext(tenantId: string): Promise<string> {
  try { return buildEnterpriseContext(await readTenantEnterpriseProfile(tenantId)); }
  catch { return ''; }
}

function currentTimeRule(): string {
  const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
  const year = new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric' });
  return `\n\n【当前时间与数据时效 · 必须遵守】当前北京时间是 ${now}，当前年份是 ${year}。默认把“当前、最新、近期、今年”理解为 ${year} 年；公开数据必须联网核验最新来源，禁止把 2024 年或更早数据表述为当前数据。历史数据仅可在明确标注年份和比较用途时引用。素材发布时间不受限制，不得按年份隐藏采集素材。`;
}

const BUSINESS_FACT_RULE = `\n\n【企业经营事实约束 · 必须遵守】产品、卖点、市场、客户、品牌语气、MOQ、价格、交期、认证、物流、联系方式、脚本语种等细节，只能来自企业中心、用户明确输入或已接入真实数据。语种严格沿用企业中心“主要业务语言/首选输出语言”，不得根据地域自行推断。找不到来源的经营细节直接删除，不得用常识、示例或模型猜测补齐。公开来源名称必须来自真实联网检索并附可点击链接，不得编造报告或平台公告。`;

const ADVISOR_SYSTEM_PROMPT = `你是灵枢AI的顾问Agent（策略编排层），服务于跨境电商、外贸工厂、品牌商、贸易商和海外卖家。

核心能力：
- 分析跨境电商经营数据，给出清晰的策略建议
- 协调我的社媒、我的客户的协同工作
- 识别"行动建议"机会：从买家询盘/偏好反推选品与运营方向
- 熟悉主流海外平台与渠道闭环：YouTube、TikTok、Instagram、Facebook 四大公域社媒平台，WhatsApp 私域承接，TikTok Shop、亚马逊、Shopify 独立站等交易渠道

回复风格：
- 简洁、专业，结论先行
- 用中文回复，专有名词可保留英文
- 给出 2-3 条具体可执行的行动建议，而非泛泛而谈
- 【能力边界与链接真实性 · 必须遵守】你没有生成文件、提供下载、发送邮件、代下单、代发布的能力。禁止编造任何下载链接、文件地址（.docx/.pdf/.xlsx、云盘、S3 等一律是假的），禁止说"点击下载""已发送""已为你生成文件"。模板、表格、清单、文档类交付物一律直接在回复里给出全文（可直接发送的消息/文案放 copy 块、字段/清单用 Markdown 表格，用户一键复制即可使用）。回复中允许出现的链接只有两类：联网检索真实返回的来源、用户消息里出现过的链接，除此之外不要写任何 URL。邀约用户下一步时，只承诺产品内真实做得到的事：继续在对话里生成/改写内容，或"建议触发 [我的社媒/我的客户] 执行：……"一键派发；不要承诺下载、导出文件、定时提醒、自动发送等做不到的操作。
- 【数据真实性要求 · 必须遵守】所有经营判断、数字、客户名单、平台表现、转化结论必须来自以下来源之一：用户消息中明确提供的数据、企业中心知识库、已接入的真实社媒/WhatsApp/订单/客户接口、或联网检索到且可引用的公开行业来源。禁止编造示例经营数据、假客户、假转化率、假平台表现。
- 数据不完整时不要以“当前缺少数据”“无法判断”“无法筛选”等消极表述开头。优先基于已接入数据给出可执行的初步判断和行动方案；必要时仅在结尾中性说明适用范围及可补充字段，不得把假设写成事实。
- 涉及市场趋势、平台打法、行业规模、竞品变化时，若不是来自企业中心或用户提供的数据，必须标注公开来源或说明“需要联网核验后才能下结论”。
- 【上下文使用要求 · 必须遵守】用户消息里会带有【当前页面上下文】【当前模块】【企业中心摘要】。回答必须优先结合当前页面正在做的事；涉及主推品、市场、MOQ、交期、品牌语气、禁忌和客户画像时，优先引用企业中心信息；涉及外贸行业趋势、目标市场变化、平台打法、竞品/品类机会时，必须使用联网检索到的公开来源或明确说明需要联网核验；连续对话时承接前文目标、已生成内容和上轮限制，不要每轮重新自我介绍。
- 【客户地域中立 · 必须遵守】不要默认客户来自义乌、珠三角或任何固定地区。只有用户消息或企业中心明确写出地区时才可引用；引用时必须说“当前企业资料显示……”，禁止把单个演示租户泛化成所有客户。
- 【渠道闭环认知 · 必须遵守】集成中心不是“WhatsApp+TikTok”双通道链路。默认应理解为四大公域社媒平台 YouTube、TikTok、Instagram、Facebook 与 WhatsApp 私域共同构成“公域获客/内容分发 → 互动线索沉淀 → WhatsApp 私域承接 → 跟进转化/复购 → 反馈内容策略”的闭环；除非用户明确只问单个平台，不要把闭环窄化为两个平台的单向链接。没有真实账号数据或用户明确选择时，不得擅自说“以某两个平台为主阵地/优先平台”，只能说“先完成五个平台接入，再按账号数据决定优先级”。
- 【关键】每条行动建议结尾，单独一行写明派发指令，格式严格为：建议触发 [我的社媒/我的客户] 执行：[一句话具体任务]
  （前端会把这一行渲染成"一键执行"按钮，所以必须用这个格式、专家名三选一）

【输出格式要求 · 必须遵守】
- 用 Markdown 排版（前端会渲染成漂亮样式）：
  · 小标题用 "## 标题"，子标题用 "### 标题"
  · 关键结论、重点数字用 **加粗**
  · 列表用 "- " 或 "1. "，不要多层数字嵌套（如 1. 里再套 1. 2.）
  · 引用网址用 [说明文字](https://网址)
- 话术、营销文案、邮件、WhatsApp 消息、短视频脚本、广告文案等"可直接复制使用"的内容，必须放进可复制块：
  · 优先使用 fenced block，格式为三反引号 + copy，例如：
    \`\`\`copy
    [EN] Hello ...
    \`\`\`
  · 每个语言版本单独一个 copy 块，块前用简短标题说明用途
- 多语言规则：
  · 默认根据【当前企业知识库】里的主攻市场、补充知识推断，最多输出 2 种首选语言版本
  · 如果用户要求的语言种类超过 2 种，但没有明确列出具体语言，先用一句话询问"需要哪几种语言版本"，不要直接生成一大串
  · 语言标注用 [EN] [AR] [ES] [FR] 等，不要混在同一个段落里
- 涉及数字对比、趋势、占比且数据全部真实可溯源时，优先输出图表块（前端会渲染成迷你图表），格式为三反引号 + chart，内容是一个严格 JSON（不要注释、不要多余文字）：
  {"type":"bar 或 line","title":"图表标题","unit":"单位(可省)","data":[{"label":"项目","value":123}],"conclusion":"一句话结论(可省)"}
  · data 2-8 项，value 必须是真实数字；对比用 bar，时间趋势用 line；没有真实数据时禁止输出 chart 块
- 回复结尾（参考来源之前）输出一个下一步块，给 2-3 条用户可直接点击的追问或动作，格式为三反引号 + next，每行一条：
  · 每条 ≤14 字、动词开头（如"生成阿语版脚本"），必须是继续在对话里就能完成的事，不要写做不到的操作
  · 内容要承接本轮回复，像顾问主动递上的下一步，不要泛泛的"还有什么问题"
- 需要对比、排期、分阶段方案、客户名单、素材清单时，优先用 Markdown 表格：
  · 表格必须包含表头、分隔行和完整行，例如 | 阶段 | 动作 | 负责人 |
  · 不要输出残缺的表格分隔符，不要在单元格里写 <br>，多点内容用分号隔开
  · 表格过宽时拆成两张小表
- 结构清晰：先给结论，再展开；每节之间空一行
- 禁止输出残缺 Markdown：不要单独输出 ###、####、#####；不要留下未闭合的 **；不要把标题符号和正文挤在同一行造成 "##### 1." 这种格式
- 控制在 2-3 条核心建议，不要长篇大论
- 结尾可以有一句自然的情绪价值，但必须根据用户上一轮语气和本次任务状态临场生成；不要套固定句式，不要复用输出范例里的结尾，不要每次都用"陪你/稳稳/加油"这类固定组合
- 如果用户是在纠错、质疑或要求判断，先正面承认问题并给出具体修正，不要用安抚话术盖过去；emoji 只在语境自然时使用，默认不用

【输出范例 · 严格照此结构】
## 行动建议

### 1. 抢占斋月家居装饰需求
斋月家庭聚会增多，**家居装饰、餐具套装**需求旺盛，建议提前 3 周铺货。
建议触发 [我的社媒] 执行：按"斋月家居场景"方向产出 5 条阿拉伯语 TikTok 短视频

### 2. 大单询盘优先承接
礼品类常出现批量采购，**响应速度**直接决定成交。
建议触发 [我的客户] 执行：为礼品类大单配置阿语自动首响话术

收尾用一句贴合当前任务的自然话，不要照抄这里。`;


export const strategyRouter = Router();
strategyRouter.use(requireAuth);

type AdvisorSnapshot = {
  exposureReady: boolean;
  exposure: number;
  inquiries: number;
  quoted: number;
  orders: number;
  followup: number;
  accountCount: number;
};

type AdvisorTarget = {
  page: 'traffic' | 'conversion' | 'enterprise' | 'orders' | 'channels';
  view?: string;
};

type AdvisorRecommendation = {
  id: string;
  title: string;
  desc: string;
  basis: string;
  target: string;
  confidence: '高' | '中' | '低';
  limitation: string;
  priorityScore: number;
  action: AdvisorTarget;
};

type MarketContext = {
  summary: string;
  sources: Array<{ title: string; uri: string }>;
  generatedAt: string;
};

const marketContextCache = new Map<string, { expiresAt: number; value: MarketContext }>();

function finiteCount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function normalizeAdvisorSnapshot(value: unknown): AdvisorSnapshot {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    exposureReady: Boolean(raw.exposureReady),
    exposure: finiteCount(raw.exposure),
    inquiries: finiteCount(raw.inquiries),
    quoted: finiteCount(raw.quoted),
    orders: finiteCount(raw.orders),
    followup: finiteCount(raw.followup),
    accountCount: finiteCount(raw.accountCount),
  };
}

function textReady(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function profileCoverage(profile: any): { score: number; missing: string[] } {
  const checks = [
    ['企业名称', profile?.company?.name],
    ['主营产品', profile?.products?.categories || profile?.products?.items?.[0]?.name],
    ['目标市场', profile?.strategy?.focusMarkets || profile?.company?.mainMarkets],
    ['目标客户', profile?.customers?.targetProfiles],
    ['MOQ', profile?.bizRules?.moq || profile?.products?.moq],
    ['付款与交期', profile?.bizRules?.paymentTerms && (profile?.bizRules?.leadTime || profile?.operations?.leadTime)],
  ] as const;
  const missing = checks.filter(([, value]) => !textReady(value)).map(([label]) => label);
  return { score: Math.round((checks.length - missing.length) / checks.length * 100), missing };
}

function confidenceFor(snapshot: AdvisorSnapshot, profileScore: number): '高' | '中' | '低' {
  const coverage = [snapshot.exposureReady, snapshot.inquiries > 0, snapshot.orders > 0, profileScore >= 70].filter(Boolean).length;
  return coverage >= 3 ? '高' : coverage >= 1 ? '中' : '低';
}

function buildAdvisorRecommendations(snapshot: AdvisorSnapshot, profile: any): AdvisorRecommendation[] {
  const profileState = profileCoverage(profile);
  const confidence = confidenceFor(snapshot, profileState.score);
  const items: AdvisorRecommendation[] = [];
  const add = (item: AdvisorRecommendation) => items.push(item);

  if (!snapshot.exposureReady || snapshot.accountCount === 0) {
    add({
      id: 'connect-social-data', title: '接入社媒账号并建立真实基线',
      desc: '先完成 YouTube、TikTok、Instagram、Facebook 的授权，再按账号表现决定内容优先级。',
      basis: '依据：当前没有读取到可用的社媒账号曝光数据。', target: '目标：本周完成至少 1 个社媒账号授权并成功同步视频数据。',
      confidence: '高', limitation: '未接入账号前，无法判断平台和内容优先级。', priorityScore: 96,
      action: { page: 'traffic', view: 'accounts' },
    });
  }

  if (snapshot.exposureReady && snapshot.exposure > 0 && snapshot.inquiries === 0) {
    add({
      id: 'exposure-to-inquiry', title: '优先修复“有播放、无询盘”的转化断点',
      desc: '检查 WhatsApp 承接链接与归因码，复盘播放最高内容，并生成强化采购 CTA 的多语言版本。',
      basis: `依据：当前已读取 ${snapshot.exposure.toLocaleString('zh-CN')} 次累计播放，但有效询盘为 0。`,
      target: '目标：7 天内获得首批可归因询盘。', confidence,
      limitation: '当前平台接口缺少完播率、链接点击和按日播放时序，暂不能定位到具体流失秒点。', priorityScore: 100,
      action: { page: 'traffic', view: 'create' },
    });
  }

  if (snapshot.inquiries > 0 && snapshot.quoted === 0) {
    add({
      id: 'inquiry-to-quote', title: '把高意向询盘推进到报价',
      desc: '优先处理意向分最高且仍未报价的客户，补齐数量、规格、认证和交期后形成可报价条件。',
      basis: `依据：已有 ${snapshot.inquiries} 个有效询盘，但进入报价的客户为 0。`,
      target: '目标：3 天内完成首批高意向询盘资格确认并进入报价。', confidence,
      limitation: '未读取客户预算与采购时间时，优先级主要依据现有意向分和对话状态。', priorityScore: 98,
      action: { page: 'conversion', view: 'leads' },
    });
  }

  if (snapshot.quoted > 0 && snapshot.orders === 0) {
    add({
      id: 'quote-to-order', title: '诊断报价到订单的成交阻力',
      desc: '逐条核对价格、MOQ、样品、付款和交期异议，并为已报价客户安排下一次跟进。',
      basis: `依据：已有 ${snapshot.quoted} 个客户进入报价，但有效订单为 0。`,
      target: '目标：7 天内明确每个报价客户的阻力与下一步承诺。', confidence,
      limitation: '若未记录丢单原因和报价版本，系统只能依据客户阶段做初步判断。', priorityScore: 94,
      action: { page: 'conversion', view: 'leads' },
    });
  }

  if (snapshot.followup > 0) {
    add({
      id: 'clear-followup', title: '先清理需要人工处理的客户待办',
      desc: '按意向分、最近消息和响应时限排序，先处理高价值且即将超时的对话。',
      basis: `依据：当前有 ${snapshot.followup} 个 WhatsApp 客户需要人工处理或存在待办原因。`,
      target: '目标：今日清零高优先级待办，并为每个客户记录下一步。', confidence,
      limitation: '未配置销售负责人时，任务暂按客户优先级而非人员负载排序。', priorityScore: 92,
      action: { page: 'conversion', view: 'inbox' },
    });
  }

  if (profileState.score < 70) {
    add({
      id: 'complete-enterprise-profile', title: '补齐会影响内容和报价的企业资料',
      desc: `优先补充：${profileState.missing.slice(0, 4).join('、')}。这些字段会直接影响脚本、CTA 和询盘回复。`,
      basis: `依据：当前企业经营资料完整度约 ${profileState.score}%。`,
      target: '目标：本周将核心经营资料完整度提升到 70% 以上。', confidence: '高',
      limitation: '完整度仅检查关键字段是否存在，不评价资料内容是否准确。', priorityScore: snapshot.exposureReady ? 82 : 90,
      action: { page: 'enterprise', view: profileState.missing.includes('主营产品') ? 'products' : 'company' },
    });
  }

  if (!items.length || items.length < 3) {
    add({
      id: 'market-content-test', title: '用市场趋势启动一轮可归因内容测试',
      desc: '从当前目标市场的公开趋势中选 1 个可验证主题，生成多语言版本并使用统一 CTA 与归因码。',
      basis: '依据：当前经营漏斗没有出现更高优先级的明显断点，可进入增长验证。',
      target: '目标：7 天内完成 3 个内容版本的小样本测试。', confidence,
      limitation: '趋势只能作为选题信号，最终仍需以账号真实播放、点击和询盘结果验证。', priorityScore: 70,
      action: { page: 'traffic', view: 'create' },
    });
  }

  return items.sort((a, b) => b.priorityScore - a.priorityScore).slice(0, 3);
}

function extractLinks(text: string): Array<{ title: string; uri: string }> {
  const result: Array<{ title: string; uri: string }> = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(/\[([^\]]+)]\((https?:\/\/[^\s)]+)\)/g)) {
    if (!seen.has(match[2])) { seen.add(match[2]); result.push({ title: match[1], uri: match[2] }); }
  }
  return result.slice(0, 5);
}

async function loadMarketContext(tenantId: string, profile: any, force: boolean): Promise<MarketContext> {
  const cached = marketContextCache.get(tenantId);
  if (!force && cached && cached.expiresAt > Date.now()) return cached.value;
  const market = profile?.strategy?.focusMarkets || profile?.company?.mainMarkets || '企业当前目标市场';
  const category = profile?.products?.categories || profile?.products?.items?.[0]?.category || '企业主营品类';
  const prompt = `联网核验 ${market} 的 ${category} 在最近 90 天内与跨境获客相关的市场变化。只写 2 条对经营动作有直接帮助的信号，每条包含：变化、对内容或询盘承接的影响、可点击公开来源。不要预测销量，不要编造数字。总字数不超过 220 字。`;
  let text = '';
  const sources: Array<{ title: string; uri: string }> = [];
  try {
    for await (const event of callLLMChatStream([{ role: 'user', content: prompt }], {
      systemPrompt: `${currentTimeRule()}${BUSINESS_FACT_RULE}`,
      requireSources: true,
    })) {
      if ('text' in event) text += event.text;
      else sources.push(...event.sources.map(item => ({ title: item.title, uri: item.uri })));
    }
  } catch (error) {
    console.warn('[strategy-advisor:market-context]', error);
  }
  const uniqueSources = [...sources, ...extractLinks(text)].filter((item, index, all) => all.findIndex(candidate => candidate.uri === item.uri) === index).slice(0, 5);
  const value: MarketContext = {
    summary: text.trim().slice(0, 900),
    sources: uniqueSources,
    generatedAt: new Date().toISOString(),
  };
  marketContextCache.set(tenantId, { expiresAt: Date.now() + 6 * 60 * 60 * 1000, value });
  return value;
}

function formatStreamError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/RESOURCE_EXHAUSTED|Too Many Requests|code['"]?:429|quota|rate limit/i.test(raw)) {
    return 'Gemini 返回 429/RESOURCE_EXHAUSTED，通常是模型或联网搜索工具临时限流、项目配额限制，或当前 API Key 未开通对应模型/搜索能力；不一定是账户余额不足。请稍后重试，或先关闭联网检索再生成。';
  }
  if (/fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND/i.test(raw)) {
    return '模型服务网络连接失败，请检查代理或稍后重试。';
  }
  if (/API key|GEMINI_API_KEY/i.test(raw)) {
    return 'Gemini API Key 未配置或不可用。';
  }
  return raw.slice(0, 300);
}

function latestUserQuestion(messages: ChatMessage[]): string {
  const latest = [...messages].reverse().find(m => m.role === 'user')?.content ?? '';
  const match = latest.match(/用户问题[:：]([\s\S]*)$/);
  return (match?.[1] ?? latest).trim();
}

function shouldRequireSources(messages: ChatMessage[]): boolean {
  const question = latestUserQuestion(messages);
  if (/不需要联网|无需联网|不用联网|不要联网|不必联网|无需搜索|不用搜索|不要搜索/i.test(question)) return false;
  return /联网|搜索|检索|查一下|查询|查找|核验|公开来源|来源|链接|趋势|平台规则|规则变化|政策|算法|竞品|品类机会|行业|目标市场|市场机会|最新|近期|报告|数据/i.test(question);
}

strategyRouter.post('/advisor', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const snapshot = normalizeAdvisorSnapshot(req.body?.snapshot);
  const customers = getWhatsAppCustomers(tenantId);
  if (customers.length) {
    const effective = customers.filter((customer: any) => Number(customer.intentScore || 0) >= 70);
    snapshot.inquiries = effective.length;
    snapshot.quoted = customers.filter((customer: any) => customer.stage === 'quoted' || customer.stage === 'won' || (Array.isArray(customer.orders) && customer.orders.length > 0)).length;
    snapshot.followup = customers.filter((customer: any) => customer.handlingMode !== 'ai_auto' || customer.inboxReason).length;
  }
  const profile = await readTenantEnterpriseProfile(tenantId);
  const recommendations = buildAdvisorRecommendations(snapshot, profile);
  const refreshExternal = req.body?.refreshExternal === true;
  const marketContext = await loadMarketContext(tenantId, profile, refreshExternal);
  const coverage = profileCoverage(profile);
  res.json({
    generatedAt: new Date().toISOString(),
    periodLabel: '当前累计经营快照',
    snapshot,
    dataQuality: {
      profileCoverage: coverage.score,
      hasSocialData: snapshot.exposureReady,
      hasInquiryData: customers.length > 0,
      hasOrderData: snapshot.orders > 0,
      note: '播放量为当前可读取累计值；接入平台 insights 时序后可升级为严格近 30 天增量。',
    },
    recommendations,
    marketContext,
  });
});

strategyRouter.post('/chat', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const { messages, deepThinking = false } = req.body as { messages: ChatMessage[]; deepThinking?: boolean };
  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: 'messages required' });
    return;
  }
  if (!await consumeDemoQuota(req, res, 'aiChat')) return;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const enterpriseCtx = await getEnterpriseContext(tenantId);
  const requireSources = shouldRequireSources(messages);
  const timeRule = currentTimeRule();
  const systemPrompt = enterpriseCtx
    ? `${ADVISOR_SYSTEM_PROMPT}${timeRule}${BUSINESS_FACT_RULE}${requireSources ? '\n\n【联网来源硬规则】本轮涉及联网搜索/公开信息核验，必须使用联网检索结果，并通过 sources 事件返回可点击来源；如果无法取得来源，不要给出联网结论，改为说明需要重新检索。' : ''}\n\n【当前企业知识库】\n${enterpriseCtx}`
    : `${ADVISOR_SYSTEM_PROMPT}${timeRule}${BUSINESS_FACT_RULE}${requireSources ? '\n\n【联网来源硬规则】本轮涉及联网搜索/公开信息核验，必须使用联网检索结果，并通过 sources 事件返回可点击来源；如果无法取得来源，不要给出联网结论，改为说明需要重新检索。' : ''}`;

  try {
    for await (const ev of callLLMChatStream(messages, { systemPrompt, deepThinking, requireSources })) {
      res.write(`data: ${JSON.stringify(ev)}\n\n`);
    }
    res.write('data: [DONE]\n\n');
  } catch (err: any) {
    const error = requireSources
      ? `联网检索失败，未能取得可跳转信息来源：${formatStreamError(err)}`
      : formatStreamError(err);
    res.write(`data: ${JSON.stringify({ error })}\n\n`);
    res.write('data: [DONE]\n\n');
  } finally {
    res.end();
  }
});

strategyRouter.post('/plan', async (req, res) => {
  const { productName, category, targetMarket, budget, competitors, advantages, backend, model } = req.body as StrategyParams & { backend?: string; model?: string };

  if (!productName || !category || !targetMarket) {
    res.status(400).json({ error: 'productName, category, targetMarket are required' });
    return;
  }
  if (!await consumeDemoQuota(req, res, 'generation')) return;

  try {
    const prompt = buildStrategyPrompt({ productName, category, targetMarket, budget, competitors, advantages });
    const raw = await callLLM(prompt, { backend: backend as any, model });
    const match = raw.match(/\{[\s\S]*\}/);
    const data = match ? JSON.parse(match[0]) : { raw };
    res.json({ ok: true, data });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? 'internal error' });
  }
});
