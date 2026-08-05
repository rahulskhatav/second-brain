# Second Brain — browser extension

Build brief for a Chrome extension that sends the page you're on to your Second
Brain, in one click. Self-contained: everything you need about the API is in
here, so you don't need the app's source open.

**The app already has everything this needs.** The server changes that make an
extension possible — token auth and CORS for extension origins — are done and
deployed. Nothing on the server side is left to build.

---

## What we're building

The user is reading an article or watching a YouTube video. They click the
extension icon and press **Remember it!**. The page goes into their sky —
fetched, summarised in ~100 words, tagged, embedded, and placed next to its
nearest neighbours — exactly as if they had pasted the link into the app's *Add
link* box.

| | |
| --- | --- |
| App | `https://second-brain-mvp-weld.vercel.app` |
| API base | `https://second-brain-mvp-weld.vercel.app/api` |
| Local dev | API on `http://localhost:8787` (**not** `:5173` — that's the Vite client) |
| Target | Chrome, Manifest V3. Written to work in Firefox; packaging it there is a later task. |

Ignore any URL containing `-git-main-`: that preview deployment sits behind
Vercel Deployment Protection and bounces every request to SSO.

---

## 1 — How the user signs in

### What the user sees

1. They install the extension and click its icon. The popup says **"Sign in to
   Second Brain"**, with username and password — the same ones they use on the
   website.
2. They type them once and press **Sign in**.
3. The popup switches, permanently, to the capture view.
4. They never sign in again. Not after closing the browser, not after a
   restart. Only *Sign out* ends it.

No OAuth, no API key to copy, no token to generate in a settings page.

### What happens underneath

Credentials go **once** to an endpoint that exists for exactly this purpose:

```
POST /api/auth/token   { username, password }
   → 200 { token: "a1b2c3…", user: { id, username, createdAt } }
   → 401 { error: "Incorrect username or password. Please try again." }
```

Store `token` in `chrome.storage.local`. Send it on every later call:

```
Authorization: Bearer a1b2c3…
```

**Never store the password.** Use it for that one request and discard it.

The token is a row in the app's `sessions` table — the same kind of token the
website's own login creates — and sessions have no expiry, so it lasts until
revoked. Signing out:

```
POST /api/auth/token/revoke     (with the Authorization header)
   → 200 { ok: true }
```

That drops this one token and leaves the user's other sessions — the website in
their browser, another device — untouched.

### Two things not to do

- **Don't try to reuse the website's login cookie.** It's httpOnly, signed and
  `SameSite=Lax`; a request from an extension service worker is cross-site, so
  the cookie is withheld. This is why the token endpoint exists.
- **Don't build registration into the extension.** New accounts are created on
  the website. Link to `https://second-brain-mvp-weld.vercel.app/register` and
  leave it there.

CORS is already granted to `chrome-extension://` and `moz-extension://` origins
for the `authorization` and `content-type` headers. There is no
`Access-Control-Allow-Credentials` and none is needed — bearer tokens mean no
cookie is ever involved, so **never send `credentials: 'include'`**.

---

## 2 — The API

Base `https://second-brain-mvp-weld.vercel.app/api`. JSON in, JSON out.
Everything except `/auth/token` and `/status` needs the `Authorization` header.

| Call | Returns |
| --- | --- |
| `POST /auth/token` `{username,password}` | `200 {token,user}` · `401 {error}` |
| `POST /auth/token/revoke` | `200 {ok:true}` |
| `GET /auth/me` | `200 {user}` — a cheap "is my token still good?" probe |
| `POST /articles` `{url}` or `{url,text}` | `202 {article,existing:false}` · `200 {article,existing:true}` · `400 {error}` |
| `POST /articles/:id/run` | `200 {article}` · `409 {error,retry:true}` · `404 {error}` |
| `GET /articles/:id` | `200 {article:{…,neighbours}}` · `404 {error}` |
| `GET /articles` | `200 {articles,tags,clusters,lastAddedAt}` |
| `DELETE /articles/:id` | `200 {ok:true}` · `404` |
| `GET /status` | `200 {reader,db}` — public; use as a reachability probe |

Errors are always `{ "error": "<a human sentence>" }`, sometimes with `field`
(validation), `retry: true` (409), or `code` (500).

**Show the server's error strings verbatim.** They were written by the app's
designer and they are better than anything invented at the call site.

### The article object

```jsonc
{
  "id": 42,
  "url": "https://example.com/piece",
  "site": "example.com/piece",     // or the channel name, for a video
  "title": "…",                     // the hostname until stage 1 finishes
  "label": "Three Words Max",       // short label for the graph node; null until read
  "kind": "article",                // 'article' | 'video'
  "summary": "…",                   // ~100 words; null until read
  "sections": [{ "heading": "…", "points": ["…"] }],
  "tags": ["…"],                    // 3–5, chosen to be shared with existing articles
  "status": "ready",
  "error": null,
  "errorKind": null,                // 'page' | 'reader' | null
  "addedAt": "2026-08-05T…Z"
}
```

`status`: `queued → fetching → reading → connecting → ready`, or `failed`.

`errorKind` decides what you offer next:

- **`page`** — the article wouldn't open (paywall, bot wall). Page text can
  rescue it. See §5.
- **`reader`** — Gemini itself failed (quota, retired model). Text would fail
  identically. Show the message and offer nothing.

---

## 3 — Capture: two requests, not one

The app runs on Vercel, where **nothing may keep executing after a response is
sent**. So creating an article and reading it are separate calls: the first
returns instantly, the second *is* the reading.

```
POST /articles { url }
  ├─ 200 { existing: true }   → already saved. Stop. This is a happy outcome,
  │                              not an error: "Already in your sky".
  ├─ 202 { existing: false }  → row created at status 'queued'
  └─ 400 { error }            → bad link

POST /articles/{id}/run       ← fire it; do NOT await before polling
  ├─ 200 { article }           → finished (could be ready OR failed)
  ├─ 409 { retry: true }       → another article is being read. Wait 2s, retry.
  └─ 404

GET /articles/{id}            ← poll every 800ms until ready or failed
```

Sketch:

```js
export async function capture(url, { onStage } = {}) {
  const { article, existing } = await addArticle({ url });
  if (existing) return { state: 'existing', article };

  onStage?.('queued', article);
  runUntilAccepted(article.id);          // deliberately not awaited
  return await pollUntilSettled(article.id, onStage);
}
```

- `runUntilAccepted` — `POST /articles/:id/run`; on `409` wait 2s and try again,
  up to ~60 attempts. Any other status is fatal.
- `pollUntilSettled` — `GET /articles/:id` every 800ms until `ready` or
  `failed`; after 90s give up with *"Still reading — check your sky in a
  minute."* (it may well finish anyway).

**Timeouts.** Default 15s for ordinary calls, but the `run` call must allow
**90s**: a typical article takes 10–25s and a video up to 45s, against a 60s
server ceiling. A short timeout aborts work that was about to succeed.

**Why the 409 exists — don't parallelise it away.** Ingests are serialised per
user on purpose. Tags are only useful if they're shared, and that works by
handing the reader the tags already in use. Run four at once and each sees an
empty vocabulary and invents its own words — two machine-learning pieces come
back with no tag in common and no cluster forms.

**Stage names for the UI**, matching the app: `fetching` → *Fetching* (22%),
`reading` → *Reading* (64%), `connecting` → *Connecting* (88%). `queued` means
the turn hasn't come up — say *Queued*, not a spinner claiming work that isn't
happening.

**Service worker lifetime.** MV3 can kill the worker mid-run. Because
`POST /articles` already returned, the link is safely recorded either way; worst
case the row is swept to `failed` after five minutes with *"That one stopped
partway. Try it again."* Mitigate by driving `capture()` from the **popup** when
it's open (the popup page holds the fetch alive), and accepting the risk for
context-menu captures — recording the outcome in `chrome.storage.local` so the
next popup open shows what happened.

---

## 4 — Send the URL raw

**Send `tab.url` exactly as it is.** Don't strip tracking parameters, don't
canonicalise, don't special-case YouTube. The server already does all of it: it
drops `utm_*`, `fbclid`, `gclid`, `si`, `ref` and friends, removes `www.`/`m.`,
trailing slashes and fragments, sorts remaining parameters, and reduces every
YouTube form — `/watch?v=`, `/shorts/`, `/live/`, `/embed/`, `youtu.be` — to a
single video id. A duplicate comes back as `200 { existing: true }`.

**YouTube needs nothing special from you.** The server detects it and routes it
to the video path, where Gemini watches the video rather than scraping a page
shell with no article in it. Videos get a 45-second budget; long ones fail with
an explanation — show that sentence rather than looking broken.

**Check the scheme before calling — this is mandatory, not politeness.** Only
`http`/`https`. `chrome://`, `file://`, `chrome-extension://` and the PDF viewer
must be refused locally with *"That page can't be saved."*

The server will not catch these for you. Anything without an `http(s)://` prefix
has `https://` prepended before it is parsed, so `ftp://nope` becomes
`https://ftp//nope`, parses as a valid URL with hostname `ftp`, and is accepted
with a `202` — it then fails minutes later at the fetch stage. Verified against
the running server. Guard at the source.

---

## 5 — The one thing the extension does better

The server fetches pages anonymously, so paywalled and login-walled pages fail
with `errorKind: 'page'`. The extension is *inside* the user's authenticated
session, so it can rescue them:

1. Always try `{ url }` first — cheaper, and the server's extraction
   (Readability → markdown) is far better than `innerText`.
2. If it comes back `failed` with `errorKind === 'page'`, show a second button:
   **"Try again with the page text"**. Only then inject a content script via
   `chrome.scripting.executeScript` to read `document.body.innerText`, and
   resubmit as `{ url, text }`. The server takes the prose and keeps the link
   attached, so the article still points at the original.
3. If `errorKind === 'reader'`, don't offer this.
4. Truncate captured text to ~200,000 characters — the API body limit is 2 MB.
5. Never inject on a YouTube page.

---

## 6 — Structure

Plain JavaScript. No build step, no framework, no bundler — it should load
unpacked as-is.

```
extension/
├─ manifest.json
├─ src/
│  ├─ api.js        fetch wrapper: base URL, bearer header, error shaping
│  ├─ capture.js    the ingest state machine from §3
│  ├─ sw.js         service worker: context menus, badge, notifications
│  ├─ popup.html    sign-in view + capture view
│  └─ popup.js
└─ icons/           16 / 32 / 48 / 128 px
```

### manifest.json

```jsonc
{
  "manifest_version": 3,
  "name": "Second Brain",
  "description": "Send what you're reading to your sky.",
  "version": "1.0.0",
  "action": { "default_popup": "src/popup.html", "default_title": "Save to Second Brain" },
  "background": { "service_worker": "src/sw.js", "type": "module" },
  "permissions": ["storage", "activeTab", "scripting", "contextMenus", "notifications"],
  "host_permissions": ["https://second-brain-mvp-weld.vercel.app/*"],
  "commands": {
    "_execute_action": { "suggested_key": { "default": "Ctrl+Shift+S", "mac": "Command+Shift+S" } }
  },
  "icons": { "16": "icons/16.png", "32": "icons/32.png", "48": "icons/48.png", "128": "icons/128.png" }
}
```

`activeTab` + `scripting`, **not** `<all_urls>` — the extension only ever reads
the page the user explicitly acted on. That's both the honest permission and the
one that survives store review. For local development add
`http://localhost:8787/*` to `host_permissions` in a dev copy, not the shipped
manifest.

### api.js

1. Read `{ apiBase, token }` from `chrome.storage.local`; default `apiBase` to
   the production URL.
2. `request(path, { method, body, timeoutMs })` — attach the bearer header when
   a token exists, set `content-type` only when there's a body, apply
   `AbortSignal.timeout(timeoutMs)`.
3. **Parse as text first, then JSON.** A non-JSON body means something other
   than the API answered — a platform error page, a captive portal — and that
   fact is the diagnosis. Report *"Couldn't reach Second Brain."* plus the
   configured base URL, not a JSON parse error.
4. Throw an `ApiError` carrying `status` and the server's own `error` string.
5. On any `401`, clear the stored token and signal the UI to show the sign-in
   view. A revoked session must not leave the extension retrying forever.

Exports: `signIn`, `signOut`, `getUser`, `addArticle`, `runArticle`,
`getArticle`.

### popup — two views, one file

**Signed out:** username, password, **Sign in**, the server's error verbatim on
failure, and a link to the website's register page.

**Signed in** (the default view forever after):

```
┌─────────────────────────────────┐
│  ⌁ Second Brain                 │
│                                 │
│  How Zettelkasten actually…     │  ← tab title, 2 lines max
│  en.wikipedia.org               │
│                                 │
│      [   Remember it!   ]       │
│                                 │
│  ──────────────────────────     │
│  Recent                         │
│  ✓ Attention Is All You Need    │
│  ⋯ The bitter lesson  Reading   │
│  ! A paywalled piece            │
│                                 │
│  rahul · Sign out               │
└─────────────────────────────────┘
```

- The button says **"Remember it!"** — that's the app's own submit wording;
  don't reinvent it.
- While ingesting, the button becomes a progress row naming the stage.
- On success it becomes **"In your sky"** with a link opening `/sky` in a new
  tab.
- Recent captures: last 5, from `chrome.storage.local`.
- Visual style: dark, quiet, the app's own. The design system is the "Nocturne"
  stylesheet in the app repo (`app/client/src/styles/nocturne.css`) — copy the
  handful of colour and radius variables the popup needs rather than importing
  the sheet.

### sw.js

- `onInstalled` → two context menus: **"Send this page to Second Brain"**
  (`contexts: ['page']`) and **"Send this link to Second Brain"**
  (`contexts: ['link']`, using `info.linkUrl`).
- `onClicked` → `capture()`, then a `chrome.notifications` toast with the result.
- Badge on `chrome.action`: `"…"` amber while ingesting, `"✓"` green on ready
  (clear after 5s), `"!"` red on failure (clear on next popup open).
- One in-flight capture at a time. The server enforces this with a 409 anyway,
  but queueing locally makes the UI honest.

---

## 7 — Errors, and what the user should see

| Situation | Response | Popup |
| --- | --- | --- |
| No token / revoked | `401` | Switch to sign-in — silently, not as an error |
| Unsupported page | — | Checked locally — the server won't: "That page can't be saved." |
| Bad link | `400 {error}` | The server's sentence, when it does reject one |
| Already saved | `200 existing:true` | "Already in your sky" + link |
| Another article reading | `409` | "Waiting its turn…", keep retrying |
| Page wouldn't open | `failed`, `errorKind:'page'` | The message + "Try again with the page text" |
| Gemini failed / quota | `failed`, `errorKind:'reader'` | The message alone |
| Unreachable / non-JSON | — | "Couldn't reach Second Brain." + base URL |

---

## 8 — Order of work

1. `api.js` + a sign-in-only popup. Load unpacked, sign in, confirm the token
   lands in `chrome.storage.local` and survives a browser restart.
2. `capture.js` against a known-good article URL, driven from the popup. Watch
   the stages advance; confirm the article shows up at `/sky`.
3. The full popup: capture view, stages, recent list, sign out.
4. `sw.js`: context menus, badge, notifications.
5. Edge cases: duplicate submit, a `chrome://` page, a YouTube video, a
   paywalled page and the text-retry path, and an invalidated token (revoke it
   with the curl below and confirm the popup returns to sign-in).

### Done when

- One click on a normal article saves it, and it appears in the sky with a
  summary, tags and neighbours — indistinguishable from a paste into the app.
- A YouTube video saves and clusters with related articles.
- Sign-in survives a browser restart; sign-out requires signing in again.
- Two clicks on the same page produce "already in your sky", never a duplicate.

### Out of scope

Registration; auto-capture of everything the user opens (see below); Firefox
packaging; highlights and notes (the app has nowhere to put them); a
dev/prod switcher UI — keep `apiBase` in `chrome.storage.local` and change it
from the service worker console when needed.

---

## 9 — Constraints worth knowing

- **Gemini's free tier caps requests per day, per model, across the whole
  deployment** — measured at 20 generate calls/day, and each article costs two.
  Frictionless capture makes that ceiling much easier to hit, so **every save
  stays a deliberate click**. No auto-capture, no "save everything I open".
- **There is no rate limiting on the API.** Client-side restraint is the only
  restraint.
- **Article text is sent to Google.** If the extension captures page text from
  an authenticated session (§5), that deserves a line in the extension's own UI.
- **No account deletion or password reset** exists in the app.
- Request bodies are capped at **2 MB**; `run` can take up to **60s**.

---

## Appendix — check the API by hand first

```bash
BASE=https://second-brain-mvp-weld.vercel.app

curl -s $BASE/api/status
# {"reader":"gemini","db":{...}}   ← 'fallback' means no Gemini key is configured

TOKEN=$(curl -s -X POST $BASE/api/auth/token \
  -H 'content-type: application/json' \
  -d '{"username":"YOU","password":"YOURS"}' | jq -r .token)

# create — returns immediately
ID=$(curl -s -X POST $BASE/api/articles \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"url":"https://en.wikipedia.org/wiki/Zettelkasten"}' | jq -r .article.id)

# read it — slow, this request IS the work
curl -s -X POST $BASE/api/articles/$ID/run -H "authorization: Bearer $TOKEN" | jq .article.status

# poll
curl -s $BASE/api/articles/$ID -H "authorization: Bearer $TOKEN" \
  | jq '.article | {status, title, tags, errorKind}'

# sign out this token
curl -s -X POST $BASE/api/auth/token/revoke -H "authorization: Bearer $TOKEN"
```

If `/api/auth/token` returns 404, the server changes haven't been deployed yet —
they're on `main` in the app repo; push and let Vercel build before going
further.
