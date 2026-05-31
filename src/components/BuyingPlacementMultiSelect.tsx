import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Loader2 } from 'lucide-react';
import {
  BUYING_CHANNEL_PLACEMENT_OPTIONS,
  channelPlacementsFromList,
  type BuyingChannelPlacement,
} from '../lib/buyingPlacements';

function channelsEqual(a: BuyingChannelPlacement[], b: BuyingChannelPlacement[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort((x, y) => x.localeCompare(y, 'zh-CN'));
  const sb = [...b].sort((x, y) => x.localeCompare(y, 'zh-CN'));
  return sa.every((v, i) => v === sb[i]);
}

type BuyingPlacementMultiSelectProps = {
  placements: string[];
  disabled?: boolean;
  onSave: (channels: BuyingChannelPlacement[]) => Promise<void>;
};

export default function BuyingPlacementMultiSelect({
  placements,
  disabled,
  onSave,
}: BuyingPlacementMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<BuyingChannelPlacement[]>(() => channelPlacementsFromList(placements));
  const [saving, setSaving] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = channelPlacementsFromList(placements);

  useEffect(() => {
    if (!open) setDraft(channelPlacementsFromList(placements));
  }, [placements, open]);

  const commit = useCallback(async () => {
    if (saving) return;
    if (channelsEqual(draft, selected)) {
      setOpen(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(draft);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }, [draft, selected, saving, onSave]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        void commit();
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open, commit]);

  const toggle = (opt: BuyingChannelPlacement) => {
    setDraft((prev) =>
      prev.includes(opt) ? prev.filter((x) => x !== opt) : [...prev, opt].sort((a, b) => a.localeCompare(b, 'zh-CN')),
    );
  };

  const summary =
    selected.length === 0
      ? '选择版位'
      : selected.length <= 2
        ? selected.join('、')
        : `${selected.slice(0, 2).join('、')} 等 ${selected.length} 项`;

  return (
    <div ref={rootRef} className="relative min-w-[140px] max-w-[200px]">
      <button
        type="button"
        disabled={disabled || saving}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="flex w-full items-center justify-between gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-left text-[10px] font-medium text-slate-700 transition hover:border-accent-blue/40 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className={`line-clamp-2 flex-1 leading-snug ${selected.length === 0 ? 'text-slate-400' : ''}`}>
          {summary}
        </span>
        {saving ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent-blue" />
        ) : (
          <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
        )}
      </button>

      {open && (
        <div
          className="absolute left-0 top-full z-30 mt-1 w-[min(220px,90vw)] rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <ul className="max-h-56 overflow-y-auto py-1">
            {BUYING_CHANNEL_PLACEMENT_OPTIONS.map((opt) => {
              const checked = draft.includes(opt);
              return (
                <li key={opt}>
                  <label className="flex cursor-pointer items-start gap-2 px-3 py-2 text-[11px] text-slate-700 hover:bg-slate-50">
                    <span
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        checked ? 'border-accent-blue bg-accent-blue text-white' : 'border-slate-300 bg-white'
                      }`}
                    >
                      {checked ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
                    </span>
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={checked}
                      onChange={() => toggle(opt)}
                    />
                    <span className="leading-snug">{opt}</span>
                  </label>
                </li>
              );
            })}
          </ul>
          <div className="border-t border-slate-100 px-2 py-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => void commit()}
              className="w-full rounded-lg bg-accent-blue py-1.5 text-[11px] font-bold text-white hover:brightness-110 disabled:opacity-50"
            >
              完成
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
