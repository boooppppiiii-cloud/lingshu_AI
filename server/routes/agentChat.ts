import { Router } from 'express';
import { callLLMChatStream, type ChatMessage } from '../agents/llm.js';
import { buildEnterpriseContext } from './enterprise.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { consumeDemoQuota } from '../lib/demo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENTERPRISE_FILE = path.join(__dirname, '../../data/enterprise.json');

function getEnterpriseContext(): string {
  try {
    return buildEnterpriseContext(JSON.parse(fs.readFileSync(ENTERPRISE_FILE, 'utf8')));
  } catch { return ''; }
}

const FORMAT_RULE = `

【输出格式要求 · 必须遵守】
- 用 Markdown 排版（前端会渲染成漂亮样式）：
  · 小标题用 "## 标题"，子标题用 "### 标题"
  · 关键结论、重点数字用 **加粗**
  · 列表用 "- " 或 "1. "，不要多层数字嵌套（如 1. 里再套 1. 2.）
  · 引用网址 / 案例链接用 [说明文字](https://网址)
- 话术、营销文案、邮件、WhatsApp 消息、短视频脚本、广告文案等"可直接复制使用"的内容，必须放进可复制块：
  · 优先使用 fenced block，格式为三反引号 + copy，例如：
    \`\`\`copy
    [EN] Hello ...
    \`\`\`
  · 每个语言版本单独一个 copy 块，块前用简短标题说明用途
  · copy 块只放可直接复制发出去的成品内容；对用户的解释、判断、策略说明、提示、下一步说明、等待确认等对话性内容一律写成正文段落，禁止放进 copy 块或引用块
  · "> " 引用块仅用于提示 / 风险说明 / 备注（如 💡 ⚠️ 开头的补充说明），不要用引用块放话术或文案
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
- 【能力边界与链接真实性 · 必须遵守】
  · 你没有生成文件、提供下载、发送邮件、代下单、代发布的能力。**禁止编造任何下载链接、文件地址**（.docx/.pdf/.xlsx、云盘、S3 等一律是假的），禁止说"点击下载""已发送""已为你生成文件"。
  · 模板、表格、清单、文档类交付物一律直接在回复里给出全文：可直接发送的消息/文案放 copy 块，字段/清单用 Markdown 表格，用户一键复制即可使用——这就是本产品的交付方式。
  · 回复中允许出现的链接只有两类：联网检索真实返回的来源、用户消息里出现过的链接。除此之外不要写任何 URL。
  · 邀约用户下一步时，只承诺产品内真实做得到的事：继续在对话里生成/改写内容，或引导用户使用当前模块的真实功能。不要承诺下载、导出文件、定时提醒、自动发送等做不到的操作。
- 【数据真实性要求 · 必须遵守】所有经营判断、数字、客户名单、平台表现、转化结论必须来自以下来源之一：用户消息中明确提供的数据、企业中心知识库、已接入的真实社媒/WhatsApp/订单/客户接口、或联网检索到且可引用的公开行业来源。**禁止编造示例经营数据、假客户、假转化率、假平台表现**。
- 当缺少真实数据时，必须明确说出“当前缺少哪些数据，因此不能判断什么”，然后给出可执行的数据接入/核验清单；可以给方法和模板，但不能把假设写成事实。
- 涉及市场趋势、平台打法、行业规模、竞品变化时，若不是来自企业中心或用户提供的数据，必须标注公开来源或说明“需要联网核验后才能下结论”。
- 【客户地域中立 · 必须遵守】灵枢AI服务的是跨境电商、外贸工厂、品牌商、贸易商和海外卖家，不默认任何客户来自义乌、珠三角或某个地区。只有当企业中心或用户消息明确写出地区时，才可以引用；引用时必须说“当前企业资料显示……”，禁止把单个演示租户泛化成所有客户。
- 【渠道闭环认知 · 必须遵守】集成中心不是“WhatsApp+TikTok”双通道链路。默认应理解为四大公域社媒平台 YouTube、TikTok、Instagram、Facebook 与 WhatsApp 私域共同构成“公域获客/内容分发 → 互动线索沉淀 → WhatsApp 私域承接 → 跟进转化/复购 → 反馈内容策略”的闭环；除非用户明确只问单个平台，不要把闭环窄化为两个平台的单向链接。没有真实账号数据或用户明确选择时，不得擅自说“以某两个平台为主阵地/优先平台”，只能说“先完成五个平台接入，再按账号数据决定优先级”。
- 结尾可以有一句自然的情绪价值，但必须根据用户上一轮语气和本次任务状态临场生成；不要套固定句式，不要复用示例话术，不要重复用户刚说过的话，不要每次都用"放心/稳稳推进/我帮你盯着/咱们"这类固定组合
- 如果用户是在纠错、质疑或要求判断，先正面承认问题并给出具体修正，不要用安抚话术盖过去；emoji 只在语境自然时使用，默认不用`;

const CONTEXT_RULE = `

【上下文使用要求 · 必须遵守】
- 用户消息里会带有【当前页面上下文】【当前模块】【企业中心摘要】。回答必须优先结合当前页面正在做的事，不要泛泛回答。
- 企业中心知识库是租户业务资料来源；涉及主推品、市场、MOQ、交期、品牌语气、禁忌和客户画像时，优先引用企业中心信息。
- 涉及外贸行业趋势、目标市场变化、平台打法、竞品/品类机会时，必须使用联网检索到的公开来源或明确说明需要联网核验；禁止编造来源和数字。
- 支持连续对话：承接前文用户目标、已生成内容和上轮限制，不要每轮重新自我介绍。`;

const SYSTEM_PROMPTS: Record<string, string> = {
  conversion: `你是灵枢AI的「我的客户」助手，服务于跨境电商、外贸工厂、品牌商、贸易商和海外卖家，统一处理潜客询盘、成交客资筛选、自动回复、老客唤醒和跟单回复建议。

核心能力：
- 多语种 24/7 买家接待（英文、阿拉伯语、西班牙语等）
- 识别大单信号并触发预警（询盘金额>$500、批量询盘、重复咨询）
- AI初筛 + 关键时刻建议人工介入（大客户、投诉、谈判）
- 生成标准化多语言客户跟进话术模板
- 分析询盘转化漏斗，找出流失节点

回复风格：
- 提供具体可用的话术，而非抽象建议
- 大单预警用醒目标注：⚠️ 大单预警
- 多语言内容标注语言代码，如 [AR] [EN] [ES]
- 如需人工介入，明确说明原因和建议行动${CONTEXT_RULE}${FORMAT_RULE}`,

  retention: `你是灵枢AI的「我的客户」老客唤醒助手，服务于跨境电商、外贸工厂、品牌商、贸易商和海外卖家，负责老客户生命周期管理。

核心能力：
- 老客画像分析：采购品类、频次、客单价、偏好市场
- 生命周期唤醒：识别沉默期（30/60/90天）并制定触达策略
- 行动建议：根据老客历史偏好，主动推荐新品或补货提醒
- 复购率分析与提升建议
- 关键节假日营销节点提醒（斋月、圣诞、黑五等）

回复风格：
- 结合具体客户数据给出针对性建议
- 唤醒话术需考虑文化差异（中东、东南亚、欧美）
- 推品建议需说明推荐理由（历史偏好/季节/市场趋势）
- 数据分析要有明确的行动建议${CONTEXT_RULE}${FORMAT_RULE}`,

  traffic: `你是灵枢AI的社媒Agent，服务于跨境电商、外贸工厂、品牌商、贸易商和海外卖家，负责社交媒体内容和流量运营。

核心能力：
- YouTube/TikTok/Instagram/Facebook 四大公域社媒内容拆解、分发和复用策略
- 多语言多平台内容脚本生成（口播/图文/分镜）
- 竞品分析与差异化内容策略
- 素材去重矩阵，避免平台重复内容降权
- 账号矩阵规划、发布节奏建议，以及与 WhatsApp 私域承接的线索闭环设计

回复风格：
- 提供具体脚本而非框架
- 标注平台适配要点（TikTok前3秒、Instagram Reels封面等）
- 给出发布时间建议（基于目标市场时区）
- 数据驱动，引用热度指标${CONTEXT_RULE}${FORMAT_RULE}`,
};

export const agentChatRouter = Router();

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const cleaned = raw.replace(/```json|```/g, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
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

agentChatRouter.post('/assistant/proactive', async (req, res) => {
  const { pageLabel = '当前页面', pageSummary = '', enterpriseSummary = '' } = req.body as {
    pageLabel?: string;
    pageSummary?: string;
    enterpriseSummary?: string;
  };
  const enterpriseCtx = enterpriseSummary || getEnterpriseContext();
  const prompt = `请为灵枢AI右下角小助手生成1条主动气泡提示。

【当前页面】${pageLabel}
【页面上下文】${pageSummary}
【企业中心资料】${enterpriseCtx || '暂无企业中心资料'}

要求：
- 气泡要短、可爱、专业，适合外贸经营工作台。
- 从这4类里选最适合当前场景的一类：互动引导、鼓励提醒、行业新闻、经营风险。
- 如果选择“行业新闻”，必须联网搜索近期公开资讯，只写可核验的概括；不要编造新闻、公司名、数字。
- 输出必须是严格 JSON，不要 Markdown，不要解释。
- JSON 字段：
  category: "互动引导" | "鼓励提醒" | "行业新闻" | "经营风险"
  text: 18-42字的气泡正文
  action: 用户点击后发送给助手的一句话问题
  tone: "guide" | "encourage" | "news" | "risk"`;

  try {
    let text = '';
    for await (const ev of callLLMChatStream([{ role: 'user', content: prompt }], {
      systemPrompt: '你是外贸经营助手的主动提示生成器，只输出严格 JSON。',
    })) {
      if ('text' in ev) text += ev.text;
    }
    const obj = extractJsonObject(text);
    const category = typeof obj?.category === 'string' ? obj.category : '互动引导';
    const bubbleText = typeof obj?.text === 'string' ? obj.text.trim() : '';
    const action = typeof obj?.action === 'string' ? obj.action.trim() : '';
    const tone = typeof obj?.tone === 'string' ? obj.tone : 'guide';
    if (!bubbleText || !action) throw new Error('empty proactive tip');
    res.json({ category, text: bubbleText.slice(0, 80), action: action.slice(0, 160), tone });
  } catch {
    res.json({
      category: '互动引导',
      text: '我可以帮你把当前页面整理成下一步动作～',
      action: `基于当前「${pageLabel}」页面，帮我整理3个下一步动作`,
      tone: 'guide',
    });
  }
});

agentChatRouter.post('/:agentType/chat', async (req, res) => {
  const { agentType } = req.params;
  const { messages, deepThinking = false } = req.body as { messages: ChatMessage[]; deepThinking?: boolean };

  if (!messages?.length) { res.status(400).json({ error: 'messages required' }); return; }

  const basePrompt = SYSTEM_PROMPTS[agentType];
  if (!basePrompt) { res.status(404).json({ error: `Unknown agent: ${agentType}` }); return; }
  if (!await consumeDemoQuota(req, res, 'aiChat')) return;

  const enterpriseCtx = getEnterpriseContext();
  const requireSources = shouldRequireSources(messages);
  const systemPrompt = enterpriseCtx
    ? `${basePrompt}${requireSources ? '\n\n【联网来源硬规则】本轮涉及联网搜索/公开信息核验，必须使用联网检索结果，并通过 sources 事件返回可点击来源；如果无法取得来源，不要给出联网结论，改为说明需要重新检索。' : ''}\n\n【当前企业知识库】\n${enterpriseCtx}`
    : `${basePrompt}${requireSources ? '\n\n【联网来源硬规则】本轮涉及联网搜索/公开信息核验，必须使用联网检索结果，并通过 sources 事件返回可点击来源；如果无法取得来源，不要给出联网结论，改为说明需要重新检索。' : ''}`;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

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
