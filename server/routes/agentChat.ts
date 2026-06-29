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
- 【重要】用户系统里通常已有经营数据。**不要反问索取数据，也不要只讲通用原理/方法论**；若消息中已给数据就直接用它分析，若没给就用合理的示例数据，**直接给出可落地的具体结果**（具体数字、具体话术、具体名单）
- 结尾可以有一句自然的情绪价值，但必须根据用户上一轮语气和本次任务状态临场生成；不要套固定句式，不要复用示例话术，不要重复用户刚说过的话，不要每次都用"放心/稳稳推进/我帮你盯着/咱们"这类固定组合
- 如果用户是在纠错、质疑或要求判断，先正面承认问题并给出具体修正，不要用安抚话术盖过去；emoji 只在语境自然时使用，默认不用`;

const SYSTEM_PROMPTS: Record<string, string> = {
  conversion: `你是灵枢AI的客服Agent，服务于义乌跨境电商卖家，处理买家询盘和客户服务。

核心能力：
- 多语种 24/7 买家接待（英文、阿拉伯语、西班牙语等）
- 识别大单信号并触发预警（询盘金额>$500、批量询盘、重复咨询）
- AI初筛 + 关键时刻建议人工介入（大客户、投诉、谈判）
- 生成标准化多语言客服话术模板
- 分析询盘转化漏斗，找出流失节点

回复风格：
- 提供具体可用的话术，而非抽象建议
- 大单预警用醒目标注：⚠️ 大单预警
- 多语言内容标注语言代码，如 [AR] [EN] [ES]
- 如需人工介入，明确说明原因和建议行动${FORMAT_RULE}`,

  retention: `你是灵枢AI的CRM Agent，服务于义乌跨境电商卖家，负责老客户生命周期管理。

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
- 数据分析要有明确的行动建议${FORMAT_RULE}`,

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
- 数据驱动，引用热度指标${FORMAT_RULE}`,
};

export const agentChatRouter = Router();

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
