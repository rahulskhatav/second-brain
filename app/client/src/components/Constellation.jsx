import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import Dust from './Dust.jsx';

const LABEL_FONT = 'Inter, system-ui, sans-serif';
const alpha = (hex, aa) => `${hex}${aa}`;

/**
 * The live sky: the user's own articles, placed by meaning.
 *
 * Positions are simulated once and then pinned — a node that has settled keeps
 * its place across reloads (the server stores x/y), so clearing a search puts
 * the sky back exactly as it was. Only genuinely new articles are free to move.
 */
const Constellation = forwardRef(function Constellation(
  { data, dim = false, showLabels = true, selectedId = null, highlightIds = null, onSelect, onLayoutSettled },
  ref
) {
  const fgRef = useRef(null);
  const wrapRef = useRef(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hoverId, setHoverId] = useState(null);

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
  const graph = useMemo(() => {
    const nodes = (data?.nodes ?? []).map((n) => ({
      ...n,
      ...(n.x != null && n.y != null ? { x: n.x, y: n.y, fx: n.x, fy: n.y } : {})
    }));
    const links = (data?.links ?? []).map((l) => ({ ...l }));
    return { nodes, links };
  }, [data]);

  const maxDegree = useMemo(() => Math.max(1, ...graph.nodes.map((n) => n.degree ?? 0)), [graph]);

  const clusterOf = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n.cluster])), [graph]);

  /** The handful of titles worth printing: highest degree, never overlapping. */
  const labelIds = useMemo(() => {
    if (!showLabels || dim) return new Set();
    const placed = [];
    for (const n of [...graph.nodes].sort((a, b) => (b.degree ?? 0) - (a.degree ?? 0))) {
      if (placed.length >= 7) break;
      if (n.x == null || n.y == null) continue;
      if (placed.some((p) => Math.abs(p.x - n.x) < 160 && Math.abs(p.y - n.y) < 18)) continue;
      placed.push(n);
    }
    return new Set(placed.map((n) => n.id));
  }, [graph, showLabels, dim]);

  const radius = useCallback((node) => 2.1 + ((node.degree ?? 0) / maxDegree) * 4.4, [maxDegree]);

  const paintNode = useCallback(
    (node, ctx, globalScale) => {
      const t = (node.degree ?? 0) / maxDegree;
      const r = 2.1 + t * 4.4;
      const halo = 7 + t * 13;

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

      if (isSelected) {
        // The focus mark: two rings and a pair of ticks, as the design draws it.
        ctx.strokeStyle = '#9184d9';
        ctx.lineWidth = 1.25 / globalScale;
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 9, 0, Math.PI * 2);
        ctx.stroke();

        ctx.strokeStyle = 'rgba(145,132,217,0.28)';
        ctx.lineWidth = 1 / globalScale;
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 22, 0, Math.PI * 2);
        ctx.stroke();

        ctx.strokeStyle = 'rgba(145,132,217,0.5)';
        ctx.beginPath();
        ctx.moveTo(node.x - r - 34, node.y);
        ctx.lineTo(node.x - r - 14, node.y);
        ctx.moveTo(node.x, node.y - r - 34);
        ctx.lineTo(node.x, node.y - r - 14);
        ctx.stroke();
      } else if (isHover) {
        ctx.strokeStyle = 'rgba(145,132,217,0.55)';
        ctx.lineWidth = 1 / globalScale;
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 6, 0, Math.PI * 2);
        ctx.stroke();
      }

      const wantsLabel = labelIds.has(node.id) || isHover || isSelected;
      if (wantsLabel && node.title) {
        const text = node.title.length > 34 ? `${node.title.slice(0, 33)}…` : node.title;
        ctx.font = `400 ${11.5 / globalScale}px ${LABEL_FONT}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = isHover || isSelected ? 'rgba(233,233,237,0.92)' : 'rgba(233,233,237,0.6)';
        ctx.fillText(text, node.x + halo * 0.5 + 7 / globalScale, node.y);
      }
    },
    [dim, highlightIds, hoverId, labelIds, maxDegree, selectedId]
  );

  const pointerArea = useCallback(
    (node, color, ctx) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(node.x, node.y, Math.max(radius(node) + 5, 8), 0, Math.PI * 2);
      ctx.fill();
    },
    [radius]
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
    if (positions.length) onLayoutSettled?.(positions);
  }, [graph, onLayoutSettled]);

  useEffect(() => {
    const fg = fgRef.current;
    if (!fg || !graph.nodes.length) return;
    fg.d3Force('charge')?.strength(-140).distanceMax(420);
    fg.d3Force('link')?.distance((l) => 90 - (l.strength ?? 0.5) * 45).strength(0.5);
    const t = setTimeout(() => fg.zoomToFit(600, 90), 60);
    return () => clearTimeout(t);
  }, [graph]);

  useImperativeHandle(ref, () => ({
    zoomIn: () => fgRef.current?.zoom(fgRef.current.zoom() * 1.35, 220),
    zoomOut: () => fgRef.current?.zoom(fgRef.current.zoom() / 1.35, 220),
    fit: () => fgRef.current?.zoomToFit(500, 90),
    centerOn: (id) => {
      const node = graph.nodes.find((n) => n.id === id);
      if (node) fgRef.current?.centerAt(node.x, node.y, 500);
    }
  }));

  return (
    <div ref={wrapRef} className="sky-canvas">
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
          linkCurvature={0}
          enableNodeDrag={false}
          warmupTicks={40}
          cooldownTicks={90}
          d3VelocityDecay={0.32}
          onEngineStop={handleEngineStop}
          onNodeClick={(node) => onSelect?.(node.id)}
          onNodeHover={(node) => setHoverId(node?.id ?? null)}
          onBackgroundClick={() => onSelect?.(null)}
        />
      )}
    </div>
  );
});

export default Constellation;
