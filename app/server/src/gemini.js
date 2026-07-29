import { GoogleGenAI } from '@google/genai';
import { condense } from './extract.js';

/**
 * How much of an article the reader gets.
 *
 * A hundred words does not need forty thousand characters of input, and the
 * budget is head-and-tail rather than a straight truncation, so the piece's
 * conclusion survives.
 */
const SUMMARY_BUDGET = 16000;
const EMBED_BUDGET = 8000;

const TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || 'gemini-3.6-flash';
const EMBED_MODEL = process.env.GEMINI_EMBED_MODEL || 'gemini-embedding-001';
export const EMBED_DIMS = 768;

/** The reader itself failed — as opposed to the page being unreadable. */
export class ReaderError extends Error {}

/**
 * Retry the failures that are the service having a moment.
 *
 * A 503 is Gemini being briefly unavailable, and it was losing whole articles:
 * one bad second and the reader gave up for good. Quota and bad-model errors
 * are not retried — they will fail identically however many times we ask.
 */
async function withRetry(work, attempts = 3) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await work();
    } catch (err) {
      const status = err?.status;
      const transient = status === 503 || status === 500 || status === 504 ||
        /unavailable|internal error|deadline|socket|ECONNRESET|fetch failed/i.test(String(err?.message));
      if (!transient || attempt >= attempts) throw err;
      await new Promise((r) => setTimeout(r, 700 * 2 ** (attempt - 1)));
    }
  }
}

/**
 * Turns a Gemini failure into something worth showing someone.
 *
 * Model names retire: a key issued today is refused `gemini-2.5-flash` with a
 * 404 even though ListModels still advertises it, so this names the model in
 * the message rather than letting it read as a problem with the article.
 */
function readerError(err, model) {
  const message = String(err?.message ?? err);
  const status = err?.status;
  if (status === 404 || /no longer available|not found/i.test(message))
    return new ReaderError(`The model "${model}" isn't available to this API key — set GEMINI_TEXT_MODEL in .env to one that is.`);
  if (status === 429 || /quota|rate limit/i.test(message))
    return new ReaderError('The Gemini quota is used up for now. Try again later.');
  if (status === 403 || status === 401 || /api[_ ]?key|permission|unauthenticated/i.test(message))
    return new ReaderError('Gemini rejected the API key — check GEMINI_API_KEY in .env.');
  return new ReaderError(`The reader failed: ${message.slice(0, 200)}`);
}

let client = null;
function gemini() {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  client ??= new GoogleGenAI({ apiKey });
  return client;
}

export const hasGemini = () => Boolean(process.env.GEMINI_API_KEY?.trim());

const SYSTEM = `You are the reader inside a personal knowledge tool called Second Brain.
Given one article, you return a hundred words the owner will actually reread, and the tags that will
put it next to the right neighbours.

Rules for the title:
- Give the piece's real headline when the supplied one is a real headline.
- When the supplied title is marked unreliable, or reads as a fragment of the
  opening sentence, or trails off in an ellipsis, write your own: under 70
  characters, in the register of a headline, no trailing full stop.

Rules for the summary:
- 90–120 words, plain prose, no preamble, no "this article".
- Say what it argues and what it concludes, in the register of someone recounting it to a friend.
- Never invent detail that isn't in the text.

Rules for the tags:
- FIVE to seven. Never fewer than five. Lowercase, one to three words each.
- Chosen to be SHARED: two pieces on the same subject must land under the same word.
- Work outward from the broadest honest category to the most specific: the field it
  belongs to, then the subject, then what this particular piece is about. That way the
  early tags gather articles together and the later ones tell them apart.
- Prefer a tag from the owner's existing vocabulary whenever it genuinely fits; only coin a new
  one when nothing there is right. Order them broadest first.
- Never pad with a word the piece does not actually cover.`;

const SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    summary: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' }, minItems: 5, maxItems: 7 }
  },
  required: ['title', 'summary', 'tags']
};

/** Writes the hundred words and picks the tags. Falls back to extraction with no API key. */
export async function summarise({ title, text, vocabulary = [], titleIsReliable = true }) {
  const ai = gemini();
  if (!ai) return extractiveSummary({ title, text, vocabulary });

  const prompt = [
    vocabulary.length
      ? `The owner's existing tags, most used first: ${vocabulary.slice(0, 60).join(', ')}.`
      : 'The owner has no tags yet — you are setting the vocabulary.',
    titleIsReliable
      ? `Title as published: ${title}`
      : `Working title (UNRELIABLE — pasted text, so this is just the opening words; write a real headline): ${title}`,
    'Article:',
    condense(text, SUMMARY_BUDGET)
  ].join('\n\n');

  let res;
  try {
    res = await withRetry(() =>
      ai.models.generateContent({
        model: TEXT_MODEL,
        contents: prompt,
        config: {
          systemInstruction: SYSTEM,
          responseMimeType: 'application/json',
          responseSchema: SCHEMA,
          temperature: 0.4
        }
      })
    );
  } catch (err) {
    throw readerError(err, TEXT_MODEL);
  }

  let parsed;
  try {
    parsed = JSON.parse(res.text);
  } catch {
    throw new ReaderError('The reader came back with something we could not parse.');
  }

  return {
    title: String(parsed.title || title).trim().slice(0, 240),
    summary: String(parsed.summary || '').trim(),
    tags: cleanTags(parsed.tags)
  };
}

/** Where the article hangs in the sky. Falls back to a lexical vector with no API key. */
export async function embed(text) {
  const ai = gemini();
  if (!ai) return lexicalVector(text);

  let res;
  try {
    res = await withRetry(() =>
      ai.models.embedContent({
        model: EMBED_MODEL,
        contents: condense(text, EMBED_BUDGET),
        config: { taskType: 'SEMANTIC_SIMILARITY', outputDimensionality: EMBED_DIMS }
      })
    );
  } catch (err) {
    throw readerError(err, EMBED_MODEL);
  }
  const values = res.embeddings?.[0]?.values;
  if (!Array.isArray(values)) throw new ReaderError('No embedding came back.');
  return normalise(values);
}

function cleanTags(tags) {
  const out = [];
  for (const t of Array.isArray(tags) ? tags : []) {
    // Hyphens and underscores become spaces: "context-windows" and "context
    // windows" have to be the same tag, or the vocabulary splits and the
    // clusters weaken — which defeats the point of asking for shared tags.
    const tag = String(t)
      .toLowerCase()
      .replace(/[-_]+/g, ' ')
      .replace(/[^a-z0-9 +/]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (tag.length >= 2 && tag.length <= 28 && !out.includes(tag)) out.push(tag);
  }
  return out.slice(0, 7);
}

/* ── No-key fallbacks ────────────────────────────────────────────────────────
   The app stays usable without a key: the summary becomes the article's own
   most central sentences and the embedding a hashed bag of words. Quality is
   visibly worse — the clustering is lexical, not semantic — but nothing breaks. */

const STOP = new Set(
  `a about after all also an and any are as at be because been but by can could did do does for from
   had has have he her him his how i if in into is it its just like made make many may me more most
   my no not of on once only or other our out over own said same see she should so some such than
   that the their them then there these they this those through to too under up us use very was way
   we were what when where which while who why will with would you your`.split(/\s+/)
);

const words = (s) => String(s).toLowerCase().match(/[a-z][a-z'+-]{1,}/g) ?? [];

function extractiveSummary({ title, text, vocabulary }) {
  const sentences = text
    .split(/(?<=[.!?])\s+(?=[A-Z"'(])/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length > 45 && s.length < 400);

  const freq = new Map();
  for (const w of words(text)) if (!STOP.has(w)) freq.set(w, (freq.get(w) ?? 0) + 1);

  const scored = sentences
    .map((s, i) => {
      const ws = words(s).filter((w) => !STOP.has(w));
      const density = ws.reduce((n, w) => n + (freq.get(w) ?? 0), 0) / Math.max(ws.length, 1);
      return { s, i, score: density * (i < 6 ? 1.25 : 1) }; // the lede usually carries the thesis
    })
    .sort((a, b) => b.score - a.score);

  const picked = [];
  let length = 0;
  for (const { s, i } of scored) {
    if (length > 620) break;
    picked.push({ s, i });
    length += s.length;
  }
  picked.sort((a, b) => a.i - b.i);

  const ranked = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([w]) => w);
  const known = vocabulary.filter((t) => t.split(' ').every((part) => freq.has(part)));
  const tags = cleanTags([...known, ...ranked].slice(0, 6));

  return {
    title,
    summary: picked.map((p) => p.s).join(' ') || text.slice(0, 600),
    tags: tags.length ? tags : ['unsorted']
  };
}

function lexicalVector(text) {
  const v = new Array(EMBED_DIMS).fill(0);
  const ws = words(text).filter((w) => !STOP.has(w));
  for (const w of ws) {
    let h = 2166136261;
    for (let i = 0; i < w.length; i++) h = Math.imul(h ^ w.charCodeAt(i), 16777619);
    const slot = (h >>> 0) % EMBED_DIMS;
    v[slot] += 1 + Math.log(1 + ws.length / 1000);
  }
  return normalise(v.map((n) => Math.log1p(n)));
}

function normalise(vec) {
  const mag = Math.hypot(...vec) || 1;
  return vec.map((n) => n / mag);
}
