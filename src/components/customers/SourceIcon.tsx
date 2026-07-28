import type { CustomerSource } from '../../types/customer';
import { SocialPlatformIcon } from '../SocialPlatformIcon';

const SOURCE_LABEL: Record<string, string> = {
  whatsapp: 'WhatsApp',
  facebook: 'Facebook',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  whatsapp_from_youtube: 'WhatsApp · YouTube',
  whatsapp_from_tiktok: 'WhatsApp · TikTok',
  whatsapp_from_instagram: 'WhatsApp · Instagram',
  whatsapp_from_facebook: 'WhatsApp · Facebook',
};

export function sourceLabel(source: CustomerSource) {
  return SOURCE_LABEL[source] || 'WhatsApp';
}

export function SourceIcon({ source, size = 16 }: { source: CustomerSource; size?: number }) {
  const label = sourceLabel(source);
  const normalized = String(source || '');
  const boxSize = Math.max(size + 4, 20);

  if (normalized.startsWith('whatsapp_from_')) {
    const origin = normalized.replace('whatsapp_from_', '');
    return (
      <span
        title={label}
        aria-label={label}
        className="relative inline-flex shrink-0 items-center justify-center"
        style={{ width: boxSize + 6, height: boxSize }}
      >
        <SocialPlatformIcon platform="whatsapp" size={size + 3} className="absolute left-0.5 top-0.5" />
        <SocialPlatformIcon platform={origin} size={Math.max(10, size - 1)} className="absolute bottom-0 right-0 rounded-full bg-white ring-2 ring-white" />
      </span>
    );
  }

  if (normalized === 'whatsapp' || normalized === 'tiktok' || normalized === 'instagram' || normalized === 'facebook') {
    return (
      <span
        title={label}
        aria-label={label}
        className="inline-flex shrink-0 items-center justify-center"
        style={{ width: boxSize, height: boxSize }}
      >
        <SocialPlatformIcon platform={normalized} size={size + 3} />
      </span>
    );
  }

  return (
    <span
      title={label}
      aria-label={label}
      className="inline-flex shrink-0 items-center justify-center"
      style={{ width: boxSize, height: boxSize }}
    >
      <SocialPlatformIcon platform="whatsapp" size={size + 3} />
    </span>
  );
}
