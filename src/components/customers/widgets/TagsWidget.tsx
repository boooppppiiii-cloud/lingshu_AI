import { Card, CardContent, CardHeader } from '../../ui/card';
import type { CustomerProfile } from '../../ConversionPage';

export function TagsWidget({ customer }: { customer: CustomerProfile }) {
  return (
    <Card>
      <CardHeader>
        <p className="text-xs font-bold text-text-primary">客户标签</p>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-1.5">
          {customer.tags.map(tag => (
            <span key={tag} className="rounded-full border border-border px-2 py-1 text-[10px] font-semibold text-text-muted">
              {tag}
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
