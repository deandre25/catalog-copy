import Link from "next/link";

import type { SearchHit } from "@/server/search/service";

export function HitList({ hits }: { hits: readonly SearchHit[] }) {
  return (
    <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
      {hits.map((hit) => (
        <li key={hit.productId} className="py-3">
          <Link
            href={`/products/${hit.productId}`}
            className="flex items-baseline justify-between gap-4"
          >
            <span>
              <span className="font-medium">{hit.title}</span>
              {hit.seoTitle ? (
                <span className="block text-xs text-zinc-500">{hit.seoTitle}</span>
              ) : null}
            </span>
            {/* The score is shown because a semantic result that looks wrong is
                only explainable next to how close it actually was. */}
            <span className="font-mono text-xs text-zinc-500">{hit.similarity.toFixed(3)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
