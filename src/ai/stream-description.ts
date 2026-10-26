import { Anthropic, anthropic } from "./client";
import { classifyError, type LlmFailureCode } from "./errors";
import { MODELS } from "./models";
import {
  DESCRIPTION_PROMPT_VERSION,
  DESCRIPTION_SYSTEM_PROMPT,
  buildDescriptionUserMessage,
} from "./prompts/description";
import { DEFAULT_RETRY_POLICY, computeBackoffMs, sleep } from "./retry";
import type { CallTelemetry } from "./telemetry";

// A 250-word description is roughly 400 tokens. 2000 bounds a runaway
// generation while leaving five times the expected length as headroom.
const MAX_TOKENS = 2000;

export type DescriptionEvent =
  | { type: "delta"; text: string }
  | { type: "done"; description: string }
  | { type: "failed"; code: LlmFailureCode; message: string; partial: string };

export type DescriptionInput = {
  rawSpecs: string;
  seoTitle: string;
  benefits: string[];
};

export type StreamOptions = {
  onCall?: (call: CallTelemetry) => void;
  signal?: AbortSignal;
};

/**
 * Yields text as it arrives and ends with exactly one terminal event, so the
 * consumer never has to guess whether a stream that stopped was finished or
 * broken.
 *
 * An async generator rather than a callback API: the `finally` block below runs
 * when the consumer stops iterating early, which is how a client disconnect
 * reaches the SDK's abort.
 */
export async function* streamDescription(
  input: DescriptionInput,
  { onCall, signal }: StreamOptions = {},
): AsyncGenerator<DescriptionEvent> {
  const policy = DEFAULT_RETRY_POLICY;
  const startedAt = Date.now();
  let text = "";

  for (let attempt = 1; ; attempt++) {
    const attemptStartedAt = Date.now();
    const stream = anthropic.messages.stream(
      {
        model: MODELS.description,
        max_tokens: MAX_TOKENS,
        system: DESCRIPTION_SYSTEM_PROMPT,
        // Thinking off. With it on, the model reasons before emitting any text,
        // and because thinking is not displayed by default the user watches an
        // empty box for several seconds — which defeats the only reason to
        // stream. There is no reasoning worth showing for catalog prose, and
        // thinking tokens are billed at the output rate.
        thinking: { type: "between_tools" },
        // between_tools is rejected above "high".
        output_config: { effort: "medium" },
        messages: [{ role: "user", content: buildDescriptionUserMessage(input) }],
      },
      { signal },
    );

    // Distinguishes "the stream is over" from "the consumer walked away", which
    // is what the finally block has to know.
    let settled = false;

    /**
     * Accumulated from the stream rather than read from finalMessage.
     *
     * An aborted or broken stream never produces a final message, but the
     * provider has already generated — and billed — whatever arrived before it
     * broke. Reading usage only on success made the ledger report a cancelled
     * generation as free, which understates spend in exactly the case this
     * project treats as a feature.
     */
    let usage: Anthropic.Usage | null = null;

    try {
      for await (const event of stream) {
        if (event.type === "message_start") {
          usage = event.message.usage;
          continue;
        }

        if (event.type === "message_delta") {
          // output_tokens on a message_delta is the running total, not an
          // increment, so it replaces rather than adds.
          if (usage) usage = { ...usage, output_tokens: event.usage.output_tokens };
          continue;
        }

        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          text += event.delta.text;
          yield { type: "delta", text: event.delta.text };
        }
      }

      const final = await stream.finalMessage();

      onCall?.(
        telemetry(attempt, "SUCCESS", final.usage, Date.now() - attemptStartedAt, null),
      );

      if (final.stop_reason === "refusal") {
        settled = true;
        yield {
          type: "failed",
          code: "refusal",
          message: `Model declined the request (${final.stop_details?.category ?? "no category"})`,
          partial: text,
        };
        return;
      }

      // Truncation is reported rather than thrown: unlike the structured call,
      // 1900 tokens of usable prose cut off at the end is still worth keeping.
      if (final.stop_reason === "max_tokens") {
        settled = true;
        yield {
          type: "failed",
          code: "truncated",
          message: `Response hit the ${MAX_TOKENS} token ceiling`,
          partial: text,
        };
        return;
      }

      settled = true;
      yield { type: "done", description: text };
      return;
    } catch (error) {
      const failure = classifyError(error);
      const latencyMs = Date.now() - attemptStartedAt;

      // The decisive condition: once a single delta has been delivered, the
      // attempt is not repeatable. Retrying would restart the model from the
      // beginning and append a second description to the text already on the
      // user's screen. Resuming mid-sentence is not something the API offers,
      // so a stream that broke after it started is reported with its partial
      // text and ends there.
      const resumable = text.length === 0;
      const budgetLeftMs = policy.totalBudgetMs - (Date.now() - startedAt);
      const delayMs =
        resumable && failure.retryable && attempt < policy.maxAttempts
          ? computeBackoffMs(attempt, policy, failure.retryAfterSeconds)
          : null;

      if (delayMs === null || delayMs >= budgetLeftMs) {
        // The counts are the last ones the provider sent. message_delta
        // carries the running output total only near the end of a response,
        // so on an abort this is a floor, not the exact figure — measured 772
        // input and 8 output tokens for a cancellation that had produced about
        // 200. It is recorded as measured rather than topped up with an
        // estimate: a ledger that mixes the two cannot be reconciled against
        // an invoice. Zero was simply wrong.
        onCall?.(telemetry(attempt, "FAILED", usage, latencyMs, failure.code));
        settled = true;
        yield { type: "failed", code: failure.code, message: failure.message, partial: text };
        return;
      }

      onCall?.(telemetry(attempt, "RETRIED", usage, latencyMs, failure.code));
      await sleep(delayMs, signal);
    } finally {
      // Only for the torn-down case: the consumer broke out of its for-await,
      // or this attempt is being abandoned. Without it the connection to the
      // provider stays open and tokens nobody will read keep being billed.
      // Aborting an already-settled stream would reject its internal promises
      // after they were awaited, which surfaces as an unhandled rejection.
      if (!settled && !stream.aborted) stream.abort();
    }
  }
}

function telemetry(
  attempt: number,
  status: CallTelemetry["status"],
  usage: Anthropic.Usage | null,
  latencyMs: number,
  errorCode: CallTelemetry["errorCode"],
): CallTelemetry {
  return {
    task: "description",
    model: MODELS.description,
    promptVersion: DESCRIPTION_PROMPT_VERSION,
    attempt,
    status,
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    latencyMs,
    errorCode,
  };
}
