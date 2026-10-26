import { LlmError, classifyError } from "./errors";

export type RetryPolicy = {
  /** Total HTTP attempts, including the first one. */
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** Ceiling for a single attempt, before the shared budget narrows it. */
  perAttemptTimeoutMs: number;
  /**
   * Wall-clock ceiling for all attempts and waits together. This exists
   * because the caller is an HTTP request handler on a platform that kills the
   * function at a fixed duration: without a shared budget, three attempts at a
   * 30s timeout plus backoff could outlive the handler, and the client would
   * get a dead connection instead of the error.
   */
  totalBudgetMs: number;
};

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 8_000,
  perAttemptTimeoutMs: 30_000,
  totalBudgetMs: 45_000,
};

export type AttemptReport = {
  attempt: number;
  latencyMs: number;
  outcome: "success" | "retrying" | "failed";
  error: LlmError | null;
};

export type WithRetryOptions = {
  policy?: RetryPolicy;
  onAttempt?: (report: AttemptReport) => void;
  signal?: AbortSignal;
};

/**
 * `send` receives the timeout it must not exceed, rather than setting its own.
 * A per-attempt timeout alone cannot keep the total inside the budget — two
 * 30s attempts plus backoff is 60s+ against a 45s budget — so the remaining
 * budget narrows each attempt as it is spent.
 */
export async function withRetry<T>(
  send: (timeoutMs: number) => Promise<T>,
  { policy = DEFAULT_RETRY_POLICY, onAttempt, signal }: WithRetryOptions = {},
): Promise<T> {
  const startedAt = Date.now();

  for (let attempt = 1; ; attempt++) {
    const attemptStartedAt = Date.now();
    const timeoutMs = Math.min(policy.perAttemptTimeoutMs, policy.totalBudgetMs - (attemptStartedAt - startedAt));

    if (timeoutMs <= 0) {
      const failure = new LlmError("timeout", "Retry budget exhausted", false);
      onAttempt?.({ attempt, latencyMs: 0, outcome: "failed", error: failure });
      throw failure;
    }

    try {
      const value = await send(timeoutMs);
      onAttempt?.({ attempt, latencyMs: Date.now() - attemptStartedAt, outcome: "success", error: null });
      return value;
    } catch (error) {
      const failure = classifyError(error);
      const latencyMs = Date.now() - attemptStartedAt;
      const lastAttempt = attempt >= policy.maxAttempts;
      const delayMs =
        failure.retryable && !lastAttempt ? computeBackoffMs(attempt, policy, failure.retryAfterSeconds) : null;
      const budgetLeftMs = policy.totalBudgetMs - (Date.now() - startedAt);

      // Waiting longer than the budget allows would mean sleeping until the
      // handler is killed. Failing now at least returns the real error, and
      // retrying earlier than a 429's retry-after just earns another 429.
      if (delayMs === null || delayMs >= budgetLeftMs) {
        onAttempt?.({ attempt, latencyMs, outcome: "failed", error: failure });
        throw failure;
      }

      onAttempt?.({ attempt, latencyMs, outcome: "retrying", error: failure });
      await sleep(delayMs, signal);
    }
  }
}

/**
 * Exponential backoff with full jitter: the delay is drawn uniformly from
 * [0, ceiling) instead of being set to the ceiling.
 *
 * Without jitter, N callers that were rate-limited by the same burst all wake
 * up at the same millisecond and recreate the burst that limited them — the
 * retry becomes a self-inflicted load test. Half jitter (ceiling/2 + random)
 * narrows that window but still clusters; full jitter spreads attempts across
 * the whole interval, which is what makes the second wave thinner than the
 * first.
 */
export function computeBackoffMs(attempt: number, policy: RetryPolicy, retryAfterSeconds: number | null): number {
  if (retryAfterSeconds !== null) {
    // Jitter is still added on top, so a fleet told "wait 2s" does not return
    // in lockstep at 2.000s.
    return retryAfterSeconds * 1000 + Math.random() * policy.baseDelayMs;
  }

  const ceiling = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
  return Math.random() * ceiling;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new LlmError("aborted", "Aborted before retrying", false));
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    function onAbort() {
      clearTimeout(timer);
      reject(new LlmError("aborted", "Aborted while waiting to retry", false));
    }

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
