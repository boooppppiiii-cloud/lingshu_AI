import { useMemo } from 'react';
import {
  Compass, Zap, MessageSquare, RefreshCw,
  Sparkles, ArrowRight, AlertTriangle, Users, TrendingUp, RotateCcw,
} from 'lucide-react';
import type { ConversationContext } from '../App';

interface Props {
  conversation: ConversationContext | null;
}

const AGENT_META = {
  strategy:   { label: '顾问 Agent',  Icon: Compass,       color: '#4f46e5', bg: 'rgba(79,70,229,0.08)' },
  traffic:    { label: '社媒 Agent',  Icon: Zap,           color: '#d97706', bg: 'rgba(217,119,6,0.08)' },
  conversion: { label: '客服 Agent',  Icon: MessageSquare, color: '#0891b2', bg: 'rgba(8,145,178,0.08)' },
  retention:  { label: 'CRM Agent',  Icon: RefreshCw,     color: '#16a34a', bg: 'rgba(22,163,74,0.08)' },
};

function SectionHeader({ label }: { label: string }) {
  return <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-2">{label}</p>;
}

function AgentAction({ agent, action, desc }: { agent: keyof typeof AGENT_META; action: string; desc: string }) {
  const { Icon, color, bg, label } = AGENT_META[agent];
  return (
    <button className="w-full flex items-start gap-2.5 p-2.5 rounded-lg border border-border hover:border-border-bright bg-surface hover:shadow-sm transition-all text-left group">
      <div className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: bg, color }}>
        <Icon size={12} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-semibold text-text-primary">{label}</p>
        <p className="text-[10px] text-text-muted leading-snug mt-0.5">{action}</p>
        <p className="text-[10px] text-text-muted leading-snug">{desc}</p>
      </div>
      <ArrowRight size={11} className="flex-shrink-0 mt-1 text-text-muted group-hover:text-text-secondary transition-colors" />
    </button>
  );
}

function extractSuggestedAgents(messages: ConversationContext['messages']): string[] {
  if (!messages) return [];
  const hints: string[] = [];
  const last = [...messages].reverse().find(m => m.role === 'assistant');
  if (!last) return hints;
  if (last.content.includes('社媒') || last.content.includes('流量') || last.content.includes('TikTok')) hints.push('traffic');
  if (last.content.includes('客服') || last.content.includes('询盘') || last.content.includes('转化')) hints.push('conversion');
  if (last.content.includes('CRM') || last.content.includes('老客') || last.content.includes('留存')) hints.push('retention');
  return hints;
}

function StrategyPanel({ conversation }: { conversation: ConversationContext }) {
  const msgCount = conversation.messages?.length ?? 0;
  const userMsgs = conversation.messages?.filter(m => m.role === 'user') ?? [];
  const suggested = useMemo(() => extractSuggestedAgents(conversation.messages), [conversation.messages]);

  const ACTIONS: Record<string, { action: string; desc: string }> = {
    traffic:    { action: '生成社媒内容矩阵', desc: '基于本次策略生成 TikTok/Instagram 脚本' },
    conversion: { action: '更新客服话术库',   desc: '将推广重点同步到客服 Agent 应答策略' },
    retention:  { action: '触发老客唤醒任务', desc: '通知 CRM Agent 筛选并联系相关老客' },
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Agent header */}
      <div className="px-4 pt-4 pb-3 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2.5 mb-3">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: 'rgba(79,70,229,0.1)', color: '#4f46e5' }}>
            <Compass size={16} />
          </div>
          <div>
            <p className="text-xs font-semibold text-text-primary">顾问 Agent</p>
            <p className="text-[10px] text-text-muted">策略编排 · 多 Agent 协调</p>
          </div>
          <span className="ml-auto flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ background: 'rgba(22,163,74,0.1)', color: '#16a34a' }}>
            <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
            运行中
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: '对话轮次', value: String(userMsgs.length) },
            { label: '消息总数', value: String(msgCount) },
          ].map(({ label, value }) => (
            <div key={label} className="bg-surface-2 rounded-lg px-3 py-2">
              <p className="text-base font-bold text-text-primary font-display leading-none">{value}</p>
              <p className="text-[10px] text-text-muted mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {/* Suggested sub-agent actions */}
        {suggested.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <Sparkles size={11} className="text-amber" />
              <SectionHeader label="顾问建议触发" />
            </div>
            <div className="space-y-2">
              {suggested.map(a => (
                <AgentAction key={a} agent={a as keyof typeof AGENT_META} action={ACTIONS[a].action} desc={ACTIONS[a].desc} />
              ))}
            </div>
          </div>
        )}

        {/* All sub-agents */}
        <div>
          <SectionHeader label="子 Agent 状态" />
          <div className="space-y-1.5">
            {(['traffic', 'conversion', 'retention'] as const).map(a => {
              const { Icon, color, bg, label } = AGENT_META[a];
              const isActive = suggested.includes(a);
              return (
                <div key={a} className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg border border-border bg-surface">
                  <div className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0" style={{ background: bg, color }}>
                    <Icon size={11} />
                  </div>
                  <span className="text-[11px] text-text-secondary flex-1">{label}</span>
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full" style={
                    isActive ? { background: 'rgba(217,119,6,0.1)', color: '#d97706' } : { background: 'rgba(148,163,184,0.1)', color: '#94a3b8' }
                  }>
                    {isActive ? '建议触发' : '待机'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Last user intent */}
        {userMsgs.length > 0 && (
          <div>
            <SectionHeader label="最近意图" />
            <div className="px-3 py-2.5 rounded-lg bg-surface-2 border border-border">
              <p className="text-[11px] text-text-secondary leading-relaxed line-clamp-3">
                {userMsgs[userMsgs.length - 1].content}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AgentHeader({ conversation, subtitle }: { conversation: ConversationContext; subtitle: string }) {
  const { Icon, label, color, bg } = AGENT_META[conversation.agent];
  const msgCount = conversation.messages?.length ?? 0;
  return (
    <div className="px-4 pt-4 pb-3 border-b border-border flex-shrink-0">
      <div className="flex items-center gap-2.5 mb-3">
        <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: bg, color }}>
          <Icon size={16} />
        </div>
        <div>
          <p className="text-xs font-semibold text-text-primary">{label}</p>
          <p className="text-[10px] text-text-muted">{subtitle}</p>
        </div>
        <span className="ml-auto flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ background: 'rgba(22,163,74,0.1)', color: '#16a34a' }}>
          <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
          运行中
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-surface-2 rounded-lg px-3 py-2">
          <p className="text-base font-bold text-text-primary font-display leading-none">{Math.ceil(msgCount / 2)}</p>
          <p className="text-[10px] text-text-muted mt-0.5">对话轮次</p>
        </div>
        <div className="bg-surface-2 rounded-lg px-3 py-2">
          <p className="text-base font-bold text-text-primary font-display leading-none">{msgCount}</p>
          <p className="text-[10px] text-text-muted mt-0.5">消息总数</p>
        </div>
      </div>
    </div>
  );
}

function ConversionPanel({ conversation }: { conversation: ConversationContext }) {
  const lastMsg = [...(conversation.messages ?? [])].reverse().find(m => m.role === 'assistant');
  const hasBigOrderAlert = lastMsg?.content.includes('大单') || lastMsg?.content.includes('⚠️');
  const langs = useMemo(() => {
    const content = conversation.messages?.map(m => m.content).join(' ') ?? '';
    const found: string[] = [];
    if (content.match(/[؀-ۿ]/)) found.push('阿拉伯语');
    if (content.match(/[a-zA-Z]{10,}/)) found.push('英语');
    if (content.includes('[ES]') || content.includes('español')) found.push('西班牙语');
    return found.length ? found : ['英语'];
  }, [conversation.messages]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <AgentHeader conversation={conversation} subtitle="询盘处理 · 话术生成" />
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {hasBigOrderAlert && (
          <div className="flex items-start gap-2 p-3 rounded-lg border" style={{ background: 'rgba(217,119,6,0.06)', borderColor: 'rgba(217,119,6,0.2)' }}>
            <AlertTriangle size={13} style={{ color: '#d97706' }} className="flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-[11px] font-semibold" style={{ color: '#d97706' }}>大单预警</p>
              <p className="text-[10px] text-text-muted mt-0.5">本次对话涉及大单场景，建议转人工跟进</p>
            </div>
          </div>
        )}
        <div>
          <SectionHeader label="本次涉及语种" />
          <div className="flex flex-wrap gap-1.5">
            {langs.map(l => (
              <span key={l} className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-surface-2 border border-border text-text-secondary">{l}</span>
            ))}
          </div>
        </div>
        <div>
          <SectionHeader label="快捷工具" />
          <div className="space-y-1.5">
            {[
              { icon: <MessageSquare size={11} />, label: '生成WhatsApp跟单模板', color: '#0891b2' },
              { icon: <Users size={11} />, label: '转人工 · 标记大单', color: '#d97706' },
              { icon: <TrendingUp size={11} />, label: '查看询盘转化漏斗', color: '#16a34a' },
            ].map(({ icon, label, color }) => (
              <button key={label} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border border-border bg-surface hover:border-border-bright text-left transition-all group">
                <span style={{ color }}>{icon}</span>
                <span className="text-[11px] text-text-secondary group-hover:text-text-primary flex-1">{label}</span>
                <ArrowRight size={10} className="text-text-muted group-hover:text-text-secondary" />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function RetentionPanel({ conversation }: { conversation: ConversationContext }) {
  const lastMsg = [...(conversation.messages ?? [])].reverse().find(m => m.role === 'assistant');
  const hasDormant = lastMsg?.content.includes('沉默') || lastMsg?.content.includes('未复购') || lastMsg?.content.includes('天没有');

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <AgentHeader conversation={conversation} subtitle="老客唤醒 · 反向推品" />
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        <div>
          <SectionHeader label="CRM 快览" />
          <div className="space-y-2">
            {[
              { label: '老客总数', value: '632', color: '#16a34a' },
              { label: '30天沉默', value: hasDormant ? '47' : '—', color: '#d97706' },
              { label: '本月复购率', value: '34%', color: '#0891b2' },
            ].map(({ label, value, color }) => (
              <div key={label} className="flex items-center justify-between px-3 py-2 rounded-lg bg-surface-2 border border-border">
                <span className="text-[11px] text-text-secondary">{label}</span>
                <span className="text-sm font-bold font-display" style={{ color }}>{value}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <SectionHeader label="快捷操作" />
          <div className="space-y-1.5">
            {[
              { icon: <RotateCcw size={11} />, label: '筛选60天未复购老客', color: '#16a34a' },
              { icon: <Sparkles size={11} />, label: '生成个性化推品方案', color: '#4f46e5' },
              { icon: <MessageSquare size={11} />, label: '批量发送唤醒消息', color: '#0891b2' },
            ].map(({ icon, label, color }) => (
              <button key={label} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border border-border bg-surface hover:border-border-bright text-left transition-all group">
                <span style={{ color }}>{icon}</span>
                <span className="text-[11px] text-text-secondary group-hover:text-text-primary flex-1">{label}</span>
                <ArrowRight size={10} className="text-text-muted group-hover:text-text-secondary" />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function RightPanel({ conversation }: Props) {
  if (!conversation) return null;
  if (conversation.agent === 'strategy')   return <StrategyPanel conversation={conversation} />;
  if (conversation.agent === 'conversion') return <ConversionPanel conversation={conversation} />;
  if (conversation.agent === 'retention')  return <RetentionPanel conversation={conversation} />;
  return null;
}
