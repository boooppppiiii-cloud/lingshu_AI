import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { Bookmark, Loader2, Maximize2, MessageCircle, Minimize2, Send, X } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { useGameProfile } from '../lib/GameProfileContext';
import { GAME_PROFILE_OPTIONS } from '../lib/gameProfiles';
import type {
  BuyingPageAssistantContext,
  BuyingPageAssistantMessage,
  BuyingPageAssistantPageMeta,
} from '../lib/buyingPageAssistantContext';
import { viewModuleSuggestions, viewModuleWelcome } from '../lib/pageAssistantLabels';
import { usePageAssistantHasBuyingData } from '../lib/PageAssistantContext';
import {
  ASSISTANT_CHAT_RESTORE_EVENT,
  buildAssistantChatTitle,
  consumeAssistantChatRestore,
  countUserMessages,
  saveAssistantChatCard,
} from '../lib/assistantChatCards';
import { useToast } from '../lib/ToastContext';
import { useAssistantAvatar } from '../lib/AssistantAvatarContext';
import AssistantReplyMarkdown from './AssistantReplyMarkdown';
import SanBotAvatar from './SanBotAvatar';
import { nextFleeOffset, type FleeOffset } from '../lib/sanBotFlee';
import { geminiService } from '../services/gemini';
import type { ViewState } from '../types';

type BuyingPageAssistantBotProps = {
  context: BuyingPageAssistantContext;
  activeView: ViewState;
};

export default function BuyingPageAssistantBot({ context, activeView }: BuyingPageAssistantBotProps) {
  const { user } = useAuth();
  const { gameProfileId } = useGameProfile();
  const { showToast } = useToast();
  const { avatar } = useAssistantAvatar();
  const hasBuyingData = usePageAssistantHasBuyingData(activeView);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [waving, setWaving] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [savingCard, setSavingCard] = useState(false);
  const [fleeOffset, setFleeOffset] = useState<FleeOffset>({ x: 0, y: 0 });
  const [lastUsedWebSearch, setLastUsedWebSearch] = useState(false);
  const botShellRef = useRef<HTMLDivElement>(null);
  const fleeResetTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const suggestions = useMemo(() => viewModuleSuggestions(activeView), [activeView]);

  const welcomeText = useMemo(
    () => viewModuleWelcome(activeView, hasBuyingData),
    [activeView, hasBuyingData],
  );

  const [messages, setMessages] = useState<BuyingPageAssistantMessage[]>([
    { role: 'assistant', text: welcomeText },
  ]);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages([{ role: 'assistant', text: welcomeText }]);
    setOpen(false);
    setExpanded(false);
    setInput('');
  }, [activeView, welcomeText]);

  useEffect(() => {
    if (!user) return;
    const tryRestore = () => {
      const restored = consumeAssistantChatRestore(user.uid);
      if (restored) {
        setMessages(restored.messages);
        setOpen(true);
        showToast(
          restored.title ? `已载入：${restored.title.slice(0, 24)}…` : '已从个人中心载入对话',
          'success',
        );
      }
    };
    tryRestore();
    const onRestore = (e: Event) => {
      const uid = (e as CustomEvent<{ userId?: string }>).detail?.userId;
      if (!uid || uid === user.uid) tryRestore();
    };
    window.addEventListener(ASSISTANT_CHAT_RESTORE_EVENT, onRestore);
    return () => window.removeEventListener(ASSISTANT_CHAT_RESTORE_EVENT, onRestore);
  }, [user, showToast]);

  useEffect(() => {
    const tick = () => {
      if (!open && Math.random() < 0.22) {
        setWaving(true);
        window.setTimeout(() => setWaving(false), 1000);
      }
    };
    const id = window.setInterval(tick, 7000);
    return () => window.clearInterval(id);
  }, [open]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  useEffect(() => {
    return () => {
      if (fleeResetTimerRef.current) clearTimeout(fleeResetTimerRef.current);
    };
  }, []);

  const handleRightHandFlee = useCallback((e: PointerEvent<SVGCircleElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const shell = botShellRef.current;
    if (!shell) return;
    const rect = shell.getBoundingClientRect();
    const botCenter = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
    setFleeOffset((prev) => nextFleeOffset(botCenter, { x: e.clientX, y: e.clientY }, prev));
    setWaving(true);
    window.setTimeout(() => setWaving(false), 700);
    if (fleeResetTimerRef.current) clearTimeout(fleeResetTimerRef.current);
    fleeResetTimerRef.current = window.setTimeout(() => setFleeOffset({ x: 0, y: 0 }), 3000);
  }, []);

  const isFleeing = fleeOffset.x !== 0 || fleeOffset.y !== 0;

  const sendQuestion = useCallback(
    async (text: string) => {
      const q = text.trim();
      if (!q || busy) return;
      if (!user) {
        setMessages((prev) => [
          ...prev,
          { role: 'user', text: q },
          { role: 'assistant', text: '请先登录后再问我哦～' },
        ]);
        return;
      }

      const history = messages.filter((m) => m.role === 'user' || m.role === 'assistant');
      setMessages((prev) => [...prev, { role: 'user', text: q }]);
      setInput('');
      setBusy(true);
      setWaving(true);

      try {
        const { reply, usedWebSearch } = await geminiService.askBuyingPageAssistant(q, context, history, {
          analyticsUserId: user.uid,
          gameProfileId,
        });
        setLastUsedWebSearch(Boolean(usedWebSearch));
        setMessages((prev) => [...prev, { role: 'assistant', text: reply }]);
      } catch (e) {
        const raw = e instanceof Error ? e.message : '请求失败';
        const msg = /invalid or unknown op/i.test(raw)
          ? 'AI 接口版本过旧，请在服务器执行：pm2 restart lingqi-dev-api（或重新 npm run dev）'
          : raw;
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', text: `呜呜，我卡住了：${msg.slice(0, 160)}` },
        ]);
      } finally {
        setBusy(false);
        setWaving(false);
      }
    },
    [busy, context, gameProfileId, messages, user],
  );

  const canSaveCard = Boolean(user) && countUserMessages(messages) > 0;

  const handleSaveCard = useCallback(async () => {
    if (!user || savingCard || !canSaveCard) return;
    setSavingCard(true);
    try {
      const title = buildAssistantChatTitle(messages, context.page.scopeNote);
      await saveAssistantChatCard({
        userId: user.uid,
        gameProfileId,
        activeView,
        title,
        messages,
        context,
      });
      showToast('对话已保存到个人中心', 'success');
    } catch (e) {
      console.error(e);
      showToast(e instanceof Error ? e.message : '保存失败', 'error');
    } finally {
      setSavingCard(false);
    }
  }, [activeView, canSaveCard, context, gameProfileId, messages, savingCard, showToast, user]);

  const footerNote = (() => {
    const scope =
      context.totalInScope > 0
        ? `本页 ${context.totalInScope} 条素材 · 已分析 ${context.withHookAnalysis} 条`
        : `当前模块 · ${context.page.scopeNote.split('·')[0]?.trim() ?? '—'}`;
    const sources = lastUsedWebSearch
      ? '本页数据 + 联网检索 + 模型经验'
      : '本页数据 + 模型经验（必要时可联网）';
    return `${scope} · ${sources}`;
  })();

  return (
    <div className="relative mt-3 w-full shrink-0 overflow-visible">
      {open ? (
        <div
          className={
            expanded
              ? 'fixed bottom-6 left-6 z-[60] w-[min(28rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl'
              : 'absolute bottom-full left-0 right-0 z-50 mb-2 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl'
          }
        >
          <div className="flex items-center justify-between border-b border-slate-100 bg-gradient-to-r from-accent-blue/15 to-sky-50 px-3 py-2">
            <span className="text-xs font-black text-primary-blue">SA小三郎 · 素材参谋</span>
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="rounded-lg p-1 text-slate-500 hover:bg-slate-100"
                aria-label={expanded ? '收起延展面板' : '延展面板'}
              >
                {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </button>
              <button
                type="button"
                onClick={() => {
                  setExpanded(false);
                  setOpen(false);
                }}
                className="rounded-lg p-1 text-slate-500 hover:bg-slate-100"
                aria-label="关闭对话"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div
            ref={listRef}
            className={`space-y-2 overflow-y-auto px-3 py-3 ${
              expanded ? 'max-h-[min(65vh,520px)]' : 'max-h-[min(42vh,280px)]'
            }`}
          >
            {messages.map((m, i) => (
              <div
                key={`${i}-${m.role}`}
                className={`rounded-xl px-3 py-2 text-[11px] leading-relaxed ${
                  m.role === 'user'
                    ? 'ml-4 bg-accent-blue text-white'
                    : 'mr-2 bg-slate-100 text-slate-700'
                }`}
              >
                {m.role === 'assistant' ? <AssistantReplyMarkdown text={m.text} /> : m.text}
              </div>
            ))}
            {busy ? (
              <div className="mr-2 inline-flex items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-2 text-[11px] text-slate-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                正在查本页素材与联网资料…
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-1.5 border-t border-slate-100 px-2 py-2">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                disabled={busy}
                onClick={() => void sendQuestion(s)}
                className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-medium text-slate-600 hover:border-accent-blue/30 hover:text-primary-blue disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
          <form
            className="flex gap-2 border-t border-slate-100 p-2"
            onSubmit={(e) => {
              e.preventDefault();
              void sendQuestion(input);
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={busy}
              placeholder="问我钩子、创意、买量思路…"
              className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2.5 py-2 text-[11px] outline-none focus:border-accent-blue/40 focus:ring-2 focus:ring-accent-blue/10 disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="inline-flex shrink-0 items-center justify-center rounded-lg bg-accent-blue px-2.5 py-2 text-white hover:brightness-110 disabled:opacity-50"
              aria-label="发送"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
          <div className="flex items-center justify-between gap-2 border-t border-slate-50 px-3 py-1.5">
            <p className="min-w-0 flex-1 text-[9px] text-slate-400">{footerNote}</p>
            {canSaveCard ? (
              <button
                type="button"
                disabled={savingCard || busy}
                onClick={() => void handleSaveCard()}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-accent-blue/30 bg-accent-blue/10 px-2 py-1 text-[10px] font-bold text-primary-blue hover:bg-accent-blue/15 disabled:opacity-50"
              >
                {savingCard ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Bookmark className="h-3 w-3" />
                )}
                保存为卡片
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => {
          setOpen((v) => {
            if (v) setExpanded(false);
            return !v;
          });
        }}
        className="group relative flex w-full flex-col items-center outline-none"
        aria-label={open ? '收起 SA小三郎' : '打开 SA小三郎对话'}
      >
        <div
          ref={botShellRef}
          className={`relative buying-bot-shell ${isFleeing ? 'buying-bot-shell-fleeing' : ''}`}
          style={{ transform: `translate(${fleeOffset.x}px, ${fleeOffset.y}px)` }}
        >
          <SanBotAvatar
            avatar={avatar}
            waving={waving || busy}
            compact
            interactive
            onRightHandClick={handleRightHandFlee}
          />
          <span className="pointer-events-none absolute -right-0.5 -top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-accent-blue text-white shadow-md ring-2 ring-white">
            <MessageCircle className="h-3 w-3" />
          </span>
        </div>
        <div
          className="mt-1 w-full rounded-xl border border-accent-blue/25 bg-gradient-to-r from-white to-sky-50 px-2 py-1.5 shadow-sm"
          aria-hidden
        >
          <p className="text-center text-[10px] font-black tracking-wide text-primary-blue">SA小三郎</p>
          <p className="text-center text-[9px] font-medium text-slate-500">懂素材的买量小参谋</p>
        </div>
      </button>
    </div>
  );
}

export function buyingPageMetaLabel(
  mode: BuyingPageAssistantPageMeta['mode'],
  rankingSegment: BuyingPageAssistantPageMeta['rankingSegment'],
  gameProfileId: string,
  scopeNote: string,
): BuyingPageAssistantPageMeta {
  const gameLabel = GAME_PROFILE_OPTIONS.find((g) => g.id === gameProfileId)?.label ?? gameProfileId;
  const modeLabel =
    mode === 'ranking'
      ? rankingSegment === 'competitor_top'
        ? '爬榜单·竞品TOP'
        : '爬榜单·团队TOP'
      : mode === 'hooks'
        ? '找钩子·竞品TOP'
        : mode === 'material_library'
          ? '素材库'
          : '追热梗';
  return {
    mode,
    rankingSegment,
    gameProfileLabel: gameLabel,
    scopeNote: `${modeLabel} · ${scopeNote}`,
  };
}
