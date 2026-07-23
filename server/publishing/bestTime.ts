export type PublishPlatform = 'youtube' | 'tiktok' | 'instagram' | 'facebook' | string;

function clamp(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return Number(value.toFixed(2));
}

function targetOffsetHours(tenantId: string, platform: string, requestedOffset?: number): number {
  if (Number.isFinite(requestedOffset)) return Math.max(-12, Math.min(14, Number(requestedOffset)));
  const specific = Number(process.env[`BEST_TIME_UTC_OFFSET_${tenantId}_${platform}`] || '');
  if (Number.isFinite(specific)) return specific;
  const tenant = Number(process.env[`BEST_TIME_UTC_OFFSET_${tenantId}`] || '');
  if (Number.isFinite(tenant)) return tenant;
  return Number(process.env.BEST_TIME_DEFAULT_UTC_OFFSET || 4);
}

function localHourFromServerHour(hour: number, offset: number): number {
  const serverOffset = 8;
  return (hour - serverOffset + offset + 24) % 24;
}

export function getBestTimeScores(tenantId: string, platform: PublishPlatform, _weekday: number, requestedOffset?: number): number[] {
  const offset = targetOffsetHours(tenantId, String(platform), requestedOffset);
  return Array.from({ length: 24 }, (_, serverHour) => {
    const localHour = localHourFromServerHour(serverHour, offset);
    let score = 0.24;
    if (localHour >= 12 && localHour <= 14) score = 0.82;
    if (localHour >= 19 && localHour <= 22) score = 0.95;
    if (localHour >= 9 && localHour <= 11) score = Math.max(score, 0.62);
    if (localHour >= 1 && localHour <= 6) score = 0.08;
    if (platform === 'tiktok' || platform === 'instagram') score += localHour >= 20 && localHour <= 23 ? 0.04 : 0;
    return clamp(score);
  });
}

// TODO: switch to personalized scores after posting_stats has >=50 samples
// for the tenant + platform. V1 only accumulates posting_stats; all UI surfaces
// consume this single heuristic interface to keep recommendations consistent.
