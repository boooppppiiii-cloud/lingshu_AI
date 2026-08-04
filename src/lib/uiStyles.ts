import type { CSSProperties } from 'react';

export const CHART_TOOLTIP_STYLE: CSSProperties = {
  border: '1px solid #e2e8f0',
  borderRadius: 14,
  background: 'rgba(255, 255, 255, 0.98)',
  boxShadow: '0 14px 36px rgba(15, 23, 42, 0.14)',
  color: '#0f172a',
  fontSize: 11,
  lineHeight: 1.5,
  padding: '9px 11px',
};

export const CHART_CURSOR_STYLE = { fill: 'rgba(22, 163, 74, 0.06)' } as const;
