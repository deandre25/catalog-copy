import { db } from "@/server/db";

/**
 * Reads a cached response and counts the hit in one statement. A SELECT
 * followed by an UPDATE would lose hits whenever two requests land on the same
 * key at once, and the hit count is the only evidence the cache is working.
 */
export async function readCache(key: string): Promise<unknown | null> {
  const rows = await db.$queryRaw<{ response: unknown }[]>`
    UPDATE "LlmCache"
    SET "hitCount" = "hitCount" + 1, "lastHitAt" = now()
    WHERE "key" = ${key}
    RETURNING "response"
  `;

  return rows[0]?.response ?? null;
}

export async function writeCache(entry: {
  key: string;
  task: string;
  model: string;
  response: unknown;
}): Promise<void> {
  await db.llmCache.upsert({
    where: { key: entry.key },
    create: {
      key: entry.key,
      task: entry.task,
      model: entry.model,
      response: entry.response as never,
    },
    update: { response: entry.response as never },
  });
}

/** Removes an entry whose stored shape no longer satisfies the current schema. */
export async function dropCache(key: string): Promise<void> {
  await db.llmCache.deleteMany({ where: { key } });
}
