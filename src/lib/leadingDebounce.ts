/**
 * Leading-edge debounce: the first call runs immediately; further calls are ignored
 * until `intervalMs` has elapsed since that run started (wall-clock).
 */
export function createLeadingDebouncer(intervalMs: number) {
  let lastStart = 0;

  return function wrap<T extends (...args: never[]) => unknown>(fn: T): T {
    return ((...args: Parameters<T>) => {
      const now = Date.now();
      if (now - lastStart < intervalMs) return;
      lastStart = now;
      return fn(...args);
    }) as T;
  };
}
