import { z } from "zod";

import { buildCacheKey } from "@/ai/cache-key";
import { EMBEDDING_DIMENSIONS, EMBEDDING_INPUT_VERSION, embed, toVectorLiteral } from "@/ai/embeddings";
import { MODELS } from "@/ai/models";
import type { CallTelemetry } from "@/ai/telemetry";
import { db } from "@/server/db";
import { dropCache, readCache, writeCache } from "@/server/generation/cache";
import { recordCacheHit, recordCalls } from "@/server/generation/ledger";

const QUERY_TASK = "embedding-query";

export const searchQuerySchema = z
  .string()
  .trim()
  // Two characters cannot express an intent, and a 200-character ceiling is
  // the same cost guard the product form uses: the query is billed by token.
  .min(3, "Type at least a few characters")
  .max(200, "Keep the query under 200 characters");

export type SearchHit = {
  productId: string;
  title: string;
  generationId: string;
  seoTitle: string | null;
  /** Cosine similarity in [-1, 1]; in practice ~0.3-0.9 for this corpus. */
  similarity: number;
};

/** A row of the raw query, before the distance is turned into a similarity. */
type HitRow = Omit<SearchHit, "similarity"> & { distance: number };

export type SearchResult = {
  hits: SearchHit[];
  /** True when the query vector came from the cache, so the search cost nothing. */
  cached: boolean;
};

export async function searchByText(
  rawQuery: string,
  { limit = 10 }: { limit?: number } = {},
): Promise<SearchResult> {
  const query = searchQuerySchema.parse(rawQuery);
  const { vector, cached } = await embedQuery(query);

  const rows = await db.$queryRaw<HitRow[]>`
    SELECT
      e."productId",
      e."generationId",
      p."title",
      g."seoTitle",
      -- The distance is selected, not the similarity, because the ORDER BY has
      -- to stay the bare operator expression for the HNSW index to be used.
      e."embedding" <=> ${toVectorLiteral(vector)}::vector AS "distance"
    FROM "ProductEmbedding" e
    JOIN "Product" p ON p."id" = e."productId"
    LEFT JOIN "Generation" g ON g."id" = e."generationId"
    ORDER BY e."embedding" <=> ${toVectorLiteral(vector)}::vector
    LIMIT ${limit}
  `;

  return { hits: rows.map(toHit), cached };
}

/**
 * "More like this" for a product that is already indexed.
 *
 * Costs nothing: the product's own vector is already in the table, so this is
 * a pure database query with no provider call. Running the stored copy back
 * through the embeddings API to get a vector we already have would be the
 * easy mistake here.
 */
export async function similarProducts(
  productId: string,
  { limit = 5 }: { limit?: number } = {},
): Promise<SearchHit[]> {
  const rows = await db.$queryRaw<HitRow[]>`
    WITH anchor AS (
      SELECT "embedding" FROM "ProductEmbedding" WHERE "productId" = ${productId}
    )
    SELECT
      e."productId",
      e."generationId",
      p."title",
      g."seoTitle",
      e."embedding" <=> (SELECT "embedding" FROM anchor) AS "distance"
    FROM "ProductEmbedding" e
    JOIN "Product" p ON p."id" = e."productId"
    LEFT JOIN "Generation" g ON g."id" = e."generationId"
    -- Without this the product is always its own first result, at distance 0.
    WHERE e."productId" <> ${productId}
      AND EXISTS (SELECT 1 FROM anchor)
    ORDER BY e."embedding" <=> (SELECT "embedding" FROM anchor)
    LIMIT ${limit}
  `;

  return rows.map(toHit);
}

export async function indexedCount(): Promise<number> {
  return db.productEmbedding.count();
}

/**
 * Cosine distance, so cosine similarity is 1 - distance.
 *
 * Why cosine: Voyage returns unit-length vectors, which makes cosine
 * similarity, dot product and Euclidean distance rank identically — the choice
 * cannot change the ordering. It is made on the two things that do differ.
 * Cosine distance is bounded in [0, 2] whatever the vector magnitudes are, so
 * a score can be shown in the UI and a threshold stays meaningful if a
 * provider that does not normalise is swapped in later; and it ignores
 * magnitude, which for text embeddings mostly tracks length, so a 240-word
 * description and a 160-word one are compared on what they say.
 */
function toHit(row: HitRow): SearchHit {
  return {
    productId: row.productId,
    generationId: row.generationId,
    title: row.title,
    seoTitle: row.seoTitle,
    similarity: 1 - Number(row.distance),
  };
}

const cachedVectorSchema = z.array(z.number()).length(EMBEDDING_DIMENSIONS);

/**
 * Query vectors are cached like any other model response.
 *
 * Search is a GET: a crawler, a refresh or a shared link would otherwise bill
 * a provider call for a query that has already been answered. The same cache
 * table as the generation stages, keyed the same way — task, model, input
 * version, normalized text — so the stats page counts these hits too.
 */
async function embedQuery(query: string): Promise<{ vector: number[]; cached: boolean }> {
  const key = buildCacheKey({
    task: QUERY_TASK,
    model: MODELS.embedding,
    promptVersion: EMBEDDING_INPUT_VERSION,
    input: query,
  });

  const startedAt = Date.now();
  const cached = await readCache(key);

  if (cached !== null) {
    const parsed = cachedVectorSchema.safeParse(cached);

    if (parsed.success) {
      await recordCacheHit(null, {
        task: QUERY_TASK,
        model: MODELS.embedding,
        promptVersion: EMBEDDING_INPUT_VERSION,
        latencyMs: Date.now() - startedAt,
      });

      return { vector: parsed.data, cached: true };
    }

    // A stored vector of the wrong width predates a dimension change. The
    // input version covers a change to the text format but not to the column.
    await dropCache(key);
  }

  const calls: CallTelemetry[] = [];

  try {
    const { vectors } = await embed([query], {
      inputType: "query",
      onCall: (call) => calls.push(call),
    });

    const vector = vectors[0];
    if (!vector) throw new Error("Embeddings provider returned no vector for the query");

    await writeCache({ key, task: QUERY_TASK, model: MODELS.embedding, response: vector });

    return { vector, cached: false };
  } finally {
    // No generation to attach to: a search is not part of one, which is why
    // recordCalls takes a nullable id.
    await recordCalls(null, calls);
  }
}
