import { useMemo } from 'react';

/**
 * The star dust behind the sky — 150 specks, seeded so they never move
 * between renders or reloads. Screen space: it doesn't pan or zoom with the
 * graph, it's the room the graph hangs in.
 */
export default function Dust({ seed = 20260728, count = 150 }) {
  const specks = useMemo(() => {
    let s = seed;
    const rnd = () => {
      s |= 0;
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return Array.from({ length: count }, () => ({
      x: +(rnd() * 1440).toFixed(1),
      y: +(rnd() * 900).toFixed(1),
      r: +(0.4 + rnd() * 0.9).toFixed(2),
      c: `rgba(233,233,237,${(0.03 + rnd() * 0.07).toFixed(3)})`
    }));
  }, [seed, count]);

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 1440 900"
      preserveAspectRatio="none"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
    >
      {specks.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r={d.r} fill={d.c} />
      ))}
    </svg>
  );
}
