import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Columns3, RotateCcw } from 'lucide-react';
import {
  COMPETITOR_TABLE_HIDEABLE_COLUMNS,
  type CompetitorTableColumnDef,
  type CompetitorTableColumnId,
  saveHiddenCompetitorColumns,
} from '../lib/competitorTableColumns';

type CompetitorTableColumnCustomizerProps = {
  hiddenIds: Set<CompetitorTableColumnId>;
  hideableColumns?: CompetitorTableColumnDef[];
  onHiddenChange: (hidden: Set<CompetitorTableColumnId>) => void;
};

export default function CompetitorTableColumnCustomizer({
  hiddenIds,
  hideableColumns = COMPETITOR_TABLE_HIDEABLE_COLUMNS,
  onHiddenChange,
}: CompetitorTableColumnCustomizerProps) {
  const [open, setOpen] = useState(false);
  const [draftHidden, setDraftHidden] = useState<Set<CompetitorTableColumnId>>(() => new Set(hiddenIds));
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) setDraftHidden(new Set(hiddenIds));
  }, [hiddenIds, open]);

  const apply = useCallback(() => {
    const next = new Set(draftHidden);
    onHiddenChange(next);
    saveHiddenCompetitorColumns(next);
    setOpen(false);
  }, [draftHidden, onHiddenChange]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        apply();
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open, apply]);

  const toggleHide = (id: CompetitorTableColumnId) => {
    setDraftHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const hiddenCount = hiddenIds.size;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold text-slate-700 shadow-sm transition hover:border-accent-blue/40 hover:bg-slate-50"
      >
        <Columns3 className="h-3.5 w-3.5 text-slate-500" />
        自定义列表
        {hiddenCount > 0 ? (
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-black text-slate-500">
            已隐藏 {hiddenCount}
          </span>
        ) : null}
      </button>

      {open && (
        <div
          className="absolute right-0 top-full z-40 mt-1 w-[min(280px,92vw)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="border-b border-slate-100 px-3 py-2.5">
            <p className="text-xs font-black text-slate-800">自定义表格列</p>
            <p className="mt-0.5 text-[10px] leading-snug text-slate-500">
              勾选要暂时隐藏的列，点击「应用」后生效
            </p>
          </div>
          <ul className="max-h-64 overflow-y-auto py-1">
            {hideableColumns.map((col) => {
              const hide = draftHidden.has(col.id);
              return (
                <li key={col.id}>
                  <label className="flex cursor-pointer items-start gap-2 px-3 py-2 text-[11px] text-slate-700 hover:bg-slate-50">
                    <span
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border border-slate-200 ${
                        hide ? 'bg-slate-600 text-white' : 'bg-white'
                      }`}
                    >
                      {hide ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
                    </span>
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={hide}
                      onChange={() => toggleHide(col.id)}
                    />
                    <span className="leading-snug">
                      <span className="font-medium">{col.label}</span>
                      <span className="ml-1 text-slate-400">隐藏</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap gap-2 border-t border-slate-100 px-2 py-2">
            <button
              type="button"
              onClick={() => {
                setDraftHidden(new Set());
                onHiddenChange(new Set());
                saveHiddenCompetitorColumns(new Set());
                setOpen(false);
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[10px] font-bold text-slate-600 hover:bg-slate-50"
            >
              <RotateCcw className="h-3 w-3" />
              恢复全部列
            </button>
            <button
              type="button"
              onClick={apply}
              className="ml-auto rounded-lg bg-accent-blue px-3 py-1.5 text-[10px] font-bold text-white hover:brightness-110"
            >
              应用
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
