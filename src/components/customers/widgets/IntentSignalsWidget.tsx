import { Card, CardContent, CardHeader } from '../../ui/card';
import type { CustomerProfile } from '../../../types/customer';

export function IntentSignalsWidget({ customer }: { customer: CustomerProfile }) {
  return (
    <Card>
      <CardHeader>
        <p className="text-xs font-bold text-text-primary">AI 意向信号</p>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-1.5">
          {customer.intentSignals.map(signal => (
            <span key={signal} className="rounded-full bg-surface-2 px-2 py-1 text-[10px] font-semibold text-text-secondary">
              {signal}
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
