import { useMemo } from 'react';
import { demoLabels, demoSky } from '../lib/demoSky.js';

const fade = (rgba) => rgba.replace(/,([\d.]+)\)$/, (_m, p) => `,${(parseFloat(p) * 0.35).toFixed(3)})`);

/**
 * The static constellation behind the signed-out screens, drawn as SVG exactly
 * as the prototype draws it: dust, edges, blurred halos, cores, then labels.
 */
export default function DemoSky({ showLabels = true, dim = false, className, style }) {
  const g = useMemo(() => demoSky(), []);

  const nodes = dim ? g.nodes.map((n) => ({ ...n, c: `${n.c}55`, haloC: `${n.c}12` })) : g.nodes;
  const edges = dim ? g.edges.map((e) => ({ ...e, c: fade(e.c) })) : g.edges;
  const labels = useMemo(() => (showLabels && !dim ? demoLabels(g.nodes) : []), [g, showLabels, dim]);

  return (
    <div
      className={className}
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        background: 'radial-gradient(120% 90% at 30% 20%, #1c1f31 0%, #161826 55%, #121423 100%)',
        ...style
      }}
    >
      <svg
        viewBox="0 0 1440 900"
        preserveAspectRatio="none"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
      >
        <g>
          {g.dust.map((d, i) => (
            <circle key={i} cx={d.x} cy={d.y} r={d.r} fill={d.c} />
          ))}
        </g>
        <g>
          {edges.map((e, i) => (
            <line key={i} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} stroke={e.c} strokeWidth={e.w} />
          ))}
        </g>
        <g style={{ filter: 'blur(9px)' }}>
          {nodes.map((n, i) => (
            <circle key={i} cx={n.x} cy={n.y} r={n.halo} fill={n.haloC} />
          ))}
        </g>
        <g>
          {nodes.map((n, i) => (
            <circle key={i} cx={n.x} cy={n.y} r={n.r} fill={n.c} />
          ))}
        </g>
      </svg>

      {labels.map((l, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: l.left,
            top: l.top,
            font: '400 11.5px/1.3 Inter, system-ui, sans-serif',
            letterSpacing: '0.01em',
            whiteSpace: 'nowrap',
            color: 'rgba(233,233,237,0.6)',
            pointerEvents: 'none'
          }}
        >
          {l.text}
        </div>
      ))}
    </div>
  );
}
