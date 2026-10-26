/**
 * Characters that are invisible to a human reviewing a spec sheet but are read
 * by the model: C0/C1 controls, zero-width marks, soft hyphen and the bidi
 * overrides. They are the standard way to hide an instruction inside text that
 * looks clean in a spreadsheet cell.
 */
const HIDDEN_CHARS_SOURCE =
  "[\\u0000-\\u0008\\u000B-\\u001F\\u007F-\\u009F\\u00AD\\u200B-\\u200F\\u2028\\u2029\\u202A-\\u202E\\u2060-\\u2064\\u2066-\\u2069\\uFEFF]";

const HIDDEN_CHARS = new RegExp(HIDDEN_CHARS_SOURCE, "g");

const HTML_TAG = /<[^<>]{0,200}>/g;
const MARKDOWN_IMAGE = /!\[([^\]]*)\]\([^)]*\)/g;
const MARKDOWN_LINK = /\[([^\]]*)\]\([^)]*\)/g;
const SCHEMED_URL = /\b(?:https?:\/\/|ftp:\/\/|www\.)\S+/gi;
const EMAIL = /\b[\w.+-]+@[\w-]+\.[a-z]{2,}\b/gi;

/**
 * Bare domains are matched only against a short list of common TLDs. A general
 * `word.word` pattern would eat ordinary prose whenever a space after a full
 * stop is missing ("almost dry.Weiss"), and a false positive that silently
 * deletes words from published copy is worse than a link that slips through.
 */
const BARE_DOMAIN =
  /\b[a-z0-9][a-z0-9-]+\.(?:com|net|org|io|co|shop|store|ua|ru|pl|de|cn)\b(?:\/\S*)?/gi;

export function sanitizeSpecs(raw: string): { text: string; removedHiddenChars: number } {
  const hidden = raw.match(HIDDEN_CHARS)?.length ?? 0;

  const text = raw
    .replace(HIDDEN_CHARS, "")
    // The fence tag is neutralised in the data itself, so pasted text cannot
    // close the fence and continue as if it were the operator speaking.
    .replace(/<\/?product_specs[^>]*>/gi, "[removed]")
    .normalize("NFC");

  return { text, removedHiddenChars: hidden };
}

export type SanitizedText = { text: string; removed: string[] };

/**
 * Runs on everything the model produces, before it is stored.
 *
 * This is the defence that actually holds. The prompt-side measures make
 * injection harder to express; this one makes a successful injection unable to
 * carry a payload worth delivering — a competitor's link, a contact address or
 * markup aimed at the storefront.
 */
export function sanitizeCopyText(
  raw: string,
  // Trimming is wrong when the input is one chunk of a stream: the space that
  // separates it from the next chunk lives at its edges, and trimming every
  // chunk glues the words together.
  { trim = true }: { trim?: boolean } = {},
): SanitizedText {
  const removed: string[] = [];
  let text = raw;

  const strip = (pattern: RegExp, label: string, replacement = "") => {
    const before = text;
    text = text.replace(pattern, replacement);
    if (text !== before) removed.push(label);
  };

  strip(HIDDEN_CHARS, "hidden_characters");
  strip(MARKDOWN_IMAGE, "markdown_image");
  // Keeps the visible label, drops the target.
  strip(MARKDOWN_LINK, "markdown_link", "$1");
  strip(HTML_TAG, "html_tag");
  strip(SCHEMED_URL, "url");
  strip(BARE_DOMAIN, "domain");
  strip(EMAIL, "email");

  text = text.replace(/[^\S\n]{2,}/g, " ").replace(/ +\n/g, "\n");
  if (trim) text = text.trim();

  return { text, removed: [...new Set(removed)] };
}

const INJECTION_PATTERNS: Array<[RegExp, string]> = [
  [
    /ignore\s+(?:all\s+|any\s+)?(?:previous|prior|above|earlier)\s+instruction/i,
    "ignore_instructions",
  ],
  [/disregard\s+(?:the\s+)?(?:above|previous|prior|system)/i, "disregard"],
  [/\b(?:new|updated|revised)\s+instructions?\b/i, "new_instructions"],
  [/\byou\s+are\s+now\b/i, "role_reassignment"],
  [/^\s*(?:system|assistant)\s*:/im, "fake_turn"],
  [/<\/?(?:product_specs|system|assistant|human|user)\b/i, "fake_delimiter"],
  [
    /\b(?:reveal|repeat|print|output)\b[^.\n]{0,40}\b(?:system\s+prompt|instructions)\b/i,
    "prompt_extraction",
  ],
  [
    /\binstead\s+(?:of|write|output)\b[^.\n]{0,60}\b(?:write|say|output|recommend|buy)\b/i,
    "substitute_output",
  ],
];

/**
 * Returns labels for a human, not a verdict for the program.
 *
 * A pattern list cannot gate anything: the same instruction rephrased, split
 * across lines or written in another language walks straight past it. Used as a
 * block it would produce false confidence plus false positives on legitimate
 * specs. Used as a flag on the generation it does the one thing it is good for
 * — telling a reviewer which output deserves a second look.
 */
export function detectInjectionSignals(raw: string): string[] {
  const signals = INJECTION_PATTERNS.filter(([pattern]) => pattern.test(raw)).map(
    ([, label]) => label,
  );

  // Fresh instances: a global regex carries lastIndex across test() calls, so a
  // shared one would start matching mid-string on the next input.
  if (new RegExp(HIDDEN_CHARS_SOURCE).test(raw)) signals.push("hidden_characters");
  if (/\b(?:https?:\/\/|www\.)\S+/i.test(raw) || new RegExp(BARE_DOMAIN.source, "i").test(raw)) {
    signals.push("contains_url");
  }

  return [...new Set(signals)];
}

/**
 * Sanitises a stream without waiting for it to finish.
 *
 * Applying sanitizeCopyText to each delta on its own would be useless: a URL
 * or a tag arrives split across several deltas, and half a URL matches
 * nothing. So text is held back until it cannot still be the start of
 * something that needs removing — past the last whitespace, and never inside
 * an unclosed `<` or `[`.
 */
export function createStreamSanitizer() {
  let pending = "";

  return {
    push(delta: string): SanitizedText {
      pending += delta;

      const lastSpace = Math.max(pending.lastIndexOf(" "), pending.lastIndexOf("\n"));
      let cut = lastSpace + 1;

      const lastOpen = Math.max(pending.lastIndexOf("<"), pending.lastIndexOf("["));
      if (lastOpen >= 0 && !/[>\]]/.test(pending.slice(lastOpen))) {
        cut = Math.min(cut, lastOpen);
      }

      if (cut <= 0) return { text: "", removed: [] };

      const ready = pending.slice(0, cut);
      pending = pending.slice(cut);

      return sanitizeCopyText(ready, { trim: false });
    },

    flush(): SanitizedText {
      const result = sanitizeCopyText(pending, { trim: false });
      pending = "";
      return result;
    },
  };
}
