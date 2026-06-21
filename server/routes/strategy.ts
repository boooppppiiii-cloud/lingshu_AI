import { Router } from 'express';
import { callLLM, callLLMChatStream, type ChatMessage } from '../agents/llm.js';
import { buildStrategyPrompt, type StrategyParams } from '../prompts/strategyPrompts.js';
import { enterpriseRouter as _er, buildEnterpriseContext } from './enterprise.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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
- 协调社媒Agent（流量）、客服Agent（转化）、CRM Agent（留存）的协同工作
- 识别"反向推品"机会：从买家询盘/偏好反推选品方向
- 熟悉主流海外平台：TikTok Shop、亚马逊、Shopify独立站、WhatsApp/Instagram私域

回复风格：
- 简洁、专业，用数字序号分点说明
- 用中文回复，专有名词可保留英文
- 给出具体可执行的建议，而非泛泛而谈
- 如需协调其他Agent，明确说明"建议触发 [Agent名] 执行：[具体任务]"

【输出格式要求】
- 禁止使用 Markdown 符号：不用 #、##、**、*、---、\`\`\` 等
- 用数字序号（1. 2. 3.）或顿号替代列表符号
- 段落之间空一行，重点用【】或⚠️标注
- 保持简洁，不废话`;


export const strategyRouter = Router();

strategyRouter.post('/chat', async (req, res) => {
  const { messages } = req.body as { messages: ChatMessage[] };
  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: 'messages required' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const enterpriseCtx = getEnterpriseContext();
  const systemPrompt = enterpriseCtx
    ? `${ADVISOR_SYSTEM_PROMPT}\n\n【当前企业知识库】\n${enterpriseCtx}`
    : ADVISOR_SYSTEM_PROMPT;

  try {
    for await (const chunk of callLLMChatStream(messages, { systemPrompt })) {
      res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
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
