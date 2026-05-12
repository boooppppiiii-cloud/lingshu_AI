import type { FlashScriptDiagnosis } from '../services/gemini';
import { Activity } from 'lucide-react';

type Props = {
  data: FlashScriptDiagnosis | null;
  loading: boolean;
  error: string | null;
};

function statusStyle(status: 'strong' | 'ok' | 'weak') {
  if (status === 'strong') return 'bg-emerald-50 text-emerald-800 border-emerald-200';
  if (status === 'weak') return 'bg-rose-50 text-rose-800 border-rose-200';
  return 'bg-amber-50 text-amber-900 border-amber-200';
}

function statusLabel(status: 'strong' | 'ok' | 'weak') {
  if (status === 'strong') return '强';
  if (status === 'weak') return '弱';
  return '中';
}

export default function FlashScriptDiagnosisPanel({ data, loading, error }: Props) {
  if (loading) {
    return (
      <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-2 text-sm font-bold text-slate-600">
          <Activity className="w-4 h-4 animate-pulse text-accent-blue" />
          正在根据脚本生成情绪曲线与 3s/8s 诊断…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-[2rem] border border-rose-100 bg-rose-50/80 p-6 text-sm text-rose-800">
        {error}
      </div>
    );
  }

  if (!data || data.emotionCurve.length === 0) {
    return null;
  }

  const { totalSeconds, emotionCurve, hook3s, selling8s } = data;
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
  const areaPath = (() => {
    if (emotionCurve.length === 0) return '';
    const first = emotionCurve[0]!;
    const last = emotionCurve[emotionCurve.length - 1]!;
    const baseY = padT + chartH;
    let d = `M ${xAt(first.t).toFixed(1)} ${baseY} L `;
    d += emotionCurve.map((p) => `${xAt(p.t).toFixed(1)} ${yAt(p.intensity).toFixed(1)}`).join(' L ');
    d += ` L ${xAt(last.t).toFixed(1)} ${baseY} Z`;
    return d;
  })();

  const mark3 = totalSeconds >= 1 ? xAt(Math.min(3, totalSeconds)) : null;
  const mark8 = totalSeconds >= 1 ? xAt(Math.min(8, totalSeconds)) : null;

  return (
    <div className="space-y-6 rounded-[2rem] border border-slate-200 bg-white p-6 md:p-8 shadow-sm">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h4 className="text-sm font-black uppercase tracking-widest text-primary-blue flex items-center gap-2">
          <Activity className="w-4 h-4 text-accent-blue" />
          脚本情绪曲线
        </h4>
        <span className="text-[11px] font-bold text-slate-400">推断总时长约 {totalSeconds}s</span>
      </div>

      <div className="relative w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${vbW} ${vbH}`}
          className="w-full max-w-full h-[140px]"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="情绪强度随时间变化"
        >
          <defs>
            <linearGradient id="flashCurveFill" x1="0" y1="0" x2="0" y2="1">
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
          {mark3 !== null && totalSeconds >= 3 ? (
            <g>
              <line x1={mark3} x2={mark3} y1={padT} y2={padT + chartH} stroke="rgb(251 146 60)" strokeWidth="1.5" strokeDasharray="4 3" />
              <text x={mark3} y={vbH - 6} textAnchor="middle" fill="#c2410c" fontSize="9" fontWeight="700">
                3s
              </text>
            </g>
          ) : null}
          {mark8 !== null && totalSeconds >= 4 ? (
            <g>
              <line x1={mark8} x2={mark8} y1={padT} y2={padT + chartH} stroke="rgb(34 197 94)" strokeWidth="1.5" strokeDasharray="4 3" />
              <text x={mark8} y={vbH - 6} textAnchor="middle" fill="#047857" fontSize="9" fontWeight="700">
                8s
              </text>
            </g>
          ) : null}
          <path d={areaPath} fill="url(#flashCurveFill)" />
          <polyline fill="none" stroke="rgb(37 99 235)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" points={linePoints} />
          {emotionCurve.map((p, i) => (
            <circle key={`${p.t}-${i}`} cx={xAt(p.t)} cy={yAt(p.intensity)} r="3" fill="white" stroke="rgb(37 99 235)" strokeWidth="1.5" />
          ))}
        </svg>
        <p className="text-[10px] text-slate-400 mt-1">
          纵轴为情绪/冲突强度（0–100，模型推断）；橙线 3s 吸睛窗口，绿线 8s 卖点窗口。
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <DiagCard title="3 秒吸睛" subtitle="前 3 秒钩子与悬念" diag={hook3s} />
        <DiagCard title="8 秒卖点" subtitle="前 8 秒利益点是否清晰" diag={selling8s} />
      </div>
    </div>
  );
}

function DiagCard({
  title,
  subtitle,
  diag,
}: {
  title: string;
  subtitle: string;
  diag: FlashScriptDiagnosis['hook3s'];
}) {
  return (
    <div className={`rounded-2xl border-2 p-5 ${statusStyle(diag.status)}`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <p className="text-xs font-black uppercase tracking-widest opacity-80">{title}</p>
          <p className="text-[10px] font-medium opacity-70 mt-0.5">{subtitle}</p>
        </div>
        <div className="text-right shrink-0">
          <span className="text-[10px] font-black uppercase tracking-wider">强度 {statusLabel(diag.status)}</span>
          <p className="text-2xl font-black leading-none mt-1">{diag.score}<span className="text-xs font-bold opacity-60">/10</span></p>
        </div>
      </div>
      <p className="text-sm leading-relaxed font-medium mb-3">{diag.finding || '—'}</p>
      {diag.suggestions.length > 0 ? (
        <ul className="text-xs space-y-1.5 list-disc pl-4 marker:text-current opacity-90">
          {diag.suggestions.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
