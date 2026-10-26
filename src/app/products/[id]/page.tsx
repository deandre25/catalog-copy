import { notFound } from "next/navigation";
import { Suspense } from "react";

import { GenerateButton } from "@/components/generate-button";
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

  const [latest, ...older] = product.generations;

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{product.title}</h1>
        <p className="text-xs text-zinc-500">Added {product.createdAt.toLocaleString("en-GB")}</p>
      </div>

      <GenerateButton productId={product.id} />

      {latest ? <GenerationCard generation={latest} /> : null}

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Raw specs</h2>
        <pre className="overflow-x-auto rounded-md border border-zinc-200 bg-white p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap dark:border-zinc-800 dark:bg-zinc-900">
          {product.rawInput}
        </pre>
      </section>

      {older.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
            Earlier attempts ({older.length})
          </h2>
          {older.map((generation) => (
            <GenerationCard key={generation.id} generation={generation} />
          ))}
        </section>
      ) : null}
    </div>
  );
}

type Generation = NonNullable<Awaited<ReturnType<typeof getProduct>>>["generations"][number];

function GenerationCard({ generation }: { generation: Generation }) {
  const isFailed = generation.status === "FAILED";

  return (
    <article className="space-y-4 rounded-md border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <header className="flex items-baseline justify-between gap-4">
        <span
          className={`text-xs font-medium ${
            isFailed ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"
          }`}
        >
          {generation.status}
        </span>
        <span className="text-xs text-zinc-500">
          {generation.createdAt.toLocaleString("en-GB")}
        </span>
      </header>

      {isFailed ? (
        <div className="space-y-1">
          <p className="text-sm font-medium">{generation.errorCode}</p>
          <p className="font-mono text-xs break-words text-zinc-600 dark:text-zinc-400">
            {generation.errorMessage}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <Field label={`SEO title · ${generation.seoTitle?.length ?? 0}/70`}>
            {generation.seoTitle}
          </Field>
          <Field label={`Meta description · ${generation.metaDescription?.length ?? 0}/160`}>
            {generation.metaDescription}
          </Field>
          <div className="space-y-1">
            <p className="text-xs font-medium text-zinc-500 uppercase">Benefits</p>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {generation.benefits.map((benefit) => (
                <li key={benefit}>{benefit}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </article>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-zinc-500 uppercase">{label}</p>
      <p className="text-sm">{children}</p>
    </div>
  );
}
