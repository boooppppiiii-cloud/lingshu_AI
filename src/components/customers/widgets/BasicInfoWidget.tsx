import { useState } from 'react';
import { Lock, Pencil } from 'lucide-react';
import { Card, CardContent } from '../../ui/card';
import { SourceIcon } from '../SourceIcon';
import type { CustomerProfile } from '../../../types/customer';

const LANGUAGE_OPTIONS = ['英语', '西语', '阿语', '葡语', '法语', '俄语', '印尼语', '越南语', '泰语', '其他'];

export function BasicInfoWidget({
  customer,
  onCustomerPatch,
}: {
  customer: CustomerProfile;
  onCustomerPatch?: (patch: Partial<CustomerProfile>) => void;
}) {
  const [languageOpen, setLanguageOpen] = useState(false);

  const updateLanguage = (language: string) => {
    onCustomerPatch?.({ language, languageLocked: true });
    setLanguageOpen(false);
  };

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
            <div className="mt-1 flex items-center">
              <SourceIcon source={customer.source} size={14} />
            </div>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-xl bg-surface-2 p-3">
            <p className="text-text-muted">国家/地区</p>
            <p className="mt-1 font-bold text-text-primary">{customer.countryName}</p>
          </div>
          <div className="relative rounded-xl bg-surface-2 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-text-muted">语言</p>
              <div className="flex items-center gap-1">
                {customer.languageLocked && (
                  <span title="已手动指定，AI 不再自动更改">
                    <Lock size={12} className="text-emerald-600" />
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setLanguageOpen(open => !open)}
                  className="flex h-6 w-6 items-center justify-center rounded-lg text-text-muted hover:bg-white hover:text-text-primary"
                  title="手动指定回复语言"
                >
                  <Pencil size={12} />
                </button>
              </div>
            </div>
            <p className="mt-1 font-bold text-text-primary">{customer.language}</p>
            {languageOpen && (
              <div className="absolute right-2 top-11 z-30 w-32 overflow-hidden rounded-xl border border-border bg-white py-1 shadow-lg">
                {LANGUAGE_OPTIONS.map(language => (
                  <button
                    key={language}
                    type="button"
                    onClick={() => updateLanguage(language)}
                    className={`block w-full px-3 py-2 text-left text-xs font-bold hover:bg-surface-2 ${customer.language === language ? 'text-primary' : 'text-text-secondary'}`}
                  >
                    {language}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="rounded-xl bg-surface-2 p-3">
            <p className="text-text-muted">当地时间</p>
            <p className="mt-1 font-bold text-text-primary">{customer.localTime}</p>
          </div>
          <div className="rounded-xl bg-surface-2 p-3">
            <p className="text-text-muted">来源渠道</p>
            <div className="mt-1 flex items-center">
              <SourceIcon source={customer.source} size={16} />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
