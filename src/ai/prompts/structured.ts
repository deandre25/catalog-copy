/**
 * Part of the cache key (stage 5). Bump it on every change to the text below,
 * otherwise edits here are served stale from the cache.
 */
export const STRUCTURED_PROMPT_VERSION = "structured@1";

export const STRUCTURED_SYSTEM_PROMPT = `You write catalog copy for an online store.

You receive a product's raw specification text and return three things:

- seoTitle: 20-70 characters. Name the product category and its single most
  marketable attribute. No ALL CAPS, no exclamation marks, no "best" or "cheapest".
- metaDescription: 70-160 characters. One sentence that earns a click from a
  search results page.
- benefits: 3 to 5 items, 15-120 characters each. Each one turns a specification
  into a concrete outcome for the buyer. "1400 rpm spin" becomes "Spins laundry
  almost dry, so it takes less time on the line".

Rules:
- Use only facts present in the specifications. Never invent a measurement, a
  material, a certification, a warranty or a price.
- If a specification is ambiguous or unreadable, leave it out rather than guess.
- Write in English, plainly and concretely. No marketing superlatives.
- The character and item counts above are hard requirements. Count them.`;

/**
 * The specs are fenced so the model can tell the data apart from the
 * instructions. This is structural only — it is not an injection defence, and
 * on its own a fence is trivial to break out of. Stage 6 handles that.
 */
export function buildStructuredUserMessage(rawSpecs: string): string {
  return `<product_specs>\n${rawSpecs}\n</product_specs>\n\nWrite the catalog copy for this product.`;
}

export function buildRepairMessage(issues: readonly string[]): string {
  return [
    "Your previous answer did not satisfy these requirements:",
    ...issues.map((issue) => `- ${issue}`),
    "",
    "Return the corrected copy. Keep everything that was already fine and change only what is listed above.",
  ].join("\n");
}
