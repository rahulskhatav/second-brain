# Second Brain

A personal knowledge management app. Users paste a URL, the backend scrapes the article, Gemini produces a summary + tags + embedding, and the user's reading history is rendered as an interactive force-directed knowledge graph.

**This README is the build spec.** Implement it in the phase order given in [§10](#10-build-order). Do not skip phases — each one ends in a verifiable state.

---

## 1. Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js 15 (App Router), TypeScript | UI + API routes in one deployable |
| Styling | Tailwind CSS v4 | See [§3 Design](#3-design-integration) before writing any UI |
| Graph | `react-force-graph-2d` | Canvas-based, handles pan/zoom/physics natively |
| Backend | Next.js Route Handlers (Node runtime) | **Not** edge runtime — `pg` and `bcrypt` need Node |
| DB | Vercel Postgres (Neon) + `pgvector` | Accessed via `pg` (node-postgres) |
| Auth | Hand-rolled: `bcrypt` + `jsonwebtoken`, JWT in httpOnly cookie | No Supabase, no NextAuth |
| AI | Google Gemini API (`@google/genai`) | `gemini-2.5-flash` for summarize/tag, `gemini-embedding-001` for vectors |
| Validation | `zod` | Every route handler validates its body |

### Dependencies

```bash
npm i pg bcrypt jsonwebtoken @google/genai zod react-force-graph-2d \
      @mozilla/readability jsdom
npm i -D @types/pg @types/bcrypt @types/jsonwebtoken @types/jsdom
```

> `bcrypt` is a native module. If the deploy target chokes on it, swap to `bcryptjs` (pure JS, same API surface via `bcryptjs`'s `hash`/`compare`). Do not mix the two.

---

## 2. Environment

Create `.env.local` (and mirror these in Vercel project settings). Also commit a `.env.example` with empty values.

```bash
# Vercel Postgres — copy from the Vercel dashboard, Storage tab
POSTGRES_URL="postgres://..."
POSTGRES_URL_NON_POOLING="postgres://..."   # used by migration script only

# Auth
JWT_SECRET=""            # 32+ random bytes: openssl rand -base64 32
JWT_EXPIRES_IN="7d"

# Google Gemini
GEMINI_API_KEY=""

# Tuning
SIMILARITY_THRESHOLD="0.78"   # cosine similarity cutoff for graph edges
```

Rules:
- `JWT_SECRET` is read once at module load in `lib/auth.ts` and **must throw** if missing.
- Never expose any of these via `NEXT_PUBLIC_`.

---

## 3. Design integration

A design will be generated separately in Claude Design and dropped into this repo. Treat it as the **visual source of truth** — it overrides any styling implied by this README.

**Expected drop location:** `/design/`

```
design/
  README.md            # notes from the design tool, if any
  tokens.css           # CSS custom properties: colors, radii, spacing, shadows
  components/          # any exported .tsx components
  screens/             # static reference markup or screenshots
```

**Instructions when `/design/` exists:**

1. Import `design/tokens.css` in `app/globals.css` **above** the Tailwind import, and map the tokens into the Tailwind v4 `@theme` block so utilities resolve to design values:
   ```css
   @import "../design/tokens.css";
   @import "tailwindcss";

   @theme {
     --color-bg: var(--sb-bg);
     --color-surface: var(--sb-surface);
     --color-accent: var(--sb-accent);
     /* ...map every token the design defines */
   }
   ```
2. Move exported components into `components/ui/`, keeping their markup and class names intact. Refactor only to add props, typing, and event handlers — **do not restyle**.
3. Derive graph canvas colors (node fill, edge stroke, hover, selected) from the same tokens by reading them off `getComputedStyle(document.documentElement)` at mount. The force-graph canvas cannot use CSS classes, so tokens must be read into JS.
4. Where the design and this README disagree on layout, follow the design and note the deviation in a comment.

**If `/design/` does not exist**, build a clean dark-mode-first UI: a single accent color, generous whitespace, `rounded-xl` surfaces, and no decorative gradients. Keep all color values as CSS variables in `globals.css` so the design can be swapped in later without touching components.

---

## 4. File structure

```
app/
  layout.tsx
  globals.css
  page.tsx                        # redirects: → /brain if authed, → /login if not
  (auth)/
    login/page.tsx                # FR2
    register/page.tsx             # FR1
  (app)/
    layout.tsx                    # server-side session guard + nav shell
    home/page.tsx                 # FR3 — URL input + tag cloud
    brain/page.tsx                # FR4 + FR5 — graph + search
  api/
    auth/register/route.ts
    auth/login/route.ts
    auth/logout/route.ts
    auth/me/route.ts
    articles/route.ts             # POST ingest, GET list
    articles/[id]/route.ts        # GET one, DELETE
    graph/route.ts                # nodes + edges
    search/route.ts               # FR5
components/
  ui/                             # from /design
  ArticleInput.tsx
  TagCloud.tsx
  KnowledgeGraph.tsx
  ArticlePanel.tsx
  SearchBar.tsx
  SearchResults.tsx
lib/
  db.ts                           # pg Pool singleton
  auth.ts                         # hash, verify, sign, session helpers
  scrape.ts                       # fetch + Readability extraction
  gemini.ts                       # summarize/tag/embed
  similarity.ts                   # cosine + edge building
  validation.ts                   # zod schemas
scripts/
  migrate.ts                      # runs db/schema.sql
db/
  schema.sql
design/                           # see §3
middleware.ts                     # route protection
```

---

## 5. Database

`db/schema.sql` — idempotent, safe to re-run.

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS articles (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url        TEXT,
  title      TEXT NOT NULL,
  summary    TEXT NOT NULL,
  tags       TEXT[] NOT NULL DEFAULT '{}',
  embedding  VECTOR(768),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS articles_user_idx     ON articles(user_id);
CREATE INDEX IF NOT EXISTS articles_tags_idx     ON articles USING GIN(tags);
CREATE INDEX IF NOT EXISTS articles_search_idx   ON articles
  USING GIN(to_tsvector('english', title || ' ' || summary));
CREATE INDEX IF NOT EXISTS articles_embed_idx    ON articles
  USING hnsw (embedding vector_cosine_ops);

-- Edges are precomputed on insert (see §7.3)
CREATE TABLE IF NOT EXISTS edges (
  source_article_id UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  target_article_id UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  similarity_score  REAL NOT NULL,
  shared_tags       TEXT[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (source_article_id, target_article_id),
  CHECK (source_article_id < target_article_id)   -- store each pair once
);
```

Notes:
- `url` is nullable — FR3's error path allows pasting raw text with no URL.
- The `CHECK (source < target)` constraint means every pair is stored once; the graph is undirected. Always order the two IDs before inserting.
- `VECTOR(768)` matches `gemini-embedding-001` when requested with `outputDimensionality: 768`. If you change the dimension, change it in both places.

`scripts/migrate.ts` reads `db/schema.sql` and executes it against `POSTGRES_URL_NON_POOLING`. Wire it as `npm run db:migrate`.

---

## 6. Auth (FR1, FR2)

`lib/auth.ts` exports:

```ts
hashPassword(plain: string): Promise<string>          // bcrypt, 12 rounds
verifyPassword(plain, hash): Promise<boolean>
signToken(payload: { sub: string; username: string }): string
verifyToken(token: string): { sub: string; username: string } | null
getSession(): Promise<{ userId: string; username: string } | null>  // reads cookie, server-side
requireSession(): Promise<{ userId: string; username: string }>     // throws 401 shape
```

Cookie: name `sb_session`, `httpOnly: true`, `sameSite: 'lax'`, `secure` in production, `path: '/'`, `maxAge` matching `JWT_EXPIRES_IN`.

**FR1 — Register.** `POST /api/auth/register` `{ username, password }`
- Validate: username 3–32 chars, `[a-zA-Z0-9_-]+`; password ≥ 8 chars.
- `409` if username taken. Message: `"That username is already taken."`
- On success: hash (bcrypt, cost 12), insert user, set cookie, return `{ user: { id, username } }`. Client redirects to `/home`.

**FR2 — Login.** `POST /api/auth/login` `{ username, password }`
- On failure return `401 { error: "Incorrect username or password. Please try again." }` for **both** unknown-user and wrong-password. Do not distinguish.
- Client on `401`: clear the password field, apply an error ring to it (`aria-invalid="true"`), render the message beneath. Keep the username value.
- On success: set cookie, redirect to `/brain`.

**Logout.** `POST /api/auth/logout` clears the cookie.

**`middleware.ts`** — verify the JWT and redirect unauthenticated users hitting `/home` or `/brain` to `/login`. Redirect authenticated users hitting `/login` or `/register` to `/brain`. Middleware runs on the edge runtime, so use `jose` for verification there (`jsonwebtoken` is Node-only) — or keep middleware to a cookie-presence check and do full verification server-side in `(app)/layout.tsx`. **Pick the second option** for simplicity; note it in a comment.

---

## 7. Ingestion pipeline (FR3)

### 7.1 Scraping — `lib/scrape.ts`

```ts
extractArticle(url: string): Promise<{ title: string; text: string }>
```

- `fetch` with a browser-like `User-Agent` and a 10s `AbortSignal.timeout`.
- Parse with `jsdom` + `@mozilla/readability` to strip nav/ads/boilerplate.
- Throw a typed `ScrapeError` if: non-2xx, non-HTML content type, or extracted text < 200 chars.
- **SSRF guard (required):** reject non-`http(s)` schemes and any URL resolving to a private range — `localhost`, `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `::1`, `fc00::/7`. Resolve the hostname with `dns.promises.lookup` and check the resolved IP, not just the string.

### 7.2 AI — `lib/gemini.ts`

```ts
analyzeArticle(text: string): Promise<{
  title: string;
  summary: string;      // ~100 words
  tags: string[];       // 3–5
}>
embed(text: string): Promise<number[]>   // 768-dim
```

Use structured output — do not parse free-form text:

```ts
const res = await ai.models.generateContent({
  model: "gemini-2.5-flash",
  contents: text.slice(0, 30000),
  config: {
    systemInstruction:
      "You analyze articles for a personal knowledge base. Return a factual title, " +
      "a summary of approximately 100 words written in plain prose with no preamble, " +
      "and 3 to 5 topic tags. Tags must be lowercase, 1-2 words, broad enough that " +
      "different articles on the same subject would receive the identical tag " +
      "(prefer 'machine learning' over 'transformer attention mechanisms').",
    responseMimeType: "application/json",
    responseSchema: {
      type: "object",
      properties: {
        title:   { type: "string" },
        summary: { type: "string" },
        tags:    { type: "array", items: { type: "string" }, minItems: 3, maxItems: 5 },
      },
      required: ["title", "summary", "tags"],
    },
  },
});
```

Embedding: `gemini-embedding-001`, input = `${title}\n\n${summary}`, `taskType: "SEMANTIC_SIMILARITY"`, `outputDimensionality: 768`. **Normalize the vector to unit length** before storing — cosine distance math assumes it.

Normalize tags before storage: trim, lowercase, dedupe.

### 7.3 Edge computation — `lib/similarity.ts`

Immediately after inserting an article, compute its edges against the same user's existing articles in one query:

```sql
INSERT INTO edges (source_article_id, target_article_id, similarity_score, shared_tags)
SELECT
  LEAST($1::uuid, a.id), GREATEST($1::uuid, a.id),
  1 - (a.embedding <=> $2::vector),
  ARRAY(SELECT UNNEST(a.tags) INTERSECT SELECT UNNEST($3::text[]))
FROM articles a
WHERE a.user_id = $4 AND a.id <> $1 AND a.embedding IS NOT NULL
  AND (
    1 - (a.embedding <=> $2::vector) >= $5           -- similarity threshold
    OR a.tags && $3::text[]                          -- OR shares a tag
  )
ON CONFLICT DO NOTHING;
```

`<=>` is pgvector's cosine **distance**, so similarity is `1 - distance`. Threshold comes from `SIMILARITY_THRESHOLD`.

### 7.4 Route — `POST /api/articles`

Body: `{ url?: string, text?: string }` — exactly one required.

Flow: session → validate → if `url`, scrape (on `ScrapeError` return `422 { error: "SCRAPE_FAILED", message: "We couldn't read that page. Paste the article text instead." }`) → `analyzeArticle` → `embed` → insert article → insert edges → `201 { article }`.

Client on `201`: `router.push('/brain?focus=<id>')`. Client on `422 SCRAPE_FAILED`: swap the input for a textarea, preserve the URL, and resubmit as `{ url, text }`.

Show a determinate-feeling progress state during ingest — it takes 5–15s. Label the stages: *Fetching → Reading → Connecting*.

---

## 8. Graph (FR4)

### `GET /api/graph`

Returns for the current user:

```ts
{
  nodes: { id, title, url, tags, createdAt, summary }[],
  links: { source, target, value }[]   // value = similarity_score
}
```

### `components/KnowledgeGraph.tsx`

- `react-force-graph-2d`, dynamically imported with `ssr: false` (it touches `window`).
- Node size scales with degree. Node color is derived from its **most common tag** — hash the tag string to an index into a palette pulled from design tokens.
- Link opacity/width scales with `value`.
- Pan (drag), zoom (scroll), and node repulsion come free from the library. Set `d3VelocityDecay ≈ 0.3` and a `charge` strength around `-120` so clusters read clearly without flying apart.
- Render node labels only above a zoom threshold; below it, dots only.
- **Click a node** → open `ArticlePanel` (right side panel on desktop ≥768px, bottom sheet on mobile) showing: title, URL as an external link, date added, the 100-word summary, and tag chips. Include a delete action that calls `DELETE /api/articles/[id]` and removes the node.
- Empty state (0 articles): centered prompt linking to `/home`.
- `?focus=<id>` in the URL: center the camera on that node and open its panel.

**Performance:** freeze the simulation (`cooldownTicks`) once settled. Re-heat only when nodes are added.

---

## 9. Search (FR5)

### `GET /api/search?q=`

- Returns `[]` if `q.trim().length <= 3`.
- Query, scoped to the user, ordered by relevance:

```sql
SELECT id, title, url, summary, tags, created_at
FROM articles
WHERE user_id = $1 AND (
  to_tsvector('english', title || ' ' || summary) @@ plainto_tsquery('english', $2)
  OR title ILIKE '%' || $2 || '%'
  OR EXISTS (SELECT 1 FROM unnest(tags) t WHERE t ILIKE '%' || $2 || '%')
)
ORDER BY ts_rank(to_tsvector('english', title || ' ' || summary),
                 plainto_tsquery('english', $2)) DESC,
         created_at DESC
LIMIT 50;
```

### Client behavior

- Debounce 300ms. Fire only when `length > 3`.
- Abort the in-flight request when a new keystroke supersedes it (`AbortController`).
- On results: fade the graph out (opacity transition, ~150ms) and mount a scrollable result list — each row: title, tag chips, date, first line of summary. Clicking a row opens the same `ArticlePanel`.
- **Keep the graph component mounted** behind the list (`hidden` / opacity-0), so the simulation state survives. Do not unmount it — remounting re-runs the physics and loses positions.
- On clearing to 0 characters: unmount the list, fade the graph back in, positions intact.

---

## 10. Build order

Complete each phase and verify before moving on.

**Phase 1 — Foundation.** Next.js + TS + Tailwind scaffold, `lib/db.ts`, `db/schema.sql`, `scripts/migrate.ts`, `.env.example`. ✅ `npm run db:migrate` creates all tables against Vercel Postgres.

**Phase 2 — Auth.** `lib/auth.ts`, all four auth routes, login/register pages, `(app)` layout guard. ✅ Register → land on `/home`; log out, log back in → land on `/brain`; bad password shows the exact FR2 error with the field cleared; hitting `/brain` logged-out redirects.

**Phase 3 — Ingestion.** `lib/scrape.ts`, `lib/gemini.ts`, `lib/similarity.ts`, `POST /api/articles`, `/home` page with input + tag cloud. ✅ Pasting a real article URL stores a row with a non-null 768-dim embedding, 3–5 tags, and a ~100-word summary; a bad URL surfaces the paste-text fallback; edges appear in the `edges` table from the second article onward.

**Phase 4 — Graph.** `GET /api/graph`, `KnowledgeGraph`, `ArticlePanel`. ✅ Nodes render, pan/zoom work, related articles visibly cluster, clicking a node opens the panel with correct data.

**Phase 5 — Search.** `GET /api/search`, `SearchBar`, `SearchResults`. ✅ Typing 4+ chars swaps to the list after ~300ms; clearing restores the graph with node positions unchanged.

**Phase 6 — Polish.** Loading and empty states, error boundaries, mobile layout for the panel and graph, keyboard focus states, `aria-live` on the ingest progress region.

---

## 11. Conventions

- Every route handler: `export const runtime = 'nodejs'`.
- Every route handler starts with a session check and a `zod` parse. No exceptions.
- Every DB query filters on `user_id` from the **session**, never from the request body.
- Errors return `{ error: string, message?: string }` with a correct status. Never leak stack traces or raw DB errors to the client.
- One `pg.Pool` singleton in `lib/db.ts`, stashed on `globalThis` so hot reload doesn't leak connections.
- Server Components for data fetching where possible; Client Components only where interactivity requires it (`KnowledgeGraph`, `SearchBar`, `ArticleInput`, forms).
- Types live next to their module; no global `types.ts` dumping ground.

---

## 12. Local setup

```bash
npm install
cp .env.example .env.local     # fill in POSTGRES_URL, JWT_SECRET, GEMINI_API_KEY
npm run db:migrate
npm run dev
```

Get a Gemini key at [aistudio.google.com](https://aistudio.google.com/apikey). Create the Postgres store in the Vercel dashboard under **Storage → Create Database → Postgres**, then pull credentials with `vercel env pull .env.local`.

---

## 13. Out of scope (v1)

Password reset, email verification, OAuth, sharing or multi-user graphs, article full-text storage, re-processing existing articles, tag editing, pagination beyond the search `LIMIT 50`, and rate limiting. Do not build these.
