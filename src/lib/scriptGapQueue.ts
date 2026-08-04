export interface ScriptGapTask {
  id: string;
  origin: 'script_gap';
  title: string;
  productLabel: string;
  themeTitle: string;
  shotBrief: string;
  suggestedDurationSec: number;
  sourceProjectId?: string;
  sourceStoryboardSlotId?: string;
  createdAt: string;
  uploadedMaterialIds: string[];
}

const KEY = 'lingshu:script-gap-queue';
const EVENT = 'lingshu:script-gap-queue-updated';

export function readScriptGapTasks(): ScriptGapTask[] {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}

export function writeScriptGapTasks(tasks: ScriptGapTask[]): void {
  localStorage.setItem(KEY, JSON.stringify(tasks));
  window.dispatchEvent(new Event(EVENT));
}

export function updateScriptGapTask(id: string, patch: Partial<ScriptGapTask>): void {
  writeScriptGapTasks(readScriptGapTasks().map(task => task.id === id ? { ...task, ...patch } : task));
}

export function createScriptGapTask(input: Omit<ScriptGapTask, 'id' | 'origin' | 'createdAt' | 'uploadedMaterialIds'>): ScriptGapTask {
  const task: ScriptGapTask = { ...input, id: `script-gap-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, origin: 'script_gap', createdAt: new Date().toISOString(), uploadedMaterialIds: [] };
  writeScriptGapTasks([task, ...readScriptGapTasks()]);
  return task;
}

export const SCRIPT_GAP_QUEUE_EVENT = EVENT;
