import { LlmError, type LlmFailureCode } from "@/ai/errors";
import { generateStructuredCopy } from "@/ai/generate-structured";
import { db } from "@/server/db";

export type GenerateOutcome =
  | { ok: true; generationId: string }
  | { ok: false; reason: "product_not_found" }
  | { ok: false; reason: "generation_failed"; code: LlmFailureCode | "unknown"; generationId: string };

export async function generateCopyForProduct(productId: string): Promise<GenerateOutcome> {
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
    const copy = await generateStructuredCopy(product.rawInput);

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
    const code = error instanceof LlmError ? error.code : "unknown";

    await db.generation.update({
      where: { id: generation.id },
      data: {
        status: "FAILED",
        errorCode: code,
        errorMessage: error instanceof Error ? error.message : String(error),
        completedAt: new Date(),
      },
    });

    return { ok: false, reason: "generation_failed", code, generationId: generation.id };
  }
}
