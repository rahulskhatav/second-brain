/**
 * Turns a user's articles into the sky: five colour-carrying clusters, and the
 * edges that appear where two things are genuinely about the same thing.
 *
 * The five cluster colours are the design's, in order of cluster size. Anything
 * that belongs to none of the top five stays neutral.
 */
/**
 * One colour per cluster, every article in a cluster painted the same.
 *
 * All five are Nocturne ramp steps, chosen to sit far apart in lightness and to
 * alternate between the accent and neutral families — the system keeps chroma
 * low, so separation has to come from value rather than hue. Ordered by cluster
 * size, so the biggest clusters get the most distinct pair.
 */
export const CLUSTER_COLORS = [
  '#b5abfc', // accent-400   — soft purple
  '#cfd3e5', // neutral-300  — pale silver
  '#7972a9', // accent-2-600 — deep lilac
  '#e4e7f5', // neutral-200  — near white
  '#9397ab'  // neutral-500  — mid grey
];

/** Belongs to no cluster: dimmer than any of them, and never mistaken for one. */
export const UNCLUSTERED_COLOR = '#75798c';

const NEIGHBOURS_PER_NODE = 3;

/**
 * How close is close enough to draw an edge.
 *
 * Absolute thresholds don't survive a change of embedding: Gemini puts related
 * articles around 0.7–0.9, while the no-key lexical fallback tops out near 0.3,
 * and a fixed cut that suits one leaves the other either a hairball or a dust
 * cloud. So the cut is relative — a neighbour has to be within reach of the
 * best neighbour that node has — with a low absolute floor to keep genuinely
 * unrelated things apart.
 */
const RELATIVE_CUT = 0.75;
const ABSOLUTE_FLOOR = 0.15;

/** Words that carry nothing when a headline has to become three words. */
const LABEL_SKIP = new Set(
  `a an the of and or for to in on at by from with why how what when which is are was were
   its your our this that as into about`.split(/\s+/)
);

/**
 * The name a node wears on the map: three words at most.
 *
 * Prefers the label the reader wrote, which summarises rather than truncates.
 * Falls back to squeezing the title — for articles read before labels existed,
 * and whenever there is no reader at all.
 */
export function shortLabel(candidate, fallbackTitle = '', max = 3) {
  const tidy = (s) =>
    String(s ?? '')
      .replace(/["“”'’]/g, '')
      .replace(/[—–:;,.!?]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const written = tidy(candidate).split(' ').filter(Boolean);
  if (written.length) return written.slice(0, max).join(' ');

  const all = tidy(fallbackTitle).split(' ').filter(Boolean);
  const meaty = all.filter((w) => !LABEL_SKIP.has(w.toLowerCase()));
  return (meaty.length ? meaty : all).slice(0, max).join(' ') || 'Untitled';
}

export const cosine = (a, b) => {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // vectors are stored normalised
};

export const parseVec = (json) => {
  if (!json) return null;
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
};

export const parseTags = (json) => {
  try {
    const t = JSON.parse(json ?? '[]');
    return Array.isArray(t) ? t.map(String) : [];
  } catch {
    return [];
  }
};

/** Tag vocabulary across the user's articles, most used first. */
export function vocabulary(rows) {
  const counts = new Map();
  for (const r of rows) for (const t of parseTags(r.tags)) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/**
 * The clusters, and which one each article belongs to.
 *
 * Clusters partition the articles: every article is in at most one, so every
 * article has exactly one colour. Building them straight from tag counts does
 * not do that — articles share tags, so "machine learning", "language models"
 * and "context windows" become three clusters over the same two articles, two
 * of which are then empty of anyone who actually paints with them, and the
 * legend claims groups that don't exist.
 *
 * So membership is decided first, and the clusters are what the membership
 * turns out to be.
 */
export function clusterise(rows) {
  const ranked = vocabulary(rows).filter(([, n]) => n >= 2).map(([name]) => name);
  const rank = new Map(ranked.map((tag, i) => [tag, i]));

  // Each article claims the most-used tag it carries.
  const claim = (candidates) => {
    const picked = new Map();
    for (const r of rows) {
      const mine = parseTags(r.tags).filter((t) => candidates.has(t));
      if (!mine.length) continue;
      mine.sort((a, b) => rank.get(a) - rank.get(b));
      picked.set(r.id, mine[0]);
    }
    return picked;
  };

  const first = claim(new Set(ranked));

  // A cluster needs two members of its own — one article is not a subject, and
  // a tag every member gave away to a broader tag is not a cluster either.
  const tally = new Map();
  for (const tag of first.values()) tally.set(tag, (tally.get(tag) ?? 0) + 1);

  const kept = [...tally.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, CLUSTER_COLORS.length)
    .map(([name]) => name);

  // Articles whose first choice didn't survive fall to the best cluster that did.
  const final = claim(new Set(kept));

  const sizes = new Map();
  for (const tag of final.values()) sizes.set(tag, (sizes.get(tag) ?? 0) + 1);

  const clusters = kept
    .filter((name) => (sizes.get(name) ?? 0) >= 2)
    .sort((a, b) => sizes.get(b) - sizes.get(a) || a.localeCompare(b))
    .map((name, i) => ({ index: i, name, count: sizes.get(name), color: CLUSTER_COLORS[i] }));

  const byName = new Map(clusters.map((c) => [c.name, c]));
  const assignment = new Map();
  for (const r of rows) {
    const tag = final.get(r.id);
    assignment.set(r.id, tag && byName.has(tag) ? byName.get(tag) : null);
  }
  return { clusters, assignment };
}

/** Every article links to its nearest few, above the threshold. Undirected, deduped. */
export function buildEdges(rows) {
  const vecs = new Map(rows.map((r) => [r.id, parseVec(r.embedding)]));
  const seen = new Set();
  const edges = [];

  for (const a of rows) {
    const va = vecs.get(a.id);
    if (!va) continue;
    const ranked = rows
      .filter((b) => b.id !== a.id && vecs.get(b.id))
      .map((b) => ({ id: b.id, sim: cosine(va, vecs.get(b.id)) }))
      .sort((x, y) => y.sim - x.sim);

    const best = ranked[0]?.sim ?? 0;
    const cut = Math.max(ABSOLUTE_FLOOR, best * RELATIVE_CUT);

    for (const o of ranked.slice(0, NEIGHBOURS_PER_NODE)) {
      if (o.sim < cut) break;
      const key = a.id < o.id ? `${a.id}:${o.id}` : `${o.id}:${a.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ source: a.id, target: o.id, sim: +o.sim.toFixed(4) });
    }
  }

  // Strength is where an edge sits in this sky's own range of closeness, so the
  // drawing weights read the same whichever embedding produced the numbers.
  const sims = edges.map((e) => e.sim);
  const low = Math.min(...sims);
  const high = Math.max(...sims);
  const span = high - low || 1;
  for (const e of edges) e.strength = +((e.sim - low) / span).toFixed(3);

  return edges;
}

/** The three closest articles to one node, whatever the edge threshold said. */
export function nearest(rows, id, limit = 3) {
  const target = rows.find((r) => r.id === id);
  const vt = parseVec(target?.embedding);
  if (!vt) return [];
  return rows
    .filter((r) => r.id !== id && r.embedding)
    .map((r) => ({ row: r, sim: cosine(vt, parseVec(r.embedding)) }))
    .sort((a, b) => b.sim - a.sim)
    .slice(0, limit);
}

/** The whole sky, shaped for the client. */
export function buildGraph(rows) {
  const ready = rows.filter((r) => r.status === 'ready');
  const { clusters, assignment } = clusterise(ready);
  const edges = buildEdges(ready);

  const degree = new Map();
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }

  const nodes = ready.map((r) => {
    const cluster = assignment.get(r.id);
    return {
      id: r.id,
      title: r.title,
      // Articles read before labels existed still get one, from their title.
      label: shortLabel(r.label, r.title),
      tags: parseTags(r.tags),
      cluster: cluster ? cluster.index : -1,
      clusterName: cluster ? cluster.name : null,
      color: cluster ? cluster.color : UNCLUSTERED_COLOR,
      degree: degree.get(r.id) ?? 0,
      x: r.x ?? null,
      y: r.y ?? null,
      addedAt: r.added_at
    };
  });

  return { nodes, links: edges, clusters };
}
