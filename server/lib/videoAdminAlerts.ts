import fs from 'fs';
import path from 'path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'url';
import type { Platform } from '../types/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ALERTS_FILE = path.join(__dirname, '../../data/video-admin-alerts.json');

export interface VideoAdminAlert {
  id: string;
  type: 'video_analysis_manual_required';
  severity: 'warning';
  statusLabel: string;
  recordId: string;
  tenantId: string;
  platform: Platform;
  title: string;
  sourceUrl: string;
  reason: string;
  error: string;
  occurrences: number;
  manualUploadStatus?: 'queued' | 'analyzing' | 'analyzed' | 'failed';
  manualUploadedAt?: string;
  manualUploadRecordId?: string;
  createdAt: string;
  updatedAt: string;
}

function readAlerts(): VideoAdminAlert[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(ALERTS_FILE, 'utf8')) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isVideoAdminAlert) : [];
  } catch {
    return [];
  }
}

function writeAlerts(alerts: VideoAdminAlert[]): void {
  fs.mkdirSync(path.dirname(ALERTS_FILE), { recursive: true });
  fs.writeFileSync(ALERTS_FILE, JSON.stringify(alerts, null, 2), 'utf8');
}

function isVideoAdminAlert(value: unknown): value is VideoAdminAlert {
  if (!value || typeof value !== 'object') return false;
  const alert = value as Partial<VideoAdminAlert>;
  return alert.type === 'video_analysis_manual_required'
    && typeof alert.id === 'string'
    && typeof alert.recordId === 'string';
}

function redactSensitiveText(input: string): string {
  return input
    .replace(/(token=)[^&\s]+/gi, '$1***')
    .replace(/(api[_-]?key=)[^&\s]+/gi, '$1***')
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/g, 'Bearer ***')
    .replace(/\/\/([^:\s/@]+):([^@\s]+)@/g, '//***:***@')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1200);
}

export function recordVideoAdminAlert(input: {
  recordId: string;
  tenantId: string;
  platform: Platform;
  title: string;
  sourceUrl: string;
  reason: string;
  error: string;
}): void {
  if (!input.recordId || !input.tenantId) return;

  const now = new Date().toISOString();
  const alerts = readAlerts();
  const existingIndex = alerts.findIndex(alert =>
    alert.type === 'video_analysis_manual_required'
    && alert.recordId === input.recordId
  );
  const patch = {
    severity: 'warning' as const,
    statusLabel: '视频级失败/需人工处理',
    tenantId: input.tenantId,
    platform: input.platform,
    title: input.title.slice(0, 160),
    sourceUrl: input.sourceUrl,
    reason: input.reason,
    error: redactSensitiveText(input.error),
    updatedAt: now,
  };

  if (existingIndex >= 0) {
    const existing = alerts[existingIndex];
    alerts[existingIndex] = {
      ...existing,
      ...patch,
      occurrences: (existing.occurrences || 1) + 1,
    };
  } else {
    alerts.unshift({
      id: randomUUID(),
      type: 'video_analysis_manual_required',
      recordId: input.recordId,
      occurrences: 1,
      createdAt: now,
      ...patch,
    });
  }

  writeAlerts(alerts
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 500));
}

export function listVideoAdminAlerts(limit = 50): VideoAdminAlert[] {
  return readAlerts()
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, Math.max(1, Math.min(200, limit)));
}

export function getVideoAdminAlert(id: string): VideoAdminAlert | null {
  return readAlerts().find(alert => alert.id === id) ?? null;
}

export function updateVideoAdminAlert(id: string, patch: Partial<VideoAdminAlert>): VideoAdminAlert | null {
  const alerts = readAlerts();
  const index = alerts.findIndex(alert => alert.id === id);
  if (index < 0) return null;
  const next = {
    ...alerts[index],
    ...patch,
    updatedAt: patch.updatedAt || new Date().toISOString(),
  };
  alerts[index] = next;
  writeAlerts(alerts.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 500));
  return next;
}

export function updateVideoAdminAlertByRecordId(recordId: string, patch: Partial<VideoAdminAlert>): VideoAdminAlert | null {
  const alerts = readAlerts();
  const match = alerts.find(alert => alert.recordId === recordId);
  if (!match) return null;
  return updateVideoAdminAlert(match.id, patch);
}
