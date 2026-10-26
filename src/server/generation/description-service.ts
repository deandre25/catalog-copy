import { buildCacheKey } from "@/ai/cache-key";
import { MODELS } from "@/ai/models";
import { DESCRIPTION_PROMPT_VERSION } from "@/ai/prompts/description";
import { streamDescription } from "@/ai/stream-description";
import type { CallTelemetry } from "@/ai/telemetry";
import { db } from "@/server/db";

import { readCache, writeCache } from "./cache";
import { recordCacheHit, recordCalls } from "./ledger";

const TASK = "description";

/**
 * Partial text is written to the database as it arrives, not only at the end.
 *
 * The end-of-stream write cannot be relied on alone: on a hard disconnect the
 * serverless function can be torn down without running any cleanup, so
 * whatever the user already read would vanish. Flushing on both a time and a
 * size bound caps the loss at roughly one interval — the time bound covers a
 * slow stream, the size bound a fast one — while keeping this to a handful of
 * UPDATEs instead of one per token.
 */
const FLUSH_INTERVAL_MS = 1_200;
const FLUSH_CHARS = 400;

export type DescriptionProgress =
  | { type: "delta"; text: string }
  | { type: "done" }
  | { type: "failed"; code: string; message: string };

export async function* writeDescription(
  generationId: string,
  { signal, fresh = false }: { signal?: AbortSignal; fresh?: boolean } = {},
): AsyncGenerator<DescriptionProgress> {
  const generation = await db.generation.findUnique({
    where: { id: generationId },
    select: {
      seoTitle: true,
      benefits: true,
      product: { select: { rawInput: true } },
    },
  });

  if (!generation) {
    yield { type: "failed", code: "not_found", message: "Generation does not exist" };
    return;
  }

  if (!generation.seoTitle) {
    yield {
      type: "failed",
      code: "not_ready",
      message: "The structured copy has to succeed before the description is written",
    };
    return;
  }

  const input = {
    rawSpecs: generation.product.rawInput,
    seoTitle: generation.seoTitle,
    benefits: generation.benefits,
  };

  // The title and benefits are part of the prompt, so they are part of the key.
  // Keying on the raw specs alone would serve a description written against a
  // different title.
  const cacheKey = buildCacheKey({
    task: TASK,
    model: MODELS.description,
    promptVersion: DESCRIPTION_PROMPT_VERSION,
    input: JSON.stringify(input),
  });

  await db.generation.update({
    where: { id: generationId },
    data: { status: "STREAMING", description: null, descriptionPartial: false, errorCode: null, errorMessage: null },
  });

  // `fresh` is what the Rewrite button sends. Without it the button would
  // replay the same cached text and look broken.
  if (!fresh) {
    const cacheStartedAt = Date.now();
    const cached = await readCache(cacheKey);

    if (typeof cached === "string" && cached.length > 0) {
      await db.generation.update({
        where: { id: generationId },
        data: {
          status: "COMPLETED",
          description: cached,
          descriptionPartial: false,
          completedAt: new Date(),
        },
      });

      await recordCacheHit(generationId, {
        task: TASK,
        model: MODELS.description,
        promptVersion: DESCRIPTION_PROMPT_VERSION,
        latencyMs: Date.now() - cacheStartedAt,
      });

      // Delivered as one delta rather than chunked with artificial pauses. A
      // fake typing animation over text that is already in hand spends the
      // user's time to imitate work that did not happen.
      yield { type: "delta", text: cached };
      yield { type: "done" };
      return;
    }
  }

  const calls: CallTelemetry[] = [];
  let text = "";
  let flushedLength = 0;
  let lastFlushAt = Date.now();
  let finalized = false;

  const flush = async () => {
    if (text.length === flushedLength) return;
    flushedLength = text.length;
    lastFlushAt = Date.now();
    await db.generation.update({
      where: { id: generationId },
      data: { description: text, descriptionPartial: true },
    });
  };

  try {
    const stream = streamDescription(
      {
        rawSpecs: generation.product.rawInput,
        seoTitle: generation.seoTitle,
        benefits: generation.benefits,
      },
      { signal, onCall: (call) => calls.push(call) },
    );

    for await (const event of stream) {
      if (event.type === "delta") {
        text += event.text;

        if (Date.now() - lastFlushAt >= FLUSH_INTERVAL_MS || text.length - flushedLength >= FLUSH_CHARS) {
          await flush();
        }

        yield { type: "delta", text: event.text };
        continue;
      }

      finalized = true;

      if (event.type === "done") {
        // Only a complete description is cached. Caching partial or refused
        // output would serve the same broken text forever, for free, which is
        // worse than paying again.
        await writeCache({
          key: cacheKey,
          task: TASK,
          model: MODELS.description,
          response: event.description,
        });

        await db.generation.update({
          where: { id: generationId },
          data: {
            status: "COMPLETED",
            description: event.description,
            descriptionPartial: false,
            completedAt: new Date(),
          },
        });

        yield { type: "done" };
        return;
      }

      // The text the user already read is kept, flagged as partial. It must
      // never be published or embedded as if it were complete, which is what
      // descriptionPartial exists to say.
      await db.generation.update({
        where: { id: generationId },
        data: {
          status: event.code === "aborted" ? "CANCELLED" : "FAILED",
          description: event.partial.length > 0 ? event.partial : null,
          descriptionPartial: event.partial.length > 0,
          errorCode: event.code,
          errorMessage: event.message,
          completedAt: new Date(),
        },
      });

      yield { type: "failed", code: event.code, message: event.message };
      return;
    }
  } finally {
    await recordCalls(generationId, calls);

    // Reached when the consumer stops iterating — the browser tab closed or
    // the connection dropped, so no terminal event was ever delivered. The
    // model call is aborted by the generator's own cleanup; this records what
    // had arrived. A dropped connection and a closed tab are indistinguishable
    // from here, so both are recorded as cancelled.
    if (!finalized) {
      await db.generation.update({
        where: { id: generationId },
        data: {
          status: "CANCELLED",
          description: text.length > 0 ? text : null,
          descriptionPartial: text.length > 0,
          errorCode: "aborted",
          errorMessage: "Client disconnected before the stream finished",
          completedAt: new Date(),
        },
      });
    }
  }
}
