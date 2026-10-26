import { MODEL_PRICING, type ModelId } from "./models";

/**
 * Rates are per 1M tokens, so both terms are summed before the single
 * division. Dividing per term first would round a 300-token Haiku call down to
 * zero and the ledger would report free generations.
 */
export function costNanoUsd(model: ModelId, inputTokens: number, outputTokens: number): number {
  const price = MODEL_PRICING[model];

  return Math.round(
    (inputTokens * price.inputPerMTok + outputTokens * price.outputPerMTok) / 1_000_000,
  );
}

export function formatUsd(nanoUsd: number): string {
  // Six decimals below a dollar. Four was enough while every row was a Claude
  // call, but an embedding query costs $0.000002 and rendered as "$0.0000" —
  // a cost page that prints its cheapest traffic as zero is the one number it
  // cannot get wrong. The precision is uniform below a dollar rather than
  // adaptive, so two figures in the same column stay comparable at a glance.
  const decimals = Math.abs(nanoUsd) < 1_000_000_000 ? 6 : 2;
  return `$${(nanoUsd / 1_000_000_000).toFixed(decimals)}`;
}
