import { Card, CardContent, CardHeader } from '../../ui/card';
import type { CustomerProfile } from '../../../types/customer';

export function IntentSignalsWidget({ customer }: { customer: CustomerProfile }) {
  const dimensions = customer.bant ? [
    ['B 预算', customer.bant.budget],
    ['A 决策权', customer.bant.authority],
    ['N 需求', customer.bant.need],
    ['T 时间', customer.bant.timing],
  ] as const : [];
  return (
    <Card>
      <CardHeader>
        <p className="text-xs font-bold text-text-primary">AI 意向信号</p>
      </CardHeader>
      <CardContent>
        {customer.bant && (
          <div className="mb-3 rounded-lg border border-border-subtle bg-surface-2 p-2.5">
            <div className="mb-2 flex items-center justify-between text-[11px]">
              <span className="font-bold text-text-primary">BANT 后台评分</span>
              <span className="font-bold text-brand-primary">{customer.bant.total}/100 · {customer.bant.completeness}/4 完整</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {dimensions.map(([label, dimension]) => (
                <div key={label} className="rounded-md bg-surface-1 px-2 py-1.5 text-[10px] text-text-secondary">
                  <div className="flex justify-between"><span>{label}</span><span>{dimension.score}/25</span></div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-border-subtle">
                    <div className="h-full rounded-full bg-brand-primary" style={{ width: `${dimension.score * 4}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-1.5">
          {customer.intentSignals.map(signal => (
            <span key={signal} className="rounded-full bg-surface-2 px-2 py-1 text-[10px] font-semibold text-text-secondary">
              {signal}
            </span>
          ))}
        </div>
        {customer.progressionGoal && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-900">
            <p className="font-bold">本轮推进：{customer.progressionGoal.label}</p>
            <p className="mt-1 leading-5">建议间接问：{customer.progressionGoal.question}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
