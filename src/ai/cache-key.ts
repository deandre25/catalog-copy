import { normalizeInput, sha256 } from "@/lib/hash";

/**
 * The key must cover every input that can change the output. Leave one out and
 * the cache serves text written for different inputs — a wrong answer is worse
 * than a missed saving.
 *
 * The prompt version is in here deliberately: editing a prompt then wondering
 * why nothing changed is the standard way to lose an afternoon.
 */
export function buildCacheKey(parts: {
  task: string;
  model: string;
  promptVersion: string;
  input: string;
}): string {
  return sha256([parts.task, parts.model, parts.promptVersion, normalizeInput(parts.input)]);
}
