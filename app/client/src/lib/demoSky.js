/**
 * The marketing sky.
 *
 * A port of the prototype's Constellation generator, seed and all: five
 * clusters over a real 48-article dataset with computed edges, so the
 * clustering a visitor sees on the landing page is the clustering the app
 * would produce. Signed-out screens have no graph of their own to show.
 *
 * The live sky — /sky — is drawn from the user's own articles instead.
 */

const SEED = 20260728;

const CLUSTERS = [
  { name: 'machine learning', cx: 420, cy: 300, rad: 150, c: '#b5abfc', n: 12 },
  { name: 'systems design', cx: 745, cy: 585, rad: 135, c: '#cfd3e5', n: 10 },
  { name: 'urbanism', cx: 1055, cy: 250, rad: 130, c: '#b2b6ca', n: 9 },
  { name: 'fermentation', cx: 1145, cy: 665, rad: 115, c: '#b5afe8', n: 8 },
  { name: 'climate', cx: 275, cy: 690, rad: 115, c: '#9397ab', n: 9 }
];

const TITLES = [
  'Scaling laws are not a law of nature', 'What embeddings actually measure', 'The bitter lesson, revisited',
  'A field guide to attention', 'Retrieval is the new fine-tuning', 'Small models, long context', 'Why evals rot',
  'Tokenizers considered harmful', 'Distillation in practice', 'The quiet return of symbolic methods',
  'Memory as a product surface', 'Latency is a design constraint',
  'Legible systems and their discontents', 'Build the thing that builds the thing', 'Notes on queues',
  'Idempotency all the way down', 'Postgres is enough', 'The cost of a nine', 'Designing for the failure case',
  'Observability without dashboards', 'Schemas as contracts', 'Migration is a social problem',
  'The fifteen-minute city, three years on', 'Streets are not for cars', 'Zoning as a love letter',
  'What Vienna knows about rent', 'The sidewalk ballet', 'Parking minimums and their victims',
  'Density without towers', 'Trams beat everything', 'The alley as public room',
  'A year of sourdough failures', 'Koji beyond the brewery', 'Salt, time, and patience', 'On garum',
  'The chemistry of a crunchy pickle', 'Miso from anything', 'Vinegar mothers', 'Fermenting in a small kitchen',
  'Heat pumps eat gas boilers', 'The grid is the bottleneck', 'Cement has a problem',
  'What a carbon price really does', 'Degrowth is a distraction', 'Solar past the duck curve',
  'Adaptation is not surrender', 'The permitting knot', 'Batteries all the way down'
];

let cached = null;

export function demoSky() {
  if (cached) return cached;

  let s = SEED;
  const rnd = () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const nodes = [];
  let ti = 0;
  CLUSTERS.forEach((cl, ci) => {
    for (let i = 0; i < cl.n; i++) {
      const a = rnd() * Math.PI * 2;
      const d = Math.pow(rnd(), 0.62) * cl.rad;
      nodes.push({
        x: +(cl.cx + Math.cos(a) * d * 1.15).toFixed(1),
        y: +(cl.cy + Math.sin(a) * d).toFixed(1),
        cluster: ci,
        c: cl.c,
        deg: 0,
        title: TITLES[ti++] || 'Untitled',
        tag: cl.name
      });
    }
  });

  const edges = [];
  const seen = new Set();
  const link = (a, b) => {
    const k = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (a === b || seen.has(k)) return;
    seen.add(k);
    nodes[a].deg++;
    nodes[b].deg++;
    edges.push([a, b]);
  };

  nodes.forEach((n, i) => {
    const near = nodes
      .map((m, j) => ({ j, d: Math.hypot(m.x - n.x, m.y - n.y) }))
      .filter((o) => o.j !== i && nodes[o.j].cluster === n.cluster)
      .sort((a, b) => a.d - b.d);
    const k = 1 + Math.floor(rnd() * 2.6);
    near.slice(0, k).forEach((o) => link(i, o.j));
  });
  for (let i = 0; i < 7; i++) link(Math.floor(rnd() * nodes.length), Math.floor(rnd() * nodes.length));

  const maxDeg = Math.max(...nodes.map((n) => n.deg));
  const out = nodes.map((n) => {
    const t = n.deg / maxDeg;
    return {
      x: n.x,
      y: n.y,
      r: +(2.1 + t * 4.4).toFixed(2),
      halo: +(7 + t * 13).toFixed(1),
      c: n.c,
      haloC: `${n.c}2e`,
      deg: n.deg,
      title: n.title,
      tag: n.tag
    };
  });

  const ed = edges.map(([a, b]) => {
    const str = Math.min(1, (nodes[a].deg + nodes[b].deg) / (maxDeg * 1.7));
    const same = nodes[a].cluster === nodes[b].cluster;
    return {
      x1: out[a].x,
      y1: out[a].y,
      x2: out[b].x,
      y2: out[b].y,
      c: `rgba(${same ? '188,183,226,' : '147,151,171,'}${(0.1 + str * 0.2).toFixed(3)})`,
      w: +(0.5 + str * 0.9).toFixed(2)
    };
  });

  const dust = [];
  for (let i = 0; i < 150; i++)
    dust.push({
      x: +(rnd() * 1440).toFixed(1),
      y: +(rnd() * 900).toFixed(1),
      r: +(0.4 + rnd() * 0.9).toFixed(2),
      c: `rgba(233,233,237,${(0.03 + rnd() * 0.07).toFixed(3)})`
    });

  cached = { nodes: out, edges: ed, dust, clusters: CLUSTERS };
  return cached;
}

/** The seven highest-degree nodes that don't collide, as the prototype picks them. */
export function demoLabels(nodes) {
  const ranked = [];
  nodes
    .map((n, i) => ({ n, i }))
    .sort((a, b) => b.n.deg - a.n.deg)
    .forEach((o) => {
      if (ranked.length >= 7) return;
      if (ranked.some((p) => Math.abs(p.n.x - o.n.x) < 230 && Math.abs(p.n.y - o.n.y) < 26)) return;
      ranked.push(o);
    });
  return ranked.map(({ n }) => ({
    left: `${((n.x + n.halo * 0.5 + 7) / 1440) * 100}%`,
    top: `${((n.y - 9) / 900) * 100}%`,
    text: n.title.length > 34 ? `${n.title.slice(0, 33)}…` : n.title
  }));
}

export const dimHex = (hex, aa) => hex + aa;
