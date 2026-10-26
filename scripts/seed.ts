/**
 * Fills a deployment with a catalog worth searching.
 *
 * Runs against whatever DATABASE_URL points at, calling the same services the
 * application does rather than inserting rows — the point is to exercise the
 * real pipeline, so the ledger, the cache and the warnings end up populated
 * the way they would be in use.
 *
 * Indexing is deferred: each description would otherwise fire its own
 * embedding request, and fifty requests against a per-minute quota is fifty
 * rate-limit errors. One batched pass at the end does the same work in one
 * request.
 *
 *   npx tsx scripts/seed.ts            # 8 products, against .env
 *   LIMIT=40 npx tsx scripts/seed.ts   # more of the catalog
 */
import "dotenv/config";

async function main() {
  const { CATALOG } = await import("./catalog");
  const { db } = await import("../src/server/db");
  const { createProduct } = await import("../src/server/products/service");
  const { generateCopyForProduct } = await import("../src/server/generation/service");
  const { writeDescription } = await import("../src/server/generation/description-service");
  const { reindexCatalog } = await import("../src/server/search/index-service");

  const limit = Number(process.env["LIMIT"] ?? 8);
  const wanted = CATALOG.slice(0, limit);

  console.log(`seeding ${wanted.length} products`);

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const [index, item] of wanted.entries()) {
    const label = `[${index + 1}/${wanted.length}] ${item.title}`;

    // Re-running the script must not duplicate the catalog.
    const existing = await db.product.findFirst({
      where: { title: item.title },
      select: { id: true, generations: { where: { status: "COMPLETED" }, select: { id: true } } },
    });

    if (existing && existing.generations.length > 0) {
      console.log(`${label} — already done`);
      skipped += 1;
      continue;
    }

    try {
      const product = existing ?? (await createProduct({ title: item.title, rawInput: item.rawInput }));
      const outcome = await generateCopyForProduct(product.id);

      if (!outcome.ok) {
        throw new Error(
          outcome.reason === "generation_failed" ? outcome.code : outcome.reason,
        );
      }

      for await (const event of writeDescription(outcome.generationId, { deferIndexing: true })) {
        if (event.type === "failed") throw new Error(`${event.code}: ${event.message}`);
      }

      console.log(`${label} — ok`);
      created += 1;
    } catch (error) {
      console.log(`${label} — FAILED: ${error instanceof Error ? error.message : String(error)}`);
      failed += 1;
    }
  }

  console.log(`\ngenerated: ${created}, already done: ${skipped}, failed: ${failed}`);
  console.log("indexing in batches…");
  console.log(await reindexCatalog());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
