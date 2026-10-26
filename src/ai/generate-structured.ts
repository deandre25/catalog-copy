import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

import { Anthropic, anthropic } from "./client";
import { LlmError, classifyError } from "./errors";
import { MODELS } from "./models";
import {
  STRUCTURED_PROMPT_VERSION,
  STRUCTURED_SYSTEM_PROMPT,
  buildRepairMessage,
  buildStructuredUserMessage,
} from "./prompts/structured";
import { withRetry } from "./retry";
import { structuredCopySchema, type StructuredCopy } from "./schemas";
import type { CallTelemetry } from "./telemetry";

/**
 * One repair turn, not three. Structured outputs make the response's shape a
 * server-side guarantee, so a failure here is a length or count violation, and
 * those are the model misjudging the same instruction twice in a row. A second
 * repair mostly buys a third bill for the same mistake; a persistent failure is
 * a prompt or schema problem and belongs in the error log, not in a retry loop.
 *
 * This is a separate axis from transport retries in retry.ts: a retry sends the
 * same request again after a transient failure, a repair turn sends a different,
 * longer conversation after a complete but unusable answer.
 */
const MAX_REPAIR_TURNS = 1;

// Large enough that thinking plus a few hundred tokens of JSON never hits the
// ceiling: a truncated structured response is unrecoverable, not degraded.
const MAX_TOKENS = 8000;

export type GenerateOptions = {
  /**
   * Called once per request to the API, successful or not. Telemetry is pushed
   * out through a callback rather than returned, so the failure paths report
   * too — a throw that also had to carry its token counts would mean attaching
   * payload to an Error object.
   */
  onCall?: (call: CallTelemetry) => void;
  signal?: AbortSignal;
};

export async function generateStructuredCopy(
  rawSpecs: string,
  { onCall, signal }: GenerateOptions = {},
): Promise<StructuredCopy> {
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: buildStructuredUserMessage(rawSpecs) },
  ];

  // Counts HTTP requests, not repair turns: a ledger row is one billable call,
  // so a retried connection failure and a repair turn both advance it.
  let call = 0;
  let successLatencyMs = 0;
  const report = (telemetry: CallTelemetry) => onCall?.(telemetry);

  for (let turn = 1; ; turn++) {
    let response: Anthropic.Message;

    try {
      response = await withRetry(
        (timeoutMs) =>
          anthropic.messages.create(
            {
              model: MODELS.structured,
              max_tokens: MAX_TOKENS,
              system: STRUCTURED_SYSTEM_PROMPT,
              output_config: {
                // Haiku's default. Stage 5 adds cost measurements; tuning this
                // before there is anything to measure would just be guessing.
                effort: "medium",
                format: zodOutputFormat(structuredCopySchema),
              },
              messages,
            },
            { signal, timeout: timeoutMs },
          ),
        {
          signal,
          // Only non-successful attempts are reported here. The successful one
          // is reported below, where the token counts are available.
          onAttempt: ({ outcome, latencyMs, error }) => {
            if (outcome === "success") {
              successLatencyMs = latencyMs;
              return;
            }
            call += 1;
            report(
              buildTelemetry(
                call,
                outcome === "retrying" ? "RETRIED" : "FAILED",
                null,
                latencyMs,
                error?.code ?? null,
              ),
            );
          },
        },
      );
    } catch (error) {
      throw classifyError(error);
    }

    call += 1;
    const { usage } = response;
    const latencyMs = successLatencyMs;

    // A refusal is not a malformed answer, so no repair turn can fix it, and it
    // is not transient either. Fail loudly and keep the category.
    if (response.stop_reason === "refusal") {
      report(buildTelemetry(call, "FAILED", usage, latencyMs, "refusal"));
      throw new LlmError(
        "refusal",
        `Model declined the request (${response.stop_details?.category ?? "no category"})`,
        false,
      );
    }

    if (response.stop_reason === "max_tokens") {
      report(buildTelemetry(call, "FAILED", usage, latencyMs, "truncated"));
      throw new LlmError("truncated", `Response hit the ${MAX_TOKENS} token ceiling`, false);
    }

    const text = response.content.find(
      (block): block is Anthropic.TextBlock => block.type === "text",
    );

    if (!text) {
      report(buildTelemetry(call, "FAILED", usage, latencyMs, "invalid_output"));
      throw new LlmError("invalid_output", "Response contained no text block", false);
    }

    const parsed = parseStructuredCopy(text.text);

    if (parsed.ok) {
      report(buildTelemetry(call, "SUCCESS", usage, latencyMs, null));
      return parsed.copy;
    }

    if (turn > MAX_REPAIR_TURNS) {
      report(buildTelemetry(call, "FAILED", usage, latencyMs, "invalid_output"));
      throw new LlmError("invalid_output", parsed.issues.join("; "), false);
    }

    report(buildTelemetry(call, "RETRIED", usage, latencyMs, "invalid_output"));

    // The whole content array goes back, not just the text: thinking blocks
    // have to be replayed unchanged or the model loses its own reasoning.
    messages.push(
      { role: "assistant", content: response.content },
      { role: "user", content: buildRepairMessage(parsed.issues) },
    );
  }
}

type ParseResult = { ok: true; copy: StructuredCopy } | { ok: false; issues: string[] };

/**
 * Validated here rather than through `messages.parse()`: that helper throws an
 * `AnthropicError` on a schema mismatch, which would mean using exceptions for
 * an expected outcome and string-matching the message to tell a bad answer
 * apart from a bad connection. It also discards the individual issues, and the
 * issues are exactly what the repair turn has to send back.
 */
export function parseStructuredCopy(raw: string): ParseResult {
  let json: unknown;

  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, issues: ["Output was not valid JSON"] };
  }

  const result = structuredCopySchema.safeParse(json);

  if (result.success) {
    return { ok: true, copy: result.data };
  }

  return {
    ok: false,
    issues: z.flattenError(result.error).formErrors.concat(
      result.error.issues.map((issue) => `${issue.path.join(".") || "output"}: ${issue.message}`),
    ),
  };
}

function buildTelemetry(
  attempt: number,
  status: CallTelemetry["status"],
  usage: Anthropic.Usage | null,
  latencyMs: number,
  errorCode: CallTelemetry["errorCode"],
): CallTelemetry {
  return {
    task: "structured",
    model: MODELS.structured,
    promptVersion: STRUCTURED_PROMPT_VERSION,
    attempt,
    status,
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    latencyMs,
    errorCode,
  };
}
