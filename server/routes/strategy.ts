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

const ADVISOR_SYSTEM_PROMPT = `你是灵枢AI的顾问Agent（策略编排层），服务于义乌跨境电商卖家。

核心能力：
- 分析跨境电商经营数据，给出清晰的策略建议
- 协调流量专家（社媒）、转化专家（客服）、留存专家（CRM）的协同工作
- 识别"行动建议"机会：从买家询盘/偏好反推选品与运营方向
- 熟悉主流海外平台：TikTok Shop、亚马逊、Shopify独立站、WhatsApp/Instagram私域

回复风格：
- 简洁、专业，结论先行
- 用中文回复，专有名词可保留英文
- 给出 2-3 条具体可执行的行动建议，而非泛泛而谈
- 【重要】不要反问索取数据、也不要只讲通用原理；消息里给了数据就直接用，没给就用合理示例数据，直接给可落地的具体结果
- 【关键】每条行动建议结尾，单独一行写明派发指令，格式严格为：建议触发 [流量专家/转化专家/留存专家] 执行：[一句话具体任务]
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
建议触发 [流量专家] 执行：按"斋月家居场景"方向产出 5 条阿拉伯语 TikTok 短视频

### 2. 大单询盘优先承接
礼品类常出现批量采购，**响应速度**直接决定成交。
建议触发 [转化专家] 执行：为礼品类大单配置阿语自动首响话术

收尾用一句贴合当前任务的自然话，不要照抄这里。`;


export const strategyRouter = Router();

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
  const systemPrompt = enterpriseCtx
    ? `${ADVISOR_SYSTEM_PROMPT}\n\n【当前企业知识库】\n${enterpriseCtx}`
    : ADVISOR_SYSTEM_PROMPT;

  try {
    for await (const ev of callLLMChatStream(messages, { systemPrompt, deepThinking })) {
      res.write(`data: ${JSON.stringify(ev)}\n\n`);
    }
    res.write('data: [DONE]\n\n');
  } catch (err: any) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
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
