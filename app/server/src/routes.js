import { Router } from 'express';
import { all, connectionHealth, one, query } from './db.js';
import { ExtractError } from './extract.js';
import { hasGemini } from './gemini.js';
import { createArticle, releaseStaleRuns, runArticle } from './ingest.js';
import { buildGraph, clusterise, nearest, parseTags, vocabulary } from './graph.js';

export const api = Router();

const rowsFor = (userId) =>
  all('SELECT * FROM articles WHERE user_id = $1 ORDER BY added_at DESC', [userId]);

const publicArticle = (r) => ({
  id: r.id,
  url: r.url,
  site: r.site,
  title: r.title,
  summary: r.summary,
  tags: parseTags(r.tags),
  status: r.status,
  error: r.error,
  errorKind: r.error_kind ?? null, // 'page' — pasting the text may help; 'reader' — it won't
  addedAt: r.added_at
});

api.get('/status', async (_req, res, next) => {
  try {
    res.json({ reader: hasGemini() ? 'gemini' : 'fallback', db: await connectionHealth() });
  } catch (err) {
    next(err);
  }
});

/* ── articles ─────────────────────────────────────────────────────────────── */

api.get('/articles', async (req, res, next) => {
  try {
    await releaseStaleRuns(req.user.id);
    const rows = await rowsFor(req.user.id);
    const ready = rows.filter((r) => r.status === 'ready');
    const counts = vocabulary(ready);
    const { clusters } = clusterise(ready);
    res.json({
      articles: rows.map(publicArticle),
      tags: counts.map(([name, count]) => ({ name, count })),
      clusters,
      lastAddedAt: rows[0]?.added_at ?? null
    });
  } catch (err) {
    next(err);
  }
});

api.post('/articles', async (req, res, next) => {
  try {
    const url = req.body?.url ? String(req.body.url) : null;
    const text = req.body?.text ? String(req.body.text) : null;
    const row = await createArticle({ userId: req.user.id, url, text });
    res.status(202).json({ article: publicArticle(row) });
  } catch (err) {
    if (err instanceof ExtractError) return res.status(400).json({ error: err.message });
    next(err);
  }
});

/**
 * Does the reading. Slow on purpose — the client fires this and polls the row
 * meanwhile, because nothing may keep running once the response is sent.
 */
api.post('/articles/:id/run', async (req, res, next) => {
  try {
    const result = await runArticle({ userId: req.user.id, id: Number(req.params.id) });
    if (result.state === 'missing') return res.status(404).json({ error: 'No such article.' });
    if (result.state === 'busy')
      return res.status(409).json({ error: 'Another article is being read.', retry: true });
    res.json({ article: publicArticle(result.article) });
  } catch (err) {
    next(err);
  }
});

api.get('/articles/:id', async (req, res, next) => {
  try {
    const row = await one('SELECT * FROM articles WHERE id = $1 AND user_id = $2', [
      Number(req.params.id),
      req.user.id
    ]);
    if (!row) return res.status(404).json({ error: 'No such article.' });

    const rows = (await rowsFor(req.user.id)).filter((r) => r.status === 'ready');
    const { assignment } = clusterise(rows);
    const neighbours = nearest(rows, row.id).map(({ row: n, sim }) => ({
      id: n.id,
      title: n.title,
      color: assignment.get(n.id)?.color ?? '#75798c',
      sim: +sim.toFixed(2)
    }));

    res.json({ article: { ...publicArticle(row), neighbours } });
  } catch (err) {
    next(err);
  }
});

api.delete('/articles/:id', async (req, res, next) => {
  try {
    const { rowCount } = await query('DELETE FROM articles WHERE id = $1 AND user_id = $2', [
      Number(req.params.id),
      req.user.id
    ]);
    if (rowCount === 0) return res.status(404).json({ error: 'No such article.' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* ── the sky ──────────────────────────────────────────────────────────────── */

api.get('/graph', async (req, res, next) => {
  try {
    res.json(buildGraph(await rowsFor(req.user.id)));
  } catch (err) {
    next(err);
  }
});

/**
 * The client runs the force simulation once and hands back where everything
 * settled, so the sky is in the same place next time — nothing re-simulated.
 */
api.post('/graph/layout', async (req, res, next) => {
  try {
    const positions = Array.isArray(req.body?.positions) ? req.body.positions : [];
    const clean = positions.filter((p) => Number.isFinite(Number(p?.x)) && Number.isFinite(Number(p?.y)));
    if (clean.length) {
      // One statement rather than one per node — a round trip per article adds
      // up on a hosted database.
      await query(
        `UPDATE articles AS a SET x = v.x, y = v.y
           FROM (SELECT * FROM unnest($1::int[], $2::float8[], $3::float8[]) AS t(id, x, y)) AS v
          WHERE a.id = v.id AND a.user_id = $4`,
        [
          clean.map((p) => Number(p.id)),
          clean.map((p) => Number(p.x)),
          clean.map((p) => Number(p.y)),
          req.user.id
        ]
      );
    }
    res.json({ ok: true, saved: clean.length });
  } catch (err) {
    next(err);
  }
});

/* ── search ───────────────────────────────────────────────────────────────── */

api.get('/search', async (req, res, next) => {
  try {
    const q = String(req.query.q ?? '').trim().toLowerCase();
    if (q.length < 2) return res.json({ query: q, results: [] });

    const rows = (await rowsFor(req.user.id)).filter((r) => r.status === 'ready');
    const { assignment } = clusterise(rows);

    const results = rows
      .map((r) => {
        const tags = parseTags(r.tags);
        const title = r.title.toLowerCase();
        const summary = (r.summary ?? '').toLowerCase();
        // Weighted so an exact tag beats a passing mention in the prose.
        let score = 0;
        if (tags.some((t) => t === q)) score += 10;
        if (tags.some((t) => t.includes(q))) score += 5;
        if (title.includes(q)) score += 4;
        if (summary.includes(q)) score += 2;
        return { r, tags, score, cluster: assignment.get(r.id) };
      })
      .filter((o) => o.score > 0)
      .sort((a, b) => b.score - a.score || new Date(b.r.added_at) - new Date(a.r.added_at))
      .map(({ r, tags, score, cluster }) => ({
        id: r.id,
        title: r.title,
        summary: r.summary,
        tags,
        score,
        clusterName: cluster?.name ?? null,
        addedAt: r.added_at
      }));

    res.json({ query: q, results });
  } catch (err) {
    next(err);
  }
});
