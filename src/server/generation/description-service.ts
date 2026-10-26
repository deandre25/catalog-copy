import { buildCacheKey } from "@/ai/cache-key";
import { MODELS } from "@/ai/models";
import { DESCRIPTION_PROMPT_VERSION } from "@/ai/prompts/description";
import { createStreamSanitizer, detectInjectionSignals, sanitizeCopyText, sanitizeSpecs } from "@/ai/sanitize";
import { streamDescription } from "@/ai/stream-description";
import type { CallTelemetry } from "@/ai/telemetry";
import { db } from "@/server/db";

import { indexGeneration } from "@/server/search/index-service";

import { readCache, writeCache } from "./cache";
import { recordCacheHit, recordCalls } from "./ledger";

const TASK = "description";

/**
 * Indexing is a side effect of finishing a description, not a step of it: a
 * failure here must not turn a description the user is already reading into a
 * failed generation. The cost of the call is in the ledger either way, and the
 * reindex endpoint exists to pick up whatever this missed.
 */
async function index(generationId: string): Promise<void> {
  try {
    await indexGeneration(generationId);
  } catch {
    /* already recorded in the ledger with its error code */
  }
}

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
      warnings: true,
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

  const specs = sanitizeSpecs(generation.product.rawInput);

  const input = {
    rawSpecs: specs.text,
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

      // A cached description is still a completed description, so it is
      // indexed too — indexGeneration skips it for free if the text is
      // byte-identical to what is already in the table.
      await index(generationId);

      // Delivered as one delta rather than chunked with artificial pauses. A
      // fake typing animation over text that is already in hand spends the
      // user's time to imitate work that did not happen.
      yield { type: "delta", text: cached };
      yield { type: "done" };
      return;
    }
  }

  const calls: CallTelemetry[] = [];
  const sanitizer = createStreamSanitizer();
  const injectionSignals = detectInjectionSignals(generation.product.rawInput);
  const strippedFromOutput = new Set<string>();

  let text = "";
  let flushedLength = 0;
  let lastFlushAt = Date.now();
  let finalized = false;

  const warnings = () => [
    ...new Set([
      ...generation.warnings,
      ...injectionSignals,
      ...[...strippedFromOutput].map((label) => `output:${label}`),
    ]),
  ];

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
    const stream = streamDescription(input, { signal, onCall: (call) => calls.push(call) });

    for await (const event of stream) {
      if (event.type === "delta") {
        // Sanitised before it leaves the server, so a payload never reaches the
        // browser even for the moment it is being typed out. The sanitiser
        // holds back any fragment that could still turn into a URL or a tag.
        const clean = sanitizer.push(event.text);
        for (const label of clean.removed) strippedFromOutput.add(label);

        if (clean.text.length > 0) {
          text += clean.text;

          if (Date.now() - lastFlushAt >= FLUSH_INTERVAL_MS || text.length - flushedLength >= FLUSH_CHARS) {
            await flush();
          }

          yield { type: "delta", text: clean.text };
        }

        continue;
      }

      const tail = sanitizer.flush();
      for (const label of tail.removed) strippedFromOutput.add(label);
      if (tail.text.length > 0) {
        text += tail.text;
        yield { type: "delta", text: tail.text };
      }

      finalized = true;

      if (event.type === "done") {
        // Stored from a single pass over the complete text rather than from the
        // concatenated chunks: whitespace collapsing across a chunk boundary
        // can differ by a space, and the stored copy is the canonical one.
        const final = sanitizeCopyText(event.description);
        for (const label of final.removed) strippedFromOutput.add(label);

        // Only complete output is cached. Caching partial or refused text would
        // serve the same broken result forever, for free, which is worse than
        // paying again.
        await writeCache({
          key: cacheKey,
          task: TASK,
          model: MODELS.description,
          response: final.text,
        });

        await db.generation.update({
          where: { id: generationId },
          data: {
            status: "COMPLETED",
            description: final.text,
            descriptionPartial: false,
            warnings: warnings(),
            completedAt: new Date(),
          },
        });

        // Indexed before the terminal event is yielded, not after: once the
        // consumer has its "done" it may never ask this generator for another
        // value, so anything after the yield is not guaranteed to run.
        await index(generationId);

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
          description: text.length > 0 ? text : null,
          descriptionPartial: text.length > 0,
          errorCode: event.code,
          errorMessage: event.message,
          warnings: warnings(),
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
      const tail = sanitizer.flush();
      const partial = text + tail.text;

      await db.generation.update({
        where: { id: generationId },
        data: {
          status: "CANCELLED",
          description: partial.length > 0 ? partial : null,
          descriptionPartial: partial.length > 0,
          errorCode: "aborted",
          errorMessage: "Client disconnected before the stream finished",
          warnings: warnings(),
          completedAt: new Date(),
        },
      });
    }
  }
}
