import { forceCollide } from 'd3-force';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import Dust from './Dust.jsx';

const LABEL_FONT = 'Inter, system-ui, sans-serif';
const alpha = (hex, aa) => `${hex}${aa}`;

/** Only to stop a one-node sky zooming to absurdity. */
const MAX_FIT_ZOOM = 6;

/** Minimum separation between nodes, in graph units — what spreads the map. */
const COLLIDE_RADIUS = 30;

/**
 * Bump when the forces change.
 *
 * Settled positions are stored and pinned, which is what keeps the sky still
 * between visits — but it also means retuning the layout has no effect on a sky
 * that has already settled. A version change makes the stored positions be
 * ignored exactly once; the new ones are saved on the way out.
 */
const LAYOUT_VERSION = 3;
const VERSION_KEY = 'sb:layout-version';

const storedLayoutIsCurrent = () => {
  try {
    return Number(localStorage.getItem(VERSION_KEY) ?? 0) >= LAYOUT_VERSION;
  } catch {
    return false; // private mode, blocked storage — re-simulating is the safe answer
  }
};

/**
 * Stars are sized in screen pixels, not graph units.
 *
 * Sizing them in graph units ties how big a node looks to how far the view is
 * zoomed: fitting a handful of articles to the viewport zooms a long way in and
 * they come out as saucers, while capping the zoom to stop that shrinks the
 * whole map to a speck instead. Dividing by the current scale at paint time
 * breaks the link — the fit is free to fill the viewport, and a star is the
 * same size whether you are looking at ten articles or a thousand.
 */
const corePx = (t) => 3.2 + t * 5;
const haloPx = (t) => 11 + t * 18;

/**
 * Stars grow when the sky is empty and shrink as it fills.
 *
 * Three articles at the size that suits three hundred are specks in a void;
 * three hundred at the size that suits three is a wall. Sized against a
 * reference sky of 48 — the dataset the design was drawn from — so that looks
 * exactly as designed, with a gentle curve either side and firm limits.
 */
const REFERENCE_SKY = 48;
const sizeScale = (count) => {
  if (count < 1) return 1;
  return Math.min(2, Math.max(0.8, (REFERENCE_SKY / count) ** 0.28));
};

/**
 * The outline of a set of points, for the shape drawn around a cluster.
 *
 * A circle through the outermost member is enormous when two articles sit far
 * apart — it swallows the whole map and runs off the screen. A hull hugs what
 * is actually there: a capsule around a pair, a rounded polygon around a group.
 * Monotone chain; collinear points dropped.
 */
function convexHull(points) {
  if (points.length < 3) return [...points];
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const half = (source) => {
    const out = [];
    for (const p of source) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };

  return [...half(pts), ...half([...pts].reverse())];
}

/**
 * Traces a hull grown outward by `pad`, with rounded corners, as one closed
 * path — so it can be filled and outlined once each. Stroking a thick pen along
 * the hull instead would work only for opaque paint: at these alphas the pen
 * stroke and the fill compound where they overlap, and the shape reads as a
 * pipe running around an empty middle rather than as a region.
 */
function tracePaddedHull(ctx, hull, pad) {
  const n = hull.length;
  ctx.beginPath();

  if (n === 1) {
    ctx.arc(hull[0].x, hull[0].y, pad, 0, Math.PI * 2);
    return;
  }
  if (n === 2) {
    const [a, b] = hull;
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    ctx.arc(a.x, a.y, pad, ang + Math.PI / 2, ang - Math.PI / 2);
    ctx.arc(b.x, b.y, pad, ang - Math.PI / 2, ang + Math.PI / 2);
    ctx.closePath();
    return;
  }

  // One winding, so "outward" means one thing all the way round.
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % n];
    area += a.x * b.y - b.x * a.y;
  }
  const pts = area < 0 ? [...hull].reverse() : hull;

  const normals = pts.map((a, i) => {
    const b = pts[(i + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = (dy / len) * pad;
    const ny = (-dx / len) * pad;
    return { nx, ny, ang: Math.atan2(ny, nx) };
  });

  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const before = normals[(i - 1 + n) % n];
    const now = normals[i];
    ctx.arc(a.x, a.y, pad, before.ang, now.ang); // rounds this corner
    ctx.lineTo(b.x + now.nx, b.y + now.ny);
  }
  ctx.closePath();
}

/**
 * The live sky: the user's own articles, placed by meaning.
 *
 * Positions are simulated once and then pinned — a node that has settled keeps
 * its place across reloads (the server stores x/y), so clearing a search puts
 * the sky back exactly as it was. Only genuinely new articles are free to move.
 */
const Constellation = forwardRef(function Constellation(
  {
    data,
    dim = false,
    showLabels = true,
    selectedId = null,
    highlightIds = null,
    onSelect,
    onLayoutSettled,
    onForget
  },
  ref
) {
  const fgRef = useRef(null);
  const wrapRef = useRef(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hoverId, setHoverId] = useState(null);
  /* Where the hovered node is on screen, for the delete button that sits over
     it. Canvas has nothing to attach a button to, so it is a real element
     positioned on top. */
  const [hovered, setHovered] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const leaveTimer = useRef(null);
  /* Bumped when the layout settles. Which titles to print depends on where
     nodes ended up, and on a sky being simulated for the first time they have
     no position yet — without this the choice is made against nothing and no
     title is ever drawn. */
  const [settledAt, setSettledAt] = useState(0);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width: Math.round(width), height: Math.round(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* Force-graph mutates the objects it's given, so it gets copies. Nodes that
     already have a stored position come back pinned (fx/fy). */
  const honourStored = useRef(storedLayoutIsCurrent()).current;

  const graph = useMemo(() => {
    const nodes = (data?.nodes ?? []).map((n) => ({
      ...n,
      ...(honourStored && n.x != null && n.y != null ? { x: n.x, y: n.y, fx: n.x, fy: n.y } : {})
    }));
    const links = (data?.links ?? []).map((l) => ({ ...l }));
    return { nodes, links };
  }, [data, honourStored]);

  const maxDegree = useMemo(() => Math.max(1, ...graph.nodes.map((n) => n.degree ?? 0)), [graph]);
  const scale = useMemo(() => sizeScale(graph.nodes.length), [graph]);

  const clusterOf = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n.cluster])), [graph]);

  /** The handful of titles worth printing: highest degree, never overlapping. */
  const labelIds = useMemo(() => {
    if (!showLabels || dim) return new Set();
    const placed = [];
    const sited = graph.nodes.filter((n) => n.x != null && n.y != null);
    if (!sited.length) return new Set();

    // Keep-apart distances scale with the layout rather than being fixed graph
    // units, which would mean something different at every zoom level.
    const span = (get) => {
      const vs = sited.map(get);
      return Math.max(...vs) - Math.min(...vs) || 1;
    };
    const gapX = span((n) => n.x) * 0.1;
    const gapY = span((n) => n.y) * 0.045;

    for (const n of [...sited].sort((a, b) => (b.degree ?? 0) - (a.degree ?? 0))) {
      if (placed.length >= 12) break;
      if (placed.some((p) => Math.abs(p.x - n.x) < gapX && Math.abs(p.y - n.y) < gapY)) continue;
      placed.push(n);
    }
    return new Set(placed.map((n) => n.id));
  }, [graph, showLabels, dim, settledAt]);

  /**
   * The fields the clusters occupy, drawn under everything else.
   *
   * One translucent circle enclosing each cluster's members, named above it.
   * They overlap where subjects do, which is the point — an article on the edge
   * of two clusters sits in the lens between them.
   */
  const paintClusters = useCallback(
    (ctx, globalScale) => {
      const px = (n) => n / globalScale;

      const groups = new Map();
      for (const n of graph.nodes) {
        if (!(n.cluster >= 0) || !Number.isFinite(n.x) || !Number.isFinite(n.y)) continue;
        if (!groups.has(n.cluster)) groups.set(n.cluster, []);
        groups.get(n.cluster).push(n);
      }

      const headings = [];

      const pad = px(38);
      const fill = (color) => alpha(color, dim ? '08' : '15');

      for (const members of groups.values()) {
        if (members.length < 2) continue;
        const hull = convexHull(members.map((n) => ({ x: n.x, y: n.y })));
        const { color, clusterName } = members[0];

        tracePaddedHull(ctx, hull, pad);
        ctx.fillStyle = fill(color);
        ctx.fill();
        ctx.strokeStyle = alpha(color, dim ? '18' : '40');
        ctx.lineWidth = px(1);
        ctx.stroke();

        // Inside the top of its own shape — outside, it clips off the top of the
        // viewport — where the padding guarantees no node is sitting.
        if (clusterName && !dim) {
          const top = Math.min(...hull.map((p) => p.y)) - pad;
          const cx = hull.reduce((s, p) => s + p.x, 0) / hull.length;
          headings.push({ text: clusterName.toUpperCase(), cx, y: top + px(17), color });
        }
      }

      if (!headings.length) return;

      ctx.font = `500 ${px(10.5)}px ${LABEL_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const had = ctx.letterSpacing;
      try {
        ctx.letterSpacing = `${px(1.4)}px`; // tracked out, like the kickers elsewhere
      } catch {
        /* older engines ignore letter spacing on canvas */
      }

      // Near-concentric clusters would print their names on top of each other.
      const placed = [];
      for (const h of headings.sort((a, b) => a.y - b.y)) {
        while (placed.some((p) => Math.abs(p.y - h.y) < px(15) && Math.abs(p.cx - h.cx) < px(150))) {
          h.y += px(16);
        }
        placed.push(h);
        ctx.fillStyle = alpha(h.color, 'cc');
        ctx.fillText(h.text, h.cx, h.y);
      }

      try {
        ctx.letterSpacing = had ?? '0px';
      } catch {
        /* nothing to restore */
      }
    },
    [graph, dim]
  );

  const paintNode = useCallback(
    (node, ctx, globalScale) => {
      const t = (node.degree ?? 0) / maxDegree;
      // Screen pixels converted to graph units for this frame's zoom.
      const px = (n) => n / globalScale;
      const r = px(corePx(t) * scale);
      const halo = px(haloPx(t) * scale);

      const lit = highlightIds ? highlightIds.has(node.id) : !dim;
      const isSelected = node.id === selectedId;
      const isHover = node.id === hoverId;

      // Halo — a soft radial bloom standing in for the prototype's blur pass.
      const g = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, halo);
      g.addColorStop(0, alpha(node.color, lit ? '38' : '10'));
      g.addColorStop(1, alpha(node.color, '00'));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(node.x, node.y, halo, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = lit ? node.color : alpha(node.color, '55');
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      ctx.fill();

      /* A watched thing reads differently from a read one: the core is hollowed
         out, which is visible at a glance without adding another colour to a
         palette that is already carrying the clusters. */
      if (node.kind === 'video') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();
        ctx.arc(node.x, node.y, Math.max(r * 0.42, px(1.1)), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      }

      if (isSelected) {
        // The focus mark: two rings and a pair of ticks, as the design draws it.
        ctx.strokeStyle = '#9184d9';
        ctx.lineWidth = px(1.25);
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + px(9), 0, Math.PI * 2);
        ctx.stroke();

        ctx.strokeStyle = 'rgba(145,132,217,0.28)';
        ctx.lineWidth = px(1);
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + px(22), 0, Math.PI * 2);
        ctx.stroke();

        ctx.strokeStyle = 'rgba(145,132,217,0.5)';
        ctx.beginPath();
        ctx.moveTo(node.x - r - px(34), node.y);
        ctx.lineTo(node.x - r - px(14), node.y);
        ctx.moveTo(node.x, node.y - r - px(34));
        ctx.lineTo(node.x, node.y - r - px(14));
        ctx.stroke();
      } else if (isHover) {
        ctx.strokeStyle = 'rgba(145,132,217,0.55)';
        ctx.lineWidth = px(1);
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + px(6), 0, Math.PI * 2);
        ctx.stroke();
      }

      const wantsLabel = labelIds.has(node.id) || isHover || isSelected;
      /* The short label, not the headline: a map wants the name of the thing,
         and a line of prose beside every dot is unreadable at any density. The
         full title is a click away in the panel. */
      const naming = node.label || node.title;
      if (wantsLabel && naming) {
        const text = naming.length > 26 ? `${naming.slice(0, 25)}…` : naming;
        ctx.font = `400 ${11.5 / globalScale}px ${LABEL_FONT}`;
        ctx.textBaseline = 'middle';
        ctx.fillStyle = isHover || isSelected ? 'rgba(233,233,237,0.92)' : 'rgba(233,233,237,0.6)';

        /* A title sitting to the right of a node near the right edge runs off
           the canvas, so it flips to the node's other side. The transform gives
           where this node actually is on screen; its horizontal scale over the
           zoom is the device pixel ratio. */
        const tf = ctx.getTransform();
        const dpr = tf.a / globalScale || 1;
        const screenX = tf.a * node.x + tf.e;
        const flip = screenX > ctx.canvas.width - 150 * dpr;

        ctx.textAlign = flip ? 'right' : 'left';
        const offset = halo * 0.5 + px(7);
        ctx.fillText(text, flip ? node.x - offset : node.x + offset, node.y);
      }
    },
    [dim, highlightIds, hoverId, labelIds, maxDegree, scale, selectedId]
  );

  /* The clickable disc has to follow the drawn one, so it is sized the same
     way — in screen pixels, with a comfortable margin for the mouse. */
  const pointerArea = useCallback(
    (node, color, ctx, globalScale = 1) => {
      const t = (node.degree ?? 0) / maxDegree;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(node.x, node.y, (corePx(t) * scale + 8) / globalScale, 0, Math.PI * 2);
      ctx.fill();
    },
    [maxDegree, scale]
  );

  const linkStyle = useCallback(
    (link) => {
      const a = link.source?.id ?? link.source;
      const b = link.target?.id ?? link.target;
      const same = clusterOf.get(a) === clusterOf.get(b) && clusterOf.get(a) !== -1;
      const strength = link.strength ?? 0.5;
      let opacity = 0.1 + strength * 0.2;
      if (dim) opacity *= 0.35;
      if (highlightIds && !(highlightIds.has(a) && highlightIds.has(b))) opacity *= 0.4;
      return {
        color: `rgba(${same ? '188,183,226,' : '147,151,171,'}${opacity.toFixed(3)})`,
        width: 0.5 + strength * 0.9
      };
    },
    [clusterOf, dim, highlightIds]
  );

  /* Once it settles, pin everything and tell the caller where things landed. */
  const handleEngineStop = useCallback(() => {
    const positions = [];
    for (const n of graph.nodes) {
      if (n.x == null || n.y == null) continue;
      n.fx = n.x;
      n.fy = n.y;
      positions.push({ id: n.id, x: +n.x.toFixed(2), y: +n.y.toFixed(2) });
    }
    if (!positions.length) return;
    setSettledAt(Date.now()); // now that nodes have places, choose the titles
    onLayoutSettled?.(positions);

    // A node asked for by URL can only be brought into view once it has one.
    const focused = selectedId != null && graph.nodes.find((n) => n.id === selectedId);
    if (focused && Number.isFinite(focused.x)) {
      fgRef.current?.centerAt(focused.x, focused.y, 600);
    }
    try {
      localStorage.setItem(VERSION_KEY, String(LAYOUT_VERSION));
    } catch {
      /* storage blocked — the sky re-simulates next visit, which is only a cost */
    }
  }, [graph, onLayoutSettled, selectedId]);

  useEffect(() => {
    const fg = fgRef.current;
    if (!fg || !graph.nodes.length) return undefined;

    // Airy rather than clustered: strong repulsion over a long range, links
    // long enough that even a close pair keeps its distance, and a collision
    // radius well beyond the halo so nothing overlaps.
    fg.d3Force('charge')?.strength(-320).distanceMax(900);
    fg.d3Force('link')
      ?.distance((l) => 160 - (l.strength ?? 0.5) * 55)
      .strength(0.35);
    fg.d3Force('collide', forceCollide(COLLIDE_RADIUS).strength(0.9));

    const fit = setTimeout(() => {
      fg.zoomToFit(600, 175); // room for the cluster rings and their names
      // zoomToFit animates, so the cap is applied once it has landed.
      setTimeout(() => {
        if (fg.zoom() > MAX_FIT_ZOOM) fg.zoom(MAX_FIT_ZOOM, 350);
      }, 650);
    }, 60);
    return () => clearTimeout(fit);
  }, [graph, maxDegree]);

  useImperativeHandle(ref, () => ({
    zoomIn: () => fgRef.current?.zoom(fgRef.current.zoom() * 1.35, 220),
    zoomOut: () => fgRef.current?.zoom(fgRef.current.zoom() / 1.35, 220),
    fit: () => {
      const fg = fgRef.current;
      if (!fg) return;
      fg.zoomToFit(500, 175);
      setTimeout(() => {
        if (fg.zoom() > MAX_FIT_ZOOM) fg.zoom(MAX_FIT_ZOOM, 300);
      }, 550);
    },
    centerOn: (id) => {
      const node = graph.nodes.find((n) => n.id === id);
      // Arriving on /sky?focus=… asks for this before the simulation has placed
      // anything; centring on an undefined point pans the view off the map and
      // leaves an empty sky. The settle handler centres it once it has a place.
      if (node && Number.isFinite(node.x) && Number.isFinite(node.y)) {
        fgRef.current?.centerAt(node.x, node.y, 500);
      }
    }
  }));

  /**
   * Clicking empty sky closes whatever is open.
   *
   * Done here rather than through onBackgroundClick because that also fires at
   * the end of a pan — drag the map and the panel would shut. A press and
   * release within a few pixels is a click; anything further is a drag.
   */
  /**
   * Keeping the delete button reachable.
   *
   * The pointer has to leave the node to get to the button, which would
   * normally take the button away with it — so leaving is delayed, and entering
   * the button cancels the departure.
   */
  const handleNodeHover = useCallback(
    (node) => {
      clearTimeout(leaveTimer.current);
      setHoverId(node?.id ?? null);
      if (!node) {
        leaveTimer.current = setTimeout(() => {
          setHovered(null);
          setConfirming(null);
        }, 260);
        return;
      }
      const screen = fgRef.current?.graph2ScreenCoords?.(node.x, node.y);
      if (screen) setHovered({ id: node.id, title: node.title, x: screen.x, y: screen.y });
    },
    []
  );

  const keepHover = useCallback(() => clearTimeout(leaveTimer.current), []);
  const releaseHover = useCallback(() => {
    leaveTimer.current = setTimeout(() => {
      setHovered(null);
      setConfirming(null);
    }, 260);
  }, []);

  // Panning or zooming moves the node out from under the button.
  const dropHover = useCallback(() => {
    setHovered(null);
    setConfirming(null);
    setHoverId(null);
  }, []);

  const pressRef = useRef(null);

  const onPointerDown = useCallback((e) => {
    pressRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const onPointerUp = useCallback(
    (e) => {
      const down = pressRef.current;
      pressRef.current = null;
      if (!down) return;
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return; // dragged
      if (hoverId != null) return; // landed on a node — onNodeClick has it
      onSelect?.(null);
    },
    [hoverId, onSelect]
  );

  return (
    <div
      ref={wrapRef}
      className="sky-canvas"
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
    >
      <Dust />
      {size.width > 0 && (
        <ForceGraph2D
          ref={fgRef}
          graphData={graph}
          width={size.width}
          height={size.height}
          backgroundColor="rgba(0,0,0,0)"
          nodeId="id"
          nodeLabel={() => ''}
          nodeCanvasObject={paintNode}
          nodePointerAreaPaint={pointerArea}
          linkColor={(l) => linkStyle(l).color}
          linkWidth={(l) => linkStyle(l).width}
          onRenderFramePre={paintClusters}
          linkCurvature={0}
          enableNodeDrag={false}
          warmupTicks={40}
          cooldownTicks={90}
          d3VelocityDecay={0.32}
          onEngineStop={handleEngineStop}
          onNodeClick={(node) => onSelect?.(node.id)}
          onNodeHover={handleNodeHover}
          onZoom={dropHover}
        />
      )}

      {/* Forgetting a node from the map. Two clicks, not one: this deletes an
          article for good, and a cross that appears under a moving pointer is
          exactly the thing you hit by accident. */}
      {hovered && onForget && (
        <div
          className="node-forget"
          style={{ left: hovered.x, top: hovered.y }}
          onMouseEnter={keepHover}
          onMouseLeave={releaseHover}
        >
          {confirming === hovered.id ? (
            <div className="node-forget-confirm">
              <span>Forget it?</span>
              <button
                className="node-forget-yes"
                onClick={() => {
                  onForget(hovered.id);
                  dropHover();
                }}
              >
                Forget
              </button>
              <button className="node-forget-no" onClick={() => setConfirming(null)}>
                Keep
              </button>
            </div>
          ) : (
            <button
              className="node-forget-cross"
              onClick={() => setConfirming(hovered.id)}
              aria-label={`Forget ${hovered.title ?? 'this article'}`}
              title="Forget this"
            >
              <svg width="9" height="9" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
                <path d="M205.7 194.3a8 8 0 01-11.4 11.4L128 139.3l-66.3 66.4a8 8 0 01-11.4-11.4l66.4-66.3-66.4-66.3a8 8 0 0111.4-11.4l66.3 66.4 66.3-66.4a8 8 0 0111.4 11.4L139.3 128z" />
              </svg>
            </button>
          )}
        </div>
      )}
    </div>
  );
});

export default Constellation;
