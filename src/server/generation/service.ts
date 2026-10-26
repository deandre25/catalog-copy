import { LlmError, type LlmFailureCode } from "@/ai/errors";
import { generateStructuredCopy } from "@/ai/generate-structured";
import { db } from "@/server/db";

export type GenerateOutcome =
  | { ok: true; generationId: string }
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

  try {
    const copy = await generateStructuredCopy(product.rawInput, { signal: options.signal });

    await db.generation.update({
      where: { id: generation.id },
      data: {
        status: "COMPLETED",
        seoTitle: copy.seoTitle,
        metaDescription: copy.metaDescription,
        benefits: copy.benefits,
        completedAt: new Date(),
      },
    });

    return { ok: true, generationId: generation.id };
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
  }
}
