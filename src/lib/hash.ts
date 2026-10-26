import { createHash } from "node:crypto";

/**
 * Collapses differences that must not produce a separate cache entry: CRLF,
 * trailing spaces, repeated blank lines, non-normalized Unicode.
 *
 * Case is deliberately preserved. Lowercasing would make "iPhone" and "iphone"
 * share a cache entry, and the second request would be served copy written for
 * the first — silently corrupting brand casing in the SEO title.
 */
export function normalizeInput(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Parts are joined with NUL rather than concatenated: without a separator
 * ("ab" + "c") and ("a" + "bc") would hash identically, which would let a
 * prompt version bleed into a task name and return the wrong cached response.
 */
export function sha256(parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("\u0000")).digest("hex");
}
