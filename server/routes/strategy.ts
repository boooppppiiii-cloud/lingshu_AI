import { Router } from 'express';
import { callLLM, callLLMChatStream, type ChatMessage } from '../agents/llm.js';
import { buildStrategyPrompt, type StrategyParams } from '../prompts/strategyPrompts.js';
import { enterpriseRouter as _er, buildEnterpriseContext } from './enterprise.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { consumeDemoQuota } from '../lib/demo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENTERPRISE_FILE = path.join(__dirname, '../../data/enterprise.json');

function getEnterpriseContext(): string {
  try {
    const profile = JSON.parse(fs.readFileSync(ENTERPRISE_FILE, 'utf8'));
    return buildEnterpriseContext(profile);
  } catch {
    return '';
  }
}

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
- 当缺少真实数据时，必须明确说出“当前缺少哪些数据，因此不能判断什么”，然后给出可执行的数据接入/核验清单；可以给方法和模板，但不能把假设写成事实。
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

strategyRouter.post('/chat', async (req, res) => {
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

  const enterpriseCtx = getEnterpriseContext();
  const requireSources = shouldRequireSources(messages);
  const systemPrompt = enterpriseCtx
    ? `${ADVISOR_SYSTEM_PROMPT}${requireSources ? '\n\n【联网来源硬规则】本轮涉及联网搜索/公开信息核验，必须使用联网检索结果，并通过 sources 事件返回可点击来源；如果无法取得来源，不要给出联网结论，改为说明需要重新检索。' : ''}\n\n【当前企业知识库】\n${enterpriseCtx}`
    : `${ADVISOR_SYSTEM_PROMPT}${requireSources ? '\n\n【联网来源硬规则】本轮涉及联网搜索/公开信息核验，必须使用联网检索结果，并通过 sources 事件返回可点击来源；如果无法取得来源，不要给出联网结论，改为说明需要重新检索。' : ''}`;

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
