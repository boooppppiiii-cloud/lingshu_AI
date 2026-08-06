export type TrafficViewMode = 'materials' | 'create' | 'publish' | 'accounts';

const TRAFFIC_VIEW_MODES: readonly TrafficViewMode[] = ['materials', 'create', 'publish', 'accounts'];

function isTrafficViewMode(value: unknown): value is TrafficViewMode {
  return typeof value === 'string' && TRAFFIC_VIEW_MODES.includes(value as TrafficViewMode);
}

export function resolveInitialTrafficViewMode(
  oneShotView: unknown,
  persistedView: unknown,
): TrafficViewMode {
  if (isTrafficViewMode(oneShotView)) return oneShotView;
  if (isTrafficViewMode(persistedView)) return persistedView;
  return 'materials';
}

export function resolveSignalViewMode(
  current: TrafficViewMode,
  hasRestoreOrKickoff: boolean,
): TrafficViewMode {
  if (!hasRestoreOrKickoff || current === 'create') return current;
  return 'materials';
}

export function resolveNavigationEventViewMode(
  current: TrafficViewMode,
  requested: TrafficViewMode,
): TrafficViewMode {
  if (current === 'create' && requested === 'materials') return current;
  return requested;
}
