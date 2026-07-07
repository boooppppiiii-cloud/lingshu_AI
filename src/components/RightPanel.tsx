import { useMemo } from 'react';
import {
  Compass, Zap, MessageSquare, RefreshCw,
  Sparkles, ArrowRight, AlertTriangle, Users, TrendingUp, RotateCcw,
} from 'lucide-react';
import type { ConversationContext, AgentType, AgentAction as AgentActionFn } from '../App';

interface Props {
  conversation: ConversationContext | null;
  onAction?: AgentActionFn;
}

const AGENT_META = {
  strategy:   { label: '首页', Icon: Compass,       color: '#4f46e5', bg: 'rgba(79,70,229,0.08)' },
  traffic:    { label: '我的社媒', Icon: Zap,           color: '#d97706', bg: 'rgba(217,119,6,0.08)' },
  conversion: { label: '我的客户', Icon: MessageSquare, color: '#0891b2', bg: 'rgba(8,145,178,0.08)' },
  retention:  { label: '我的客户', Icon: RefreshCw,     color: '#16a34a', bg: 'rgba(22,163,74,0.08)' },
};

const WORKSPACE_STATUS: Record<AgentType, { label: string; color: string }> = {
  strategy: { label: '运行中', color: '#16a34a' },
  traffic: { label: '执行中', color: '#d97706' },
  conversion: { label: '待机', color: '#94a3b8' },
  retention: { label: '运行中', color: '#16a34a' },
};

function SectionHeader({ label }: { label: string }) {
  return <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-2">{label}</p>;
}

function AgentAction({ agent, action, desc, onClick }: { agent: keyof typeof AGENT_META; action: string; desc: string; onClick?: () => void }) {
  const { Icon, color, bg, label } = AGENT_META[agent];
  return (
    <button onClick={onClick} className="w-full flex items-start gap-2.5 p-2.5 rounded-lg border border-border hover:border-border-bright bg-surface hover:shadow-sm transition-all text-left group">
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

function StrategyPanel({ conversation, onAction }: { conversation: ConversationContext; onAction?: AgentActionFn }) {
  const msgCount = conversation.messages?.length ?? 0;
  const userMsgs = conversation.messages?.filter(m => m.role === 'user') ?? [];
  const suggested = useMemo(() => extractSuggestedAgents(conversation.messages), [conversation.messages]);

  const ACTIONS: Record<string, { action: string; desc: string; task: string }> = {
    traffic:    { action: '生成社媒内容矩阵', desc: '基于本次策略生成 TikTok/Instagram 脚本', task: '根据本次策略，直接产出一套内容矩阵：5 个「选题 × 钩子 × 形式」的 TikTok/Instagram 脚本要点，不要讲方法论。' },
    conversion: { action: '更新客户回复库',   desc: '将推广重点同步到客户跟进策略',       task: '把本次策略的推广重点，直接落成 5 条可用的询盘应答话术（中英双语），不要讲原理。' },
    retention:  { action: '触发老客唤醒任务', desc: '通知我的客户筛选并联系相关老客',         task: '根据本次策略，直接给老客唤醒方案：目标人群 + 触达节奏 + 3 条文案，不要讲方法论。' },
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
            <p className="text-xs font-semibold text-text-primary">首页</p>
            <p className="text-[10px] text-text-muted">策略编排 · 多专家协调</p>
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
                <AgentAction key={a} agent={a as keyof typeof AGENT_META} action={ACTIONS[a].action} desc={ACTIONS[a].desc}
                  onClick={() => onAction?.(a as AgentType, ACTIONS[a].task)} />
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
              const status = WORKSPACE_STATUS[a];
              return (
                <div key={a} className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg border border-border bg-surface">
                  <div className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0" style={{ background: bg, color }}>
                    <Icon size={11} />
                  </div>
                  <span className="text-[11px] text-text-secondary flex-1">{label}</span>
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full" style={{ background: `${status.color}18`, color: status.color }}>
                    {suggested.includes(a) ? '建议触发' : status.label}
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

function TrafficPanel({ conversation, onAction }: { conversation: ConversationContext; onAction?: AgentActionFn }) {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <AgentHeader conversation={conversation} subtitle="爆款采集 · 脚本生成" />
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        <div>
          <SectionHeader label="采集快览" />
          <div className="space-y-2">
            {[
              { label: '今日脚本', value: '12', color: '#d97706' },
              { label: '覆盖平台', value: '5', color: '#4f46e5' },
              { label: '去重命中', value: '3', color: '#16a34a' },
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
              { icon: <Zap size={11} />, label: '分析 TikTok 10 条假发爆款', color: '#d97706', task: '直接分析 10 条 TikTok 假发爆款的共性，输出表格：钩子、画面、卖点、评论区需求、可复刻脚本方向。' },
              { icon: <Sparkles size={11} />, label: '生成斋月中东推广方案', color: '#4f46e5', task: '围绕斋月中东市场，直接生成 5 条短视频脚本方向，包含平台、前 3 秒钩子、画面、口播、CTA。' },
              { icon: <TrendingUp size={11} />, label: '素材去重矩阵', color: '#16a34a', task: '把同一产品拆成 6 个去重内容角度：人群、场景、痛点、证据、优惠、平台适配。用表格输出。' },
            ].map(({ icon, label, color, task }) => (
              <button key={label} onClick={() => onAction?.('traffic', task)} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border border-border bg-surface hover:border-border-bright text-left transition-all group">
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

function ConversionPanel({ conversation, onAction }: { conversation: ConversationContext; onAction?: AgentActionFn }) {
  const lastMsg = [...(conversation.messages ?? [])].reverse().find(m => m.role === 'assistant');
  const hasBigOrderAlert = lastMsg?.content.includes('大单') || lastMsg?.content.includes('⚠️');
  const langs = useMemo(() => {
    const content = conversation.messages?.map(m => m.content).join(' ') ?? '';
    const found: string[] = [];
    if (/[؀-ۿ؀-ۿ]/.test(content)) found.push('阿拉伯语');
    if (/\b(me interesa|precio|piezas|hola|gracias|muestra|por favor|estimado|enviar|unitario)\b/i.test(content)) found.push('西班牙语');
    if (/[a-zA-Z]{4,}/.test(content)) found.push('英语');
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
          <div className="flex items-center justify-between mb-2">
            <SectionHeader label="本次涉及语种" />
            <span className="text-[9px] text-text-muted">已自动识别</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {langs.map(l => (
              <span key={l} className="px-2 py-0.5 rounded-md text-[11px] font-medium border text-text-secondary"
                style={{ background: 'rgba(8,145,178,0.06)', borderColor: 'rgba(8,145,178,0.25)', color: '#0891b2' }}>
                {l}
              </span>
            ))}
          </div>
        </div>
        <div>
          <SectionHeader label="快捷工具" />
          <div className="space-y-1.5">
            {[
              { icon: <MessageSquare size={11} />, label: '生成WhatsApp跟单模板', color: '#0891b2', task: '针对"已报价、3 天未回复"的大单询盘（客户 Ahmed，定制类 500 件，已报价：起订 200 件、500 件 95 折、标准 25 天/加急 18 天 +8%），直接写一条可立即发送的 WhatsApp 跟单话术，中英双语，含一个轻促单的优惠钩子。不要解释原理、不要反问要信息。' },
              { icon: <Users size={11} />, label: '转人工 · 标记大单', color: '#d97706', task: '把当前大单询盘直接生成转人工交接摘要，按此格式给结果，不要反问：客户：Ahmed（沙特，定制类 500 件，$2,400）｜已报价：起订 200、500 件 95 折、标准 25 天/加急 18 天(+8%)｜风险点：价格敏感、已 3 天未回复｜建议人工首句话术：（给一句中英）' },
              { icon: <TrendingUp size={11} />, label: '查看询盘转化漏斗', color: '#16a34a', task: '基于这份近 30 天询盘漏斗数据，直接指出主要卡点 + 给 3 条可执行优化建议，不要再问我要数据、也不要讲通用原理：询盘 642 → 响应 603(94%) → 报价 271(45%) → 成交 198(73%)，整体转化 31%；来源 WhatsApp 71%/站内 DM 18%/邮件 8%/表单 3%；首响 8 分钟、未响应 23 条；首响越快成交越高（<5分 39%、5-15分 32%、15-60分 23%、>1时 13%）；流失原因 价格 38%/物流时效 24%/MOQ 19%/缺货 11%。' },
            ].map(({ icon, label, color, task }) => (
              <button key={label} onClick={() => onAction?.('conversion', task)} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border border-border bg-surface hover:border-border-bright text-left transition-all group">
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

function RetentionPanel({ conversation, onAction }: { conversation: ConversationContext; onAction?: AgentActionFn }) {
  const lastMsg = [...(conversation.messages ?? [])].reverse().find(m => m.role === 'assistant');
  const hasDormant = lastMsg?.content.includes('沉默') || lastMsg?.content.includes('未复购') || lastMsg?.content.includes('天没有');

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <AgentHeader conversation={conversation} subtitle="老客唤醒 · 行动建议" />
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        <div>
          <SectionHeader label="客户快览" />
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
              { icon: <RotateCcw size={11} />, label: '筛选60天未复购老客', color: '#16a34a', task: '直接给出"60 天未复购"老客筛选结果（不要反问要数据）：本月共 412 人、平均 LTV $94。按价值列 TOP5（姓名/市场/上次购买/历史品类/LTV/建议推品/触达优先级），用表格或清单。' },
              { icon: <Sparkles size={11} />, label: '生成个性化推品方案', color: '#4f46e5', task: '直接给 3 个老客的个性化推品方案示例（客户/市场/历史购买/推荐新品/推荐理由/一句话术），不要讲原理。示例客户：Ahmed(沙特,美妆个护)、Linh(越南,家居)、Carlos(墨西哥,消费电子)。' },
              { icon: <MessageSquare size={11} />, label: '批量发送唤醒消息', color: '#0891b2', task: '直接给 3 条可发送的老客唤醒文案：中文、英文、阿拉伯语各一条，针对 60 天未复购老客，含一个限时优惠钩子。不要解释原理。' },
            ].map(({ icon, label, color, task }) => (
              <button key={label} onClick={() => onAction?.('retention', task)} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border border-border bg-surface hover:border-border-bright text-left transition-all group">
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

export default function RightPanel({ conversation, onAction }: Props) {
  if (!conversation) return null;
  if (conversation.agent === 'strategy')   return <StrategyPanel conversation={conversation} onAction={onAction} />;
  if (conversation.agent === 'traffic')    return <TrafficPanel conversation={conversation} onAction={onAction} />;
  if (conversation.agent === 'conversion') return <ConversionPanel conversation={conversation} onAction={onAction} />;
  if (conversation.agent === 'retention')  return <RetentionPanel conversation={conversation} onAction={onAction} />;
  return null;
}
