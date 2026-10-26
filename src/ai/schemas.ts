import { z } from "zod";

export const structuredCopySchema = z.object({
  // 70 / 160 characters are where Google truncates a title and a description in
  // search results. Copy past that limit is paid for and then cut off.
  seoTitle: z.string().min(20).max(70),
  metaDescription: z.string().min(70).max(160),
  benefits: z.array(z.string().min(15).max(120)).min(3).max(5),
});

export type StructuredCopy = z.infer<typeof structuredCopySchema>;
