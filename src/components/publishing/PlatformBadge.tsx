import { SocialPlatformIcon } from '../SocialPlatformIcon';

const GlobeIcon = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="2" />
    <path d="M3.8 12h16.4M12 3.5c2.2 2.3 3.4 5.1 3.4 8.5S14.2 18.2 12 20.5C9.8 18.2 8.6 15.4 8.6 12S9.8 5.8 12 3.5Z" stroke="currentColor" strokeWidth="1.7" />
  </svg>
);

type PlatformMeta = {
  label: string;
  className: string;
};

function normalizePlatform(platform: string): string {
  const value = platform.trim().toLowerCase();
  if (value.includes('youtube')) return 'youtube';
  if (value.includes('tiktok') || value.includes('tik tok')) return 'tiktok';
  if (value.includes('instagram')) return 'instagram';
  if (value.includes('facebook')) return 'facebook';
  return value;
}

export function platformMeta(platform: string): PlatformMeta {
  const normalized = normalizePlatform(platform);
  if (normalized === 'youtube') {
    return { label: 'YouTube', className: 'bg-red-50 text-red-700' };
  }
  if (normalized === 'tiktok') {
    return { label: 'TikTok', className: 'bg-slate-100 text-slate-950' };
  }
  if (normalized === 'instagram') {
    return {
      label: 'Instagram',
      className: 'bg-fuchsia-50 text-fuchsia-800',
    };
  }
  if (normalized === 'facebook') {
    return { label: 'Facebook', className: 'bg-blue-50 text-blue-700' };
  }
  return {
    label: platform || '其他平台',
    className: 'bg-slate-600 text-white',
  };
}

export function PlatformBadge({
  platform,
  compact = false,
}: {
  platform: string;
  compact?: boolean;
}) {
  const meta = platformMeta(platform);
  const normalized = normalizePlatform(platform);
  const hasBrandLogo = normalized === 'youtube' || normalized === 'tiktok' || normalized === 'instagram' || normalized === 'facebook';
  return (
    <span
      aria-label={`发布平台：${meta.label}`}
      title={meta.label}
      className={`inline-flex max-w-full shrink-0 items-center font-black shadow-sm ${meta.className} ${
        compact ? 'h-5 w-5 justify-center rounded-md' : 'gap-1 rounded-md px-1.5 py-0.5 text-[9px]'
      }`}
    >
      {hasBrandLogo
        ? <SocialPlatformIcon platform={platform} size={compact ? 13 : 12} />
        : <GlobeIcon size={compact ? 12 : 11} />}
      {!compact && <span className="truncate">{meta.label}</span>}
    </span>
  );
}
