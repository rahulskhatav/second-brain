import { Readability } from '@mozilla/readability';
import { JSDOM, VirtualConsole } from 'jsdom';
import TurndownService from 'turndown';

/**
 * Readability's cleaned HTML, turned into markdown.
 *
 * Markdown keeps the shape of the piece — what was a heading, what was a list,
 * what was a pull quote — which flat text throws away, and the reader uses that
 * shape to find the argument. The rules below drop what carries no meaning for
 * a summary and costs tokens: images, and the URLs behind link text.
 */
const turndown = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  hr: '---'
});

// Link text stays, the href goes: a summariser never follows them, and a page
// of footnoted URLs is a page of tokens spent on nothing.
turndown.addRule('bareLinks', {
  filter: 'a',
  replacement: (content) => content
});
turndown.remove(['img', 'figure', 'picture', 'video', 'audio', 'iframe', 'form', 'button', 'style', 'script']);

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/124.0 Safari/537.36 SecondBrain/1.0';

export class ExtractError extends Error {}

export function normaliseUrl(input) {
  const raw = String(input ?? '').trim();
  if (!raw) throw new ExtractError('Paste a link first.');
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    throw new ExtractError("That doesn't look like a link.");
  }
  if (!/^https?:$/.test(url.protocol)) throw new ExtractError('Only http and https links, please.');
  return url;
}

export const siteOf = (url) => url.hostname.replace(/^www\./, '') + url.pathname.replace(/\/$/, '');

/** Parameters that identify a campaign or a referrer, never the page itself. */
const TRACKING_PARAMS =
  /^(utm_|ic[id]$|igsh$|si$|fbclid$|gclid$|dclid$|msclkid$|mc_[ce]id$|ref$|ref_src$|source$|s_kwcid$|_hs[a-z]*$|yclid$|twclid$|at_[a-z_]+$)/i;

/**
 * One key per thing, so the same link twice is recognised as the same link.
 *
 * The same article reaches someone as a bare URL, with a newsletter's tracking
 * parameters bolted on, with a trailing slash, over http, or with #section on
 * the end — all of which are the same page. A YouTube video arrives as
 * youtu.be, as /watch?v=, as /shorts/, and with a timestamp; all the same
 * video, so it reduces to its id.
 */
export function urlKey(url) {
  if (!url) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');

  if (isYouTube(url)) {
    const id = url.hostname.endsWith('youtu.be')
      ? url.pathname.slice(1).split('/')[0]
      : url.searchParams.get('v') ?? url.pathname.split('/').filter(Boolean).pop();
    if (id) return `youtube:${id}`;
  }

  const params = [...url.searchParams.entries()]
    .filter(([k]) => !TRACKING_PARAMS.test(k))
    .sort(([a], [b]) => a.localeCompare(b));
  const query = new URLSearchParams(params).toString();
  const path = url.pathname.replace(/\/+$/, '') || '/';

  return `${host}${path}${query ? `?${query}` : ''}`.toLowerCase();
}

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be'
]);

/**
 * A video is not a page: scraping youtube.com gives a player shell and no
 * article, so these take a different route entirely — the reader watches them.
 */
export function isYouTube(url) {
  if (!url || !YOUTUBE_HOSTS.has(url.hostname)) return false;
  if (url.hostname.endsWith('youtu.be')) return url.pathname.length > 1;
  return (
    (url.pathname === '/watch' && url.searchParams.has('v')) ||
    url.pathname.startsWith('/shorts/') ||
    url.pathname.startsWith('/live/') ||
    url.pathname.startsWith('/embed/')
  );
}

/**
 * The video's own title and channel, from YouTube's oEmbed endpoint — public,
 * keyless, and one small request. Without it the reader has to invent a title
 * from what it hears, which it does less well than reading the real one.
 */
export async function youTubeMeta(url) {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(url.href)}&format=json`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) {
      // 401/404 here is YouTube saying private, removed, or age-restricted.
      if (res.status === 401 || res.status === 403 || res.status === 404) {
        throw new ExtractError("That video isn't available — it may be private or removed.");
      }
      return {};
    }
    const data = await res.json();
    return {
      title: typeof data.title === 'string' ? data.title.slice(0, 240) : undefined,
      channel: typeof data.author_name === 'string' ? data.author_name.slice(0, 120) : undefined
    };
  } catch (err) {
    if (err instanceof ExtractError) throw err;
    return {}; // oEmbed being unreachable is not a reason to refuse the video
  }
}

/**
 * Pulls the page and strips it back to the article: nav bars, cookie walls and
 * related-stories rails go, the prose stays.
 */
export async function extractFromUrl(url) {
  let res;
  try {
    res = await fetch(url.href, {
      redirect: 'follow',
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(20000)
    });
  } catch {
    throw new ExtractError("We couldn't reach that page.");
  }
  if (!res.ok) throw new ExtractError(`That page answered ${res.status}.`);
  if (!/text\/html|application\/xhtml/i.test(res.headers.get('content-type') ?? ''))
    throw new ExtractError("That link isn't an article page.");

  const html = await res.text();
  const virtualConsole = new VirtualConsole(); // swallow the page's own console noise
  const dom = new JSDOM(html, { url: url.href, virtualConsole });

  const doc = dom.window.document;
  for (const el of doc.querySelectorAll('script, style, noscript, iframe, svg')) el.remove();

  const parsed = new Readability(doc).parse();

  // Markdown when Readability gives us clean HTML to convert; its flat text is
  // the fallback, and the raw body the fallback's fallback.
  let text = '';
  if (parsed?.content) {
    try {
      text = tidyMarkdown(turndown.turndown(parsed.content));
    } catch {
      text = '';
    }
  }
  if (text.length < 400) text = collapse(parsed?.textContent ?? doc.body?.textContent ?? '');
  if (text.length < 400) throw new ExtractError("We couldn't read that page.");

  return {
    title: (parsed?.title || doc.title || url.hostname).trim().slice(0, 240),
    text: text.slice(0, 60000)
  };
}

/**
 * Squeeze the markdown without changing what it says.
 *
 * Turndown escapes punctuation that only matters when the output will be
 * re-parsed as markdown — ours is read once by a model — and pads the page with
 * blank lines and leftover separators. All of it is tokens.
 */
/**
 * Everything after the article proper.
 *
 * Reference lists, further reading and see-also sections are the longest part
 * of many pages and say nothing about what the piece argues — on a Wikipedia
 * article they can be most of the tokens. Only cut when the heading appears
 * late, so a short piece that opens on "Notes" keeps its body.
 */
const END_MATTER =
  /^#{1,6}[ \t]*(references|external links|further reading|see also|bibliography|notes|citations|sources|footnotes)[ \t]*$/im;

function dropEndMatter(md) {
  const hit = md.match(END_MATTER);
  return hit && hit.index > md.length * 0.4 ? md.slice(0, hit.index).trim() : md;
}

/**
 * Fit an article into a token budget without losing its conclusion.
 *
 * Cutting at a character count keeps the opening and throws the ending away,
 * which is where a piece usually says what it decided. Taking the head and the
 * tail costs the same and summarises far better.
 */
export function condense(text, maxChars) {
  if (text.length <= maxChars) return text;
  const head = Math.floor(maxChars * 0.7);
  const tail = maxChars - head - 20;
  return `${text.slice(0, head).trim()}\n\n[…]\n\n${text.slice(-tail).trim()}`;
}

function tidyMarkdown(md) {
  return dropEndMatter(String(md))
    .replace(/\\([-_*[\]()#+.!`>])/g, '$1') // undo escaping
    .replace(/^[ \t]+|[ \t]+$/gm, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/^(?:---|\*\*\*|___)$/gm, '') // rules carry nothing for a summary
    .replace(/^#{1,6}\s*$/gm, '') // headings emptied by the image rules
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * The paste-the-text path, for paywalls and logins.
 *
 * A working title only — the summariser is asked for a real one and its answer
 * replaces this. A pasted blob rarely leads with its own headline, so: a short
 * standalone first line if there is one, else the opening words.
 */
export function extractFromText(raw, url) {
  const text = collapse(raw);
  if (text.length < 200) throw new ExtractError('Paste a little more of the article.');

  const firstLine = (text.split('\n')[0] ?? '').trim();
  const title =
    firstLine.length > 4 && firstLine.length <= 90
      ? firstLine
      : text.split(/\s+/).slice(0, 9).join(' ') + '…';

  return { title: title.replace(/\.$/, '').slice(0, 240), text: text.slice(0, 60000) };
}

const collapse = (s) =>
  String(s)
    .replace(/\r/g, '')
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
