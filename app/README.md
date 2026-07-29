# Second Brain

Everything you read, quietly connected. Paste a link — the app fetches the page,
strips it back to the article, writes you a hundred words, tags it so it lands
next to its neighbours, and hangs it in a sky with everything else you've read.

Built from the Claude Design handoff in `../project/`, on the Nocturne design
system. `client/src/styles/nocturne.css` is that system's stylesheet, copied in
verbatim — it stays the source of truth for every colour, radius and shadow.

## Running it

```bash
cd app
npm install
cp .env.example .env      # Gemini key + DATABASE_URL go in here
npm run dev
```

`npm run dev` starts the API on **:8787** and the client on **:5173** — open
http://localhost:5173. For a single-origin production run:

```bash
npm run build && npm start   # everything on :8787
```

**A database is required, including locally** — there is no file fallback, because
the app is deployed to a serverless platform with no durable filesystem. Either
paste your hosted `DATABASE_URL` into `.env`, or run one in Docker:

```bash
docker run -d --name sb-pg -e POSTGRES_PASSWORD=secondbrain \
  -e POSTGRES_DB=secondbrain -p 55432:5432 postgres:16-alpine
# DATABASE_URL=postgres://postgres:secondbrain@127.0.0.1:55432/secondbrain
```

The schema creates itself on first query — there is no migration step.

### The Gemini key

Get one at https://aistudio.google.com/apikey and set `GEMINI_API_KEY` in
`app/.env`. Two models are used, both overridable in `.env`:

| Model | What it does |
| --- | --- |
| `gemini-3.1-flash-lite` | The hundred words, the title, and three to five shared tags |
| `gemini-embedding-001` | The 768-dim vector that decides where an article hangs |

### The free tier will not survive customer testing

The Gemini free tier caps **requests per day, per model, per project** — and the
cap is low. Measured on a fresh key: `gemini-3.6-flash` allows **20 generate
requests per day**, in total, across every user of your deployment. Twenty
articles and the app stops working for everyone until midnight Pacific.

That is a hard blocker for putting this in front of customers. **Enable billing**
on the Google Cloud project behind the key before you invite anyone. Ingest is
two calls per article (one generate, one embed) on a flash-class model, so real
usage costs cents, but the free tier's daily ceiling is not something you can
design around.

`gemini-3.1-flash-lite` is the default because it has usable headroom for
development. With billing on, `gemini-3.6-flash` writes better prose — set
`GEMINI_TEXT_MODEL` to switch.

**Model names retire, and `ListModels` lies about it.** A key issued today is
refused `gemini-2.5-flash` with a 404 — *"no longer available to new users"* —
even though the model still appears in the account's own model listing. If
ingest starts failing with a message naming the model, list what your key
actually accepts and set `GEMINI_TEXT_MODEL`:

```bash
curl -s "https://generativelanguage.googleapis.com/v1beta/models?key=$GEMINI_API_KEY" \
  | grep -o '"name": "models/[^"]*"'
```

Then confirm with a real call — being listed is not the same as being usable.

**Without a key the app still runs.** Summaries fall back to an extractive
summariser and embeddings to a hashed lexical vector, so the whole flow is
exercisable offline — but the clustering is lexical rather than semantic and the
tags are frequent words rather than subjects. The server prints which reader it
started with, and `GET /api/status` reports it.

## Deploying to Vercel

The repo lives on GitHub and Vercel builds every push.

**1 — push it.** From the repo root (`second-brain-app-design/`):

```bash
git remote add origin https://github.com/<you>/second-brain.git
git push -u origin main
```

`.env` is gitignored. Never commit it — the key and the database password are
in it.

**2 — import it.** In Vercel: *Add New → Project*, pick the GitHub repo, and set

| Setting | Value |
| --- | --- |
| **Root Directory** | `app` |
| Framework Preset | Other |
| Build / Output | leave blank — `vercel.json` sets them |

The Root Directory matters: the repo root holds the design bundle, and the
deployable project is `app/`.

**3 — attach a database.** *Storage → Create Database → Postgres*, connect it to
the project. Vercel injects `POSTGRES_URL` itself; the app reads that or
`DATABASE_URL`. Nothing to run — the schema creates itself on first query.

**4 — set the environment variables.** *Settings → Environment Variables*, for
Production **and** Preview:

| Name | Value |
| --- | --- |
| `GEMINI_API_KEY` | your key |
| `SESSION_SECRET` | any long random string — it signs the session cookies |
| `GEMINI_TEXT_MODEL` | optional, defaults to `gemini-3.1-flash-lite` |

**5 — redeploy** so the new variables are picked up, then open the URL.

### How it fits the platform

`api/[...path].js` is a catch-all function exporting the Express app, so
`/api/auth/login` arrives with its path intact. It's a filesystem route rather
than a rewrite on purpose — a rewrite pointing every `/api/*` at one function
can hand that function the *rewritten* path, and then nothing below `/api`
matches. The client is served as static files; `vercel.json` rewrites unknown
non-API paths to `index.html` so deep links like `/sky` work.

**Nothing runs after a response.** Serverless kills a function the moment it
replies, which is why ingest is split: `POST /api/articles` creates the row and
returns immediately, then `POST /api/articles/:id/run` does the reading inside
its own request while the browser polls the row for the stage it has reached.
`maxDuration` is 60s — the Hobby ceiling — against a typical ingest of 10–25s.

Two consequences worth knowing:

- **Closing the tab mid-ingest may abandon the article.** The design promises it
  finishes without you, and on a long-lived server it did. Here the run is
  driven by a request from the browser. Anything left claimed for more than five
  minutes is released and marked failed, so it never blocks the queue — but it
  won't have finished. Making that promise true again needs a durable queue
  (Vercel Cron, QStash, or a small always-on worker).
- **One ingest at a time per user, enforced in the database** rather than in
  memory, since instances don't share memory. A second run gets `409` and the
  client retries.

## The screens

| Route | Design screen |
| --- | --- |
| `/` | 01 — Landing page |
| `/register`, `/login` | 02 — Register & log in |
| `/home` | 03 — What did you read today? · 04 — Ingesting |
| `/sky` | 05 — The graph · 06 — Article panel · 07 — Search · 08 — Empty sky |

The ingest states (03 → 04), the article panel (06), search (07) and the empty
sky (08) are states of their screen rather than separate routes, exactly as the
prototype frames them.

## How it works

**Ingest** (`server/src/ingest.js`) runs the three stages the UI names, in the
background, so closing the tab doesn't stop it. The article row's `status` —
`queued` → `fetching` → `reading` → `connecting` → `ready` — is what the
progress card polls.

Ingests are **serialised per user**, which is not an optimisation but a
correctness requirement. The tags are only worth anything if they're shared, and
that works by handing the reader the tags already in use. Paste four links at
once and, run in parallel, every one sees an empty vocabulary and invents its
own words: two pieces both about machine learning came back with no tag in
common and no cluster formed. Queued, the second sees the first's tags and
reuses them. A queued article sits at `queued` rather than showing a spinning
"Fetching" for work that hasn't started.

Failures are recorded as `error_kind`: `page` (the article wouldn't open —
pasting the text may help, and the UI offers it) or `reader` (Gemini itself
failed — pasting would fail identically, so the UI doesn't offer it and names
the real cause instead).

1. **Fetch** — `@mozilla/readability` over `jsdom` strips nav bars, cookie walls
   and related-stories rails, and the result is converted to **markdown**, which
   keeps the shape of the piece — headings, lists — that flat text throws away.
   Paywalled? The paste-the-text path takes the prose directly and keeps the
   link attached.

   Markdown does not itself save tokens: measured against the flat text it
   replaced, it costs about **3% more**, because there was never any HTML in the
   payload to strip. The savings come from what it makes safe to drop — image
   markup, the URLs behind link text, and trailing reference/see-also sections,
   which on a long page are most of the tokens — and from a head-and-tail budget
   rather than a straight truncation, so the piece's conclusion survives being
   cut. Measured with `countTokens` over three Wikipedia articles: **7,735 →
   4,207 tokens per article, 46% less**, and 57% on the longest.
2. **Distil** — Gemini returns the summary and tags under a JSON schema. The
   owner's existing tag vocabulary goes into the prompt so two pieces on the same
   subject land under the same word instead of near-synonyms.
3. **Connect** — the article is embedded and its neighbours found.

**The sky** (`server/src/graph.js`) draws an edge from each article to its
nearest few. The cut is *relative* — a neighbour must be within 75% of that
node's best neighbour, over a low absolute floor — because an absolute threshold
doesn't survive a change of embedding: Gemini puts related articles around
0.7–0.9 while the lexical fallback tops out near 0.3, and one fixed cut leaves
the other a hairball or a dust cloud. Clusters are the five most-used tags with
at least two articles each, coloured from the design's palette in size order.

**Positions are simulated once and then pinned.** When the force layout settles
the client posts where everything landed and the server stores it, so clearing a
search puts the sky back exactly as it was — same positions, same clusters,
nothing re-simulated. Only genuinely new articles are free to move.

**Auth** is username and password, no email and no reset link, as screen 02
specifies. Passwords are bcrypt-hashed; the session is a random token in a
signed, httpOnly cookie. Every article query is scoped to the session's user.

## Layout

```
app/
├─ api/[...path].js  the Vercel serverless entry — exports the Express app
├─ vercel.json       build, output, maxDuration, SPA rewrite
├─ server/src/
│  ├─ app.js       the Express app, no listener attached
│  ├─ index.js     listens on :8787 for local development
│  ├─ db.js        Postgres pool + self-creating schema
│  ├─ auth.js      register / login / logout / me
│  ├─ extract.js   fetch + readability, and the pasted-text path
│  ├─ gemini.js    summarise + embed, with the no-key fallbacks
│  ├─ ingest.js    the three-stage pipeline
│  ├─ graph.js     clusters, edges, neighbours
│  └─ routes.js    articles, graph, layout, search
└─ client/src/
   ├─ components/  Constellation (live canvas), DemoSky (marketing SVG), panel, chrome
   ├─ pages/       Landing, Register, Login, Home, Sky
   └─ styles/      nocturne.css (the design system) + app.css (the screens)
```

Two skies, on purpose. `DemoSky` is the prototype's seeded 48-article
constellation, ported exactly, drawn as SVG — the signed-out screens have no
graph of their own to show. `Constellation` is the live one: the user's own
articles on canvas via `react-force-graph-2d`, pannable, zoomable, clickable.

## API

All routes need the session cookie except `POST /api/auth/register|login` and
`GET /api/status`.

| Route | What |
| --- | --- |
| `GET /api/articles` | The library, plus tag counts and clusters |
| `POST /api/articles` | `{ url }` or `{ url?, text }` — creates the row, returns immediately |
| `POST /api/articles/:id/run` | Does the reading. Slow by design; `409` if one is already running |
| `GET /api/articles/:id` | One article with its three nearest neighbours |
| `DELETE /api/articles/:id` | Forget this |
| `GET /api/graph` | `{ nodes, links, clusters }` |
| `POST /api/graph/layout` | Store settled positions |
| `GET /api/search?q=` | Tag-and-prose search, tags weighted highest |

## Not built

The design doc's own next steps: the mobile bottom-sheet variant of the article
panel, and any read-it-later capture beyond pasting a link. The tag cloud on
Home was left navigational — clicking a tag searches the sky for it.

Deliberately left out for the MVP, and worth adding before this is more than a
customer test: **rate limiting** (one tester pasting a hundred links exhausts the
Gemini quota for everyone and, with billing on, spends real money), **account
deletion**, and any notice to users that article text is sent to Google. There is
also no durable ingest queue — see the closing-the-tab caveat above.
