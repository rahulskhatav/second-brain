import { Link } from 'react-router-dom';

/** The lit node and the wordmark. Sizes are the design's, per screen. */
export default function Mark({ to = '/', size = 13, glow = 11, spread = 3, className = '', style }) {
  return (
    <Link to={to} className={`mark ${className}`} style={style} aria-label="Second Brain">
      <span
        className="mark-dot"
        style={{
          width: size,
          height: size,
          boxShadow: `0 0 ${glow}px ${spread}px rgba(145,132,217,.5)`
        }}
      />
      <span className="mark-name">Second Brain</span>
    </Link>
  );
}
