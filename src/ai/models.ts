export const MODELS = {
  /** Title, meta and benefits: short, schema-constrained, high volume. */
  structured: "claude-haiku-5-5",
  /** The long description is the only output a shopper actually reads. */
  description: "claude-sonnet-5-5",
} as const;

export type ModelId = (typeof MODELS)[keyof typeof MODELS];

/**
 * Price per 1M tokens in micro-dollars. The API returns token counts but never
 * a cost, so pricing has to live in the codebase.
 *
 * Haiku rates apply to prompts up to 100K tokens; ours are a few hundred.
 * Cache-specific rates are added in stage 5, together with prompt caching.
 */
export const MODEL_PRICING: Record<ModelId, { inputPerMTok: number; outputPerMTok: number }> = {
  "claude-haiku-5-5": { inputPerMTok: 100_000, outputPerMTok: 500_000 },
  "claude-sonnet-5-5": { inputPerMTok: 2_000_000, outputPerMTok: 10_000_000 },
};
