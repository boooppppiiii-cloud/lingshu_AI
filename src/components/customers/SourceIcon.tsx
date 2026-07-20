import { MessageCircle, Music2 } from 'lucide-react';
import type { CustomerSource } from '../../types/customer';

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

  if (normalized === 'whatsapp' || normalized.startsWith('whatsapp_from_')) {
    return (
      <span
        title={label}
        aria-label={label}
        className="inline-flex shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"
        style={{ width: boxSize, height: boxSize }}
      >
        <MessageCircle size={size} strokeWidth={2.4} />
      </span>
    );
  }

  if (source === 'tiktok') {
    return (
      <span
        title={label}
        aria-label={label}
        className="inline-flex shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-950"
        style={{ width: boxSize, height: boxSize }}
      >
        <Music2 size={size} strokeWidth={2.4} />
      </span>
    );
  }

  if (source === 'instagram') {
    return (
      <span
        title={label}
        aria-label={label}
        className="inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-fuchsia-500 via-rose-500 to-amber-400 text-[9px] font-black text-white"
        style={{ width: boxSize, height: boxSize, fontSize: Math.max(8, Math.round(size * 0.55)) }}
      >
        IG
      </span>
    );
  }

  return (
    <span
      title={label}
      aria-label={label}
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-blue-600 font-black text-white"
      style={{ width: boxSize, height: boxSize, fontSize: Math.max(10, Math.round(size * 0.8)) }}
    >
      f
    </span>
  );
}
