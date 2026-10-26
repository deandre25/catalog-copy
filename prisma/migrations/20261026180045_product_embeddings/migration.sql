-- pgvector ships in the pgvector/pgvector image and on Neon, but the extension
-- still has to be created per database. Kept in the migration rather than run
-- by hand so a fresh clone and a fresh Neon branch both work from `migrate deploy`.
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateTable
CREATE TABLE "ProductEmbedding" (
    "productId" TEXT NOT NULL,
    "generationId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "tokens" INTEGER NOT NULL,
    "embedding" vector(1024) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductEmbedding_pkey" PRIMARY KEY ("productId")
);

-- AddForeignKey
ALTER TABLE "ProductEmbedding" ADD CONSTRAINT "ProductEmbedding_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- HNSW over cosine distance, matching the operator the search query uses: an
-- index built for one distance function is not usable by another.
--
-- HNSW rather than IVFFlat because IVFFlat has to be trained on existing rows
-- to pick its lists, and a catalog that is filled one product at a time would
-- build its index on an empty or unrepresentative table. HNSW needs no
-- training step and degrades gracefully as rows are added. At this catalog's
-- size Postgres would be faster with a sequential scan; the index is here
-- because it is what the same query needs at catalog scale, and an empty index
-- costs nothing.
CREATE INDEX "ProductEmbedding_embedding_cosine_idx"
    ON "ProductEmbedding" USING hnsw ("embedding" vector_cosine_ops);
