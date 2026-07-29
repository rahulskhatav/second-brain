import { Readability } from '@mozilla/readability';
import { JSDOM, VirtualConsole } from 'jsdom';

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
  const text = collapse(parsed?.textContent ?? doc.body?.textContent ?? '');
  if (text.length < 400) throw new ExtractError("We couldn't read that page.");

  return {
    title: (parsed?.title || doc.title || url.hostname).trim().slice(0, 240),
    text: text.slice(0, 60000)
  };
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
