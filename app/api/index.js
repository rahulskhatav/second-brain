import { app } from '../server/src/app.js';

/**
 * The Vercel entry point.
 *
 * Everything under /api is routed here explicitly by vercel.json, with the
 * original path carried in `__p`, and put back before Express sees it.
 *
 * The obvious approach — a catch-all filename, `api/[...path].js` — was
 * deployed as a *single* dynamic segment: `/api/status` reached the app and
 * `/api/auth/login` returned a platform 404, so every route two levels deep was
 * missing and only sign-in and registration appeared broken. Routing that
 * depends on how a filename is interpreted is not worth the ambiguity when an
 * explicit rule costs three lines.
 */
export default function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const original = url.searchParams.get('__p');

  if (original) {
    url.searchParams.delete('__p');
    const query = url.searchParams.toString();
    req.url = original + (query ? `?${query}` : '');
  }

  return app(req, res);
}
