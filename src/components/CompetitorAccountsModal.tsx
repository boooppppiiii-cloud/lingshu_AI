import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Plus, Loader2, Trash2, Download, Users, ExternalLink, AlertCircle } from 'lucide-react';
import { authHeader } from '../lib/auth';

type AccountPlatform = 'youtube' | 'tiktok' | 'instagram' | 'facebook';

interface CompetitorAccount {
  id: string;
  platform: AccountPlatform;
  accountUrl: string;
  accountName: string;
  handle: string;
  avatarUrl: string;
  note: string;
  lastCrawledAt: string;
  lastCrawlCount: number;
  createdAt: string;
}

const PLATFORM_META: Record<AccountPlatform, { label: string; bg: string }> = {
  youtube: { label: 'YouTube', bg: '#ff0000' },
  tiktok: { label: 'TikTok', bg: '#010101' },
  instagram: { label: 'Instagram', bg: '#c13584' },
  facebook: { label: 'Facebook', bg: '#1877f2' },
};

const CRAWL_COUNT = 10;

function formatTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

async function readError(r: Response, fallback: string): Promise<string> {
  const data = await r.json().catch(() => ({})) as { error?: string };
  return data.error || fallback;
}

function accountPlaceholder(platform: AccountPlatform): string {
  if (platform === 'youtube') return 'https://www.youtube.com/@handle';
  if (platform === 'tiktok') return 'https://www.tiktok.com/@user';
  if (platform === 'instagram') return 'https://www.instagram.com/username';
  return 'https://www.facebook.com/page';
}

export default function CompetitorAccountsModal({
  open,
  onClose,
  onCrawled,
}: {
  open: boolean;
  onClose: () => void;
  onCrawled: (importedCount: number) => void;
}) {
  const [accounts, setAccounts] = useState<CompetitorAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [platform, setPlatform] = useState<AccountPlatform>('youtube');
  const [url, setUrl] = useState('');
  const [adding, setAdding] = useState(false);
  const [crawlingId, setCrawlingId] = useState('');
  const [deletingId, setDeletingId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/overseas/competitor-accounts', { headers: authHeader() });
      const data = await r.json().catch(() => ({})) as { items?: CompetitorAccount[] };
      setAccounts(data.items || []);
    } catch {
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setError('');
      setNotice('');
      void loadAccounts();
    }
  }, [open, loadAccounts]);

  const addAccount = async () => {
    const trimmed = url.trim();
    if (!trimmed) { setError('请粘贴对标账号主页链接'); return; }
    setAdding(true);
    setError('');
    setNotice('');
    try {
      const r = await fetch('/api/overseas/competitor-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ url: trimmed, platform }),
      });
      if (!r.ok) { setError(await readError(r, '添加失败')); return; }
      const data = await r.json().catch(() => ({})) as { item?: CompetitorAccount; duplicated?: boolean };
      setUrl('');
      setNotice(data.duplicated ? '该账号已在库中' : '已加入对标账号库');
      await loadAccounts();
    } catch {
      setError('添加失败，请稍后重试');
    } finally {
      setAdding(false);
    }
  };

  const crawlAccount = async (account: CompetitorAccount) => {
    setCrawlingId(account.id);
    setError('');
    setNotice('');
    try {
      const r = await fetch(`/api/overseas/competitor-accounts/${account.id}/crawl`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ limit: CRAWL_COUNT }),
      });
      if (!r.ok) { setError(await readError(r, '采集失败')); return; }
      const data = await r.json().catch(() => ({})) as { imported?: number; message?: string };
      const imported = Number(data.imported || 0);
      setNotice(data.message || `已从「${account.accountName}」采集 ${imported} 条最新视频`);
      await loadAccounts();
      onCrawled(imported);
    } catch {
      setError('采集失败，请稍后重试');
    } finally {
      setCrawlingId('');
    }
  };

  const deleteAccount = async (account: CompetitorAccount) => {
    setDeletingId(account.id);
    try {
      const r = await fetch(`/api/overseas/competitor-accounts/${account.id}`, {
        method: 'DELETE',
        headers: authHeader(),
      });
      if (r.ok) setAccounts(prev => prev.filter(a => a.id !== account.id));
    } finally {
      setDeletingId('');
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/40 px-5 py-6 backdrop-blur-sm"
        >
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            onClick={e => e.stopPropagation()}
            className="flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-white shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-glow text-accent">
                  <Users size={18} />
                </span>
                <div>
                  <h2 className="text-base font-black text-text-primary">对标账号库</h2>
                  <p className="text-xs text-text-muted">粘贴对标账号主页，一键采集其最新视频进入爆款灵感</p>
                </div>
              </div>
              <button type="button" onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-text-muted hover:bg-surface-2" title="关闭">
                <X size={16} />
              </button>
            </div>

            {/* Add form */}
            <div className="border-b border-border bg-surface px-6 py-4">
              <div className="flex flex-col gap-2 sm:flex-row">
                <select
                  value={platform}
                  onChange={e => setPlatform(e.target.value as AccountPlatform)}
                  aria-label="平台"
                  className="h-11 shrink-0 cursor-pointer rounded-xl border border-border bg-white px-3 text-sm font-bold text-text-primary outline-none focus:border-accent"
                >
                  <option value="youtube">YouTube</option>
                  <option value="tiktok">TikTok</option>
                  <option value="instagram">Instagram</option>
                  <option value="facebook">Facebook</option>
                </select>
                <input
                  type="text"
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !adding) void addAccount(); }}
                  placeholder={accountPlaceholder(platform)}
                  className="h-11 w-full rounded-xl border border-border bg-white px-3.5 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent"
                />
                <button
                  type="button"
                  onClick={() => void addAccount()}
                  disabled={adding}
                  className="flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-accent px-4 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                  {adding ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                  添加
                </button>
              </div>
              {error && (
                <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-red-600">
                  <AlertCircle size={13} /> {error}
                </p>
              )}
              {!error && notice && (
                <p className="mt-2 text-xs font-semibold text-accent">{notice}</p>
              )}
            </div>

            {/* Accounts list */}
            <div className="min-h-[220px] flex-1 overflow-y-auto px-6 py-4">
              {loading ? (
                <div className="flex h-40 items-center justify-center text-text-muted">
                  <Loader2 size={20} className="animate-spin" />
                </div>
              ) : accounts.length === 0 ? (
                <div className="flex h-40 flex-col items-center justify-center gap-2 text-center">
                  <Users size={26} className="text-text-muted" />
                  <p className="text-sm font-semibold text-text-primary">还没有对标账号</p>
                  <p className="text-xs text-text-muted">在上方粘贴一个 YouTube / TikTok / Instagram / Facebook 主页链接开始</p>
                </div>
              ) : (
                <ul className="space-y-2.5">
                  {accounts.map(account => {
                    const meta = PLATFORM_META[account.platform];
                    const crawling = crawlingId === account.id;
                    return (
                      <li key={account.id}
                        className="flex items-center gap-3 rounded-xl border border-border bg-white px-3.5 py-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[10px] font-black text-white"
                          style={{ background: meta.bg }}>
                          {meta.label.slice(0, 2).toUpperCase()}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <p className="truncate text-sm font-bold text-text-primary">{account.accountName}</p>
                            <a href={account.accountUrl} target="_blank" rel="noopener noreferrer"
                              className="shrink-0 text-text-muted hover:text-accent" title="打开主页">
                              <ExternalLink size={12} />
                            </a>
                          </div>
                          <p className="truncate text-xs text-text-muted">
                            {meta.label}
                            {account.lastCrawledAt
                              ? ` · 上次采集 ${formatTime(account.lastCrawledAt)}（+${account.lastCrawlCount}）`
                              : ' · 尚未采集'}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void crawlAccount(account)}
                          disabled={crawling || Boolean(crawlingId)}
                          className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                          title={`采集最新 ${CRAWL_COUNT} 条`}
                        >
                          {crawling ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                          {crawling ? '采集中' : '采集最新'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteAccount(account)}
                          disabled={deletingId === account.id}
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border text-text-muted hover:border-red-300 hover:text-red-600 disabled:opacity-60"
                          title="移除"
                        >
                          {deletingId === account.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="border-t border-border bg-surface px-6 py-3 text-xs text-text-muted">
              采集到的视频会进入「爆款灵感」，并自动排队做视频级 AI 分析；标注来源为对标账号主页。
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
