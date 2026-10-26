import Anthropic from "@anthropic-ai/sdk";

export type LlmFailureCode =
  /** Safety classifier declined the request (stop_reason: "refusal"). */
  | "refusal"
  /** Hit max_tokens, so the output is cut off mid-structure. */
  | "truncated"
  /** Well-formed JSON that does not satisfy the Zod schema. */
  | "invalid_output"
  /** 429. Separate from api_error so the stats page can show it on its own. */
  | "rate_limited"
  /** 529 — the API is temporarily over capacity. */
  | "overloaded"
  /** Any other non-2xx response. */
  | "api_error"
  /** Connection failure. */
  | "network_error"
  /** The request exceeded the per-attempt timeout. */
  | "timeout"
  /** The caller aborted. Not a failure of ours and never retried. */
  | "aborted";

/**
 * `retryable` is decided here, where the cause is known, rather than by the
 * backoff code. The retry loop only reads the flag — it never re-inspects HTTP
 * statuses or matches error text.
 */
export class LlmError extends Error {
  readonly retryAfterSeconds: number | null;

  constructor(
    readonly code: LlmFailureCode,
    message: string,
    readonly retryable: boolean,
    options?: { cause?: unknown; retryAfterSeconds?: number | null },
  ) {
    super(message, { cause: options?.cause });
    this.name = "LlmError";
    this.retryAfterSeconds = options?.retryAfterSeconds ?? null;
  }
}

/**
 * Statuses that are worth sending the same request again.
 *
 * 408 and 409 are transport-level races. Everything absent from this set is a
 * statement about the request itself — 400 malformed, 401 bad key, 402 out of
 * credit, 403 no access, 404 wrong model id, 413 too large, 422 unprocessable.
 * Repeating any of those produces the same response, three times the latency
 * and, where the request is billable, three times the bill. Worse, retrying a
 * 401 or a 402 across many concurrent generations turns a configuration
 * mistake into a burst of traffic against an endpoint that is already saying no.
 */
const RETRYABLE_STATUSES = new Set([408, 409, 429, 500, 502, 503, 504, 529]);

export function classifyError(error: unknown): LlmError {
  if (error instanceof LlmError) return error;

  // Checked before APIConnectionError: an abort is a user decision, not a
  // transport failure, and retrying it would restart work nobody is waiting for.
  if (error instanceof Anthropic.APIUserAbortError) {
    return new LlmError("aborted", "Request was aborted", false, { cause: error });
  }

  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new LlmError("timeout", "Request timed out", true, { cause: error });
  }

  if (error instanceof Anthropic.APIConnectionError) {
    return new LlmError("network_error", error.message, true, { cause: error });
  }

  if (error instanceof Anthropic.APIError) {
    const status = error.status ?? 0;
    const retryAfterSeconds = readRetryAfter(error.headers);
    const code: LlmFailureCode =
      status === 429 ? "rate_limited" : status === 529 ? "overloaded" : "api_error";

    return new LlmError(
      code,
      `${status} ${error.type ?? "unknown"}: ${error.message}`,
      RETRYABLE_STATUSES.has(status),
      { cause: error, retryAfterSeconds },
    );
  }

  // Nothing is known about this failure, so it is not assumed to be transient.
  return new LlmError("api_error", error instanceof Error ? error.message : String(error), false, {
    cause: error,
  });
}

/**
 * On a 429 the server states how long to wait. That instruction outranks any
 * backoff curve computed on the client.
 */
function readRetryAfter(headers: Headers | undefined): number | null {
  const raw = headers?.get("retry-after");
  if (!raw) return null;

  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}
