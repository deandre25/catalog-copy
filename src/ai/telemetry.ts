import type { LlmFailureCode } from "./errors";
import type { ModelId } from "./models";

/**
 * What stage 5 needs to write one row of the cost ledger. Produced here, at the
 * call site, because it is the only place that knows the real token counts;
 * pricing and persistence happen later.
 */
export type CallTelemetry = {
  task: "structured" | "description" | "embedding";
  model: ModelId;
  promptVersion: string;
  attempt: number;
  status: "SUCCESS" | "RETRIED" | "FAILED";
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  errorCode: LlmFailureCode | null;
};
