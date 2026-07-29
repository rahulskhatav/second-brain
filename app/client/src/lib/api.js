export class ApiError extends Error {
  constructor(message, { status, field } = {}) {
    super(message);
    this.status = status;
    this.field = field;
  }
}

async function request(path, { method = 'GET', body, signal } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'include',
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new ApiError("Can't reach the server.");
  }

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
