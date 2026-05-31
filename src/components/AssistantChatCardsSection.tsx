import { useCallback, useEffect, useState } from 'react';
import { Bookmark, ChevronDown, Loader2, MessageCircle, Trash2, Upload } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { useToast } from '../lib/ToastContext';
import { useGameProfile } from '../lib/GameProfileContext';
import {
  ASSISTANT_CHAT_COLLECTION,
  countUserMessages,
  deleteAssistantChatCard,
  listAssistantChatCards,
  queueAssistantChatRestore,
  type AssistantChatCard,
} from '../lib/assistantChatCards';
import { VIEW_MODULE_LABELS } from '../lib/pageAssistantLabels';
import AssistantReplyMarkdown from './AssistantReplyMarkdown';
import type { ViewState } from '../types';

type AssistantChatCardsSectionProps = {
  onRequestLogin?: () => void;
};

function formatTime(iso: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function AssistantChatCardsSection({ onRequestLogin }: AssistantChatCardsSectionProps) {
  const { user } = useAuth();
  const { gameProfileId } = useGameProfile();
  const { showToast } = useToast();
  const [cards, setCards] = useState<AssistantChatCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) {
      setCards([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setCards(await listAssistantChatCards(user.uid, gameProfileId));
    } finally {
      setLoading(false);
    }
  }, [user, gameProfileId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDelete = async (card: AssistantChatCard) => {
    if (!user) return;
    if (!window.confirm(`删除对话卡片「${card.title}」？`)) return;
    try {
      await deleteAssistantChatCard(card.id, user.uid);
      setCards((prev) => prev.filter((c) => c.id !== card.id));
      if (expandedId === card.id) setExpandedId(null);
      showToast('已删除', 'success');
    } catch (e) {
      console.error(e);
      showToast('删除失败', 'error');
    }
  };

  const handleRestore = (card: AssistantChatCard) => {
    if (!user) return;
    queueAssistantChatRestore(user.uid, card);
    showToast('已载入对话，请打开侧栏 SA小三郎继续', 'success');
  };

  if (!user) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 p-6 text-center text-sm text-slate-500">
        登录后可查看与 SA小三郎保存的对话卡片
      </div>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest">SA小三郎对话</h3>
          <p className="mt-1 text-xs text-slate-500">
            在侧栏对话中点击「保存为卡片」后，会出现在此处（集合 <code className="text-[10px]">{ASSISTANT_CHAT_COLLECTION}</code>）
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="text-xs font-bold text-primary-blue hover:underline"
        >
          刷新
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-accent-blue" />
        </div>
      ) : cards.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center">
          <Bookmark className="mx-auto mb-3 h-10 w-10 text-slate-300" />
          <p className="text-sm font-medium text-slate-600">暂无保存的对话</p>
          <p className="mt-1 text-xs text-slate-400">在任意页面打开侧栏 SA小三郎，聊几句后点「保存为卡片」</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {cards.map((card) => {
            const expanded = expandedId === card.id;
            const userCount = countUserMessages(card.messages);
            const viewLabel = VIEW_MODULE_LABELS[card.activeView as ViewState] ?? card.activeView;
            const preview = card.messages.find((m) => m.role === 'user')?.text ?? card.messages[1]?.text ?? '';

            return (
              <article
                key={card.id}
                className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:border-accent-blue/30"
              >
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : card.id)}
                  className="flex flex-1 flex-col p-4 text-left"
                >
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <span className="inline-flex items-center gap-1 rounded-lg bg-accent-blue/10 px-2 py-0.5 text-[10px] font-bold text-primary-blue">
                      <MessageCircle className="h-3 w-3" />
                      {viewLabel}
                    </span>
                    <ChevronDown
                      className={`h-4 w-4 shrink-0 text-slate-400 transition ${expanded ? 'rotate-180' : ''}`}
                    />
                  </div>
                  <h4 className="line-clamp-2 text-sm font-bold leading-snug text-slate-800">{card.title}</h4>
                  <p className="mt-1 line-clamp-1 text-[11px] text-slate-500">{card.pageScope || '—'}</p>
                  <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-slate-600">{preview}</p>
                  <p className="mt-3 text-[10px] text-slate-400">
                    {userCount} 条提问 · {card.messages.length} 条消息 · {formatTime(card.updated)}
                  </p>
                </button>

                {expanded ? (
                  <div className="max-h-64 space-y-2 overflow-y-auto border-t border-slate-100 bg-slate-50/80 px-3 py-3">
                    {card.messages.map((m, i) => (
                      <div
                        key={i}
                        className={`rounded-lg px-2.5 py-2 text-[11px] leading-relaxed ${
                          m.role === 'user'
                            ? 'ml-3 bg-accent-blue text-white'
                            : 'mr-2 bg-white text-slate-700 border border-slate-100'
                        }`}
                      >
                        <span className="mb-0.5 block text-[9px] font-bold opacity-70">
                          {m.role === 'user' ? '我' : 'SA小三郎'}
                        </span>
                        {m.role === 'assistant' ? (
                          <AssistantReplyMarkdown text={m.text} />
                        ) : (
                          m.text
                        )}
                      </div>
                    ))}
                    {card.contextSummary.totalInScope > 0 ? (
                      <p className="text-[10px] text-slate-400">
                        保存时上下文：{card.contextSummary.totalInScope} 条素材，已分析{' '}
                        {card.contextSummary.withHookAnalysis} 条
                      </p>
                    ) : null}
                  </div>
                ) : null}

                <div className="flex border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => handleRestore(card)}
                    className="flex flex-1 items-center justify-center gap-1.5 py-2.5 text-[11px] font-bold text-primary-blue hover:bg-accent-blue/5"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    载入侧栏
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(card)}
                    className="flex flex-1 items-center justify-center gap-1.5 border-l border-slate-100 py-2.5 text-[11px] font-bold text-red-600 hover:bg-red-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    删除
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
