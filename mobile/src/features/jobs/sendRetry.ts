// G11, bounded: poor highway signal. When a request cannot reach Sahayak at all
// (no HTTP response), resend the SAME request with the SAME idempotency key until
// it lands or the window closes. The backend de-duplicates on that key, so a
// request that did arrive but whose answer was lost is never created twice.
//
// Deliberately not a queue that survives the app closing: a request sent ten
// minutes after the owner gave up and phoned a tow truck dispatches a partner
// to nobody. The owner sees the retry and can stop it.

export const RETRY_INTERVAL_MS = 5000;
export const RETRY_WINDOW_MS = 3 * 60 * 1000;

/** An axios error with no response never reached the server (offline, DNS, timeout). */
export function isNoSignal(err: unknown): boolean {
  const e = err as { response?: unknown; isAxiosError?: boolean; message?: string } | null;
  if (!e || typeof e !== "object") return false;
  return e.response === undefined && (e.isAxiosError === true || /network|timeout/i.test(e.message ?? ""));
}

export interface RetryOptions {
  intervalMs?: number;
  windowMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Called before each retry (not the first attempt) with the attempt number. */
  onRetry?: (attempt: number, msLeft: number) => void;
  /** Return true to stop retrying (the owner tapped Stop). */
  stopped?: () => boolean;
}

export class RetryStopped extends Error {
  constructor() {
    super("STOPPED");
  }
}

export async function sendWithRetry<T>(send: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const interval = opts.intervalMs ?? RETRY_INTERVAL_MS;
  const windowMs = opts.windowMs ?? RETRY_WINDOW_MS;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const started = now();
  let attempt = 0;
  for (;;) {
    try {
      return await send();
    } catch (err) {
      if (!isNoSignal(err)) throw err;
      const left = windowMs - (now() - started);
      if (left <= interval) throw err;
      await sleep(interval);
      if (opts.stopped?.()) throw new RetryStopped();
      attempt += 1;
      opts.onRetry?.(attempt, left - interval);
    }
  }
}
