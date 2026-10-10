import { RateLimitError, type SadaSendError } from './errors.js';

/**
 * When to try again, and how long to wait.
 *
 * Two rules, and the second is the one nobody implements:
 *
 * 1. **Exponential backoff with full jitter.** Fixed backoff synchronises every
 *    client that was refused in the same second, so they all return together and
 *    refuse together — the thundering herd that turns a brief limit into a long
 *    one. Full jitter (a uniform draw from `[0, backoff]`) spreads them.
 *
 * 2. **`Retry-After` wins, always.** The API already sends it — it is the
 *    server saying exactly when the window rolls over — and until this SDK
 *    existed nothing read it. A client that guesses shorter makes the limit
 *    worse; a client that guesses longer makes the customer wait for nothing.
 *    The header is not advice.
 */

export type RetryPolicy = {
  /** Attempts *after* the first. 0 disables retrying entirely. */
  maxRetries: number;
  /** First backoff, doubling each attempt. */
  baseDelayMs: number;
  /** Ceiling on the computed backoff. `Retry-After` is not capped by this. */
  maxDelayMs: number;
  /**
   * How long a `Retry-After` may ask us to sleep before the client gives up
   * and returns the error instead. An account throttled for reputation can be
   * told to come back in an hour, and blocking a request handler for an hour is
   * worse than returning an error the caller can schedule around.
   */
  maxRetryAfterMs: number;
};

export const DEFAULT_RETRY: RetryPolicy = {
  maxRetries: 3,
  baseDelayMs: 500,
  maxDelayMs: 8_000,
  maxRetryAfterMs: 60_000,
};

/**
 * The wait before attempt `n` (1-based), or `null` for "stop, return the error".
 *
 * Split out and pure so the policy can be tested without sleeping — a retry
 * test that actually waits is a test nobody runs often enough to trust.
 */
export function delayFor(
  attempt: number,
  error: SadaSendError,
  policy: RetryPolicy,
  random: () => number = Math.random,
): number | null {
  if (attempt > policy.maxRetries) return null;

  if (error instanceof RateLimitError && error.retryAfterSeconds !== undefined) {
    const asked = error.retryAfterSeconds * 1000;
    // Longer than we are willing to block: surface the error with the header
    // intact so the caller can decide, rather than silently sleeping on it.
    if (asked > policy.maxRetryAfterMs) return null;
    // Not jittered, and not backed off. The server named a time.
    return asked;
  }

  const backoff = Math.min(policy.baseDelayMs * 2 ** (attempt - 1), policy.maxDelayMs);
  return Math.floor(random() * backoff);
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
