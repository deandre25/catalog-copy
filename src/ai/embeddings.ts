import { z } from "zod";

import { env } from "@/lib/env";

import { LlmError, RETRYABLE_STATUSES } from "./errors";
import { MODELS } from "./models";
import { withRetry, type RetryPolicy } from "./retry";
import type { CallTelemetry } from "./telemetry";

/**
 * Anthropic has no embeddings endpoint, so this is the one call in the project
 * that does not go through the Anthropic SDK. Voyage is used because it is the
 * provider Anthropic recommends for retrieval and because `voyage-4-lite` is
 * cheap enough that re-indexing the whole catalog is not a decision anyone has
 * to think about.
 *
 * The HTTP call is hand-written rather than pulled in as another SDK: it is one
 * POST, and writing it here keeps the retry, timeout and ledger behaviour
 * identical to the Anthropic calls instead of inheriting a second SDK's own.
 */
const ENDPOINT = "https://api.voyageai.com/v1/embeddings";

/**
 * Bump when the composition of the embedded text changes (see composeEmbeddingInput).
 *
 * Unlike a prompt version this cannot be used to invalidate anything lazily:
 * vectors from two different input formats are not comparable, so a change
 * here means the catalog has to be re-indexed before search is trustworthy.
 */
export const EMBEDDING_INPUT_VERSION = "embedding@1";

/**
 * Must match `vector(1024)` in the migration. 1024 is the model's default;
 * Voyage can also return 256, 512 or 2048 via Matryoshka truncation, but the
 * column type is fixed at migration time, so this is not a runtime knob —
 * changing it is a migration plus a full re-index.
 */
export const EMBEDDING_DIMENSIONS = 1024;

/**
 * Embeddings are a single short POST with no generation step, so a request that
 * has not answered in ten seconds is not going to. The tighter budget also
 * keeps indexing from eating into the time the description stream is allowed.
 */
const EMBEDDING_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 300,
  maxDelayMs: 4_000,
  perAttemptTimeoutMs: 10_000,
  totalBudgetMs: 20_000,
};

/**
 * Voyage prepends a different instruction depending on this field, which is
 * what makes the stored vectors and the search vector comparable at all: the
 * document side is encoded as "a thing that could answer a question", the query
 * side as "a question looking for a document". Embedding a query with
 * input_type "document" still returns 1024 numbers and still produces a
 * ranking — just a measurably worse one, which is the kind of bug that never
 * throws.
 */
export type EmbeddingInputType = "document" | "query";

/** The ledger separates the two sides; input_type is what already distinguishes them. */
const LEDGER_TASK = { document: "embedding", query: "embedding-query" } as const;

const responseSchema = z.object({
  data: z.array(z.object({ index: z.number().int(), embedding: z.array(z.number()) })),
  usage: z.object({ total_tokens: z.number().int() }),
});

export type EmbeddingResult = {
  vectors: number[][];
  tokens: number;
};

export async function embed(
  texts: readonly string[],
  {
    inputType,
    signal,
    onCall,
  }: {
    inputType: EmbeddingInputType;
    signal?: AbortSignal;
    onCall?: (call: CallTelemetry) => void;
  },
): Promise<EmbeddingResult> {
  if (texts.length === 0) return { vectors: [], tokens: 0 };

  let successLatencyMs = 0;
  let successTokens = 0;

  const result = await withRetry(
    async (timeoutMs) => {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.VOYAGE_API_KEY}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: MODELS.embedding,
          input: texts,
          input_type: inputType,
          output_dimension: EMBEDDING_DIMENSIONS,
          // The caller is expected to keep inputs well inside the context
          // window; truncation false turns a silently shortened embedding —
          // which still ranks, just wrongly — into an error we can see.
          truncation: false,
        }),
        signal: deadline(timeoutMs, signal),
      }).catch((error: unknown) => {
        throw transportError(error, signal);
      });

      if (!response.ok) throw await httpError(response);

      const parsed = responseSchema.safeParse(await response.json());

      if (!parsed.success) {
        throw new LlmError("invalid_output", "Embedding response had an unexpected shape", false);
      }

      // The vector is about to be written into a fixed-width column. A
      // dimension mismatch caught here names the real cause; caught by
      // Postgres it arrives as a cast error from inside a raw query.
      for (const item of parsed.data.data) {
        if (item.embedding.length !== EMBEDDING_DIMENSIONS) {
          throw new LlmError(
            "invalid_output",
            `Expected ${EMBEDDING_DIMENSIONS} dimensions, got ${item.embedding.length}`,
            false,
          );
        }
      }

      successTokens = parsed.data.usage.total_tokens;

      return {
        // The API documents `index` rather than guaranteeing order, so results
        // are placed by it: a reordered response would otherwise attach each
        // vector to the wrong product.
        vectors: [...parsed.data.data]
          .sort((a, b) => a.index - b.index)
          .map((item) => item.embedding),
        tokens: parsed.data.usage.total_tokens,
      };
    },
    {
      policy: EMBEDDING_RETRY_POLICY,
      signal,
      onAttempt: (report) => {
        if (report.outcome === "success") {
          successLatencyMs = report.latencyMs;
          return;
        }

        onCall?.({
          task: LEDGER_TASK[inputType],
          model: MODELS.embedding,
          promptVersion: EMBEDDING_INPUT_VERSION,
          attempt: report.attempt,
          status: report.outcome === "retrying" ? "RETRIED" : "FAILED",
          inputTokens: 0,
          outputTokens: 0,
          latencyMs: report.latencyMs,
          errorCode: report.error?.code ?? null,
        });
      },
    },
  );

  onCall?.({
    task: LEDGER_TASK[inputType],
    model: MODELS.embedding,
    promptVersion: EMBEDDING_INPUT_VERSION,
    attempt: 1,
    status: "SUCCESS",
    // Embeddings are billed on input only; there is no output token count.
    inputTokens: successTokens,
    outputTokens: 0,
    latencyMs: successLatencyMs,
    errorCode: null,
  });

  return result;
}

/**
 * The retry loop hands down the timeout it wants, and the caller may abort
 * independently, so both have to reach one fetch. AbortSignal.any forwards
 * whichever fires first together with its reason, which is what lets
 * transportError tell a timeout apart from a cancellation.
 */
function deadline(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([timeout, signal]) : timeout;
}

function transportError(error: unknown, signal?: AbortSignal): LlmError {
  if (error instanceof LlmError) return error;

  // The caller's signal is checked first: a cancellation is a decision, not a
  // transport failure, and retrying it would restart work nobody is waiting for.
  if (signal?.aborted) return new LlmError("aborted", "Request was aborted", false, { cause: error });

  if (error instanceof DOMException && error.name === "TimeoutError") {
    return new LlmError("timeout", "Embedding request timed out", true, { cause: error });
  }

  return new LlmError(
    "network_error",
    error instanceof Error ? error.message : String(error),
    true,
    { cause: error },
  );
}

async function httpError(response: Response): Promise<LlmError> {
  // Voyage returns { detail: "..." } on 4xx. Read defensively: an error page
  // from a proxy in front of the API is not JSON at all.
  const detail = await response
    .text()
    .then((body) => {
      try {
        const parsed: unknown = JSON.parse(body);
        if (parsed && typeof parsed === "object" && "detail" in parsed) {
          return String((parsed as { detail: unknown }).detail);
        }
      } catch {
        /* fall through to the raw body */
      }
      return body.slice(0, 200);
    })
    .catch(() => response.statusText);

  const retryAfter = Number(response.headers.get("retry-after"));

  return new LlmError(
    response.status === 429 ? "rate_limited" : "api_error",
    `${response.status}: ${detail}`,
    // The same table the Anthropic path uses: a 401 or a 400 says something
    // about the request, and sending it twice more only triples the latency.
    RETRYABLE_STATUSES.has(response.status),
    { retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter : null },
  );
}

/**
 * Postgres accepts a vector as its text form, and parameterising it as a
 * string keeps the query parameterised — a 1024-element array interpolated
 * into SQL by hand is both slower to parse and an injection waiting to happen.
 */
export function toVectorLiteral(vector: readonly number[]): string {
  return `[${vector.join(",")}]`;
}
