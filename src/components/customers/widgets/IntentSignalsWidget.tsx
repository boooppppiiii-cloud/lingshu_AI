import { Card, CardContent, CardHeader } from '../../ui/card';
import type { CustomerProfile } from '../../../types/customer';

export function IntentSignalsWidget({ customer }: { customer: CustomerProfile }) {
  const dimensions = customer.bant ? [
    ['B 预算', customer.bant.budget],
    ['A 决策权', customer.bant.authority],
    ['N 需求', customer.bant.need],
    ['T 时间', customer.bant.timing],
  ] as const : [];
  const levelLabel = customer.bant?.band === 'black'
    ? '信息待核实'
    : customer.bant?.level === 'hot'
    ? '高价值商机'
    : customer.bant?.level === 'qualified'
    ? '值得重点跟进'
    : '继续了解需求';
  const statusLabel = { confirmed: '信号明确', partial: '已有线索', unknown: '尚待了解' } as const;
  const spinLabel = { situation: '了解现状', problem: '找出难点', implication: '确认影响', need_payoff: '推进下一步' } as const;
  return (
    <Card>
      <CardHeader>
        <p className="text-xs font-bold text-text-primary">AI 意向信号</p>
      </CardHeader>
      <CardContent>
        {customer.bant && (
          <div className="mb-3 rounded-lg border border-border-subtle bg-surface-2 p-2.5">
            <div className="mb-2 flex items-center justify-between text-[11px]">
              <span className="font-bold text-text-primary">采购意向判断</span>
              <span className="font-bold text-brand-primary">{levelLabel}</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {dimensions.map(([label, dimension]) => (
                <div key={label} className="rounded-md bg-surface-1 px-2 py-1.5 text-[10px] text-text-secondary">
                  <div className="flex justify-between gap-2"><span>{label}</span><span>{statusLabel[dimension.status]}</span></div>
                </div>
              ))}
            </div>
            {customer.bant.evidence && customer.bant.evidence.length > 0 && (
              <details className="mt-2 text-[10px] text-text-secondary">
                <summary className="cursor-pointer font-semibold">查看判断依据</summary>
                <div className="mt-1.5 space-y-1">
                  {customer.bant.evidence.slice(-8).map(item => <p key={item}>{item.replace(/\s[+-]\d+$/, '')}</p>)}
                </div>
              </details>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-1.5">
          {customer.intentSignals.map(signal => (
            <span key={signal} className="rounded-full bg-surface-2 px-2 py-1 text-[10px] font-semibold text-text-secondary">
              {signal}
            </span>
          ))}
        </div>
        {customer.spinGuidance ? (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-900">
            <p className="font-bold">当前沟通重点 · {spinLabel[customer.spinGuidance.stage]}</p>
            <p className="mt-1 leading-5">{customer.spinGuidance.statement} {customer.spinGuidance.question}</p>
          </div>
        ) : customer.progressionGoal && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-900">
            <p className="font-bold">本轮推进：{customer.progressionGoal.label}</p>
            <p className="mt-1 leading-5">建议间接问：{customer.progressionGoal.question}</p>
          </div>
        )}
        {customer.bant && customer.bant.authenticity.redFlags.length > 0 && (
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-[11px] text-slate-600">
            <p className="font-bold">信息待核实</p>
            {customer.bant.authenticity.redFlags.map(flag => (
              <p key={flag} className="mt-1 leading-5">{flag}</p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
