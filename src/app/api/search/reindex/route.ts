import { NextResponse } from "next/server";

import { reindexCatalog } from "@/server/search/index-service";

// Each row is one short provider call plus one insert, so fifty of them fit
// well inside the ceiling; the limit is what keeps it that way.
export const maxDuration = 60;

/**
 * Backfill endpoint for copy that was written before the index existed, or
 * whose indexed text is stale.
 *
 * POST rather than GET: it spends tokens, and a GET that spends money will
 * eventually be called by a crawler or a link preview.
 */
export async function POST() {
  const summary = await reindexCatalog();
  return NextResponse.json(summary);
}
