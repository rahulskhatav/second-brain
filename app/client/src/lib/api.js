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

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? 'Something went wrong.', { status: res.status, field: data.field });
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
