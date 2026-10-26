import Anthropic from "@anthropic-ai/sdk";

import { env } from "@/lib/env";

export const anthropic = new Anthropic({
  apiKey: env.ANTHROPIC_API_KEY,
  // The SDK retries 429/5xx twice by default, silently. Stage 3 implements
  // retries at the application level instead, because every attempt has to
  // become its own row in the cost ledger — a retry the SDK hides is a retry
  // that is paid for and never reported.
  maxRetries: 0,
  timeout: 60_000,
});

export { Anthropic };
