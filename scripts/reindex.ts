/**
 * Batched backfill of the vector index, for copy written before the index
 * existed or re-generated since.
 *
 *   npx tsx scripts/reindex.ts
 */
import "dotenv/config";

async function main() {
  const { reindexCatalog } = await import("../src/server/search/index-service");
  console.log(await reindexCatalog());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
