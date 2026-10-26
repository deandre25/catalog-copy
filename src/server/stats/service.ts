import { connection } from "next/server";

import { db } from "@/server/db";

const DAY_MS = 24 * 60 * 60 * 1000;

export type DailyRow = { day: Date; calls: number; costMicroUsd: number };

export async function getUsageStats() {
  // Date.now() is synchronous, so it would be evaluated during prerendering and
  // baked into the static shell — a <Suspense> boundary alone does not defer
  // synchronous work. connection() is what moves the clock read to request time.
  await connection();

  const since = new Date(Date.now() - DAY_MS);

  const [lastDay, cacheHitsLastDay, byModel, byDay, failures, completedGenerations, totals, billedAverages, cacheHitsByTask] =
    await Promise.all([
      db.llmCall.aggregate({
        where: { createdAt: { gte: since }, cacheHit: false },
        _count: { _all: true },
        _sum: { costMicroUsd: true, inputTokens: true, outputTokens: true },
        _avg: { latencyMs: true },
      }),
      db.llmCall.count({ where: { createdAt: { gte: since }, cacheHit: true } }),
      db.llmCall.groupBy({
        by: ["model"],
        where: { cacheHit: false },
        _count: { _all: true },
        _sum: { costMicroUsd: true, inputTokens: true, outputTokens: true },
      }),
      // date_trunc has no groupBy equivalent in Prisma, so this one is raw SQL.
      // generate_series fills the days with no traffic, otherwise the table
      // silently skips them and a quiet day looks like a missing day.
      db.$queryRaw<DailyRow[]>`
        SELECT d.day::date AS day,
               COALESCE(COUNT(c.id), 0)::int AS calls,
               COALESCE(SUM(c."costMicroUsd"), 0)::int AS "costMicroUsd"
        FROM generate_series(
               date_trunc('day', now()) - interval '13 days',
               date_trunc('day', now()),
               interval '1 day'
             ) AS d(day)
        LEFT JOIN "LlmCall" c
               ON date_trunc('day', c."createdAt") = d.day
              AND c."cacheHit" = false
        GROUP BY d.day
        ORDER BY d.day DESC
      `,
      db.llmCall.groupBy({
        by: ["errorCode"],
        where: { createdAt: { gte: since }, status: { in: ["FAILED", "RETRIED"] } },
        _count: { _all: true },
      }),
      db.generation.count({ where: { status: "COMPLETED" } }),
      db.llmCall.aggregate({ where: { cacheHit: false }, _sum: { costMicroUsd: true } }),
      db.llmCall.groupBy({
        by: ["task", "model"],
        where: { cacheHit: false, status: "SUCCESS" },
        _avg: { costMicroUsd: true },
      }),
      db.llmCall.groupBy({
        by: ["task", "model"],
        where: { cacheHit: true },
        _count: { _all: true },
      }),
    ]);

  /**
   * An estimate, and labelled as one in the UI. A cache hit never produced
   * token counts, so what it avoided can only be inferred from what the same
   * task on the same model usually costs when it is actually billed.
   */
  const savedMicroUsd = cacheHitsByTask.reduce((total, hit) => {
    const average = billedAverages.find(
      (row) => row.task === hit.task && row.model === hit.model,
    );
    return total + hit._count._all * (average?._avg.costMicroUsd ?? 0);
  }, 0);

  const totalCostMicroUsd = totals._sum.costMicroUsd ?? 0;

  return {
    lastDay: {
      calls: lastDay._count._all,
      costMicroUsd: lastDay._sum.costMicroUsd ?? 0,
      inputTokens: lastDay._sum.inputTokens ?? 0,
      outputTokens: lastDay._sum.outputTokens ?? 0,
      avgLatencyMs: Math.round(lastDay._avg.latencyMs ?? 0),
      cacheHits: cacheHitsLastDay,
    },
    allTime: {
      costMicroUsd: totalCostMicroUsd,
      completedGenerations,
      costPerGenerationMicroUsd:
        completedGenerations > 0 ? Math.round(totalCostMicroUsd / completedGenerations) : 0,
      savedMicroUsd: Math.round(savedMicroUsd),
      cacheHits: cacheHitsByTask.reduce((total, hit) => total + hit._count._all, 0),
    },
    byModel: byModel.map((row) => ({
      model: row.model,
      calls: row._count._all,
      costMicroUsd: row._sum.costMicroUsd ?? 0,
      inputTokens: row._sum.inputTokens ?? 0,
      outputTokens: row._sum.outputTokens ?? 0,
    })),
    byDay,
    failures: failures
      .map((row) => ({ code: row.errorCode ?? "unknown", count: row._count._all }))
      .sort((a, b) => b.count - a.count),
  };
}
