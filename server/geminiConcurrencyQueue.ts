/**
 * Limits outbound Gemini work: max 2 concurrent, max 15 starts per rolling 60s.
 * Callers wait with short jitter sleeps when limits are hit (no artificial reject).
 */

const MAX_CONCURRENT = 2;
const WINDOW_MS = 60_000;
const MAX_STARTS_PER_WINDOW = 15;

let activeCount = 0;
const startTimestamps: number[] = [];

function pruneWindow(now: number) {
  const cutoff = now - WINDOW_MS;
  while (startTimestamps.length > 0 && startTimestamps[0]! < cutoff) {
    startTimestamps.shift();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function smallJitterSleep(): Promise<void> {
  return sleep(50 + Math.random() * 200);
}

let mutex: Promise<void> = Promise.resolve();

async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  let release!: () => void;
  const next = new Promise<void>((r) => {
    release = r;
  });
  const prev = mutex;
  mutex = next;
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}

async function tryAdmit(): Promise<boolean> {
  return withLock(async () => {
    const now = Date.now();
    pruneWindow(now);
    if (activeCount < MAX_CONCURRENT && startTimestamps.length < MAX_STARTS_PER_WINDOW) {
      activeCount += 1;
      startTimestamps.push(Date.now());
      return true;
    }
    return false;
  });
}

async function releaseSlot(): Promise<void> {
  await withLock(async () => {
    activeCount = Math.max(0, activeCount - 1);
  });
}

/** Run `fn` after passing concurrency + rate limits; waits as long as needed. */
export async function runGeminiThroughQueue<T>(fn: () => Promise<T>): Promise<T> {
  while (!(await tryAdmit())) {
    await smallJitterSleep();
  }
  try {
    return await fn();
  } finally {
    await releaseSlot();
  }
}
