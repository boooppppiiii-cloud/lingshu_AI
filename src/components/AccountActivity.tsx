import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  CheckCircle2,
  CheckSquare2,
  ChevronDown,
  ChevronRight,
  CircleUserRound,
  Clock3,
  ExternalLink,
  Filter,
  Layers3,
  MessageCircle,
  RefreshCw,
  Send,
  Sparkles,
  Square,
  UserPlus,
  UsersRound,
  X,
} from 'lucide-react';
import { ChannelOverview } from './YouTubeIntegration';
import { authHeader } from '../lib/auth';

type ActivityTab = 'overview' | 'content' | 'comments';
type CommentFilter = 'all' | 'high' | 'pending' | 'following' | 'converted' | 'ignored';
type CommentStatus = 'pending' | 'following' | 'converted' | 'ignored' | 'replied';

type SocialComment = {
  id: string;
  platform: 'TikTok' | 'Instagram' | 'YouTube' | 'Facebook';
  author: string;
  handle: string;
  text: string;
  contentTitle: string;
  receivedAt: string;
  intent: string;
  score: number;
  reason: string;
  status: CommentStatus;
  replies: string[];
  accountId: string;
  commentId: string;
  stateKey: string;
  videoId?: string;
  authorId?: string;
};

type AccountOption = {
  id: string;
  platform: SocialComment['platform'];
  title: string;
  handle?: string;
  status: string;
};

const PLATFORM_OPTIONS: SocialComment['platform'][] = ['YouTube', 'TikTok', 'Instagram', 'Facebook'];

const TAB_ITEMS: Array<{ id: ActivityTab; label: string }> = [
  { id: 'overview', label: '数据概览' },
  { id: 'content', label: '内容动态' },
  { id: 'comments', label: '评论管理' },
];

const FILTERS: Array<{ id: CommentFilter; label: string }> = [
  { id: 'all', label: '全部评论' },
  { id: 'high', label: '高意向' },
  { id: 'pending', label: '待回复' },
  { id: 'following', label: '跟进中' },
  { id: 'converted', label: '已转客户' },
  { id: 'ignored', label: '已忽略' },
];

const statusLabel: Record<CommentStatus, string> = {
  pending: '待回复',
  following: '跟进中',
  converted: '已转客户',
  ignored: '已忽略',
  replied: '已回复',
};

export default function AccountActivity() {
  const [tab, setTab] = useState<ActivityTab>('overview');
  const [filter, setFilter] = useState<CommentFilter>('all');
  const [comments, setComments] = useState<SocialComment[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [replyIndex, setReplyIndex] = useState(0);
  const [replyText, setReplyText] = useState('');
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState(false);
  const [notice, setNotice] = useState('');
  const [syncIssues, setSyncIssues] = useState<Array<{ platform: string; reason: string }>>([]);
  const [accountOptions, setAccountOptions] = useState<AccountOption[]>([]);
  const [selectedPlatforms, setSelectedPlatforms] = useState<SocialComment['platform'][]>([]);
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);

  const api = async (url: string, init?: RequestInit) => {
    const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...authHeader(), ...(init?.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.error || '请求失败');
    return data;
  };

  const loadComments = async () => {
    setLoading(true); setNotice('');
    try {
      const data = await api('/api/overseas/social-engagement/comments');
      const next: SocialComment[] = (data.items || []).map((item: any) => ({
        id: item.stateKey,
        accountId: item.accountId,
        commentId: item.id,
        stateKey: item.stateKey,
        videoId: item.videoId,
        authorId: item.authorId || item.authorName,
        platform: item.platform === 'youtube' ? 'YouTube' : item.platform === 'instagram' ? 'Instagram' : item.platform === 'facebook' ? 'Facebook' : 'TikTok',
        author: item.authorName || '社媒用户',
        handle: item.username ? `@${item.username}` : item.accountTitle || '',
        text: item.textDisplay || '',
        contentTitle: item.contentTitle || '已发布内容',
        receivedAt: item.publishedAt ? new Date(item.publishedAt).toLocaleString() : '',
        intent: item.analysis?.intent || '待分析',
        score: Number(item.analysis?.score || 0),
        reason: item.analysis?.reason || '正在准备 AI 商机判断。',
        replies: item.analysis?.replies || [],
        status: item.status || 'pending',
      }));
      const nextAccounts: AccountOption[] = (data.accounts || []).map((account: any) => ({
        id: account.id,
        platform: account.platform === 'youtube' ? 'YouTube' : account.platform === 'instagram' ? 'Instagram' : account.platform === 'facebook' ? 'Facebook' : 'TikTok',
        title: account.title || account.handle || '未命名账号',
        handle: account.handle,
        status: account.status || 'connected',
      }));
      setComments(next); setAccountOptions(nextAccounts); setSyncIssues(data.unavailable || []);
      setSelectedIds(current => current.filter(id => next.some(item => item.id === id)));
    } catch (error) { setNotice(error instanceof Error ? error.message : '评论同步失败'); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (tab === 'comments' && !comments.length) void loadComments(); }, [tab]);

  const scopedComments = useMemo(() => comments.filter(comment => {
    if (selectedPlatforms.length && !selectedPlatforms.includes(comment.platform)) return false;
    if (selectedAccounts.length && !selectedAccounts.includes(comment.accountId)) return false;
    return true;
  }), [comments, selectedPlatforms, selectedAccounts]);

  const filtered = useMemo(() => scopedComments.filter(comment => {
    if (filter === 'all') return true;
    if (filter === 'high') return comment.score >= 80;
    return comment.status === filter;
  }), [scopedComments, filter]);
  const selectedComments = useMemo(() => selectedIds
    .map(id => filtered.find(comment => comment.id === id))
    .filter((comment): comment is SocialComment => Boolean(comment)), [filtered, selectedIds]);
  const selected = selectedComments[0] || null;

  const toggleComment = (id: string) => {
    setSelectedIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
    setReplyIndex(0);
  };

  const togglePlatform = (platform: SocialComment['platform']) => {
    setSelectedPlatforms(current => current.includes(platform) ? current.filter(item => item !== platform) : [...current, platform]);
    setSelectedIds([]);
  };
  const toggleAccountFilter = (accountId: string) => {
    setSelectedAccounts(current => current.includes(accountId) ? current.filter(item => item !== accountId) : [...current, accountId]);
    setSelectedIds([]);
  };

  useEffect(() => {
    if (!selected) return;
    setReplyText(selected.replies[replyIndex] || '');
    if (selected.replies.length) return;
    let active = true;
    void api('/api/overseas/social-engagement/comments/analyze', { method: 'POST', body: JSON.stringify({ stateKey: selected.stateKey, text: selected.text, platform: selected.platform, contentTitle: selected.contentTitle }) })
      .then(data => { if (!active) return; setComments(list => list.map(item => item.id === selected.id ? { ...item, ...data.analysis } : item)); setReplyText(data.analysis?.replies?.[0] || ''); })
      .catch(error => { if (active) setNotice(error instanceof Error ? error.message : '分析失败'); });
    return () => { active = false; };
  }, [selected?.id]);

  const setStatus = (id: string, status: CommentStatus) => {
    setComments(current => current.map(comment => comment.id === id ? { ...comment, status } : comment));
    const item = comments.find(comment => comment.id === id);
    if (item) void api('/api/overseas/social-engagement/comments/status', { method: 'PATCH', body: JSON.stringify({ stateKey: item.stateKey, status }) }).catch(error => setNotice(error instanceof Error ? error.message : '状态保存失败'));
  };

  const sendReplies = async () => {
    if (!selectedComments.length || !replyText.trim()) return;
    setActing(true); setNotice('');
    const succeeded: string[] = [];
    const failed: string[] = [];
    for (const comment of selectedComments) {
      try {
        await api('/api/overseas/social-engagement/comments/reply', { method: 'POST', body: JSON.stringify({ platform: comment.platform.toLowerCase(), accountId: comment.accountId, commentId: comment.commentId, message: replyText.trim() }) });
        succeeded.push(comment.id);
      } catch (error) {
        failed.push(`${comment.author}：${error instanceof Error ? error.message : '发送失败'}`);
      }
    }
    if (succeeded.length) setComments(current => current.map(comment => succeeded.includes(comment.id) ? { ...comment, status: 'replied' } : comment));
    setNotice(`已回复 ${succeeded.length} 条${failed.length ? `，失败 ${failed.length} 条（${failed.join('；')}）` : '。'}`);
    setActing(false);
  };

  const convertLead = async () => {
    if (!selected) return; setActing(true); setNotice('');
    try {
      await api('/api/overseas/social-engagement/comments/convert', { method: 'POST', body: JSON.stringify({ stateKey: selected.stateKey, platform: selected.platform.toLowerCase(), authorId: selected.authorId, authorName: selected.author, commentId: selected.commentId, text: selected.text, score: selected.score, videoId: selected.videoId, contentTitle: selected.contentTitle }) });
      setComments(list => list.map(item => item.id === selected.id ? { ...item, status: 'converted' } : item)); setNotice('已转入「我的客户」。');
    } catch (error) { setNotice(error instanceof Error ? error.message : '转客户失败'); }
    finally { setActing(false); }
  };

  return (
    <div className="min-h-full">
      <div className="sticky top-0 z-10 border-b border-border bg-white/95 px-6 backdrop-blur">
        <div className="flex h-14 items-center justify-between gap-4">
          <div className="flex items-center gap-1 rounded-xl bg-surface-2 p-1">
            {TAB_ITEMS.map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`rounded-lg px-4 py-2 text-xs font-black transition ${tab === item.id ? 'bg-white text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'}`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 text-[11px] text-text-muted">
            <span className="rounded-full bg-emerald-50 px-2 py-1 font-bold text-emerald-700">真实账号数据</span>
            <button type="button" onClick={() => void loadComments()} disabled={loading} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 font-bold text-text-secondary hover:bg-surface-2 disabled:opacity-50">
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> {loading ? '同步中' : '同步动态'}
            </button>
          </div>
        </div>
      </div>

      {tab === 'overview' && <div className="px-6 py-5"><ChannelOverview /></div>}

      {tab === 'content' && (
        <div className="px-6 py-5">
          <div className="rounded-2xl border border-dashed border-border bg-white px-6 py-16 text-center shadow-sm">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-glow text-accent"><Clock3 size={22} /></span>
            <h3 className="mt-4 text-sm font-black text-text-primary">内容动态将在账号同步后展示</h3>
            <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-text-muted">这里会聚合已发布内容、平台状态和单条内容表现，不会把未同步的平台历史冒充为真实数据。</p>
            <button type="button" className="mt-5 inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-xs font-black text-white">前往集成中心 <ChevronRight size={14} /></button>
          </div>
        </div>
      )}

      {tab === 'comments' && (
        <div className="min-h-[620px]">
          <div className="flex min-h-[540px] overflow-hidden">
          <aside className="w-56 flex-shrink-0 border-r border-border bg-surface px-3 py-4">
            <div className="space-y-2 border-b border-border pb-4">
              <details className="group rounded-xl border border-border bg-white shadow-sm">
                <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-xs font-black text-text-secondary">
                  <Layers3 size={13} className="text-text-muted" /><span className="flex-1">平台</span><span className="text-[10px] font-bold text-accent">{selectedPlatforms.length ? `已选 ${selectedPlatforms.length}` : '全部'}</span><ChevronDown size={13} className="text-text-muted transition group-open:rotate-180" />
                </summary>
                <div className="space-y-1 border-t border-border p-2">
                  <button type="button" onClick={() => { setSelectedPlatforms([]); setSelectedIds([]); }} className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[11px] font-bold ${selectedPlatforms.length === 0 ? 'bg-accent-glow text-accent' : 'text-text-secondary hover:bg-surface'}`}><span className="flex-1">全部平台</span>{selectedPlatforms.length === 0 && <CheckCircle2 size={13} />}</button>
                  {PLATFORM_OPTIONS.map(platform => {
                    const active = selectedPlatforms.includes(platform);
                    const count = comments.filter(comment => comment.platform === platform).length;
                    return <button key={platform} type="button" onClick={() => togglePlatform(platform)} className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[11px] font-bold ${active ? 'bg-accent-glow text-accent' : 'text-text-secondary hover:bg-surface'}`}>{active ? <CheckSquare2 size={14} /> : <Square size={14} />}<span className="flex-1">{platform}</span><span className="text-[10px] text-text-muted">{count}</span></button>;
                  })}
                </div>
              </details>
              <details className="group rounded-xl border border-border bg-white shadow-sm">
                <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-xs font-black text-text-secondary">
                  <UsersRound size={13} className="text-text-muted" /><span className="flex-1">账号</span><span className="text-[10px] font-bold text-accent">{selectedAccounts.length ? `已选 ${selectedAccounts.length}` : '全部'}</span><ChevronDown size={13} className="text-text-muted transition group-open:rotate-180" />
                </summary>
                <div className="space-y-1 border-t border-border p-2">
                  <button type="button" onClick={() => { setSelectedAccounts([]); setSelectedIds([]); }} className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[11px] font-bold ${selectedAccounts.length === 0 ? 'bg-accent-glow text-accent' : 'text-text-secondary hover:bg-surface'}`}><span className="flex-1">全部账号</span>{selectedAccounts.length === 0 && <CheckCircle2 size={13} />}</button>
                  {accountOptions.filter(account => !selectedPlatforms.length || selectedPlatforms.includes(account.platform)).map(account => {
                    const active = selectedAccounts.includes(account.id);
                    const count = comments.filter(comment => comment.accountId === account.id).length;
                    return <button key={account.id} type="button" onClick={() => toggleAccountFilter(account.id)} className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[11px] font-bold ${active ? 'bg-accent-glow text-accent' : 'text-text-secondary hover:bg-surface'}`}>{active ? <CheckSquare2 size={14} /> : <Square size={14} />}<span className="min-w-0 flex-1 truncate">{account.title}</span><span className="text-[9px] text-text-muted">{account.platform} · {count}</span></button>;
                  })}
                  {!accountOptions.length && <p className="px-2 py-3 text-[10px] leading-4 text-text-muted">暂无已授权账号，请先到集成中心连接</p>}
                </div>
              </details>
            </div>
            <div className="mb-3 mt-4 flex items-center gap-2 px-2 text-[11px] font-black uppercase tracking-wider text-text-muted"><Filter size={12} /> 评论筛选</div>
            <div className="space-y-1">
              {FILTERS.map(item => {
                const count = scopedComments.filter(comment => item.id === 'all' ? true : item.id === 'high' ? comment.score >= 80 : comment.status === item.id).length;
                return (
                  <button key={item.id} type="button" onClick={() => setFilter(item.id)} className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-xs font-bold ${filter === item.id ? 'bg-white text-accent shadow-sm' : 'text-text-secondary hover:bg-white/70'}`}>
                    <span>{item.label}</span><span className="text-[10px] text-text-muted">{count}</span>
                  </button>
                );
              })}
            </div>
          </aside>

          <section className="min-w-0 flex-1 bg-white">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <div><p className="text-xs font-black text-text-primary">{FILTERS.find(item => item.id === filter)?.label}</p><p className="mt-1 text-[11px] text-text-muted">共 {filtered.length} 条，点击卡片可多选</p></div>
              <div className="flex items-center gap-2">
                {selectedIds.length > 0 && <button type="button" onClick={() => setSelectedIds([])} className="text-[11px] font-bold text-text-muted hover:text-text-primary">清空选择</button>}
                <button type="button" onClick={() => setSelectedIds(selectedIds.length === filtered.length ? [] : filtered.map(comment => comment.id))} disabled={!filtered.length} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[11px] font-black text-text-secondary disabled:opacity-40">{filtered.length > 0 && selectedIds.length === filtered.length ? <CheckSquare2 size={14} /> : <Square size={14} />} 全选</button>
                <span className="rounded-full bg-accent-glow px-3 py-1.5 text-[11px] font-black text-accent">已选 {selectedComments.length} 条</span>
              </div>
            </div>
            <div className="grid gap-3 p-5 md:grid-cols-2 xl:grid-cols-3">
              {filtered.map(comment => {
                const checked = selectedIds.includes(comment.id);
                const first = selectedIds[0] === comment.id;
                return (
                  <button key={comment.id} type="button" onClick={() => toggleComment(comment.id)} className={`relative rounded-2xl border p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${checked ? 'border-accent bg-accent-glow/50 ring-1 ring-accent/20' : 'border-border bg-white'}`}>
                    <span className={`absolute right-3 top-3 ${checked ? 'text-accent' : 'text-text-muted'}`}>{checked ? <CheckSquare2 size={18} /> : <Square size={18} />}</span>
                    <div className="flex items-center gap-2 pr-7"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 text-text-muted"><CircleUserRound size={18} /></span><div className="min-w-0 flex-1"><p className="truncate text-xs font-black text-text-primary">{comment.author}</p><p className="truncate text-[10px] text-text-muted">{comment.platform} · {comment.receivedAt}</p></div></div>
                    <p className="mt-3 line-clamp-3 min-h-[60px] text-xs leading-5 text-text-secondary">{comment.text}</p>
                    <p className="mt-2 truncate text-[10px] text-text-muted">来自《{comment.contentTitle}》</p>
                    <div className="mt-3 flex items-center justify-between gap-2"><div className="flex items-center gap-1.5"><span className="rounded-md bg-surface-2 px-2 py-1 text-[10px] font-bold text-text-secondary">{comment.intent}</span>{first && <span className="rounded-md bg-violet-50 px-2 py-1 text-[10px] font-black text-violet-700">首个选定</span>}</div><span className={`rounded-full px-2 py-1 text-[10px] font-black ${comment.score >= 80 ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700'}`}>{comment.score} 分</span></div>
                  </button>
                );
              })}
              {!filtered.length && <div className="col-span-full px-6 py-20 text-center text-xs leading-5 text-text-muted">{loading ? '正在同步已授权账号的评论…' : '暂无符合条件的真实评论'}{syncIssues.map(item => <div key={`${item.platform}-${item.reason}`} className="mt-2 text-amber-700">{item.platform}：{item.reason}</div>)}</div>}
            </div>
          </section>

          <AnimatePresence initial={false}>
            {selected && (
              <motion.aside initial={{ x: 48, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 48, opacity: 0 }} transition={{ duration: 0.2 }} className="w-[460px] flex-shrink-0 border-l border-border bg-surface p-5 shadow-[-12px_0_30px_rgba(15,23,42,0.08)]">
              <div className="mb-4 flex items-center justify-between"><div><h2 className="text-sm font-black text-text-primary">评论详情与回复</h2><p className="mt-1 text-[11px] text-text-muted">以首个选中评论生成，应用于已选 {selectedComments.length} 条</p></div><button type="button" onClick={() => setSelectedIds([])} className="rounded-lg p-2 text-text-muted hover:bg-white hover:text-text-primary"><X size={17} /></button></div>
              <div className="space-y-4">
                <div className="rounded-2xl border border-border bg-white p-5 shadow-sm">
                  <div className="flex items-start justify-between gap-4">
                    <div><div className="flex items-center gap-2"><h3 className="text-sm font-black text-text-primary">{selected.author}</h3><span className="text-xs text-text-muted">{selected.handle}</span></div><p className="mt-1 text-[11px] text-text-muted">{selected.platform} · 来自《{selected.contentTitle}》</p></div>
                    <button type="button" className="inline-flex items-center gap-1 text-[11px] font-bold text-text-muted hover:text-accent">查看原评论 <ExternalLink size={11} /></button>
                  </div>
                  <p className="mt-4 rounded-xl bg-surface px-4 py-3 text-sm leading-6 text-text-primary">{selected.text}</p>
                  <div className="mt-4 rounded-xl border border-violet-100 bg-violet-50/70 p-4">
                    <div className="flex items-center gap-2 text-xs font-black text-violet-800"><Sparkles size={14} /> AI 商机判断 · {selected.intent} · {selected.score} 分</div>
                    <p className="mt-2 text-xs leading-5 text-violet-700">{selected.reason}</p>
                  </div>
                </div>

                <div className="rounded-2xl border border-border bg-white p-5 shadow-sm">
                  <div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-black text-text-primary">AI 三版回复</h3><p className="mt-1 text-[11px] text-text-muted">基于首个选定卡片，可编辑后批量发送</p></div><span className="whitespace-nowrap rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-black text-emerald-700">人工确认</span></div>
                  <div className="mt-4 flex gap-2">
                    {selected.replies.slice(0, 3).map((reply, index) => <button key={index} type="button" onClick={() => { setReplyIndex(index); setReplyText(reply); }} className={`rounded-lg px-3 py-1.5 text-[11px] font-black ${replyIndex === index ? 'bg-accent text-white' : 'bg-surface-2 text-text-secondary'}`}>版本 {index + 1}</button>)}
                  </div>
                  <textarea value={replyText} onChange={event => setReplyText(event.target.value)} rows={4} placeholder={selected.replies.length ? '' : 'AI 正在生成回复建议…'} className="mt-3 w-full resize-none rounded-xl border border-border bg-surface px-4 py-3 text-sm leading-6 outline-none focus:border-accent" />
                  {selectedComments.length > 1 && <p className="mt-2 text-[10px] leading-4 text-amber-700">同一版回复将发送给全部 {selectedComments.length} 条已选评论，请确认内容对所有对象都适用。</p>}
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <button type="button" onClick={() => setStatus(selected.id, 'ignored')} className="text-xs font-bold text-text-muted hover:text-text-secondary">忽略评论</button>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setStatus(selected.id, 'following')} className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-xs font-black text-text-secondary"><MessageCircle size={14} /> 标记跟进</button>
                      <button type="button" onClick={() => void convertLead()} disabled={acting} className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-xs font-black text-text-secondary disabled:opacity-50"><UserPlus size={14} /> 转入我的客户</button>
                      <button type="button" onClick={() => void sendReplies()} disabled={acting || !replyText.trim()} className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-xs font-black text-white disabled:opacity-50"><Send size={14} /> {acting ? '批量发送中' : `一键回复 ${selectedComments.length} 条`}</button>
                    </div>
                  </div>
                  {selected.status !== 'pending' && <div className="mt-4 flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700"><CheckCircle2 size={14} /> 当前状态：{statusLabel[selected.status]}</div>}
                  {notice && <div className="mt-3 rounded-xl bg-sky-50 px-3 py-2 text-xs font-bold text-sky-700">{notice}</div>}
                </div>
              </div>
              </motion.aside>
            )}
          </AnimatePresence>
          </div>
        </div>
      )}
    </div>
  );
}
