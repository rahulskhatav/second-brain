import { track } from './analytics.js';

export class ApiError extends Error {
  constructor(message, { status, field } = {}) {
    super(message);
    this.status = status;
    this.field = field;
  }
}

/**
 * The route, not the request: /articles/41 and /articles/42 are one line on a
 * chart, and the id is a fact about what someone read. The search term goes the
 * same way — the length of it is already tracked, the words never are.
 */
const routeShape = (path) =>
  path
    .split('?')[0]
    .replace(/\/\d+/g, '/:id');

async function request(path, { method = 'GET', body, signal } = {}) {
  let res;
  const startedAt = performance.now();
  const route = routeShape(path);
  /** How long it took and how it ended — never what was asked for. */
  const timed = (status, ok) =>
    track('api_call', { route, method, status, ok, ms: Math.round(performance.now() - startedAt) });

  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'include',
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal
    });
  } catch (err) {
    // An abort is the caller changing its mind — a superseded search, a closed
    // panel — not a failure, and counting it as one would bury the real ones.
    if (err?.name === 'AbortError') throw err;
    timed(0, false);
    throw new ApiError("Can't reach the server.");
  }

  timed(res.status, res.ok);

  /* Read as text first. A non-JSON body is itself the diagnosis: it means
     something other than the API answered — a static 404 page, a platform error
     page — and reporting "Something went wrong" for that hides the one fact
     worth knowing. */
  const raw = await res.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = {};
  }

  if (!res.ok) {
    const served = !raw.trim().startsWith('{');
    const message =
      data.error ??
      (served
        ? `The API didn't answer (${res.status}) — the /api routes aren't reaching the server.`
        : `Something went wrong (${res.status}).`);
    throw new ApiError(message, { status: res.status, field: data.field });
  }
  return data;
}

export const api = {
  status: () => request('/status'),

  me: () => request('/auth/me'),
  register: (username, password) => request('/auth/register', { method: 'POST', body: { username, password } }),
  login: (username, password) => request('/auth/login', { method: 'POST', body: { username, password } }),
  logout: () => request('/auth/logout', { method: 'POST' }),

  articles: () => request('/articles'),
  article: (id) => request(`/articles/${id}`),
  addArticle: (payload) => request('/articles', { method: 'POST', body: payload }),
  // Slow by design: this request *is* the reading. Fire it, then poll the row.
  runArticle: (id) => request(`/articles/${id}/run`, { method: 'POST' }),
  forget: (id) => request(`/articles/${id}`, { method: 'DELETE' }),

  graph: () => request('/graph'),
  saveLayout: (positions) => request('/graph/layout', { method: 'POST', body: { positions } }),

  search: (q, signal) => request(`/search?q=${encodeURIComponent(q)}`, { signal })
};
