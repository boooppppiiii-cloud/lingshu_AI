export type PublishDeliveryMode = 'now' | 'flexible' | 'schedule';

export type PendingScheduleInput = {
  deliveryMode?: PublishDeliveryMode;
  scheduledAt?: string;
};

export type PendingDropResolution =
  | { kind: 'blocked'; message: string }
  | { kind: 'needs-time' }
  | { kind: 'ready'; scheduledAt: Date; locked: boolean };

function validDate(value: unknown): Date | null {
  const parsed = value instanceof Date ? new Date(value) : new Date(String(value || ''));
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function selectedTimeOnDay(day: Date, time: string): Date | null {
  const match = /^(\d{2}):(\d{2})$/.exec(time.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  const target = new Date(day);
  target.setHours(hours, minutes, 0, 0);
  return target;
}

export function resolvePendingDrop(
  item: PendingScheduleInput,
  droppedDay: Date,
  selectedTime = '',
  now = new Date(),
): PendingDropResolution {
  if (item.deliveryMode === 'now') {
    return { kind: 'blocked', message: '立即发布内容不会进入日历；如需排期，请先改为“时间待定”或“定点排期”。' };
  }

  if (item.deliveryMode === 'schedule') {
    const fixed = validDate(item.scheduledAt);
    if (!fixed) return { kind: 'blocked', message: '请先在编辑页设置有效的定点发布时间。' };
    if (fixed.getTime() <= now.getTime()) return { kind: 'blocked', message: '定点发布时间必须晚于当前时间。' };
    return { kind: 'ready', scheduledAt: fixed, locked: true };
  }

  if (!selectedTime) return { kind: 'needs-time' };
  const selected = selectedTimeOnDay(droppedDay, selectedTime);
  if (!selected) return { kind: 'blocked', message: '请选择有效的发布时间。' };
  if (selected.getTime() <= now.getTime()) return { kind: 'blocked', message: '计划发布时间必须晚于当前时间。' };
  return { kind: 'ready', scheduledAt: selected, locked: false };
}

export function moveScheduleToDay(currentScheduledAt: string | Date, targetDay: Date): Date | null {
  const current = validDate(currentScheduledAt);
  const day = validDate(targetDay);
  if (!current || !day) return null;
  day.setHours(current.getHours(), current.getMinutes(), 0, 0);
  return day;
}

export function localTimeValue(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
