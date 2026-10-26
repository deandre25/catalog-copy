import { connection } from "next/server";
import { Suspense } from "react";

import { HitList } from "@/components/hit-list";

import { indexedCount, searchByText, searchQuerySchema } from "@/server/search/service";

/**
 * A GET form rather than a client component.
 *
 * The result of a search is worth linking to and worth coming back to, so the
 * query belongs in the URL. It also means the page works with no JavaScript,
 * and that the query embedding cache has something stable to key on — the same
 * URL shared twice costs one provider call, not two.
 */
export default function SearchPage({ searchParams }: PageProps<"/search">) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Semantic search</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Searches the generated copy by meaning, not by keyword. &ldquo;Quiet machine for a
          small flat&rdquo; matches copy that never uses those words.
        </p>
      </div>

      <form method="get" className="flex gap-2">
        <input
          type="search"
          name="q"
          placeholder="something quiet for a small kitchen"
          className="flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          type="submit"
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          Search
        </button>
      </form>

      {/* Both the search and the index count are uncached reads, so they sit
          behind their own boundary and the shell is still prerendered. */}
      <Suspense fallback={<p className="text-sm text-zinc-500">Searching…</p>}>
        <Results searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Results({ searchParams }: { searchParams: PageProps<"/search">["searchParams"] }) {
  // Marks the boundary as request-time before anything inside it reads a
  // clock. Next cannot see that Prisma did I/O — the driver is not
  // instrumented the way fetch is — so without this the render stays a
  // prerender, the Date.now() inside withRetry throws as an unstable value,
  // and the boundary never resumes: production served a page stuck on
  // "Searching…" for roughly half of all queries.
  await connection();

  const params = await searchParams;
  const raw = typeof params.q === "string" ? params.q : "";

  if (raw.trim().length === 0) {
    const count = await indexedCount();
    return (
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {count} product{count === 1 ? "" : "s"} indexed. A product is indexed once its
        description finishes — a cancelled or partial description is never indexed.
      </p>
    );
  }

  const parsed = searchQuerySchema.safeParse(raw);

  if (!parsed.success) {
    return (
      <p className="text-sm text-red-600 dark:text-red-400">
        {parsed.error.issues[0]?.message ?? "Invalid query"}
      </p>
    );
  }

  const { hits, cached } = await searchByText(parsed.data);

  if (hits.length === 0) {
    return (
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Nothing indexed yet, so there is nothing to match against.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500">
        {hits.length} result{hits.length === 1 ? "" : "s"} ·{" "}
        {cached ? "query vector served from cache" : "query embedded now"}
      </p>
      <HitList hits={hits} />
      {/* Stated rather than hidden: every vector in the table is the nearest
          neighbour of something, so a weak match is still returned ranked
          first. Calibrating a cut-off needs labelled queries we do not have. */}
      <p className="text-xs text-zinc-500">
        Results are ranked by cosine similarity and never filtered by a threshold — the lowest
        score here is still the closest copy in the catalog.
      </p>
    </div>
  );
}
