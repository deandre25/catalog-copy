"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function GenerateButton({ productId }: { productId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setPending(true);
    setError(null);

    try {
      const response = await fetch(`/api/products/${productId}/generate`, { method: "POST" });

      if (!response.ok) {
        const { error: code } = (await response.json()) as { error: string };
        setError(FAILURE_MESSAGES[code] ?? `Generation failed (${code}).`);
      }

      // Refreshed on failure too: the failed generation is a row in the table
      // and belongs in the history the page shows.
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {pending ? "Generating…" : "Generate copy"}
      </button>
      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
    </div>
  );
}

const FAILURE_MESSAGES: Record<string, string> = {
  refusal: "The model declined to write copy for these specs.",
  truncated: "The response was cut off. Shorten the specs and try again.",
  invalid_output: "The model could not produce copy within the required limits.",
  api_error: "The model provider returned an error. Try again in a moment.",
  network_error: "Could not reach the model provider.",
  product_not_found: "This product no longer exists.",
};
