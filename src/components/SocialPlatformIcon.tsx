import { useId } from 'react';

export type SocialBrand = 'youtube' | 'tiktok' | 'instagram' | 'facebook' | 'whatsapp';

export function normalizeSocialBrand(value: string): SocialBrand | null {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized.includes('youtube')) return 'youtube';
  if (normalized.includes('tiktok') || normalized.includes('tik tok')) return 'tiktok';
  if (normalized.includes('instagram')) return 'instagram';
  if (normalized.includes('facebook')) return 'facebook';
  if (normalized.includes('whatsapp')) return 'whatsapp';
  return null;
}

export function socialBrandLabel(value: string): string {
  const brand = normalizeSocialBrand(value);
  if (brand === 'youtube') return 'YouTube';
  if (brand === 'tiktok') return 'TikTok';
  if (brand === 'instagram') return 'Instagram';
  if (brand === 'facebook') return 'Facebook';
  if (brand === 'whatsapp') return 'WhatsApp';
  return value || '社媒平台';
}

export function SocialPlatformIcon({
  platform,
  size = 20,
  className = '',
  monochrome = false,
}: {
  platform: string;
  size?: number;
  className?: string;
  monochrome?: boolean;
}) {
  const brand = normalizeSocialBrand(platform);
  const gradientId = `instagram-${useId().replace(/:/g, '')}`;
  const common = {
    width: size,
    height: size,
    className: `inline-block shrink-0 ${className}`,
    role: 'img' as const,
    'aria-label': socialBrandLabel(platform),
  };

  if (brand === 'youtube') {
    return (
      <svg {...common} viewBox="0 0 24 24">
        <path fill={monochrome ? 'currentColor' : '#FF0000'} d="M23.2 7.1a3 3 0 0 0-2.1-2.1C19.2 4.5 12 4.5 12 4.5S4.8 4.5 2.9 5A3 3 0 0 0 .8 7.1 31 31 0 0 0 .3 12a31 31 0 0 0 .5 4.9A3 3 0 0 0 2.9 19c1.9.5 9.1.5 9.1.5s7.2 0 9.1-.5a3 3 0 0 0 2.1-2.1 31 31 0 0 0 .5-4.9 31 31 0 0 0-.5-4.9Z" />
        <path fill={monochrome ? '#fff' : '#fff'} d="m9.6 15.4 6.2-3.4-6.2-3.4v6.8Z" />
      </svg>
    );
  }

  if (brand === 'tiktok') {
    const note = 'M14.2 3.1v10.6a4.4 4.4 0 1 1-3.5-4.3v2.8a1.8 1.8 0 1 0 1 1.6V1.8h2.8c.4 2.3 1.8 3.7 4.5 4.2v2.9a8.6 8.6 0 0 1-4.8-1.8v-4Z';
    return (
      <svg {...common} viewBox="0 0 24 24">
        {!monochrome && <path d={note} fill="#25F4EE" transform="translate(-.7 .55)" />}
        {!monochrome && <path d={note} fill="#FE2C55" transform="translate(.65 -.2)" />}
        <path d={note} fill={monochrome ? 'currentColor' : '#010101'} />
      </svg>
    );
  }

  if (brand === 'instagram') {
    return (
      <svg {...common} viewBox="0 0 24 24">
        <defs>
          <linearGradient id={gradientId} x1="3" y1="21" x2="21" y2="3" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FFD600" />
            <stop offset=".45" stopColor="#FF0169" />
            <stop offset="1" stopColor="#D300C5" />
          </linearGradient>
        </defs>
        <rect x="2" y="2" width="20" height="20" rx="6" fill={monochrome ? 'currentColor' : `url(#${gradientId})`} />
        <circle cx="12" cy="12" r="4.35" fill="none" stroke="#fff" strokeWidth="2" />
        <circle cx="17.65" cy="6.55" r="1.25" fill="#fff" />
      </svg>
    );
  }

  if (brand === 'facebook') {
    return (
      <svg {...common} viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="11" fill={monochrome ? 'currentColor' : '#1877F2'} />
        <path fill="#fff" d="M13.8 20v-7h2.4l.4-2.8h-2.8V8.4c0-.8.2-1.4 1.4-1.4h1.5V4.5c-.3 0-1.2-.1-2.3-.1-2.3 0-3.9 1.4-3.9 4v1.8H8.2V13h2.3v7h3.3Z" />
      </svg>
    );
  }

  if (brand === 'whatsapp') {
    return (
      <svg {...common} viewBox="0 0 24 24">
        <path fill={monochrome ? 'currentColor' : '#25D366'} d="M12 1.4A10.4 10.4 0 0 0 3.1 17.2L1.7 22.5l5.4-1.4A10.5 10.5 0 1 0 12 1.4Z" />
        <path fill="#fff" d="M17.8 14.4c-.3-.2-1.8-.9-2.1-1-.3-.1-.5-.1-.7.2-.2.3-.8 1-.9 1.2-.2.2-.4.2-.7.1-1.8-.9-3-1.6-4.2-3.7-.3-.5.3-.5.8-1.6.1-.2 0-.4 0-.6l-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.6.1-.8.4-.3.3-1.1 1.1-1.1 2.6s1.1 3 1.2 3.2c.2.2 2.1 3.3 5.2 4.6 1.9.8 2.7.9 3.7.8.6-.1 1.8-.7 2.1-1.5.2-.7.2-1.3.2-1.4-.1-.3-.3-.4-.5-.6Z" />
      </svg>
    );
  }

  return (
    <svg {...common} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path d="M3 12h18M12 3c2.2 2.4 3.3 5.4 3.3 9S14.2 18.6 12 21c-2.2-2.4-3.3-5.4-3.3-9S9.8 5.4 12 3Z" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}
