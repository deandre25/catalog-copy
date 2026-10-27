import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { listProducts } from "@/server/products/service";

export default function ProductsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Catalog</h1>
      {/* Cache Components prerenders the shell; an uncached database read has to
          sit behind its own Suspense boundary or the build fails. */}
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <ProductList />
      </Suspense>
    </div>
  );
}

async function ProductList() {
  // Prisma I/O is invisible to Next: it is not a fetch, so nothing here marks
  // the render dynamic on its own. This boundary currently resolves at request
  // time, but only as a side effect of the prerender giving up on it — and the
  // search page proved what that costs, where a boundary that looked identical
  // prerendered happily and served the same stale answer to everyone.
  // connection() states the requirement instead of relying on it.
  await connection();

  const products = await listProducts();

  if (products.length === 0) {
    return (
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Nothing here yet.{" "}
        <Link href="/" className="underline">
          Add a product
        </Link>
        .
      </p>
    );
  }

  return (
    <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
      {products.map((product) => (
        <li key={product.id} className="py-3">
          <Link href={`/products/${product.id}`} className="flex items-baseline justify-between gap-4">
            <span className="font-medium">{product.title}</span>
            <span className="text-xs text-zinc-500">
              {product._count.generations} generation(s) ·{" "}
              {product.createdAt.toLocaleDateString("en-GB")}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
