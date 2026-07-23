import type { ReactElement } from 'react';

type PlatformIcon = (props: { size?: number }) => ReactElement;

const TikTokIcon: PlatformIcon = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M14.2 4.2v10.1a4.1 4.1 0 1 1-3.4-4V13a1.6 1.6 0 1 0 1.1 1.5V2.8h2.7c.4 2.2 1.7 3.5 4.2 4v2.8a8.2 8.2 0 0 1-4.6-1.7V4.2Z" fill="currentColor" />
  </svg>
);

const InstagramIcon: PlatformIcon = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="3.3" y="3.3" width="17.4" height="17.4" rx="5" stroke="currentColor" strokeWidth="2.2" />
    <circle cx="12" cy="12" r="4.1" stroke="currentColor" strokeWidth="2.2" />
    <circle cx="17.6" cy="6.8" r="1.25" fill="currentColor" />
  </svg>
);

const YouTubeIcon: PlatformIcon = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M21 7.1a2.8 2.8 0 0 0-2-2C17.3 4.6 12 4.6 12 4.6s-5.3 0-7 .5a2.8 2.8 0 0 0-2 2A29 29 0 0 0 2.5 12c0 1.6.2 3.3.5 4.9a2.8 2.8 0 0 0 2 2c1.7.5 7 .5 7 .5s5.3 0 7-.5a2.8 2.8 0 0 0 2-2c.3-1.6.5-3.3.5-4.9s-.2-3.3-.5-4.9Z" fill="currentColor" />
    <path d="m10 15.4 5.2-3.4L10 8.6v6.8Z" fill="white" />
  </svg>
);

const FacebookIcon: PlatformIcon = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M14.1 21v-8h2.7l.4-3h-3.1V8.1c0-.9.3-1.5 1.6-1.5h1.7V3.9c-.3 0-1.3-.1-2.5-.1-2.5 0-4.2 1.5-4.2 4.4V10H8v3h2.7v8h3.4Z" fill="currentColor" />
  </svg>
);

const GlobeIcon: PlatformIcon = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="2" />
    <path d="M3.8 12h16.4M12 3.5c2.2 2.3 3.4 5.1 3.4 8.5S14.2 18.2 12 20.5C9.8 18.2 8.6 15.4 8.6 12S9.8 5.8 12 3.5Z" stroke="currentColor" strokeWidth="1.7" />
  </svg>
);

type PlatformMeta = {
  label: string;
  Icon: PlatformIcon;
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
    return { label: 'YouTube', Icon: YouTubeIcon, className: 'bg-red-600 text-white' };
  }
  if (normalized === 'tiktok') {
    return { label: 'TikTok', Icon: TikTokIcon, className: 'bg-slate-950 text-white' };
  }
  if (normalized === 'instagram') {
    return {
      label: 'Instagram',
      Icon: InstagramIcon,
      className: 'bg-gradient-to-br from-fuchsia-600 via-rose-500 to-amber-400 text-white',
    };
  }
  if (normalized === 'facebook') {
    return { label: 'Facebook', Icon: FacebookIcon, className: 'bg-blue-600 text-white' };
  }
  return {
    label: platform || '其他平台',
    Icon: GlobeIcon,
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
  return (
    <span
      aria-label={`发布平台：${meta.label}`}
      title={meta.label}
      className={`inline-flex max-w-full shrink-0 items-center font-black shadow-sm ${meta.className} ${
        compact ? 'h-5 w-5 justify-center rounded-md' : 'gap-1 rounded-md px-1.5 py-0.5 text-[9px]'
      }`}
    >
      <meta.Icon size={compact ? 12 : 11} />
      {!compact && <span className="truncate">{meta.label}</span>}
    </span>
  );
}
