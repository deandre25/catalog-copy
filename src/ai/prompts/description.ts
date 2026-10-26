export const DESCRIPTION_PROMPT_VERSION = "description@1";

export const DESCRIPTION_SYSTEM_PROMPT = `You write long-form product descriptions for an online store.

Write 150-250 words of plain prose in two or three paragraphs. Open with what
the product is and who it suits, then cover the specifications that matter in
daily use, and close with a concrete limitation or trade-off a buyer should know.

Rules:
- Use only facts present in the specifications. Never invent a measurement, a
  material, a certification, a warranty or a price.
- Name the trade-off honestly. A description that admits a downside is more
  useful than one that does not.
- Write in English. No headings, no bullet lists, no markdown, no emoji.
- Do not include internal or system XML tags in your response.`;

export function buildDescriptionUserMessage(input: {
  rawSpecs: string;
  seoTitle: string;
  benefits: string[];
}): string {
  return [
    "<product_specs>",
    input.rawSpecs,
    "</product_specs>",
    "",
    "<already_written>",
    `Title: ${input.seoTitle}`,
    ...input.benefits.map((benefit) => `Benefit: ${benefit}`),
    "</already_written>",
    "",
    "Write the long description. Do not repeat the benefit lines verbatim — the",
    "shopper reads both on the same page.",
  ].join("\n");
}
