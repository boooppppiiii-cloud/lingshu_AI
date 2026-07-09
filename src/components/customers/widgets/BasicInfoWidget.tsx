import { Card, CardContent } from '../../ui/card';
import type { CustomerProfile } from '../../ConversionPage';

export function BasicInfoWidget({ customer }: { customer: CustomerProfile }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-2 text-sm font-black">
            {customer.avatar}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-black text-text-primary">{customer.name}</p>
            <p className="text-xs text-text-muted">{customer.email || '暂无邮箱'}</p>
            <p className="text-xs text-text-muted">{customer.source}</p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-xl bg-surface-2 p-3">
            <p className="text-text-muted">国家/地区</p>
            <p className="mt-1 font-bold text-text-primary">{customer.countryName}</p>
          </div>
          <div className="rounded-xl bg-surface-2 p-3">
            <p className="text-text-muted">语言</p>
            <p className="mt-1 font-bold text-text-primary">{customer.language}</p>
          </div>
          <div className="rounded-xl bg-surface-2 p-3">
            <p className="text-text-muted">当地时间</p>
            <p className="mt-1 font-bold text-text-primary">{customer.localTime}</p>
          </div>
          <div className="rounded-xl bg-surface-2 p-3">
            <p className="text-text-muted">来源渠道</p>
            <p className="mt-1 font-bold text-text-primary">{customer.source}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
