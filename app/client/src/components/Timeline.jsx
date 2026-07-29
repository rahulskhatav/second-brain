import { useEffect, useMemo } from 'react';
import { CloseIcon } from './Icons.jsx';

const DAY = 86400000;

const startOfDay = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

/** Monday. Weeks that start on Sunday make "last week" mean two different things. */
const startOfWeek = (d) => {
  const x = startOfDay(d);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
};

const dayMonth = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
const clockTime = (d) => new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

/**
 * Everything you've read, newest first: today, then the last three days, then a
 * heading a week. Close enough to remember, far enough to have forgotten.
 */
export function groupByAge(articles, now = new Date()) {
  const today = startOfDay(now);
  const recent = new Date(today.getTime() - 3 * DAY); // the three days before today
  const groups = [];
  const put = (label, key, article) => {
    let g = groups.find((x) => x.key === key);
    if (!g) groups.push((g = { key, label, articles: [] }));
    g.articles.push(article);
  };

  for (const a of [...articles].sort((x, y) => new Date(y.addedAt) - new Date(x.addedAt))) {
    const when = new Date(a.addedAt);
    if (when >= today) put('Today', 'today', a);
    else if (when >= recent) put('Last 3 days', 'recent', a);
    else {
      const week = startOfWeek(when);
      const thisWeek = startOfWeek(now);
      const weeksBack = Math.round((thisWeek - week) / (7 * DAY));
      const label =
        weeksBack === 1 ? 'Last week' : `Week of ${dayMonth(week)}`;
      put(label, `w${week.getTime()}`, a);
    }
  }
  return groups;
}

export default function Timeline({ articles, selectedId, onSelect, onClose }) {
  const groups = useMemo(() => groupByAge(articles), [articles]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const ready = articles.filter((a) => a.status === 'ready').length;

  return (
    <aside className="timeline glass" aria-label="Everything you've read">
      <div className="timeline-head">
        <div>
          <div className="kicker-quiet">In order</div>
          <h2>
            {ready} article{ready === 1 ? '' : 's'}
          </h2>
        </div>
        <button className="panel-close" onClick={onClose} aria-label="Close">
          <CloseIcon />
        </button>
      </div>

      <div className="timeline-scroll">
        {groups.length === 0 && <p className="timeline-empty">Nothing yet. Add the last thing you read.</p>}

        {groups.map((group) => (
          <section key={group.key} className="timeline-group">
            <div className="timeline-when">
              <span>{group.label}</span>
              <span className="timeline-count">{group.articles.length}</span>
            </div>
            {group.articles.map((a) => (
              <button
                key={a.id}
                className={`timeline-item${a.id === selectedId ? ' is-current' : ''}`}
                onClick={() => a.status === 'ready' && onSelect(a.id)}
                disabled={a.status !== 'ready'}
              >
                <span className="timeline-time">{clockTime(a.addedAt)}</span>
                <span className="timeline-body">
                  <span className="timeline-title">{a.title}</span>
                  {a.status === 'ready' ? (
                    !!a.tags.length && <span className="timeline-tags">{a.tags.slice(0, 3).join(' · ')}</span>
                  ) : (
                    <span className="timeline-status">
                      {a.status === 'failed' ? (a.error ?? 'Failed') : 'Still reading…'}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </section>
        ))}
      </div>
    </aside>
  );
}
