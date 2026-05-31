import type { BuyingFullAnalysis } from '../types';
import { Activity } from 'lucide-react';

type Props = {
  data: BuyingFullAnalysis | null | undefined;
};

export default function BuyingVideoEmotionCurve({ data }: Props) {
  if (!data || data.emotionCurve.length < 2) {
    return (
      <p className="text-[11px] leading-relaxed text-slate-400">
        全片情绪曲线待生成（新上传或重新分析后将自动出现）
      </p>
    );
  }

  const { totalSeconds, emotionCurve, peak3sSec, peakFullSec, firstSellingPointSec } = data;
  const padL = 8;
  const padR = 8;
  const padT = 12;
  const padB = 28;
  const vbW = 320;
  const vbH = 120;
  const chartW = vbW - padL - padR;
  const chartH = vbH - padT - padB;
  const xAt = (t: number) => padL + (totalSeconds > 0 ? (t / totalSeconds) * chartW : 0);
  const yAt = (intensity: number) => padT + chartH - (intensity / 100) * chartH;

  const linePoints = emotionCurve.map((p) => `${xAt(p.t).toFixed(1)},${yAt(p.intensity).toFixed(1)}`).join(' ');
  const first = emotionCurve[0]!;
  const last = emotionCurve[emotionCurve.length - 1]!;
  const baseY = padT + chartH;
  const areaPath = `M ${xAt(first.t).toFixed(1)} ${baseY} L ${emotionCurve.map((p) => `${xAt(p.t).toFixed(1)} ${yAt(p.intensity).toFixed(1)}`).join(' L ')} L ${xAt(last.t).toFixed(1)} ${baseY} Z`;

  const mark = (t: number, color: string, label: string) => {
    const x = xAt(Math.max(0, Math.min(totalSeconds, t)));
    return (
      <g key={label}>
        <line x1={x} x2={x} y1={padT} y2={padT + chartH} stroke={color} strokeWidth="1.5" strokeDasharray="4 3" />
        <text x={x} y={vbH - 6} textAnchor="middle" fill={color} fontSize="9" fontWeight="700">
          {label}
        </text>
      </g>
    );
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-bold text-primary-blue">
          <Activity className="h-3.5 w-3.5 text-accent-blue" />
          全片情绪曲线
        </span>
        <span className="text-[10px] font-bold text-slate-400">约 {totalSeconds}s</span>
      </div>
      <div className="relative w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${vbW} ${vbH}`}
          className="h-[130px] w-full max-w-full"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="全片情绪强度随时间变化"
        >
          <defs>
            <linearGradient id="buyingCurveFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgb(59 130 246)" stopOpacity="0.35" />
              <stop offset="100%" stopColor="rgb(59 130 246)" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          <rect x={padL} y={padT} width={chartW} height={chartH} fill="rgb(248 250 252)" rx="6" />
          {[0, 0.25, 0.5, 0.75, 1].map((r) => (
            <line
              key={r}
              x1={padL}
              x2={padL + chartW}
              y1={padT + chartH * r}
              y2={padT + chartH * r}
              stroke="rgb(226 232 240)"
              strokeWidth="1"
            />
          ))}
          {mark(peak3sSec, '#c2410c', '3s高潮')}
          {mark(peakFullSec, '#7c3aed', '全片高潮')}
          {mark(firstSellingPointSec, '#047857', '卖点')}
          <path d={areaPath} fill="url(#buyingCurveFill)" />
          <polyline
            fill="none"
            stroke="rgb(37 99 235)"
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeLinecap="round"
            points={linePoints}
          />
          {emotionCurve.map((p, i) => (
            <circle
              key={`${p.t}-${i}`}
              cx={xAt(p.t)}
              cy={yAt(p.intensity)}
              r="3"
              fill="white"
              stroke="rgb(37 99 235)"
              strokeWidth="1.5"
            />
          ))}
        </svg>
        <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
          橙线 3s 情绪高潮 {peak3sSec.toFixed(1)}s · 紫线全片高潮 {peakFullSec.toFixed(1)}s · 绿线卖点首次{' '}
          {firstSellingPointSec.toFixed(1)}s
        </p>
      </div>
    </div>
  );
}
