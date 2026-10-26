import { z } from "zod";

// Validated once, at module load, so a missing or malformed variable fails the
// process instead of surfacing as a provider 401 in the middle of a generation.
const envSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1)
    .refine((value) => value.startsWith("postgres://") || value.startsWith("postgresql://"), {
      message: "must be a postgres:// or postgresql:// connection string",
    }),
  ANTHROPIC_API_KEY: z.string().min(1, "required — the app cannot generate anything without it"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  throw new Error(`Invalid environment variables:\n${z.prettifyError(parsed.error)}`);
}

export const env = parsed.data;
