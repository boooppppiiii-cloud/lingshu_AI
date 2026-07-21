import { useEffect, useState } from 'react';
import { BookOpen, X } from 'lucide-react';
import type { CustomerProfile } from '../../types/customer';
import { buildPrioritySuggestion, completedTodoCustomers, pendingCustomers } from '../../lib/customerPriority';
import { SourceIcon } from './SourceIcon';
import { authHeader } from '../../lib/auth';

interface Props {
  customers: CustomerProfile[];
  onSelectCustomer: (id: string) => void;
  onClose: () => void;
}

interface KnowledgeMissCluster {
  topic: string;
  count: number;
  examples: string[];
}

interface NightModeBriefing {
  customers: number;
  autoReplies: number;
  drafts: number;
  calls: number;
  autoCustomerIds: string[];
  draftCustomerIds: string[];
  callCustomerIds: string[];
}

interface PublishingBriefing {
  title: string;
  platform: string;
  inquiries: number;
  postId: string;
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return '早上好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

function groupLabel(mode: CustomerProfile['handlingMode']) {
  if (mode === 'human_needed') return '需要你处理';
  if (mode === 'ai_draft') return '等你确认';
  return 'AI 接待中';
}

function priorityDot(customer: CustomerProfile) {
  const suggestion = buildPrioritySuggestion(customer);
  if (suggestion.tone === 'red') return 'bg-red-500';
  if (suggestion.tone === 'amber') return 'bg-amber-500';
  if (suggestion.tone === 'blue') return 'bg-sky-500';
  return 'bg-emerald-500';
}

export function DailyBriefing({ customers, onSelectCustomer, onClose }: Props) {
  const [missClusters, setMissClusters] = useState<KnowledgeMissCluster[]>([]);
  const [nightBriefing, setNightBriefing] = useState<NightModeBriefing | null>(null);
  const [publishingBriefing, setPublishingBriefing] = useState<PublishingBriefing | null>(null);
  const pending = pendingCustomers(customers);
  const completed = completedTodoCustomers(customers);
  const grouped = [
    { mode: 'human_needed' as const, items: pending.filter(customer => customer.handlingMode === 'human_needed') },
    { mode: 'ai_draft' as const, items: pending.filter(customer => customer.handlingMode === 'ai_draft') },
  ].filter(group => group.items.length > 0);
  const first = pending[0];

  const select = (id: string) => {
    onSelectCustomer(id);
    onClose();
  };

  useEffect(() => {
    fetch('/api/overseas/customers/knowledge-misses/briefing')
      .then(resp => resp.ok ? resp.json() : null)
      .then(data => setMissClusters(Array.isArray(data?.items) ? data.items : []))
      .catch(() => setMissClusters([]));
    fetch('/api/overseas/customers/night-mode/briefing')
      .then(resp => resp.ok ? resp.json() : null)
      .then(data => setNightBriefing(data?.item ?? null))
      .catch(() => setNightBriefing(null));
    fetch('/api/overseas/publishing/briefing', { headers: authHeader() })
      .then(resp => resp.ok ? resp.json() : null)
      .then(data => setPublishingBriefing(data?.item ?? null))
      .catch(() => setPublishingBriefing(null));
  }, []);

  const addKnowledge = (cluster: KnowledgeMissCluster) => {
    localStorage.setItem('lingshu:enterprise:prefill-faq', JSON.stringify({
      question: cluster.topic,
      answer: '',
      source: 'learned',
    }));
    window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: { page: 'enterprise' } }));
    onClose();
  };

  const openPublishingBriefing = () => {
    window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: { page: 'strategy' } }));
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/35 px-4">
      <div className="w-full max-w-[480px] rounded-2xl border border-border bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="flex items-center gap-3">
            <img src="/brand-logo.png" alt="灵小枢" className="h-8 w-8 object-contain" />
            <div>
              <p className="text-sm font-black text-text-primary">{greeting()}，今天有 {pending.length} 件事需要你</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-text-muted hover:bg-surface-2" title="关闭">
            <X size={15} />
          </button>
        </div>

        <div className="max-h-[52vh] overflow-y-auto px-5 py-4">
          <div className="space-y-4">
            {publishingBriefing && (
              <button
                type="button"
                onClick={openPublishingBriefing}
                className="flex w-full items-start gap-3 rounded-xl border border-sky-100 bg-sky-50/80 p-3 text-left transition-colors hover:border-sky-200 hover:bg-sky-50"
              >
                <SourceIcon source={`whatsapp_from_${publishingBriefing.platform}`} size={16} />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-black text-sky-950">
                    你的视频《{publishingBriefing.title}》昨天带来了 {publishingBriefing.inquiries} 条询盘
                  </p>
                  <p className="mt-1 text-[11px] font-semibold text-sky-800">点击查看首页社媒数据</p>
                </div>
              </button>
            )}
            {nightBriefing && (
              <section className="rounded-xl border border-emerald-100 bg-emerald-50/80 p-3">
                <p className="text-xs font-black text-emerald-950">
                  昨夜 AI 接待了 {nightBriefing.customers} 位客户，自动回复 {nightBriefing.autoReplies} 条 ✓
                </p>
                <p className="mt-1 text-[11px] font-semibold text-emerald-800">
                  等你确认 {nightBriefing.drafts} 条 | {nightBriefing.calls} 位客户想通话
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={() => nightBriefing.autoCustomerIds[0] && select(nightBriefing.autoCustomerIds[0])} className="rounded-full bg-white px-2.5 py-1 text-[11px] font-black text-emerald-800 shadow-sm">
                    看自动接待
                  </button>
                  <button type="button" onClick={() => nightBriefing.draftCustomerIds[0] && select(nightBriefing.draftCustomerIds[0])} className="rounded-full bg-white px-2.5 py-1 text-[11px] font-black text-amber-700 shadow-sm">
                    看待确认
                  </button>
                  <button type="button" onClick={() => nightBriefing.callCustomerIds[0] && select(nightBriefing.callCustomerIds[0])} className="rounded-full bg-white px-2.5 py-1 text-[11px] font-black text-red-700 shadow-sm">
                    看通话客户
                  </button>
                </div>
              </section>
            )}
            {missClusters.length > 0 && (
              <section>
                <p className="mb-2 text-[11px] font-black text-text-muted">知识库缺口</p>
                <div className="space-y-2">
                  {missClusters.map(cluster => (
                    <button
                      key={cluster.topic}
                      type="button"
                      onClick={() => addKnowledge(cluster)}
                      className="flex w-full items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-left transition-colors hover:border-amber-300 hover:bg-amber-100"
                    >
                      <BookOpen size={15} className="mt-0.5 text-amber-700" />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-black text-amber-900">本周 {cluster.count} 位客户问到「{cluster.topic}」，知识库还没有这条 → 补充</p>
                        <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-amber-800">{cluster.examples.slice(0, 2).join(' / ')}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            )}
            {grouped.map(group => (
              <section key={group.mode}>
                <p className="mb-2 text-[11px] font-black text-text-muted">{groupLabel(group.mode)}</p>
                <div className="space-y-2">
                  {group.items.map(customer => {
                    const suggestion = buildPrioritySuggestion(customer);
                    return (
                      <button
                        key={customer.id}
                        type="button"
                        onClick={() => select(customer.id)}
                        className="flex w-full items-start gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-left transition-colors hover:border-slate-300 hover:bg-white"
                      >
                        <SourceIcon source={customer.source} size={15} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-xs font-black text-text-primary">{customer.name}</p>
                            <span className={`h-2 w-2 rounded-full ${priorityDot(customer)}`} />
                          </div>
                          <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-text-muted">{suggestion.reason}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
            {completed.length > 0 && (
              <section>
                <p className="mb-2 text-[11px] font-black text-text-muted">已完成</p>
                <div className="space-y-2">
                  {completed.map(customer => (
                    <button
                      key={customer.id}
                      type="button"
                      onClick={() => select(customer.id)}
                      className="flex w-full items-start gap-3 rounded-lg border border-emerald-100 bg-emerald-50/70 px-3 py-2.5 text-left transition-colors hover:border-emerald-200 hover:bg-emerald-50"
                    >
                      <SourceIcon source={customer.source} size={15} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-xs font-black text-text-primary">{customer.name}</p>
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-700">已完成</span>
                        </div>
                        <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-emerald-700">今天已处理，已放到待办底部。</p>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
          <button type="button" onClick={onClose} className="rounded-lg border border-border bg-white px-3 py-2 text-xs font-bold text-text-secondary hover:bg-surface-2">
            稍后
          </button>
          <button type="button" onClick={() => first && select(first.id)} disabled={!first} className="rounded-lg bg-slate-950 px-4 py-2 text-xs font-bold text-white disabled:opacity-40">
            开始处理
          </button>
        </div>
      </div>
    </div>
  );
}
