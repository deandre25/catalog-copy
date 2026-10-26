import { notFound } from "next/navigation";
import { Suspense } from "react";

import { getProduct } from "@/server/products/service";

type Params = PageProps<"/products/[id]">["params"];

export default function ProductPage({ params }: PageProps<"/products/[id]">) {
  // `params` is awaited inside the boundary, not here: awaiting it in the page
  // body is runtime data outside <Suspense>, which Cache Components rejects at
  // build time because it would block the whole route from prerendering.
  return (
    <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
      <ProductDetail params={params} />
    </Suspense>
  );
}

async function ProductDetail({ params }: { params: Params }) {
  const { id } = await params;
  const product = await getProduct(id);

  if (!product) notFound();

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{product.title}</h1>
        <p className="text-xs text-zinc-500">
          Added {product.createdAt.toLocaleString("en-GB")}
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Raw specs</h2>
        <pre className="overflow-x-auto rounded-md border border-zinc-200 bg-white p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap dark:border-zinc-800 dark:bg-zinc-900">
          {product.rawInput}
        </pre>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Generations</h2>
        {product.generations.length === 0 ? (
          <p className="rounded-md border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700">
            No generations yet — copy generation arrives in stage 2.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {product.generations.map((generation) => (
              <li key={generation.id} className="flex items-baseline justify-between gap-4 py-3">
                <span className="text-sm">{generation.seoTitle ?? "—"}</span>
                <span className="text-xs text-zinc-500">{generation.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
