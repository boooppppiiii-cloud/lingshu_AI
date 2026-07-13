import { useMemo, useState } from 'react';
import { AlertCircle, Info, MessageSquare, RefreshCw, TrendingUp, UserCheck } from 'lucide-react';
import { CUSTOMERS } from '../mocks/customers';
import type { CustomerProfile } from '../types/customer';

const STAGE_LABEL: Record<CustomerProfile['stage'], string> = {
  lead: '潜客',
  inquiry: '询盘中',
  quoted: '已报价',
  won: '已成交',
  silent30: '沉默30天',
  silent60: '沉默60天',
};

function usd(value: string): number {
  return Number(value.replace(/[^0-9.-]/g, '')) || 0;
}

function latestWhatsApp(customer: CustomerProfile) {
  return [...customer.timeline].reverse().find(item => item.type === 'whatsapp');
}

function isWhatsAppInquiry(customer: CustomerProfile) {
  return customer.source === 'whatsapp';
}

export default function InquiryDataBoard(_props: { windowDays?: number }) {
  const [refreshKey, setRefreshKey] = useState(0);

  const inquiries = useMemo(() => [...CUSTOMERS]
    .filter(isWhatsAppInquiry)
    .sort((a, b) => b.priority - a.priority || b.intentScore - a.intentScore), [refreshKey]);

  const summary = useMemo(() => {
    const highIntent = inquiries.filter(item => item.intentScore >= 80).length;
    const needsHuman = inquiries.filter(item => item.handlingMode !== 'ai_auto' || item.inboxReason).length;
    const quoted = inquiries.filter(item => item.stage === 'quoted' || item.stage === 'won').length;
    const estimated = inquiries.reduce((sum, item) => sum + usd(item.estimatedValue), 0);
    return { highIntent, needsHuman, quoted, estimated };
  }, [inquiries]);

  return (
    <div className="h-full overflow-y-auto px-6 py-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-sm font-bold text-text-primary">询盘真实数据</p>
          <p className="mt-1 text-xs text-text-muted">数据来自「我的客户」tab 中的 WhatsApp 客户会话。</p>
        </div>
        <button type="button" onClick={() => setRefreshKey(v => v + 1)} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-text-secondary hover:text-text-primary">
          <RefreshCw size={12} />刷新
        </button>
      </div>

      {inquiries.length === 0 ? (
        <EmptyState text="我的客户 tab 中暂无 WhatsApp 会话，因此询盘页不展示无真实来源的漏斗、响应时效或来源占比组件。" />
      ) : (
        <>
          <div className="mb-4 grid gap-3 md:grid-cols-4">
            <StatCard label="WhatsApp询盘" value={String(inquiries.length)} icon={<MessageSquare size={14} />} />
            <StatCard label="高意向客户" value={String(summary.highIntent)} icon={<TrendingUp size={14} />} />
            <StatCard label="需人工跟进" value={String(summary.needsHuman)} icon={<UserCheck size={14} />} />
            <StatCard label="预估金额" value={`$${summary.estimated.toLocaleString('en-US')}`} icon={<Info size={14} />} />
          </div>

          <section className="rounded-xl border border-border bg-white">
            <div className="border-b border-border px-4 py-3">
              <p className="text-sm font-bold text-text-primary">WhatsApp 询盘明细</p>
              <p className="mt-1 text-xs text-text-muted">只展示客户页已有字段，不生成无法从客户会话判断的漏斗或响应指标。</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-surface-2 text-text-secondary">
                  <tr>
                    {['客户', '产品/需求', '阶段', '意向分', '预估金额', '最近消息', '下一步'].map(head => (
                      <th key={head} className="px-3 py-2 text-left font-semibold">{head}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {inquiries.map(customer => {
                    const message = latestWhatsApp(customer);
                    return (
                      <tr key={customer.id} className="border-t border-border align-top">
                        <td className="px-3 py-2">
                          <p className="font-semibold text-text-primary">{customer.name}</p>
                          <p className="mt-0.5 text-text-muted">{customer.countryName} · {customer.lastActive}</p>
                        </td>
                        <td className="px-3 py-2 text-text-secondary">{customer.product}</td>
                        <td className="px-3 py-2">
                          <span className="rounded bg-green-50 px-2 py-0.5 font-semibold text-green-700">{STAGE_LABEL[customer.stage]}</span>
                        </td>
                        <td className="px-3 py-2 font-semibold text-text-primary">{customer.intentScore}</td>
                        <td className="px-3 py-2 font-semibold text-text-primary">{customer.estimatedValue}</td>
                        <td className="max-w-[300px] px-3 py-2 text-text-secondary">{message?.body || customer.summary}</td>
                        <td className="max-w-[260px] px-3 py-2 text-text-secondary">{customer.nextStep}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {summary.quoted > 0 && (
            <p className="mt-3 text-xs font-semibold text-green-700">已有 {summary.quoted} 个 WhatsApp 询盘推进到报价或成交阶段。</p>
          )}
        </>
      )}

      <p className="mt-4 flex items-center gap-1.5 text-[11px] text-text-muted">
        <Info size={12} /> 已删除公共平台评论、询盘漏斗、响应时效、来源占比等不来自 WhatsApp/我的客户 tab 的组件。
      </p>
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-white p-3">
      <div className="flex items-center gap-2 text-green-700">{icon}<span className="text-xs font-semibold text-text-secondary">{label}</span></div>
      <p className="mt-2 text-2xl font-bold leading-none text-text-primary">{value}</p>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-surface p-6 text-sm text-text-muted">
      <div className="flex items-start gap-2"><AlertCircle size={16} className="mt-0.5 text-text-muted" /><p>{text}</p></div>
    </div>
  );
}
