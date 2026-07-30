import { record } from './analytics.js';
import { all, one, query } from './db.js';
import {
  ExtractError,
  extractFromText,
  extractFromUrl,
  isYouTube,
  normaliseUrl,
  siteOf,
  youTubeMeta
} from './extract.js';
import { embed, ReaderError, summarise, summariseVideo } from './gemini.js';
import { vocabulary } from './graph.js';

/** Stages that mean the pipeline still holds this row. */
const IN_FLIGHT = ['queued', 'fetching', 'reading', 'connecting'];

/** A run that hasn't moved in this long was cut off mid-flight. */
const STALE_AFTER_MINUTES = 5;

/**
 * Creating an article is deliberately separate from running it.
 *
 * On a serverless platform anything still executing when the response is sent
 * gets killed, so the old shape — respond 202, keep reading in the background —
 * silently loses the article. Instead the row is created here and the work
 * happens inside its own request, which the client fires and lets run while it
 * polls the row for the stage it's reached.
 */
export async function createArticle({ userId, url: rawUrl, text }) {
  const url = rawUrl ? normaliseUrl(rawUrl) : null;
  if (!url && !text) throw new ExtractError('Paste a link, or the article text.');

  const video = Boolean(url) && isYouTube(url);
  return one(
    `INSERT INTO articles (user_id, url, site, title, status, source_text, kind)
     VALUES ($1, $2, $3, $4, 'queued', $5, $6) RETURNING *`,
    [
      userId,
      url?.href ?? null,
      url ? siteOf(url) : 'pasted text',
      url?.hostname ?? 'Reading…',
      text ?? null,
      video ? 'video' : 'article'
    ]
  );
}

/**
 * Fetch → distil → connect, inside one request.
 *
 * Only one at a time per user. The tags are only worth anything if they're
 * shared — two pieces on the same subject have to land under the same word —
 * and that works by handing the reader the tags already in use. Run four at
 * once and each sees an empty vocabulary and invents its own words: two
 * machine-learning pieces come back with no tag in common and no cluster
 * forms. So a second run is turned away and told to come back.
 */
export async function runArticle({ userId, id }) {
  const article = await one('SELECT * FROM articles WHERE id = $1 AND user_id = $2', [id, userId]);
  if (!article) return { state: 'missing' };
  if (!IN_FLIGHT.includes(article.status)) return { state: 'done', article };

  await releaseStaleRuns(userId);

  const busy = await one(
    `SELECT id FROM articles
      WHERE user_id = $1 AND id <> $2 AND status = ANY($3::text[])
        AND started_at IS NOT NULL`,
    [userId, id, IN_FLIGHT]
  );
  if (busy) return { state: 'busy' };

  // Claim it: started_at is what marks a row as actually running, so a second
  // request for the same article doesn't read it twice.
  const claimed = await one(
    `UPDATE articles SET status = 'fetching', started_at = now()
      WHERE id = $1 AND user_id = $2 AND started_at IS NULL AND status = 'queued'
      RETURNING id`,
    [id, userId]
  );
  if (!claimed) return { state: 'busy' };

  const startedAt = Date.now();
  try {
    await pipeline(article, userId);
    await record(userId, 'article_read', {
      seconds: Math.round((Date.now() - startedAt) / 1000),
      source: article.source_text ? 'pasted text' : 'link',
      // The site, not the article: enough to see what people read, not what.
      site: article.url ? new URL(article.url).hostname.replace(/^www\./, '') : null
    });
  } catch (err) {
    await fail(id, err);
    await record(userId, 'article_failed', {
      seconds: Math.round((Date.now() - startedAt) / 1000),
      kind: err instanceof ReaderError ? 'reader' : 'page',
      reason: err instanceof ReaderError || err instanceof ExtractError ? err.message : 'unknown'
    });
  }

  return { state: 'done', article: await one('SELECT * FROM articles WHERE id = $1', [id]) };
}

async function pipeline(article, userId) {
  const { id, url: href, source_text: pastedText, kind } = article;
  const url = href ? new URL(href) : null;
  const video = kind === 'video';

  // 1 — fetch. For a video there is no page to strip: the title and channel
  // come from YouTube, and the reader watches the thing itself.
  let title;
  let text = '';
  let channel;
  if (video) {
    const meta = await youTubeMeta(url);
    title = meta.title ?? url.hostname;
    channel = meta.channel;
  } else {
    ({ title, text } = pastedText ? extractFromText(pastedText, url) : await extractFromUrl(url));
  }
  await query('UPDATE articles SET title = $1, site = $2, status = $3 WHERE id = $4', [
    title,
    video ? (channel ?? 'YouTube') : article.site,
    'reading',
    id
  ]);

  // 2 — distil: the gist, the sections, and tags chosen to be shared.
  const others = await all(
    `SELECT tags FROM articles WHERE user_id = $1 AND status = 'ready' AND id <> $2`,
    [userId, id]
  );
  const vocab = vocabulary(others).map(([tag]) => tag);
  const { title: finalTitle, label, summary, sections, tags } = video
    ? await summariseVideo({ url, title, channel, vocabulary: vocab })
    : await summarise({
        title,
        text,
        vocabulary: vocab,
        titleIsReliable: !pastedText // pasted text has no headline of its own
      });

  await query(
    `UPDATE articles SET title = $1, label = $2, summary = $3, sections = $4, tags = $5, status = $6
      WHERE id = $7`,
    [finalTitle, label, summary, JSON.stringify(sections ?? []), JSON.stringify(tags), 'connecting', id]
  );

  // 3 — connect: place it by meaning.
  /* The section points go in as well as the summary. A video has no body text
     at all, so without them it would be placed on two sentences; and for an
     article they are the part most about what it actually says. */
  const distilled = (sections ?? []).flatMap((s) => s.points).join('\n');
  const vector = await embed(
    `${finalTitle}\n\n${summary}\n\n${distilled}\n\n${tags.join(', ')}\n\n${text.slice(0, 8000)}`
  );
  await query(
    `UPDATE articles SET embedding = $1, status = 'ready', error = NULL, error_kind = NULL,
            source_text = NULL
      WHERE id = $2`,
    [JSON.stringify(vector), id]
  );
}

async function fail(id, err) {
  // The page and the reader fail for different reasons and deserve different
  // words — telling someone we couldn't read their article when the model name
  // was retired sends them off debugging the wrong thing.
  const isReader = err instanceof ReaderError;
  const known = err instanceof ExtractError || isReader;
  const message = known ? err.message : "We couldn't read that page.";
  await query("UPDATE articles SET status = 'failed', error = $1, error_kind = $2 WHERE id = $3", [
    message,
    isReader ? 'reader' : 'page',
    id
  ]);
  if (!(err instanceof ExtractError)) console.error(`[ingest ${id}]`, err);
}

/**
 * A run cut off partway — the browser went away, or the function hit its
 * ceiling — leaves a row claimed forever, which would block every later
 * article for that user. Anything that hasn't moved in a while is let go.
 */
export async function releaseStaleRuns(userId) {
  const { rowCount } = await query(
    `UPDATE articles
        SET status = 'failed',
            error = 'That one stopped partway. Try it again.',
            error_kind = 'page'
      WHERE user_id = $1 AND status = ANY($2::text[]) AND started_at IS NOT NULL
        AND started_at < now() - ($3 || ' minutes')::interval`,
    [userId, IN_FLIGHT, String(STALE_AFTER_MINUTES)]
  );
  return rowCount;
}
