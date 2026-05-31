import { useMemo, useState } from 'react';
import { Check, Plus } from 'lucide-react';
import {
  mergeRunDatesList,
  normalizeRunDateInput,
  parseManualRunDateLines,
  recentRunDatePresets,
} from '../lib/buyingRunDates';

type BuyingRunDatesPickerPanelProps = {
  draft: string[];
  onDraftChange: (dates: string[]) => void;
  /** 面板顶部说明，如批量模式提示 */
  hint?: string;
};

export default function BuyingRunDatesPickerPanel({
  draft,
  onDraftChange,
  hint,
}: BuyingRunDatesPickerPanelProps) {
  const [manualLine, setManualLine] = useState('');
  const [manualBlock, setManualBlock] = useState('');

  const presets = useMemo(() => {
    const base = recentRunDatePresets(60);
    const extra = draft.filter((d) => !base.includes(d));
    return mergeRunDatesList([...extra, ...base]);
  }, [draft]);

  const toggle = (date: string) => {
    onDraftChange(
      draft.includes(date) ? draft.filter((x) => x !== date) : mergeRunDatesList([...draft, date]),
    );
  };

  const addManual = (raw: string) => {
    const parts = parseManualRunDateLines(raw);
    if (!parts.length) return;
    onDraftChange(mergeRunDatesList([...draft, ...parts]));
  };

  return (
    <div className="text-[11px] text-slate-700" onClick={(e) => e.stopPropagation()}>
      <div className="border-b border-slate-100 px-3 py-2">
        <p className="text-[10px] font-bold text-slate-500">
          {hint ?? '多选日期（每行一项）'}
        </p>
      </div>
      <ul className="max-h-48 overflow-y-auto py-1">
        {presets.map((date) => {
          const checked = draft.includes(date);
          return (
            <li key={date}>
              <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-slate-50">
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                    checked ? 'border-accent-blue bg-accent-blue text-white' : 'border-slate-300 bg-white'
                  }`}
                >
                  {checked ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
                </span>
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={checked}
                  onChange={() => toggle(date)}
                />
                <span className="font-mono leading-none">{date}</span>
              </label>
            </li>
          );
        })}
      </ul>
      <div className="space-y-2 border-t border-slate-100 px-3 py-2">
        <p className="text-[10px] font-bold text-slate-500">手动填入</p>
        <div className="flex gap-1">
          <input
            type="text"
            value={manualLine}
            onChange={(e) => setManualLine(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                const n = normalizeRunDateInput(manualLine);
                if (n) {
                  addManual(n);
                  setManualLine('');
                }
              }
            }}
            placeholder="如 2026-05-19"
            className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] text-slate-800"
          />
          <button
            type="button"
            onClick={() => {
              addManual(manualLine);
              setManualLine('');
            }}
            className="shrink-0 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-bold text-slate-700 hover:bg-white"
            title="添加"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        <textarea
          value={manualBlock}
          onChange={(e) => setManualBlock(e.target.value)}
          rows={3}
          placeholder={'多行粘贴，每行一个日期\n2026-05-18\n2026-05-17'}
          className="w-full resize-y rounded-lg border border-slate-200 px-2 py-1.5 font-mono text-[10px] leading-snug text-slate-800"
        />
        {manualBlock.trim() ? (
          <button
            type="button"
            onClick={() => {
              addManual(manualBlock);
              setManualBlock('');
            }}
            className="w-full rounded-lg border border-dashed border-slate-300 py-1 text-[10px] font-bold text-slate-600 hover:border-accent-blue/40"
          >
            导入上方多行日期
          </button>
        ) : null}
      </div>
    </div>
  );
}
