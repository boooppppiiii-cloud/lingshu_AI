export const DEMO_PROGRESS_KEY = 'ow_demo_steps';
export const DEMO_PROGRESS_EVENT = 'ow_demo_progress';

export type DemoStepId =
  | 'template'
  | 'strategy'
  | 'traffic'
  | 'conversion'
  | 'retention'
  | 'scheduler'
  | 'automation_workflow';

export function readDemoProgress(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(DEMO_PROGRESS_KEY) || '{}'); } catch { return {}; }
}

export function writeDemoProgress(next: Record<string, boolean>) {
  localStorage.setItem(DEMO_PROGRESS_KEY, JSON.stringify(next));
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
