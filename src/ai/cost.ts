import { MODEL_PRICING, type ModelId } from "./models";

/**
 * Rates are per 1M tokens, so both terms are summed before the single
 * division. Dividing per term first would round a 300-token Haiku call down to
 * zero and the ledger would report free generations.
 */
export function costMicroUsd(model: ModelId, inputTokens: number, outputTokens: number): number {
  const price = MODEL_PRICING[model];

  return Math.round(
    (inputTokens * price.inputPerMTok + outputTokens * price.outputPerMTok) / 1_000_000,
  );
}

export function formatUsd(microUsd: number): string {
  // Four decimals below a dollar, so a single generation does not render as
  // "$0.00" and so two numbers in the same column stay comparable at a glance:
  // "$0.0800" next to "$0.0068" reads correctly, "$0.08" next to "$0.0068"
  // looks like the same order of magnitude.
  const decimals = Math.abs(microUsd) < 1_000_000 ? 4 : 2;
  return `$${(microUsd / 1_000_000).toFixed(decimals)}`;
}
