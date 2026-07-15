import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { callLLM } from '../agents/llm.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INTERACTIONS_FILE = path.join(__dirname, '../../data/whatsapp-interactions.json');

interface MissInteraction {
  id: string;
  body?: string;
  timestamp?: number;
  audit?: {
    knowledgeMiss?: boolean;
    buyerMessage?: string;
  };
  meta?: {
    knowledgeMiss?: boolean;
    buyerMessage?: string;
  };
}

export interface KnowledgeMissCluster {
  topic: string;
  count: number;
  examples: string[];
}

function readMisses(): MissInteraction[] {
  try {
    const raw = JSON.parse(fs.readFileSync(INTERACTIONS_FILE, 'utf8')) as MissInteraction[];
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function normalizeExample(item: MissInteraction): string {
  return String(item.meta?.buyerMessage || item.audit?.buyerMessage || item.body || '').trim();
}

function fallbackTopic(example: string): string {
  const text = example.toLowerCase();
  if (/halal|certificate|certification|认证|证书/.test(text)) return '产品认证';
  if (/sample|样品/.test(text)) return '样品政策';
  if (/shipping|freight|delivery|运费|物流/.test(text)) return '物流运费';
  if (/payment|deposit|付款|定金/.test(text)) return '付款条款';
  return example.replace(/\s+/g, ' ').slice(0, 18) || '未覆盖问题';
}

function fallbackCluster(examples: string[]): KnowledgeMissCluster[] {
  const groups = new Map<string, string[]>();
  for (const example of examples) {
    const topic = fallbackTopic(example);
    groups.set(topic, [...(groups.get(topic) ?? []), example]);
  }
  return [...groups.entries()]
    .map(([topic, items]) => ({ topic, count: items.length, examples: items.slice(0, 2) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);
}

function parseClusters(raw: string): KnowledgeMissCluster[] {
  const match = raw.match(/\[[\s\S]*]/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]) as KnowledgeMissCluster[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map(item => ({
      topic: String(item.topic || '').trim(),
      count: Number(item.count || 0),
      examples: Array.isArray(item.examples) ? item.examples.map(String).filter(Boolean).slice(0, 2) : [],
    })).filter(item => item.topic && item.count > 0).slice(0, 3);
  } catch {
    return [];
  }
}

export async function aggregateKnowledgeMisses(days = 7): Promise<KnowledgeMissCluster[]> {
  const since = Date.now() - days * 86_400_000;
  const examples = readMisses()
    .filter(item => (item.meta?.knowledgeMiss || item.audit?.knowledgeMiss) && Number(item.timestamp || 0) >= since)
    .map(normalizeExample)
    .filter(Boolean);
  if (!examples.length) return [];
  try {
    const raw = await callLLM([
      '把这些客户原话按知识库缺口主题聚类。',
      '只返回 JSON 数组，格式：{"topic":"主题短语","count":数字,"examples":["原话1","原话2"]}。',
      '取出现次数最多的 top3，每个主题保留 2 条原话示例。',
      examples.map((item, index) => `${index + 1}. ${item}`).join('\n'),
    ].join('\n'), { backend: 'qwen', model: process.env.KNOWLEDGE_QUERY_MODEL || 'qwen-plus' });
    return parseClusters(raw).length ? parseClusters(raw) : fallbackCluster(examples);
  } catch {
    return fallbackCluster(examples);
  }
}
