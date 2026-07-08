import { useEffect, useState } from 'react';
import {
  Archive, Bot, Check, ChevronLeft, FileText, Languages, Loader2, MessageSquare,
  MoreHorizontal, PanelRightOpen, Phone, Send, Star, Zap,
} from 'lucide-react';
import { Avatar } from '../../../components/ui/avatar';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { Collapsible } from '../../../components/ui/collapsible';
import type { CustomerProfile, TimelineEventType } from '../types';
import { avatarInitial, customerStatus, lastMessageSummary } from '../lib/customer-utils';

interface CustomerDetailProps {
  customer: CustomerProfile;
  customers: CustomerProfile[];
  onBack: () => void;
  onOpenCustomer: (id: string) => void;
  onSent: () => void;
  apiJson: <T>(url: string, init?: RequestInit) => Promise<T>;
}

function eventIcon(type: TimelineEventType) {
  if (type === 'ai') return Bot;
  if (type === 'call') return Phone;
  if (type === 'quote') return FileText;
  if (type === 'task') return Check;
  return MessageSquare;
}

function openAssistant(customer: CustomerProfile, text: string) {
  window.dispatchEvent(new CustomEvent('lingshu-assistant-open', {
    detail: {
      text,
      context: {
        agent: 'conversion',
        label: `我的客户 / ${customer.name}`,
        summary: `当前客户：${customer.name}，${customer.countryName}，${customer.language}，${customer.product}，${customer.summary}`,
        suggestions: ['生成下一条回复建议', '生成报价草稿', '翻译最近消息', '整理通话简报'],
      },
    },
  }));
}

function ConversationList({ customers, selectedId, onOpenCustomer }: { customers: CustomerProfile[]; selectedId: string; onOpenCustomer: (id: string) => void }) {
  return (
    <aside className="hidden w-80 shrink-0 border-r border-border bg-surface lg:flex lg:flex-col">
      <div className="border-b border-border px-4 py-3">
        <p className="text-[17px] font-bold text-text-primary">待处理会话</p>
        <p className="mt-1 text-[13px] text-text-muted">按紧急度排序</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {customers.map(item => (
          <button
            key={item.id}
            type="button"
            onClick={() => onOpenCustomer(item.id)}
            className={`flex w-full items-start gap-3 rounded-lg px-3 py-3 text-left transition-colors hover:bg-surface-2 ${item.id === selectedId ? 'bg-surface-2' : ''}`}
          >
            <Avatar size="sm" status={customerStatus(item)}>{avatarInitial(item)}</Avatar>
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-3">
                <span className="truncate text-[15px] font-bold text-text-primary">{item.name}</span>
                <span className="shrink-0 text-[13px] text-text-muted">{item.lastActive}</span>
              </span>
              <span className="mt-1 block truncate text-[15px] text-text-muted">{lastMessageSummary(item)}</span>
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}

function TopActionBar({ customer, onBack }: { customer: CustomerProfile; onBack: () => void }) {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border bg-surface px-4">
      <div className="flex min-w-0 items-center gap-2">
        <Button type="button" variant="ghost" size="icon" onClick={onBack} title="返回队列">
          <ChevronLeft size={17} />
        </Button>
        <h2 className="min-w-0 truncate text-[17px] font-bold text-text-primary">{customer.name}</h2>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button type="button" variant="ghost" size="icon" title="收藏"><Star size={17} /></Button>
        <Button type="button" variant="ghost" size="icon" title="更多"><MoreHorizontal size={18} /></Button>
        <Button type="button" variant="ghost" size="icon" title="稍后处理"><Archive size={17} /></Button>
        <Button type="button" variant="ghost" size="icon" title="AI建议" onClick={() => openAssistant(customer, `基于${customer.name}当前对话生成下一步建议`)}><Zap size={17} /></Button>
      </div>
    </header>
  );
}

function ConversationStream({ customer }: { customer: CustomerProfile }) {
  return (
    <section className="min-h-0 flex-1 overflow-y-auto bg-surface-2 px-6 py-5">
      <div className="mx-auto max-w-3xl space-y-3">
        {customer.timeline.length === 0 && (
          <Card className="border-dashed text-center text-[15px] text-text-secondary">还没有对话记录</Card>
        )}
        {customer.timeline.map(event => {
          const Icon = eventIcon(event.type);
          const outbound = event.actor === 'seller' || event.actor === 'ai';
          return (
            <div key={event.id} className={`flex gap-3 ${outbound ? 'justify-end' : 'justify-start'}`}>
              {!outbound && <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface"><Icon size={15} className="text-text-secondary" /></div>}
              <Card className={`max-w-[78%] ${outbound ? 'bg-accent-glow' : ''}`} padding="sm">
                <div className="flex items-center justify-between gap-4">
                  <p className="text-[13px] font-bold text-text-primary">{event.title}</p>
                  <span className="text-[13px] text-text-muted">{event.time}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-[15px] leading-relaxed text-text-secondary">{event.body}</p>
              </Card>
              {outbound && <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface"><Icon size={15} className="text-accent" /></div>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ReplyComposer({ customer, onSent, apiJson }: CustomerDetailProps) {
  const latestDraft = [...customer.timeline].reverse().find(event => event.status === 'ai_draft' || event.type === 'ai')?.body || customer.nextStep;
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState('');
  const [aiHighlighted, setAiHighlighted] = useState(false);
  const open = customer.window?.open ?? true;

  useEffect(() => {
    setText('');
    setError('');
    setAiHighlighted(false);
  }, [customer.id]);

  const fillDraft = async () => {
    setDrafting(true);
    setError('');
    try {
      let draft = latestDraft;
      try {
        const data = await apiJson<{ draft?: { reply_text?: string; should_escalate?: boolean; reason?: string } }>(`/api/overseas/customers/${customer.id}/draft`, { method: 'POST' });
        if (data.draft?.should_escalate) setError(data.draft.reason || '需要人工确认，AI 未生成可发送草稿');
        else draft = data.draft?.reply_text || latestDraft;
      } catch {
        draft = latestDraft;
      }
      setText(draft);
      setAiHighlighted(true);
      window.setTimeout(() => {
        const input = document.querySelector<HTMLTextAreaElement>('[data-customer-reply-input="true"]');
        input?.focus();
        input?.setSelectionRange(input.value.length, input.value.length);
      }, 0);
      onSent();
    } finally {
      setDrafting(false);
    }
  };

  const send = async () => {
    if (!text.trim()) return;
    setSending(true);
    setError('');
    try {
      await apiJson(`/api/overseas/customers/${customer.id}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'text', body: text.trim(), aiDraft: aiHighlighted ? text.trim() : undefined }),
      });
      setText('');
      setAiHighlighted(false);
      onSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : '发送失败');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="border-t border-border bg-surface px-6 py-3">
      <div className="mx-auto max-w-3xl">
        <Card padding="none" className={`overflow-hidden ${aiHighlighted ? 'bg-accent-glow' : ''}`}>
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-surface-2 text-[13px] font-bold text-text-secondary">WA</span>
            <span className="text-[13px] font-bold text-text-secondary">WhatsApp</span>
            {aiHighlighted && <Badge variant="success">这是AI建议，可直接编辑后发送</Badge>}
          </div>
          <textarea
            data-customer-reply-input="true"
            value={text}
            onChange={event => {
              setText(event.target.value);
              if (aiHighlighted) setAiHighlighted(false);
            }}
            rows={3}
            disabled={!open || sending}
            placeholder={open ? '输入回复...' : '窗口关闭，需模板消息'}
            className="min-h-[84px] w-full resize-none bg-transparent px-4 py-3 text-[15px] leading-relaxed text-text-primary outline-none placeholder:text-text-muted disabled:opacity-60"
          />
          <div className="flex items-center justify-between px-3 py-2">
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" size="icon" onClick={fillDraft} disabled={drafting} title="AI建议回复">
                {drafting ? <Loader2 size={15} className="animate-spin" /> : <Zap size={16} />}
              </Button>
              <Button type="button" variant="ghost" size="icon" onClick={() => openAssistant(customer, `把给${customer.name}的回复翻译成${customer.language}`)} title="翻译">
                <Languages size={16} />
              </Button>
              <Button type="button" variant="ghost" size="icon" onClick={() => openAssistant(customer, `为${customer.product}生成报价草稿`)} title="报价">
                <FileText size={16} />
              </Button>
              {error && <span className="text-[13px] font-semibold text-red">{error}</span>}
            </div>
            <Button type="button" onClick={send} disabled={!open || !text.trim() || sending}>
              {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
              Send
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

function CustomerInfoPanel({ customer }: { customer: CustomerProfile }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-9 shrink-0 items-center justify-center border-l border-border bg-surface text-[13px] font-bold text-text-muted hover:bg-surface-2"
        title="展开客户资料"
      >
        <span className="[writing-mode:vertical-rl]">客户资料 &gt;</span>
      </button>
    );
  }
  return (
    <aside className="absolute inset-y-0 right-0 z-20 w-80 overflow-y-auto border-l border-border bg-surface shadow-sm">
      <div className="flex h-14 items-center justify-between border-b border-border px-4">
        <p className="text-[17px] font-bold text-text-primary">客户资料</p>
        <Button type="button" variant="ghost" size="icon" onClick={() => setOpen(false)} title="收起客户资料">
          <PanelRightOpen size={17} />
        </Button>
      </div>
      <Collapsible title="基本信息">
        <div className="space-y-2 text-[15px] text-text-secondary">
          <p>国家：{customer.countryName}</p>
          <p>语言：{customer.language}</p>
          <p>来源：{customer.source}</p>
        </div>
      </Collapsible>
      <Collapsible title="订单历史">
        <div className="space-y-2 text-[15px] text-text-secondary">
          {(customer.orderHistory.length ? customer.orderHistory : ['暂无历史订单']).map(order => <p key={order}>{order}</p>)}
        </div>
      </Collapsible>
      <Collapsible title="AI意向标签">
        <div className="flex flex-wrap gap-2">
          {customer.intentSignals.concat(customer.tags).slice(0, 8).map(signal => <Badge key={signal} variant="outline">{signal}</Badge>)}
        </div>
      </Collapsible>
    </aside>
  );
}

export function CustomerDetail(props: CustomerDetailProps) {
  const { customer, customers, onBack, onOpenCustomer } = props;
  return (
    <div className="relative flex h-full overflow-hidden bg-surface">
      <ConversationList customers={customers} selectedId={customer.id} onOpenCustomer={onOpenCustomer} />
      <section className="flex min-w-0 flex-1 flex-col">
        <TopActionBar customer={customer} onBack={onBack} />
        <ConversationStream customer={customer} />
        <ReplyComposer {...props} />
      </section>
      <CustomerInfoPanel customer={customer} />
    </div>
  );
}
