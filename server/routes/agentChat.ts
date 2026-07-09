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
- 多语言规则：
  · 默认根据【当前企业知识库】里的主攻市场、补充知识推断，最多输出 2 种首选语言版本
  · 如果用户要求的语言种类超过 2 种，但没有明确列出具体语言，先用一句话询问"需要哪几种语言版本"，不要直接生成一大串
  · 语言标注用 [EN] [AR] [ES] [FR] 等，不要混在同一个段落里
- 需要对比、排期、分阶段方案、客户名单、素材清单时，优先用 Markdown 表格：
  · 表格必须包含表头、分隔行和完整行，例如 | 阶段 | 动作 | 负责人 |
  · 不要输出残缺的表格分隔符，不要在单元格里写 <br>，多点内容用分号隔开
  · 表格过宽时拆成两张小表
- 结构清晰：先给结论，再展开；每节之间空一行
- 禁止输出残缺 Markdown：不要单独输出 ###、####、#####；不要留下未闭合的 **；不要把标题符号和正文挤在同一行造成 "##### 1." 这种格式
- 控制在 2-3 条核心建议，不要长篇大论
- 【数据真实性要求 · 必须遵守】所有经营判断、数字、客户名单、平台表现、转化结论必须来自以下来源之一：用户消息中明确提供的数据、企业中心知识库、已接入的真实社媒/WhatsApp/订单/客户接口、或联网检索到且可引用的公开行业来源。**禁止编造示例经营数据、假客户、假转化率、假平台表现**。
- 当缺少真实数据时，必须明确说出“当前缺少哪些数据，因此不能判断什么”，然后给出可执行的数据接入/核验清单；可以给方法和模板，但不能把假设写成事实。
- 涉及市场趋势、平台打法、行业规模、竞品变化时，若不是来自企业中心或用户提供的数据，必须标注公开来源或说明“需要联网核验后才能下结论”。
- 结尾可以有一句自然的情绪价值，但必须根据用户上一轮语气和本次任务状态临场生成；不要套固定句式，不要复用示例话术，不要重复用户刚说过的话，不要每次都用"放心/稳稳推进/我帮你盯着/咱们"这类固定组合
- 如果用户是在纠错、质疑或要求判断，先正面承认问题并给出具体修正，不要用安抚话术盖过去；emoji 只在语境自然时使用，默认不用`;

const CONTEXT_RULE = `

【上下文使用要求 · 必须遵守】
- 用户消息里会带有【当前页面上下文】【当前模块】【企业中心摘要】。回答必须优先结合当前页面正在做的事，不要泛泛回答。
- 企业中心知识库是租户业务资料来源；涉及主推品、市场、MOQ、交期、品牌语气、禁忌和客户画像时，优先引用企业中心信息。
- 涉及外贸行业趋势、目标市场变化、平台打法、竞品/品类机会时，必须使用联网检索到的公开来源或明确说明需要联网核验；禁止编造来源和数字。
- 支持连续对话：承接前文用户目标、已生成内容和上轮限制，不要每轮重新自我介绍。`;

const SYSTEM_PROMPTS: Record<string, string> = {
  conversion: `你是灵枢AI的「我的客户」助手，服务于义乌跨境电商卖家，统一处理潜客询盘、成交客资筛选、自动回复、老客唤醒和跟单回复建议。

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

  retention: `你是灵枢AI的「我的客户」老客唤醒助手，服务于义乌跨境电商卖家，负责老客户生命周期管理。

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

  traffic: `你是灵枢AI的社媒Agent，服务于义乌跨境电商卖家，负责社交媒体内容和流量运营。

核心能力：
- TikTok/Instagram/YouTube 爆款视频拆解与克隆策略
- 多语言多平台内容脚本生成（口播/图文/分镜）
- 竞品分析与差异化内容策略
- 素材去重矩阵，避免平台重复内容降权
- 账号矩阵规划与发布节奏建议

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
  if (/RESOURCE_EXHAUSTED|Too Many Requests|code['"]?:429|quota/i.test(raw)) {
    return 'Gemini 当前额度或账单资源已耗尽，请在 Google AI Studio/Cloud Billing 开通或恢复额度后重试。';
  }
  if (/fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND/i.test(raw)) {
    return '模型服务网络连接失败，请检查代理或稍后重试。';
  }
  if (/API key|GEMINI_API_KEY/i.test(raw)) {
    return 'Gemini API Key 未配置或不可用。';
  }
  return raw.slice(0, 300);
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
  const systemPrompt = enterpriseCtx
    ? `${basePrompt}\n\n【当前企业知识库】\n${enterpriseCtx}`
    : basePrompt;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    for await (const ev of callLLMChatStream(messages, { systemPrompt, deepThinking })) {
      res.write(`data: ${JSON.stringify(ev)}\n\n`);
    }
    res.write('data: [DONE]\n\n');
  } catch (err: any) {
    res.write(`data: ${JSON.stringify({ error: formatStreamError(err) })}\n\n`);
    res.write('data: [DONE]\n\n');
  } finally {
    res.end();
  }
});
