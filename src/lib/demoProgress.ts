export const DEMO_PROGRESS_KEY = 'ow_demo_steps';
const DEMO_PROGRESS_SCOPE_KEY = 'ow_demo_steps_scope';
export const DEMO_PROGRESS_EVENT = 'ow_demo_progress';

export type DemoStepId =
  | 'template'
  | 'strategy'
  | 'traffic'
  | 'conversion'
  | 'retention'
  | 'scheduler'
  | 'automation_workflow';

function scopedKey() {
  const scope = localStorage.getItem(DEMO_PROGRESS_SCOPE_KEY);
  return scope ? `${DEMO_PROGRESS_KEY}:${scope}` : DEMO_PROGRESS_KEY;
}

export function setDemoProgressScope(scope: string | null | undefined) {
  if (scope) localStorage.setItem(DEMO_PROGRESS_SCOPE_KEY, scope);
  else localStorage.removeItem(DEMO_PROGRESS_SCOPE_KEY);
  window.dispatchEvent(new CustomEvent(DEMO_PROGRESS_EVENT, { detail: readDemoProgress() }));
}

export function readDemoProgress(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(scopedKey()) || '{}'); } catch { return {}; }
}

export function writeDemoProgress(next: Record<string, boolean>) {
  localStorage.setItem(scopedKey(), JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(DEMO_PROGRESS_EVENT, { detail: next }));
}

export function completeDemoStep(step: DemoStepId) {
  const current = readDemoProgress();
  if (current[step]) return;
  writeDemoProgress({ ...current, [step]: true });
}

export function resetDemoProgress() {
  writeDemoProgress({});
}
