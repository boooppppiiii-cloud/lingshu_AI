/**
 * SA小三郎对话卡片（个人中心）
 *
 * PocketBase 集合 `assistant_chat_cards`（未建时自动 localStorage 兜底）：
 * - userId (text) · gameProfileId (text) · activeView (text)
 * - title (text) · pageScope (text)
 * - pageMetaJson (json/text) · messagesJson (json/text) · contextSummaryJson (json/text)
 * API Rules：仅本人 userId 可 list/create/delete
 */
import type {
  BuyingPageAssistantContext,
  BuyingPageAssistantMessage,
  BuyingPageAssistantPageMeta,
} from './buyingPageAssistantContext';
import type { GameProfileId, ViewState } from '../types';
import { pb } from './pb';
import type { RecordModel } from 'pocketbase';

export const ASSISTANT_CHAT_COLLECTION = 'assistant_chat_cards';

export type AssistantChatContextSummary = {
  page: BuyingPageAssistantPageMeta;
  totalInScope: number;
  withHookAnalysis: number;
  hookTypeCounts: Record<string, number>;
  genreTagCounts: Record<string, number>;
};

export type AssistantChatCard = {
  id: string;
  userId: string;
  gameProfileId: GameProfileId;
  activeView: ViewState;
  title: string;
  pageScope: string;
  messages: BuyingPageAssistantMessage[];
  contextSummary: AssistantChatContextSummary;
  created: string;
  updated: string;
};

const RESTORE_KEY_PREFIX = 'assistant_chat_restore_';

/** 侧栏 bot 已挂载时，个人中心「载入侧栏」通过此事件触发恢复 */
export const ASSISTANT_CHAT_RESTORE_EVENT = 'lingqi:assistant-chat-restore';

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw.trim()) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function buildContextSummary(context: BuyingPageAssistantContext): AssistantChatContextSummary {
  return {
    page: context.page,
    totalInScope: context.totalInScope,
    withHookAnalysis: context.withHookAnalysis,
    hookTypeCounts: { ...context.hookTypeCounts },
    genreTagCounts: { ...context.genreTagCounts },
  };
}

export function buildAssistantChatTitle(
  messages: BuyingPageAssistantMessage[],
  pageScope: string,
): string {
  const firstUser = messages.find((m) => m.role === 'user')?.text.trim();
  const base = firstUser ? firstUser.replace(/\s+/g, ' ').slice(0, 40) : '与 SA小三郎的对话';
  const scope = pageScope.split('·')[0]?.trim() ?? '';
  return scope ? `${base} · ${scope}`.slice(0, 64) : base;
}

export function recordToAssistantChatCard(r: RecordModel): AssistantChatCard {
  const page = parseJson<BuyingPageAssistantPageMeta>(r.pageMetaJson, {
    mode: 'ranking',
    gameProfileLabel: '',
    scopeNote: '',
  });
  const messages = parseJson<BuyingPageAssistantMessage[]>(r.messagesJson, []);
  const contextSummary = parseJson<AssistantChatContextSummary>(r.contextSummaryJson, {
    page,
    totalInScope: 0,
    withHookAnalysis: 0,
    hookTypeCounts: {},
    genreTagCounts: {},
  });
  return {
    id: r.id,
    userId: String(r.userId ?? ''),
    gameProfileId: (String(r.gameProfileId ?? 'flower') as GameProfileId) || 'flower',
    activeView: (String(r.activeView ?? 'buying_dashboard') as ViewState) || 'buying_dashboard',
    title: String(r.title ?? '对话记录').trim() || '对话记录',
    pageScope: page.scopeNote || String(r.pageScope ?? ''),
    messages: Array.isArray(messages) ? messages : [],
    contextSummary,
    created: String(r.created ?? ''),
    updated: String(r.updated ?? r.created ?? ''),
  };
}

export async function listAssistantChatCards(
  userId: string,
  gameProfileId: GameProfileId,
): Promise<AssistantChatCard[]> {
  try {
    const records = await pb.collection(ASSISTANT_CHAT_COLLECTION).getFullList({
      filter: `userId = ${JSON.stringify(userId)} && gameProfileId = ${JSON.stringify(gameProfileId)}`,
      sort: '-updated',
    });
    return records.map(recordToAssistantChatCard);
  } catch (e) {
    console.warn('listAssistantChatCards failed', e);
    return listAssistantChatCardsLocal(userId, gameProfileId);
  }
}

export async function saveAssistantChatCard(input: {
  userId: string;
  gameProfileId: GameProfileId;
  activeView: ViewState;
  title: string;
  messages: BuyingPageAssistantMessage[];
  context: BuyingPageAssistantContext;
}): Promise<AssistantChatCard> {
  const pageScope = input.context.page.scopeNote;
  const body = {
    userId: input.userId,
    gameProfileId: input.gameProfileId,
    activeView: input.activeView,
    title: input.title.trim() || buildAssistantChatTitle(input.messages, pageScope),
    pageScope,
    pageMetaJson: JSON.stringify(input.context.page),
    messagesJson: JSON.stringify(input.messages),
    contextSummaryJson: JSON.stringify(buildContextSummary(input.context)),
  };
  try {
    const record = await pb.collection(ASSISTANT_CHAT_COLLECTION).create(body);
    return recordToAssistantChatCard(record);
  } catch (e) {
    console.warn('saveAssistantChatCard PocketBase failed, using localStorage', e);
    return saveAssistantChatCardLocal(body);
  }
}

export async function deleteAssistantChatCard(id: string, userId: string): Promise<void> {
  try {
    await pb.collection(ASSISTANT_CHAT_COLLECTION).delete(id);
  } catch {
    /* local */
  }
  deleteAssistantChatCardLocal(id, userId);
}

export function queueAssistantChatRestore(userId: string, card: AssistantChatCard): void {
  sessionStorage.setItem(
    `${RESTORE_KEY_PREFIX}${userId}`,
    JSON.stringify({ messages: card.messages, title: card.title }),
  );
  window.dispatchEvent(
    new CustomEvent(ASSISTANT_CHAT_RESTORE_EVENT, { detail: { userId } }),
  );
}

export function consumeAssistantChatRestore(
  userId: string,
): { messages: BuyingPageAssistantMessage[]; title: string } | null {
  const key = `${RESTORE_KEY_PREFIX}${userId}`;
  const raw = sessionStorage.getItem(key);
  if (!raw) return null;
  sessionStorage.removeItem(key);
  try {
    const v = JSON.parse(raw) as { messages?: BuyingPageAssistantMessage[]; title?: string };
    if (!Array.isArray(v.messages) || !v.messages.length) return null;
    return { messages: v.messages, title: String(v.title ?? '') };
  } catch {
    return null;
  }
}

/* —— localStorage 兜底（未建 PocketBase 集合时） —— */

type LocalCard = Omit<AssistantChatCard, 'id' | 'created' | 'updated'> & {
  id: string;
  created: string;
  updated: string;
};

function localKey(userId: string) {
  return `assistant_chat_cards_${userId}`;
}

function readLocalAll(userId: string): LocalCard[] {
  try {
    const raw = localStorage.getItem(localKey(userId));
    if (!raw) return [];
    const arr = JSON.parse(raw) as LocalCard[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeLocalAll(userId: string, cards: LocalCard[]) {
  localStorage.setItem(localKey(userId), JSON.stringify(cards));
}

function listAssistantChatCardsLocal(userId: string, gameProfileId: GameProfileId): AssistantChatCard[] {
  return readLocalAll(userId)
    .filter((c) => c.gameProfileId === gameProfileId)
    .sort((a, b) => b.updated.localeCompare(a.updated));
}

function saveAssistantChatCardLocal(body: Record<string, string>): AssistantChatCard {
  const userId = body.userId;
  const now = new Date().toISOString();
  const card: LocalCard = {
    id: `local_${Date.now()}`,
    userId,
    gameProfileId: body.gameProfileId as GameProfileId,
    activeView: body.activeView as ViewState,
    title: body.title,
    pageScope: body.pageScope,
    messages: parseJson(body.messagesJson, []),
    contextSummary: parseJson(body.contextSummaryJson, {
      page: parseJson(body.pageMetaJson, { mode: 'ranking', gameProfileLabel: '', scopeNote: '' }),
      totalInScope: 0,
      withHookAnalysis: 0,
      hookTypeCounts: {},
      genreTagCounts: {},
    }),
    created: now,
    updated: now,
  };
  const all = readLocalAll(userId);
  all.unshift(card);
  writeLocalAll(userId, all);
  return card;
}

function deleteAssistantChatCardLocal(id: string, userId: string) {
  writeLocalAll(
    userId,
    readLocalAll(userId).filter((c) => c.id !== id),
  );
}

export function countUserMessages(messages: BuyingPageAssistantMessage[]): number {
  return messages.filter((m) => m.role === 'user').length;
}
