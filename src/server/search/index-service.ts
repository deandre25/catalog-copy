import { EMBEDDING_INPUT_VERSION, embed, toVectorLiteral } from "@/ai/embeddings";
import { MODELS } from "@/ai/models";
import { sleep, type RetryPolicy } from "@/ai/retry";
import type { CallTelemetry } from "@/ai/telemetry";
import { normalizeInput, sha256 } from "@/lib/hash";
import { db } from "@/server/db";
import { recordCalls } from "@/server/generation/ledger";

export type IndexOutcome =
  | { status: "indexed"; tokens: number }
  /** The text is byte-identical to what is already indexed, so nothing was sent. */
  | { status: "unchanged" }
  | { status: "skipped"; reason: "not_found" | "incomplete" };

/**
 * What goes into the vector, and why it is not the supplier's specs.
 *
 * The corpus is the generated copy, not the raw input. Three reasons, in order
 * of how much they matter:
 *
 * 1. It is what the search is for. "Find products like this one" is a question
 *    about the catalog a shopper sees, and the generated copy is that catalog.
 * 2. Supplier text is hostile to retrieval: SKUs, repeated boilerplate,
 *    inconsistent units and tables of numbers. Embeddings encode meaning, and
 *    a column of measurements carries very little of it.
 * 3. The generated copy has already been through the stage 6 output filter.
 *    Embedding raw specs would put injected text back into the corpus, where a
 *    search result would surface it to a reviewer as if it were our own copy.
 *
 * The title and benefits are included alongside the description because they
 * are the distilled attributes — the description is prose and may bury the
 * category under a sentence about who the product suits.
 */
export function composeEmbeddingInput(copy: {
  title: string;
  seoTitle: string;
  benefits: readonly string[];
  description: string;
}): string {
  return [copy.title, copy.seoTitle, copy.benefits.join(". "), copy.description].join("\n\n");
}

/**
 * Chunk size: one chunk per product, deliberately.
 *
 * Chunking exists to stop a long document's meaning from averaging out into a
 * vector that is close to everything and specific to nothing, and to let a
 * retriever return the passage that answers the question rather than the whole
 * document. Neither applies here. A composed entry is roughly 300-400 tokens
 * against a 32,000-token model limit, and it is already one coherent unit: a
 * single product. Splitting it into paragraph chunks would make the retrieval
 * unit a fragment of a product, so "similar products" would return the same
 * product three times, and a query about a specification would match the
 * paragraph that happens to list it rather than the product that has it.
 *
 * The threshold where this flips: documents long enough that a single vector
 * loses detail — a manual, a multi-variant page, a page of reviews. Then the
 * unit of retrieval is no longer the product, and chunks of a few hundred
 * tokens with a sentence or two of overlap, each carrying the product id, are
 * the right shape.
 */
export async function indexGeneration(
  generationId: string,
  { signal }: { signal?: AbortSignal } = {},
): Promise<IndexOutcome> {
  const generation = await db.generation.findUnique({
    where: { id: generationId },
    select: {
      id: true,
      productId: true,
      status: true,
      seoTitle: true,
      benefits: true,
      description: true,
      descriptionPartial: true,
      product: { select: { title: true } },
    },
  });

  if (!generation) return { status: "skipped", reason: "not_found" };

  // Partial text is text the stream never finished. Indexing it would answer
  // searches with half a sentence and rank it as if it were finished copy,
  // which is exactly what descriptionPartial exists to prevent.
  if (
    generation.status !== "COMPLETED" ||
    !generation.seoTitle ||
    !generation.description ||
    generation.descriptionPartial
  ) {
    return { status: "skipped", reason: "incomplete" };
  }

  const content = composeEmbeddingInput({
    title: generation.product.title,
    seoTitle: generation.seoTitle,
    benefits: generation.benefits,
    description: generation.description,
  });

  // The input version is part of the hash: a change to composeEmbeddingInput
  // produces vectors that are not comparable with the old ones, so every row
  // has to be re-embedded rather than left as a silent mix of two formats.
  const sourceHash = sha256([EMBEDDING_INPUT_VERSION, MODELS.embedding, normalizeInput(content)]);

  const existing = await db.productEmbedding.findUnique({
    where: { productId: generation.productId },
    select: { sourceHash: true },
  });

  if (existing?.sourceHash === sourceHash) return { status: "unchanged" };

  const calls: CallTelemetry[] = [];

  try {
    const { vectors, tokens } = await embed([content], {
      inputType: "document",
      signal,
      onCall: (call) => calls.push(call),
    });

    const vector = vectors[0];
    if (!vector) return { status: "skipped", reason: "incomplete" };

    // Prisma cannot write an Unsupported column, so the whole row goes through
    // raw SQL. ON CONFLICT rather than delete-then-insert: re-indexing must
    // never leave a product missing from search in between.
    await db.$executeRaw`
      INSERT INTO "ProductEmbedding"
        ("productId", "generationId", "model", "sourceHash", "content", "tokens", "embedding", "updatedAt")
      VALUES (
        ${generation.productId}, ${generation.id}, ${MODELS.embedding}, ${sourceHash},
        ${content}, ${tokens}, ${toVectorLiteral(vector)}::vector, now()
      )
      ON CONFLICT ("productId") DO UPDATE SET
        "generationId" = EXCLUDED."generationId",
        "model"        = EXCLUDED."model",
        "sourceHash"   = EXCLUDED."sourceHash",
        "content"      = EXCLUDED."content",
        "tokens"       = EXCLUDED."tokens",
        "embedding"    = EXCLUDED."embedding",
        "updatedAt"    = now()
    `;

    return { status: "indexed", tokens };
  } finally {
    // Billed whether or not the insert succeeded: the tokens were spent at the
    // provider, and a ledger that only records successes understates the bill.
    await recordCalls(generationId, calls);
  }
}

/**
 * The provider's quota, not a tuning knob: these two numbers are what Voyage
 * grants an account with no payment method on file. Adding one raises both by
 * roughly two orders of magnitude, and the only correct edit here is to copy
 * the new figures from the account page.
 *
 * They are named because everything below is derived from them. Left as bare
 * numbers in the two constants that use them, a tier change looks like a
 * performance decision someone made by feel.
 */
const QUOTA_REQUESTS_PER_MINUTE = 3;
const QUOTA_TOKENS_PER_MINUTE = 10_000;

/**
 * A batch is bounded by tokens, not by item count.
 *
 * Voyage's hard ceiling is 1,000 texts and 1M tokens per request, so counting
 * items looks sufficient — and is not. The quota that binds a real account is
 * measured in tokens per minute, and the first version of this batched 37
 * products of ~400 tokens into one request, sailed past the item limit and hit
 * the TPM wall. Batching only helps when it is batched along the axis the
 * quota is measured on.
 *
 * 70% of the window rather than all of it: estimateTokens is an approximation,
 * and a batch that lands 20% over its estimate must still fit.
 */
const BATCH_TOKEN_BUDGET = Math.floor(QUOTA_TOKENS_PER_MINUTE * 0.7);

/**
 * One request per slice of the minute, plus a second of margin for clock skew
 * between us and the provider's window.
 */
const BATCH_PACING_MS = Math.ceil(60_000 / QUOTA_REQUESTS_PER_MINUTE) + 1_000;

/**
 * A rate limit measured per minute cannot be retried inside a 20-second
 * budget: every attempt lands in the same window that rejected the first one.
 * The budget below outlasts several of the provider's windows deliberately.
 * The retry budget has to outlast the provider's quota window or the retry is
 * decoration. This is the one place in the project that waits minutes, and it
 * is a background pass with nobody watching.
 */
const BULK_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 5,
  baseDelayMs: 8_000,
  maxDelayMs: 60_000,
  perAttemptTimeoutMs: 60_000,
  totalBudgetMs: 5 * 60_000,
};

/** Four characters per token is close enough to size a batch. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function intoBatches(pending: readonly Pending[]): Pending[][] {
  const batches: Pending[][] = [];
  let batch: Pending[] = [];
  let tokens = 0;

  for (const entry of pending) {
    const cost = estimateTokens(entry.content);

    if (batch.length > 0 && tokens + cost > BATCH_TOKEN_BUDGET) {
      batches.push(batch);
      batch = [];
      tokens = 0;
    }

    batch.push(entry);
    tokens += cost;
  }

  if (batch.length > 0) batches.push(batch);

  return batches;
}

type Pending = {
  productId: string;
  generationId: string;
  content: string;
  sourceHash: string;
};

/**
 * Backfill for products whose copy predates the index, or whose indexed text
 * is stale. Everything that needs embedding goes out in batched requests.
 */
export async function reindexCatalog({ limit = 200 }: { limit?: number } = {}): Promise<{
  indexed: number;
  unchanged: number;
  skipped: number;
  failed: number;
}> {
  const products = await db.product.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      title: true,
      embedding: { select: { sourceHash: true } },
      generations: {
        where: { status: "COMPLETED", descriptionPartial: false },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, seoTitle: true, benefits: true, description: true },
      },
    },
  });

  const summary = { indexed: 0, unchanged: 0, skipped: 0, failed: 0 };
  const pending: Pending[] = [];

  for (const product of products) {
    const generation = product.generations[0];

    if (!generation?.seoTitle || !generation.description) {
      summary.skipped += 1;
      continue;
    }

    const content = composeEmbeddingInput({
      title: product.title,
      seoTitle: generation.seoTitle,
      benefits: generation.benefits,
      description: generation.description,
    });

    const sourceHash = sha256([EMBEDDING_INPUT_VERSION, MODELS.embedding, normalizeInput(content)]);

    if (product.embedding?.sourceHash === sourceHash) {
      summary.unchanged += 1;
      continue;
    }

    pending.push({ productId: product.id, generationId: generation.id, content, sourceHash });
  }

  const batches = intoBatches(pending);

  for (const [index, batch] of batches.entries()) {
    // Paced rather than fired back to back: the retry policy can absorb a 429,
    // but spending the quota and then waiting it out is slower than not
    // spending it.
    if (index > 0) await sleep(BATCH_PACING_MS);

    const calls: CallTelemetry[] = [];

    try {
      const { vectors, tokens } = await embed(
        batch.map((entry) => entry.content),
        { inputType: "document", policy: BULK_RETRY_POLICY, onCall: (call) => calls.push(call) },
      );

      // One request produced one token count for the whole batch, so the
      // per-row figure is the share each text contributed by length. The
      // ledger row below carries the real total; this is only for the
      // per-product column.
      const totalChars = batch.reduce((sum, entry) => sum + entry.content.length, 0);

      for (const [index, entry] of batch.entries()) {
        const vector = vectors[index];
        if (!vector) {
          summary.failed += 1;
          continue;
        }

        await writeEmbedding(entry, vector, Math.round((tokens * entry.content.length) / totalChars));
        summary.indexed += 1;
      }
    } catch {
      // The error is already in the ledger with its code. One bad batch must
      // not stop the rest of the catalog from being indexed.
      summary.failed += batch.length;
    } finally {
      // generationId is null: a batched request covers many generations, and
      // attributing its cost to one of them would be a lie the stats page
      // would repeat.
      await recordCalls(null, calls);
    }
  }

  return summary;
}

async function writeEmbedding(entry: Pending, vector: number[], tokens: number): Promise<void> {
  await db.$executeRaw`
    INSERT INTO "ProductEmbedding"
      ("productId", "generationId", "model", "sourceHash", "content", "tokens", "embedding", "updatedAt")
    VALUES (
      ${entry.productId}, ${entry.generationId}, ${MODELS.embedding}, ${entry.sourceHash},
      ${entry.content}, ${tokens}, ${toVectorLiteral(vector)}::vector, now()
    )
    ON CONFLICT ("productId") DO UPDATE SET
      "generationId" = EXCLUDED."generationId",
      "model"        = EXCLUDED."model",
      "sourceHash"   = EXCLUDED."sourceHash",
      "content"      = EXCLUDED."content",
      "tokens"       = EXCLUDED."tokens",
      "embedding"    = EXCLUDED."embedding",
      "updatedAt"    = now()
  `;
}
