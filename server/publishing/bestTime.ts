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

const DEFAULT_WEEKDAY_FACTORS = [0.98, 0.90, 0.88, 0.91, 0.95, 1, 0.99];

const PLATFORM_WEEKDAY_FACTORS: Record<string, number[]> = {
  youtube: [1, 0.88, 0.90, 0.92, 0.95, 0.99, 1],
  tiktok: [0.98, 0.89, 0.87, 0.90, 0.95, 1, 0.99],
  instagram: [0.99, 0.90, 0.88, 0.91, 0.96, 1, 0.99],
  facebook: [0.98, 0.91, 0.89, 0.92, 0.96, 1, 0.99],
};

function weekdayFactor(platform: PublishPlatform, weekday: number): number {
  const normalizedWeekday = Math.max(0, Math.min(6, Math.floor(Number(weekday) || 0)));
  const factors = PLATFORM_WEEKDAY_FACTORS[String(platform).toLowerCase()] || DEFAULT_WEEKDAY_FACTORS;
  return factors[normalizedWeekday] ?? 1;
}

export function getBestTimeScores(tenantId: string, platform: PublishPlatform, weekday: number, requestedOffset?: number): number[] {
  const offset = targetOffsetHours(tenantId, String(platform), requestedOffset);
  const dayFactor = weekdayFactor(platform, weekday);
  return Array.from({ length: 24 }, (_, serverHour) => {
    const localHour = localHourFromServerHour(serverHour, offset);
    let score = 0.24;
    if (localHour >= 12 && localHour <= 14) score = 0.82;
    if (localHour >= 19 && localHour <= 22) score = 0.95;
    if (localHour >= 9 && localHour <= 11) score = Math.max(score, 0.62);
    if (localHour >= 1 && localHour <= 6) score = 0.08;
    if (platform === 'tiktok' || platform === 'instagram') score += localHour >= 20 && localHour <= 23 ? 0.04 : 0;
    return clamp(score * dayFactor);
  });
}

// TODO: switch to personalized scores after posting_stats has >=50 samples
// for the tenant + platform. V1 only accumulates posting_stats; all UI surfaces
// consume this single heuristic interface to keep recommendations consistent.
