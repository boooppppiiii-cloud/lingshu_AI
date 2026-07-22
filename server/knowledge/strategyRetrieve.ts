import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { callLLM } from '../agents/llm.js';
import { store } from '../storage/index.js';
import type { ConversationTurn } from './retrieve.js';

export interface ResponseStrategy {
  id: string;
  scenario: string;
  signals: string[];
  intent: string;
  strategy: string[];
  examples: string[];
  risk_link: string;
  escalate: string;
}

interface StrategyMemoryRecord {
  id: string;
  tenant_id: string;
  strategy_id: string;
  adjustment: string;
  evidence_count: number | string;
  status: string;
  source?: string;
  scenario?: string;
  signals?: string[] | string;
  intent?: string;
  strategy_steps?: string[] | string;
  risk_link?: string;
  escalate?: string;
}

export interface RetrievedStrategy {
  strategy: ResponseStrategy;
  confidence: number;
  reason: string;
  method: 'semantic' | 'heuristic';
  learnedAdjustment?: string;
  learnedEvidenceCount?: number;
}

export interface StrategyRetrieveInput {
  latestMessage: string;
  conversation?: ConversationTurn[];
  stage?: string;
  intent?: string;
}

interface ScoredStrategy {
  strategy: ResponseStrategy;
  score: number;
  matchedSignals: string[];
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const strategyFile = path.join(__dirname, 'strategies.json');
const STRATEGIES = JSON.parse(fs.readFileSync(strategyFile, 'utf8')) as ResponseStrategy[];

if (!Array.isArray(STRATEGIES) || STRATEGIES.length === 0) {
  throw new Error('response_strategy_library_empty');
}

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function normalize(value: unknown): string {
  return text(value).normalize('NFKC').toLowerCase();
}

function conversationText(input: StrategyRetrieveInput): string {
  const turns = (input.conversation ?? [])
    .filter(turn => turn && (turn.role === 'buyer' || turn.role === 'seller') && text(turn.text))
    .slice(-8)
    .map(turn => `${turn.role}: ${text(turn.text).slice(0, 1000)}`);
  if (!turns.length || !normalize(turns.at(-1)).includes(normalize(input.latestMessage))) {
    turns.push(`buyer: ${text(input.latestMessage).slice(0, 1000)}`);
  }
  return turns.join('\n');
}

function phraseScore(haystack: string, signal: string): number {
  const phrase = normalize(signal);
  if (!phrase || !haystack.includes(phrase)) return 0;
  return Math.min(4, 1 + phrase.length / 8);
}

function rankStrategies(input: StrategyRetrieveInput, library: readonly ResponseStrategy[]): ScoredStrategy[] {
  const latest = normalize(input.latestMessage);
  const recent = normalize(conversationText(input));
  const metadata = normalize(`${input.stage ?? ''} ${input.intent ?? ''}`);
  return library.map(strategy => {
    const matchedSignals = strategy.signals.filter(signal => recent.includes(normalize(signal)));
    const latestScore = strategy.signals.reduce((sum, signal) => sum + phraseScore(latest, signal) * 2, 0);
    const contextScore = strategy.signals.reduce((sum, signal) => sum + phraseScore(recent, signal), 0);
    const metadataScore = strategy.signals.reduce((sum, signal) => sum + phraseScore(metadata, signal), 0);
    return { strategy, score: latestScore + contextScore + metadataScore, matchedSignals };
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.strategy.id.localeCompare(b.strategy.id));
}

export function rankResponseStrategies(input: StrategyRetrieveInput): ScoredStrategy[] {
  return rankStrategies(input, STRATEGIES);
}

function parseMatches(raw: string): Array<{ id: string; confidence: number; reason: string }> {
  const match = raw.replace(/```json|```/gi, '').match(/\{[\s\S]*\}/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]) as { matches?: Array<Record<string, unknown>> };
    return (parsed.matches ?? []).map(item => ({
      id: text(item.id),
      confidence: Math.max(0, Math.min(1, Number(item.confidence) || 0)),
      reason: text(item.reason).slice(0, 240),
    })).filter(item => item.id && item.confidence >= 0.62).slice(0, 2);
  } catch {
    return [];
  }
}

async function semanticMatches(input: StrategyRetrieveInput, candidates: ResponseStrategy[]) {
  const prompt = [
    'Identify the buyer conversation scenarios that match this response strategy library.',
    'Judge meaning from the latest message and recent conversation, including pronouns, negation, negotiation stage, and what has already happened.',
    'A shared keyword is not enough. Choose at most two strategies. Choose none when the situation is unclear or no strategy truly applies.',
    'Return strict JSON only: {"matches":[{"id":"S01","confidence":0.0,"reason":"short Chinese reason"}]}.',
    'Use confidence >= 0.62 only for a meaningful match.',
    '',
    `Stage: ${text(input.stage) || 'unknown'}`,
    `Draft intent: ${text(input.intent) || 'reply'}`,
    'Recent conversation:',
    conversationText(input),
    '',
    'Candidate strategies:',
    candidates.map(item => [
      `${item.id} | ${item.scenario}`,
      `Buyer intent: ${item.intent}`,
      `Signals: ${item.signals.join(' / ')}`,
    ].join('\n')).join('\n\n'),
  ].join('\n');
  const raw = await callLLM(prompt, {
    backend: 'qwen',
    model: process.env.STRATEGY_MATCH_MODEL || process.env.KNOWLEDGE_QUERY_MODEL || 'qwen-plus',
  });
  return parseMatches(raw);
}

function jsonStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(text).filter(Boolean) : [];
  } catch {
    return [];
  }
}

async function tenantStrategyMemory(tenantId: string): Promise<StrategyMemoryRecord[]> {
  const result = await store.list<StrategyMemoryRecord>('response_strategy_memory', {
    where: { tenant_id: tenantId, status: 'active' },
    sort: '-updated',
    perPage: 100,
  });
  return result.items;
}

function customStrategies(records: StrategyMemoryRecord[]): ResponseStrategy[] {
  return records.flatMap(item => {
    const signals = jsonStringArray(item.signals);
    const steps = jsonStringArray(item.strategy_steps);
    const evidenceCount = Number(item.evidence_count || 0);
    if (item.source !== 'learned_custom' || evidenceCount < 5 || !text(item.scenario) || signals.length < 2 || steps.length < 2) return [];
    return [{
      id: text(item.strategy_id),
      scenario: text(item.scenario),
      signals,
      intent: text(item.intent),
      strategy: steps,
      examples: [],
      risk_link: text(item.risk_link) || 'L3',
      escalate: text(item.escalate),
    }];
  });
}

function attachTenantMemory(records: StrategyMemoryRecord[], matches: RetrievedStrategy[]): RetrievedStrategy[] {
  const byStrategy = new Map(records.map(item => [text(item.strategy_id), item]));
  return matches.map(match => {
    const memory = byStrategy.get(match.strategy.id);
    const evidenceCount = Number(memory?.evidence_count || 0);
    if (!memory?.adjustment || evidenceCount < 5) return match;
    return {
      ...match,
      learnedAdjustment: text(memory.adjustment),
      learnedEvidenceCount: evidenceCount,
    };
  });
}

export async function retrieveResponseStrategies(tenantId: string, input: StrategyRetrieveInput): Promise<RetrievedStrategy[]> {
  let memoryRecords: StrategyMemoryRecord[] = [];
  try {
    memoryRecords = await tenantStrategyMemory(tenantId);
  } catch {
    // Built-in strategies remain available while tenant memory storage is unavailable.
  }
  const learned = customStrategies(memoryRecords);
  const library = [...STRATEGIES, ...learned];
  const ranked = rankStrategies(input, library);
  const candidates = (ranked.length
    ? ranked.slice(0, 10).map(item => item.strategy)
    : [...learned, ...STRATEGIES]).slice(0, 24);
  let matches: RetrievedStrategy[] = [];
  try {
    const judged = await semanticMatches(input, candidates);
    matches = judged.flatMap(item => {
      const strategy = library.find(candidate => candidate.id === item.id);
      return strategy
        ? [{ strategy, confidence: item.confidence, reason: item.reason, method: 'semantic' as const }]
        : [];
    });
  } catch {
    // The deterministic fallback keeps draft generation available if semantic matching is temporarily unavailable.
  }
  if (!matches.length && ranked.length) {
    const top = ranked[0];
    const clearSecond = ranked[1] && ranked[1].score >= top.score * 0.8 ? ranked[1] : null;
    matches = [top, clearSecond].filter((item): item is ScoredStrategy => Boolean(item)).map(item => ({
      strategy: item.strategy,
      confidence: Math.min(0.78, 0.55 + item.score / 40),
      reason: `规则信号命中：${item.matchedSignals.slice(0, 3).join('、')}`,
      method: 'heuristic',
    }));
  }
  return attachTenantMemory(memoryRecords, matches);
}

export function buildStrategyPromptBlock(matches: RetrievedStrategy[]): string {
  if (!matches.length) return '';
  return [
    'Response strategy layer (dialogue tactics, not business facts):',
    'Mandatory precedence: current redline rules and enterprise knowledge > response strategy > seller style memory.',
    'Use strategies to decide how to ask, explain, negotiate, follow up, or hand off. Never treat a strategy or its examples as evidence for price, discount, MOQ, inventory, certification, payment, shipping, lead time, capability, or any other company fact.',
    'Never copy numbers or company claims from strategy examples. If a strategy conflicts with current enterprise facts or redline rules, ignore the conflicting strategy instruction.',
    ...matches.map((match, index) => [
      `Matched strategy ${index + 1}: ${match.strategy.id} ${match.strategy.scenario} (confidence=${match.confidence.toFixed(2)})`,
      `Why matched: ${match.reason}`,
      `Buyer intent: ${match.strategy.intent}`,
      `Tactics: ${match.strategy.strategy.join('；')}`,
      `Risk link: ${match.strategy.risk_link}`,
      match.strategy.escalate ? `Handoff condition: ${match.strategy.escalate}` : '',
      match.strategy.examples.length ? `Wording references only: ${match.strategy.examples.join(' | ')}` : '',
      match.learnedAdjustment
        ? `Tenant preference learned from ${match.learnedEvidenceCount} real edited replies: ${match.learnedAdjustment}`
        : '',
    ].filter(Boolean).join('\n')),
  ].join('\n');
}

export function strategyEvidence(matches: RetrievedStrategy[]): string[] {
  return matches.map(match => `情境策略：${match.strategy.id} ${match.strategy.scenario}（${match.reason}）`);
}

export function responseStrategyLibrary(): readonly ResponseStrategy[] {
  return STRATEGIES;
}
