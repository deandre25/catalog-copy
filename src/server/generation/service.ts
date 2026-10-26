import { buildCacheKey } from "@/ai/cache-key";
import { LlmError, type LlmFailureCode } from "@/ai/errors";
import { generateStructuredCopy } from "@/ai/generate-structured";
import { MODELS } from "@/ai/models";
import { STRUCTURED_PROMPT_VERSION } from "@/ai/prompts/structured";
import { detectInjectionSignals, sanitizeCopyText, sanitizeSpecs } from "@/ai/sanitize";
import { structuredCopySchema, type StructuredCopy } from "@/ai/schemas";
import type { CallTelemetry } from "@/ai/telemetry";
import { db } from "@/server/db";

import { dropCache, readCache, writeCache } from "./cache";
import { recordCacheHit, recordCalls } from "./ledger";

const TASK = "structured";

export type GenerateOutcome =
  | { ok: true; generationId: string; fromCache: boolean }
  | { ok: false; reason: "product_not_found" }
  | {
      ok: false;
      reason: "generation_failed";
      code: LlmFailureCode | "unknown";
      retryable: boolean;
      retryAfterSeconds: number | null;
      generationId: string;
    };

export async function generateCopyForProduct(
  productId: string,
  options: { signal?: AbortSignal } = {},
): Promise<GenerateOutcome> {
  const product = await db.product.findUnique({
    where: { id: productId },
    select: { rawInput: true },
  });

  if (!product) {
    return { ok: false, reason: "product_not_found" };
  }

  // The row is created before the call, so a crash mid-generation leaves a
  // PENDING row to investigate instead of no trace that anything was attempted.
  const generation = await db.generation.create({
    data: { productId, status: "PENDING" },
    select: { id: true },
  });

  // Invisible characters are stripped and the fence tag neutralised before the
  // text reaches the prompt. Signals are recorded, not acted on: a pattern list
  // cannot decide this, only point a reviewer at it.
  const specs = sanitizeSpecs(product.rawInput);
  const warnings = detectInjectionSignals(product.rawInput);

  const cacheKey = buildCacheKey({
    task: TASK,
    model: MODELS.structured,
    promptVersion: STRUCTURED_PROMPT_VERSION,
    // Keyed on the sanitised text, since that is what actually reaches the
    // model and therefore what determines the output.
    input: specs.text,
  });

  const cacheStartedAt = Date.now();
  const cached = await readCache(cacheKey);

  if (cached !== null) {
    // Revalidated rather than trusted. The prompt version in the key covers
    // prompt edits, but not a change to the Zod schema — a stored entry can be
    // structurally stale while its key still looks current. A failed parse is
    // treated as a miss and the entry is dropped.
    const parsed = structuredCopySchema.safeParse(cached);

    if (parsed.success) {
      const clean = sanitizeCopy(parsed.data);

      await db.generation.update({
        where: { id: generation.id },
        data: {
          status: "COMPLETED",
          seoTitle: clean.copy.seoTitle,
          metaDescription: clean.copy.metaDescription,
          benefits: clean.copy.benefits,
          warnings: [...warnings, ...clean.removed],
          completedAt: new Date(),
        },
      });

      await recordCacheHit(generation.id, {
        task: TASK,
        model: MODELS.structured,
        promptVersion: STRUCTURED_PROMPT_VERSION,
        latencyMs: Date.now() - cacheStartedAt,
      });

      return { ok: true, generationId: generation.id, fromCache: true };
    }

    await dropCache(cacheKey);
  }

  const calls: CallTelemetry[] = [];

  try {
    const copy = await generateStructuredCopy(specs.text, {
      signal: options.signal,
      onCall: (call) => calls.push(call),
    });

    const clean = sanitizeCopy(copy);

    // The sanitised copy is what gets cached, so a stripped payload is not
    // re-stripped on every hit and the stored value matches what was shown.
    await writeCache({
      key: cacheKey,
      task: TASK,
      model: MODELS.structured,
      response: clean.copy,
    });

    await db.generation.update({
      where: { id: generation.id },
      data: {
        status: "COMPLETED",
        seoTitle: clean.copy.seoTitle,
        metaDescription: clean.copy.metaDescription,
        benefits: clean.copy.benefits,
        warnings: [...warnings, ...clean.removed],
        completedAt: new Date(),
      },
    });

    return { ok: true, generationId: generation.id, fromCache: false };
  } catch (error) {
    const failure = error instanceof LlmError ? error : null;

    await db.generation.update({
      where: { id: generation.id },
      data: {
        // An aborted generation is not a failure of the system: the user
        // changed their mind, and the row should read that way in the history.
        status: failure?.code === "aborted" ? "CANCELLED" : "FAILED",
        errorCode: failure?.code ?? "unknown",
        errorMessage: error instanceof Error ? error.message : String(error),
        warnings,
        completedAt: new Date(),
      },
    });

    return {
      ok: false,
      reason: "generation_failed",
      code: failure?.code ?? "unknown",
      retryable: failure?.retryable ?? false,
      retryAfterSeconds: failure?.retryAfterSeconds ?? null,
      generationId: generation.id,
    };
  } finally {
    // In finally, not after the call: the retries and the repair turn that
    // preceded a failure were billed, and a ledger that only records
    // successful generations understates the bill by exactly the amount spent
    // on things that went wrong.
    await recordCalls(generation.id, calls);
  }
}

/**
 * Every field the model produced goes through the output filter. Length limits
 * already came from Zod; this removes the payloads an injection would want to
 * place in published copy.
 */
function sanitizeCopy(copy: StructuredCopy): { copy: StructuredCopy; removed: string[] } {
  const title = sanitizeCopyText(copy.seoTitle);
  const meta = sanitizeCopyText(copy.metaDescription);
  const benefits = copy.benefits.map((benefit) => sanitizeCopyText(benefit));

  return {
    copy: {
      seoTitle: title.text,
      metaDescription: meta.text,
      benefits: benefits.map((benefit) => benefit.text),
    },
    removed: [
      ...new Set([
        ...title.removed,
        ...meta.removed,
        ...benefits.flatMap((benefit) => benefit.removed),
      ]),
    ].map((label) => `output:${label}`),
  };
}
