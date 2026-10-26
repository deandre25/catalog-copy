import { z } from "zod";

export const createProductSchema = z.object({
  title: z.string().trim().min(2, "Name is too short").max(120),
  rawInput: z
    .string()
    .trim()
    .min(20, "Paste at least a few specs — there is nothing to work with yet")
    // Upper bound is a cost guard, not a model limit: anything past this is a
    // pasted web page rather than a spec sheet, and it would be paid for twice
    // (prompt tokens now, embedding tokens in stage 7).
    .max(8000, "Specs are too long — trim to the relevant attributes"),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
