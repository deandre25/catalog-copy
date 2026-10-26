# Catalog Copy

An assistant for an e-commerce content team. Paste a supplier's raw product
specs and get back an SEO title, a meta description, a benefit list and a
long-form description — plus semantic search across everything already
generated.

The domain is deliberate: the interesting part of this project is not the copy
it writes, it is everything a production LLM integration needs around the model
call. Streaming with cancellation, schema-validated output with a repair turn,
retries that know which errors not to retry, a response cache, a cost ledger,
prompt-injection defences, and retrieval over pgvector — each one is
implemented, and each one is explained below including where it falls short.

**Live demo:** **https://catalog-copy-six.vercel.app**

> The embeddings account is on a free tier without a payment method, which caps
> it at **3 requests per minute**. Search more than three times in a minute and
> the page says so rather than hanging — that path is deliberate, see below.

## Architecture

```
  Browser                        Next.js route handlers              Providers
  ───────                        ──────────────────────              ─────────

  RawInputForm ───POST /api/products──────► products/service
                                                  │
                                                  ▼
                                              Product row

  GenerateButton ─POST /api/products/[id]/generate─► generation/service
                                                  │
                        sanitizeSpecs ────────────┤
                        detectInjectionSignals ───┤
                        cache read/write ◄────────┤────► LlmCache
                                                  ▼
                                        ai/generate-structured
                                        (withRetry + Zod + 1 repair turn)
                                                  │                 Anthropic
                                                  └────────────────► claude-haiku-5-5

  DescriptionStream ◄─SSE─ POST /api/generations/[id]/description
       │  AbortController                        │
       │  (Stop button)            stream sanitizer, periodic flush
       │                                         ▼
       │                               ai/stream-description          Anthropic
       │                                         │─────────────────► claude-sonnet-5-5
       │                                         ▼
       │                               search/index-service            Voyage
       │                                         └─────────────────► voyage-4-lite
       ▼
  partial text kept, marked incomplete

  Search page ────GET /search?q=────► search/service ──► pgvector, HNSW cosine
  Stats page ─────GET /stats────────► stats/service ───► LlmCall ledger (GROUP BY)
```

Every provider call — including each retry, each repair turn and each cache hit
— writes one row to `LlmCall`. Nothing stores a pre-aggregated total.

## The seven concerns

### 1. Streaming

The long description streams over SSE from a route handler
(`/api/generations/[id]/description`), consumed with `fetch` + `getReader`
rather than `EventSource`, which is GET-only and cannot set headers. The client
reassembles frames across chunk boundaries and decodes with
`TextDecoder(..., { stream: true })` so a multi-byte character split across two
TCP chunks is not mangled.

Three endings are handled separately, because they mean different things. The
**Stop button** aborts an `AbortController`; the browser keeps the text on
screen and the server stores it with `descriptionPartial: true`. A **dropped
connection** is indistinguishable from a closed tab on the server, so both are
recorded as cancelled — and because a torn-down serverless function may never
run cleanup, partial text is flushed to the database every 1.2s or 400
characters rather than only at the end. If the stream closes with **no terminal
event**, the client treats that as a failure rather than a success, since a
silent truncation would otherwise look like finished copy.

Partial text is never cached and never embedded. It is kept because the user
already read it, and flagged because it must never be published as complete.

### 2. Structured output

Title, meta description and benefits come back as JSON enforced by
`output_config.format` with `zodOutputFormat(structuredCopySchema)`. The server
guarantees shape and types, but the SDK moves `minLength`/`maxItems`-style
constraints into the schema *description*, so lengths are only a hint to the
model — they are revalidated locally with `safeParse`.

**The fallback is one repair turn, not a blind retry.** On a schema failure the
assistant's whole response is appended to the conversation along with the
specific Zod issues ("`seoTitle` must be at most 70 characters, got 83"), and
the model fixes what is listed. Of the three options — retry the same request,
partially accept, or repair — a plain retry wastes the information in the error,
and partial acceptance would publish copy that violates the SERP limits the
schema exists to enforce. The budget is exactly one repair: a model that fails
the same schema twice is not converging, and the third call costs as much as the
first. `messages.parse()` is deliberately not used; it throws and discards the
individual issues, which are the only thing that makes the repair turn work.

### 3. Retries

`withRetry` does exponential backoff with **full jitter** — the delay is drawn
uniformly from `[0, ceiling)` rather than set to the ceiling, so N callers
rate-limited by the same burst do not wake up in the same millisecond and
recreate it. A `retry-after` header outranks the computed curve. Three attempts,
30s per attempt, under a **shared 45s wall-clock budget** that narrows each
attempt as it is spent: a handler that is killed at 60s cannot afford three 30s
attempts, and if the next backoff would outlast the remaining budget the call
fails immediately with the real error instead of sleeping until it is killed.

Retryability is decided in `classifyError`, where the cause is known; the retry
loop only reads the flag. Retried: 408, 409, 429, 500, 502, 503, 504, 529, and
connection timeouts. **Not retried:** 400, 401, 402, 403, 404, 413, 422 — each
is a statement about the request itself, so repeating it buys the same answer at
triple the latency and, where billable, triple the cost. Also not retried:
`stop_reason: "refusal"` (deterministic), `max_tokens` truncation (the same
request produces the same cut-off), and user aborts (nobody is waiting for the
result). Retrying a 401 across many concurrent generations would turn one
configuration mistake into a burst against an endpoint already saying no.

The Anthropic SDK's own retries are switched off (`maxRetries: 0`) so that every
attempt is one visible row in the cost ledger.

### 4. Caching

`LlmCache` is keyed on `sha256(task | model | promptVersion | normalizedInput)`,
joined with a null byte so field boundaries cannot collide. Normalisation folds
CRLF, collapses whitespace per line and applies NFC — but **deliberately
preserves case**, because lowercasing would let `iPhone` and `iphone` share an
entry and corrupt brand casing on the way back out. The prompt version in the
key means editing a prompt invalidates the cache implicitly, with no manual
flush.

The description's key includes the title and benefits, not just the specs,
because they are in its prompt — keying on the specs alone would serve a
description written against a different title. Reads count the hit in the same
statement (`UPDATE ... RETURNING`), so concurrent requests do not lose hits.
Cached payloads are revalidated against the current Zod schema and dropped on
failure, since the prompt version covers prompt edits but not schema changes.
Only complete output is cached: caching a partial or refused response would
serve the same broken result forever, for free.

### 5. Cost accounting

One `LlmCall` row per HTTP request, append-only, including retries, repair
turns, failures and cache hits. Money is stored as **integer micro-dollars**
(1 = $0.000001) to avoid float drift on `SUM`, and the cost of a call is
computed by summing both token terms before a single division — dividing per
term first would round a 300-token Haiku call down to zero and the ledger would
report free generations.

`/stats` is a `GROUP BY` over that table: spend in the last 24 hours, average
cost per completed generation, failures by error code, spend per model, and a
14-day series built with `generate_series` so quiet days render as zero instead
of disappearing. Cache savings are shown as an **estimate** and labelled as one:
hits multiplied by the average billed cost of the same task and model, because
what a cache hit would have cost is not knowable, only approximable.

### 6. Prompt-injection protection

The threat model comes first, because it determines which defences matter. The
model has no tools, no database access, no network and no secrets in its
prompt, so there is nothing to exfiltrate. The real risk is **output
hijacking**: injected text in a supplier feed making the model write a
competitor's domain, a fake discount or SEO spam into copy that is then
published.

That makes the defence that holds an **output** filter. Everything the model
produces is stripped of HTML tags, markdown links and images, schemed URLs,
bare domains and email addresses before it is stored. Bare domains are matched
against a short TLD list rather than a general `word.word` pattern, because a
false positive that silently deletes words from published copy is worse than a
link that slips through. The streaming path holds text back past the last
whitespace and never releases an unclosed `<` or `[`, so a payload split across
four deltas never reaches the browser even for a moment.

Input-side measures raise the bar rather than close the hole: invisible
characters (zero-width, soft hyphen, bidi overrides, C0/C1) are stripped; the
data is fenced in a tag with a **per-request random suffix** so pasted text
cannot close the fence and continue as the operator, and any `product_specs`
tag inside the data is neutralised; and the instruction is repeated after the
data block, because the model weighs the last thing it read heavily.

A pattern detector labels suspicious input (`ignore_instructions`, `fake_turn`,
`role_reassignment`, `prompt_extraction`, …) and surfaces it in the UI as
"Needs review". It **never blocks**: the same instruction rephrased, split
across lines or written in another language walks straight past it, so as a
gate it would deliver false confidence plus false positives on legitimate
specs.

**What none of this protects against:** semantic manipulation inside the schema
— an injection can still make the model omit a real drawback or overstate
within 160 characters, and no regex detects a change in meaning. It does not
prevent system-prompt extraction, and nothing here depends on that prompt being
secret. Most importantly, there is no reliable way to make an LLM distinguish
instructions from data; these measures reduce the blast radius, they do not
remove the vulnerability. What actually bounds the damage is the architecture:
no tools, no credentials, no side effects. The worst outcome is bad text, and
bad text is caught by the output filter and a human reviewer.

### 7. RAG

One `vector(1024)` per product in `ProductEmbedding`, from Voyage
`voyage-4-lite` — Anthropic has no embeddings endpoint, so this is the only
provider call outside the SDK, and it reuses the same retry policy and ledger.
Document and query sides are embedded with different `input_type` values, which
is what makes them comparable; using `document` for a query still returns 1024
numbers and still ranks, just measurably worse, which is the kind of bug that
never throws.

**Chunk size: one chunk per product, deliberately.** Chunking exists to stop a
long document's meaning from averaging into a vector that is close to everything
and specific to nothing, and to return the passage that answers a question.
Neither applies to ~350 tokens of copy against a 32,000-token limit that is
already one coherent unit — a single product. Splitting it into paragraphs would
make the retrieval unit a *fragment* of a product, so "similar products" would
return the same product three times. The threshold where this flips is
documents long enough that one vector loses detail (a manual, a page of
reviews); then chunks of a few hundred tokens with a sentence of overlap, each
carrying the product id, are the right shape.

**Similarity metric: cosine.** Voyage returns unit-length vectors, so cosine
similarity, dot product and Euclidean distance rank *identically* — the metric
cannot change the ordering, and the choice is made on what does differ. Cosine
distance is bounded in `[0, 2]` whatever the magnitudes, so a score can be shown
in the UI and a threshold stays meaningful if a provider that does not normalise
is swapped in; and it ignores magnitude, which in text embeddings mostly tracks
length, so a 240-word description and a 160-word one are compared on what they
say.

The index is HNSW over `vector_cosine_ops`, not IVFFlat: IVFFlat must be trained
on existing rows to choose its lists, and a catalog filled one product at a time
would build its index on an empty table. The query selects the distance but
orders by the **bare operator expression** — `ORDER BY 1 - (embedding <=> q)
DESC` reads better and silently falls back to a sequential scan, and an index
built for cosine is unusable by `<->`.

What is indexed is the *generated* copy, not the supplier's specs: the search is
a question about the catalog a shopper sees; supplier text is hostile to
retrieval (SKUs, boilerplate, tables of numbers); and the generated copy has
already been through the output filter, so raw specs would put injected text
back into the corpus. Re-embedding unchanged text is skipped on a source hash,
query vectors go through the same response cache so a shared search URL costs
one provider call, and "similar products" on a product page costs nothing at all
— that product's vector is already in the table.

## Stack

| | |
|---|---|
| Framework | Next.js 16 (App Router, Cache Components) |
| Language | TypeScript, strict |
| Database | PostgreSQL 17 + pgvector, Prisma 7 ORM |
| Validation | Zod 4 |
| Styling | Tailwind CSS 4 |
| Models | Anthropic `claude-haiku-5-5` / `claude-sonnet-5-5` |
| Embeddings | Voyage `voyage-4-lite`, 1024 dimensions |
| Hosting | Vercel + Neon |

Next.js 16 rather than the 15 originally planned: `create-next-app` installs 16,
15 is already a previous major, and every surface this project uses — route
handlers, SSE, async `params` — is identical on both.

## Local setup

Requires Node 20+ and Docker.

```bash
cp .env.example .env    # then fill in ANTHROPIC_API_KEY and VOYAGE_API_KEY
npm install
npm run db:up           # postgres + pgvector on localhost:5433
npm run db:migrate      # apply migrations, including CREATE EXTENSION vector
npm run dev
```

The app runs on http://localhost:3000. Both API keys are validated at startup by
`src/lib/env.ts`, so a missing one fails the process immediately instead of
surfacing as a provider 401 in the middle of a generation.

## Deployment

1. **Neon** — create a project. pgvector is available there; the extension is
   created by the migration, not by hand.
2. **Migrate** — point `DATABASE_URL` at the Neon branch and run
   `npm run db:deploy` (`prisma migrate deploy`). This is a deliberate manual
   step rather than part of the build: a failed migration inside a build leaves
   a half-deployed schema behind a live deployment.
3. **Vercel** — import the repository and set `DATABASE_URL` (the **pooled**
   Neon connection string, since serverless functions open a pool per
   instance), `ANTHROPIC_API_KEY` and `VOYAGE_API_KEY`.
4. `postinstall` runs `prisma generate`, so the client is built on Vercel; the
   generated client is gitignored rather than committed.

Route durations are declared per handler (`maxDuration = 60`), above the 45s
retry budget so a handler outlives its own worst case.

## Scripts

| Script | |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run db:up` / `db:down` | Start / stop the local database |
| `npm run db:migrate` | Create and apply a migration (development) |
| `npm run db:deploy` | Apply pending migrations (production) |
| `npm run db:studio` | Prisma Studio |

## Data model

- **Product** — a catalog entry: the raw specs as pasted, plus a hash of their
  normalized form.
- **Generation** — one attempt at producing copy for a product. Kept as
  history, never overwritten, so output from different prompt versions can be
  compared. Carries `descriptionPartial` and the review `warnings`.
- **LlmCall** — append-only ledger, one row per request to a model provider,
  including failed attempts, retries and cache hits. All cost reporting is a
  `GROUP BY` over this table.
- **LlmCache** — response cache keyed by `task | model | promptVersion |
  normalizedInput`, so editing a prompt invalidates it implicitly.
- **ProductEmbedding** — one `vector(1024)` per product, built from its latest
  complete copy and indexed with HNSW over cosine distance. Written and read
  through raw SQL: Prisma has no vector type.

## Status

All seven concerns have been exercised against the live providers. Measured on
2026-10-26, three products end to end:

| | |
|---|---|
| Structured copy (Haiku) | 1,121 in / 2,119 out tokens, **$0.0012**, 10.3s |
| Description (Sonnet) | 776 in / 451 out tokens, **$0.0061**, 5.0s |
| Embedding (voyage-4-lite) | 423 tokens, **$0.000008**, 0.8s |
| **Per product, cold** | **~$0.0073** |
| Same description from cache | **$0**, 160ms instead of 5.0s |

Behaviour, not just cost:

- **Structured output** came back inside every bound without a repair turn —
  a 52-character title (limit 70), a 108-character meta description (70-160)
  and five benefits.
- **Cancellation**: killing the client 3s into a stream left 157 words stored
  with `descriptionPartial: true`, status `CANCELLED`, and nothing cached.
- **Injection**: a supplier feed carrying a fake `</product_specs>`, a
  `System:` turn, a competitor domain, an `<a href>` and an email produced
  clean copy from the real specs only — and five signals flagged for review.
  The output filter had nothing to strip, which is the first layer holding.
- **RAG**: "quiet machine for a small flat" — words that appear in none of the
  copy — ranked the washing machine 0.409, the dishwasher 0.353 and a garden
  hose 0.047. A repeat of the same query served the vector from cache.
- The live run found one real bug: an aborted stream was billed as $0, because
  usage was only read from `finalMessage()`, which a broken stream never
  produces. Usage is now accumulated from the stream events, so a cancelled
  generation reports the tokens the provider actually charged for. The output
  count on an abort is a floor rather than an exact figure, and that is
  documented where it is recorded.

Deployed to Vercel with the database on Neon, where `migrate deploy` created
the pgvector extension and the HNSW index unattended.

Production found three more bugs that local development could not:

- **The search page hung on "Searching…" for about half of all requests.**
  Prisma's I/O is invisible to Next, so the Suspense boundary stayed in
  prerender mode and the first clock read inside the retry loop threw as an
  unstable value. Fixed with `await connection()` at the top of the boundary
  and a monotonic timer for latency.
- **A provider error inside a streamed boundary had no way to report itself.**
  Once the shell is flushed there is no status code left to send, so the
  stream simply ended and the fallback stayed on screen forever. The boundary
  now catches `LlmError` and renders the reason.
- **`Number(null)` is `0`**, so a provider that sends no `retry-after` — Voyage
  documents none — was read as "retry immediately", collapsing the backoff
  curve and burning all three attempts inside one second.

Outstanding: no screenshots in this README yet.
