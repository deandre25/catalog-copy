# Catalog Copy

An assistant for e-commerce content teams: paste raw product specs, get an
SEO title, meta description, benefit list and a long-form description, plus
semantic search across everything already generated.

Work in progress — this README documents setup only. The architecture notes and
the write-up of each LLM concern (streaming, structured output, retries,
caching, cost accounting, prompt-injection defences, RAG) land in stage 8.

## Stack

| | |
|---|---|
| Framework | Next.js 16 (App Router, Cache Components) |
| Language | TypeScript, strict |
| Database | PostgreSQL 17 + pgvector, Prisma 7 ORM |
| Validation | Zod 4 |
| Styling | Tailwind CSS 4 |
| Models | Anthropic `claude-haiku-5-5` / `claude-sonnet-5-5` |

## Local setup

Requires Node 20+ and Docker.

```bash
cp .env.example .env
npm install
npm run db:up        # postgres + pgvector on localhost:5433
npm run db:migrate   # apply migrations
npm run dev
```

The app runs on http://localhost:3000.

## Scripts

| Script | |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run db:up` / `db:down` | Start / stop the local database |
| `npm run db:migrate` | Create and apply a migration |
| `npm run db:studio` | Prisma Studio |

## Data model

- **Product** — a catalog entry: the raw specs as pasted, plus a hash of their
  normalized form.
- **Generation** — one attempt at producing copy for a product. Kept as
  history, never overwritten, so output from different prompt versions can be
  compared.
- **LlmCall** — append-only ledger, one row per request to a model provider,
  including failed attempts, retries and cache hits. All cost reporting is a
  `GROUP BY` over this table.
- **LlmCache** — response cache keyed by `task | model | promptVersion |
  normalizedInput`, so editing a prompt invalidates it implicitly.
