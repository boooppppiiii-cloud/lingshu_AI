import type { PointerEvent } from 'react';
import {
  BODY_COLOR_PALETTES,
  type AssistantAvatarConfig,
  type AssistantAvatarOption,
} from '../lib/assistantAvatar';

type SanBotAvatarProps = {
  avatar: AssistantAvatarConfig;
  waving?: boolean;
  compact?: boolean;
  className?: string;
  /** 侧栏：右手可点，触发逃离 */
  interactive?: boolean;
  onRightHandClick?: (e: PointerEvent<SVGCircleElement>) => void;
};

const RIGHT_HAND_HIT: Record<AssistantAvatarOption, { cx: number; cy: number; r: number }> = {
  0: { cx: 73, cy: 54, r: 12 },
  1: { cx: 78, cy: 40, r: 12 },
  2: { cx: 71, cy: 62, r: 12 },
};

function RightHandHit({
  pose,
  onRightHandClick,
}: {
  pose: AssistantAvatarOption;
  onRightHandClick?: (e: PointerEvent<SVGCircleElement>) => void;
}) {
  if (!onRightHandClick) return null;
  const { cx, cy, r } = RIGHT_HAND_HIT[pose];
  return (
    <circle
      cx={cx}
      cy={cy}
      r={r}
      fill="transparent"
      className="buying-bot-hand-r cursor-pointer"
      onPointerDown={(e) => {
        e.stopPropagation();
        onRightHandClick(e);
      }}
    />
  );
}

function HairLayer({ hair, stroke }: { hair: AssistantAvatarOption; stroke: string }) {
  if (hair === 1) {
    return (
      <>
        <path d="M34 18 Q44 8 54 18 L52 22 Q44 14 36 22 Z" fill={stroke} opacity="0.35" />
        <ellipse cx="44" cy="16" rx="10" ry="5" fill={stroke} opacity="0.2" />
      </>
    );
  }
  if (hair === 2) {
    return (
      <>
        <path d="M28 22 L24 8 L32 18 Z" fill={stroke} opacity="0.45" />
        <path d="M60 22 L64 8 L56 18 Z" fill={stroke} opacity="0.45" />
      </>
    );
  }
  return (
    <>
      <line x1="44" y1="14" x2="44" y2="8" stroke={stroke} strokeWidth="2" strokeLinecap="round" />
      <circle cx="44" cy="7" r="2.5" fill="#fbbf24" />
    </>
  );
}

function ExpressionLayer({ expression }: { expression: AssistantAvatarOption }) {
  if (expression === 1) {
    return <path d="M34 43 Q44 52 54 43" fill="none" stroke="#1e3a5f" strokeWidth="2.2" strokeLinecap="round" />;
  }
  if (expression === 2) {
    return <line x1="38" y1="46" x2="50" y2="46" stroke="#1e3a5f" strokeWidth="2" strokeLinecap="round" />;
  }
  return <path d="M38 44 Q44 48 50 44" fill="none" stroke="#1e3a5f" strokeWidth="2" strokeLinecap="round" />;
}

function HeadAccessoryLayer({ headAccessory }: { headAccessory: AssistantAvatarOption }) {
  if (headAccessory === 1) {
    return (
      <>
        <circle cx="44" cy="12" r="6" fill="#fbbf24" opacity="0.95" />
        <path d="M44 6 L46 2 L42 2 Z" fill="#fbbf24" />
        <path d="M38 10 L34 8 M50 10 L54 8" stroke="#f59e0b" strokeWidth="1.5" strokeLinecap="round" />
      </>
    );
  }
  if (headAccessory === 2) {
    return (
      <path
        d="M30 20 Q44 12 58 20"
        fill="none"
        stroke="#ef4444"
        strokeWidth="3"
        strokeLinecap="round"
      />
    );
  }
  return null;
}

function FaceAccessoryLayer({ faceAccessory }: { faceAccessory: AssistantAvatarOption }) {
  if (faceAccessory === 1) {
    return (
      <>
        <circle cx="36" cy="34" r="6" fill="none" stroke="#1e3a5f" strokeWidth="1.8" />
        <circle cx="52" cy="34" r="6" fill="none" stroke="#1e3a5f" strokeWidth="1.8" />
        <line x1="42" y1="34" x2="46" y2="34" stroke="#1e3a5f" strokeWidth="1.2" />
      </>
    );
  }
  if (faceAccessory === 2) {
    return <rect x="28" y="31" width="32" height="7" rx="3.5" fill="#1e3a5f" opacity="0.85" />;
  }
  return null;
}

function BodyAccessoryLayer({
  bodyAccessory,
  body,
}: {
  bodyAccessory: AssistantAvatarOption;
  body: string;
}) {
  if (bodyAccessory === 1) {
    return (
      <>
        <path d="M44 52 L44 68 L40 74 L48 74 Z" fill="#ef4444" stroke="#b91c1c" strokeWidth="1" />
        <circle cx="44" cy="52" r="3" fill="#fff" stroke="#ef4444" strokeWidth="1" />
      </>
    );
  }
  if (bodyAccessory === 2) {
    return (
      <>
        <circle cx="44" cy="58" r="7" fill="#fff" stroke={body} strokeWidth="2" />
        <text x="44" y="61" textAnchor="middle" fontSize="8" fontWeight="bold" fill={body}>
          SA
        </text>
      </>
    );
  }
  return null;
}

function ArmsLayer({
  pose,
  body,
  stroke,
  waving,
  onRightHandClick,
}: {
  pose: AssistantAvatarOption;
  body: string;
  stroke: string;
  waving: boolean;
  onRightHandClick?: (e: PointerEvent<SVGCircleElement>) => void;
}) {
  const armProps = { fill: body, stroke, strokeWidth: 1.5 };
  if (pose === 1) {
    return (
      <>
        <g className={waving ? 'buying-bot-arm-l' : undefined}>
          <rect x="6" y="42" width="14" height="8" rx="4" {...armProps} transform="rotate(-35 13 46)" />
        </g>
        <g className={waving ? 'buying-bot-arm-r' : undefined}>
          <rect x="68" y="42" width="14" height="8" rx="4" {...armProps} transform="rotate(35 75 46)" />
          <RightHandHit pose={pose} onRightHandClick={onRightHandClick} />
        </g>
      </>
    );
  }
  if (pose === 2) {
    return (
      <>
        <rect x="10" y="58" width="14" height="8" rx="4" {...armProps} />
        <g>
          <rect x="64" y="58" width="14" height="8" rx="4" {...armProps} />
          <RightHandHit pose={pose} onRightHandClick={onRightHandClick} />
        </g>
      </>
    );
  }
  return (
    <>
      <rect x="8" y="52" width="14" height="8" rx="4" {...armProps} />
      <g className={waving ? 'buying-bot-arm-r' : undefined}>
        <rect x="66" y="50" width="14" height="8" rx="4" {...armProps} />
        <RightHandHit pose={pose} onRightHandClick={onRightHandClick} />
      </g>
    </>
  );
}

export default function SanBotAvatar({
  avatar,
  waving = false,
  compact,
  className = '',
  interactive,
  onRightHandClick,
}: SanBotAvatarProps) {
  const palette = BODY_COLOR_PALETTES[avatar.bodyColor] ?? BODY_COLOR_PALETTES[0];
  const waveClass = waving ? 'buying-bot-wave' : '';
  const poseClass = avatar.pose === 1 ? 'buying-bot-pose-cheer' : avatar.pose === 2 ? 'buying-bot-pose-stand' : '';
  const handHandler = interactive ? onRightHandClick : undefined;

  return (
    <svg
      viewBox="0 0 88 96"
      className={`drop-shadow-md buying-bot-bob ${waveClass} ${poseClass} ${
        compact ? 'h-[60px] w-[52px]' : 'h-[88px] w-[77px]'
      } ${className}`.trim()}
      aria-hidden={!interactive}
    >
      <ellipse cx="44" cy="92" rx="28" ry="4" fill="#00000018" />
      <rect x="14" y="78" width="60" height="10" rx="4" fill={palette.base} />
      <rect x="18" y="74" width="52" height="8" rx="3" fill={palette.base2} />
      <rect
        x="26"
        y="48"
        width="36"
        height="28"
        rx="10"
        fill={palette.body}
        stroke={palette.bodyStroke}
        strokeWidth="2"
      />
      <BodyAccessoryLayer bodyAccessory={avatar.bodyAccessory} body={palette.bodyStroke} />
      <circle cx="44" cy="36" r="22" fill={palette.head} stroke={palette.bodyStroke} strokeWidth="2" />
      <HairLayer hair={avatar.hair} stroke={palette.bodyStroke} />
      <HeadAccessoryLayer headAccessory={avatar.headAccessory} />
      <circle cx="36" cy="34" r="4" fill="#1e3a5f" className="buying-bot-blink" />
      <circle cx="52" cy="34" r="4" fill="#1e3a5f" className="buying-bot-blink" />
      <circle cx="37" cy="32" r="1.2" fill="#fff" />
      <circle cx="53" cy="32" r="1.2" fill="#fff" />
      <FaceAccessoryLayer faceAccessory={avatar.faceAccessory} />
      <ExpressionLayer expression={avatar.expression} />
      <ArmsLayer
        pose={avatar.pose}
        body={palette.body}
        stroke={palette.bodyStroke}
        waving={waving}
        onRightHandClick={handHandler}
      />
    </svg>
  );
}
