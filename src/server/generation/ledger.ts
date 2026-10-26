import { costMicroUsd } from "@/ai/cost";
import type { CallTelemetry } from "@/ai/telemetry";
import { db } from "@/server/db";

export async function recordCalls(
  generationId: string | null,
  calls: readonly CallTelemetry[],
): Promise<void> {
  if (calls.length === 0) return;

  await db.llmCall.createMany({
    data: calls.map((call) => ({
      generationId,
      task: call.task,
      model: call.model,
      promptVersion: call.promptVersion,
      status: call.status,
      attempt: call.attempt,
      cacheHit: false,
      inputTokens: call.inputTokens,
      outputTokens: call.outputTokens,
      costMicroUsd: costMicroUsd(call.model, call.inputTokens, call.outputTokens),
      latencyMs: call.latencyMs,
      errorCode: call.errorCode,
    })),
  });
}

/**
 * A cache hit gets its own row with zero tokens and zero cost. Skipping it
 * would make the cache invisible in the ledger, and "how often does the cache
 * actually hit" is the only question that proves it was worth building.
 */
export async function recordCacheHit(
  generationId: string | null,
  entry: { task: string; model: string; promptVersion: string; latencyMs: number },
): Promise<void> {
  await db.llmCall.create({
    data: {
      generationId,
      task: entry.task,
      model: entry.model,
      promptVersion: entry.promptVersion,
      status: "SUCCESS",
      cacheHit: true,
      latencyMs: entry.latencyMs,
    },
  });
}
