export type LlmFailureCode =
  /** Safety classifier declined the request (stop_reason: "refusal"). */
  | "refusal"
  /** Hit max_tokens, so the output is cut off mid-structure. */
  | "truncated"
  /** Well-formed JSON that does not satisfy the Zod schema. */
  | "invalid_output"
  /** Non-2xx from the API. */
  | "api_error"
  /** Connection failure or timeout. */
  | "network_error";

/**
 * `retryable` is set at the throw site, by the code that knows why the call
 * failed. Stage 3's backoff only has to read this flag — it never re-inspects
 * HTTP statuses or error messages.
 */
export class LlmError extends Error {
  constructor(
    readonly code: LlmFailureCode,
    message: string,
    readonly retryable: boolean,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "LlmError";
  }
}
