import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const BUDGET_FILE = path.resolve(process.cwd(), 'data/seedance-budget-usage.json');

interface BudgetEntry {
  reservationId: string;
  amountCny: number;
  duration: number;
  resolution: string;
  createdAt: string;
}

type BudgetStore = Record<string, Record<string, BudgetEntry[]>>;

export interface SeedanceBudgetReservation {
  ok: boolean;
  reservationId?: string;
  limitCny: number;
  usedCny: number;
  reservedCny: number;
  remainingCny: number;
}

function positiveNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function monthKey(date = new Date()): string {
  return date.toISOString().slice(0, 7);
}

function readStore(): BudgetStore {
  try {
    return JSON.parse(fs.readFileSync(BUDGET_FILE, 'utf8')) as BudgetStore;
  } catch {
    return {};
  }
}

function writeStore(store: BudgetStore): void {
  fs.mkdirSync(path.dirname(BUDGET_FILE), { recursive: true });
  const temporary = `${BUDGET_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(temporary, BUDGET_FILE);
}

export function seedanceMonthlyBudgetCny(): number {
  return positiveNumber('SEEDANCE_TENANT_MONTHLY_BUDGET_CNY', 200);
}

export function estimateSeedanceCostCny(duration: number, resolution: string): number {
  const normalized = String(resolution || '720p').toLowerCase();
  const rate = normalized === '480p'
    ? positiveNumber('SEEDANCE_ESTIMATED_CNY_PER_SECOND_480P', 0.9)
    : normalized === '1080p'
      ? positiveNumber('SEEDANCE_ESTIMATED_CNY_PER_SECOND_1080P', 3)
      : positiveNumber('SEEDANCE_ESTIMATED_CNY_PER_SECOND_720P', 1.5);
  return Math.ceil(Math.max(1, duration) * rate * 100) / 100;
}

export function reserveSeedanceBudget(input: {
  tenantId: string;
  duration: number;
  resolution: string;
}): SeedanceBudgetReservation {
  const limitCny = seedanceMonthlyBudgetCny();
  const reservedCny = estimateSeedanceCostCny(input.duration, input.resolution);
  const store = readStore();
  const month = monthKey();
  const entries = store[input.tenantId]?.[month] || [];
  const usedCny = Math.round(entries.reduce((sum, entry) => sum + Number(entry.amountCny || 0), 0) * 100) / 100;
  const remainingCny = Math.max(0, Math.round((limitCny - usedCny) * 100) / 100);

  if (usedCny + reservedCny > limitCny) {
    return { ok: false, limitCny, usedCny, reservedCny, remainingCny };
  }

  const reservationId = randomUUID();
  const entry: BudgetEntry = {
    reservationId,
    amountCny: reservedCny,
    duration: input.duration,
    resolution: input.resolution,
    createdAt: new Date().toISOString(),
  };
  store[input.tenantId] = { ...(store[input.tenantId] || {}), [month]: [...entries, entry] };
  writeStore(store);
  return {
    ok: true,
    reservationId,
    limitCny,
    usedCny: Math.round((usedCny + reservedCny) * 100) / 100,
    reservedCny,
    remainingCny: Math.max(0, Math.round((limitCny - usedCny - reservedCny) * 100) / 100),
  };
}

export function releaseSeedanceBudget(tenantId: string, reservationId: string): void {
  const store = readStore();
  const month = monthKey();
  const entries = store[tenantId]?.[month] || [];
  const next = entries.filter(entry => entry.reservationId !== reservationId);
  if (next.length === entries.length) return;
  store[tenantId] = { ...(store[tenantId] || {}), [month]: next };
  writeStore(store);
}
