-- Micro-dollars were too coarse for the cheapest traffic: a 10-token embedding
-- query costs 0.2 of one, so every such row rounded to zero and the ledger
-- reported a quarter of its calls as free. Rescaled rather than recomputed —
-- the existing rows are exact in micro-dollars, so a factor of 1000 is lossless.
ALTER TABLE "LlmCall" RENAME COLUMN "costMicroUsd" TO "costNanoUsd";

-- bigint, not int: a single call at the old unit fitted in 32 bits, but int4
-- tops out at $2.14 once the unit is a nano-dollar.
ALTER TABLE "LlmCall"
  ALTER COLUMN "costNanoUsd" TYPE BIGINT USING "costNanoUsd"::bigint * 1000;

ALTER TABLE "LlmCall" ALTER COLUMN "costNanoUsd" SET DEFAULT 0;
