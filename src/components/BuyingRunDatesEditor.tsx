import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import { mergeRunDatesList, runDatesEqual } from '../lib/buyingRunDates';
import BuyingRunDatesPickerPanel from './BuyingRunDatesPickerPanel';

type BuyingRunDatesEditorProps = {
  runDates: string[];
  disabled?: boolean;
  onSave: (dates: string[]) => Promise<void>;
};

export default function BuyingRunDatesEditor({
  runDates,
  disabled,
  onSave,
}: BuyingRunDatesEditorProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(() => mergeRunDatesList(runDates));
  const [saving, setSaving] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(() => mergeRunDatesList(runDates), [runDates]);

  useEffect(() => {
    if (!open) setDraft(mergeRunDatesList(runDates));
  }, [runDates, open]);

  const commit = useCallback(async () => {
    if (saving) return;
    const next = mergeRunDatesList(draft);
    if (runDatesEqual(next, selected)) {
      setOpen(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(next);
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

  const summary =
    selected.length === 0 ? (
      <span className="text-slate-400">选择日期</span>
    ) : (
      <span className="flex flex-col gap-0.5 leading-snug">
        {selected.slice(0, 4).map((d) => (
          <span key={d}>{d}</span>
        ))}
        {selected.length > 4 ? <span className="text-slate-400">+{selected.length - 4} 天</span> : null}
      </span>
    );

  return (
    <div ref={rootRef} className="relative min-w-[120px] max-w-[160px]">
      <button
        type="button"
        disabled={disabled || saving}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="flex w-full items-start justify-between gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-left text-[10px] font-medium text-slate-700 transition hover:border-accent-blue/40 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="min-w-0 flex-1">{summary}</span>
        {saving ? (
          <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-accent-blue" />
        ) : (
          <ChevronDown
            className={`mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400 transition ${open ? 'rotate-180' : ''}`}
          />
        )}
      </button>

      {open && (
        <div
          className="absolute left-0 top-full z-30 mt-1 w-[min(240px,92vw)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <BuyingRunDatesPickerPanel draft={draft} onDraftChange={setDraft} />
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
