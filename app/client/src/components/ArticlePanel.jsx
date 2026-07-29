import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { CloseIcon, OpenIcon } from './Icons.jsx';

const addedOn = (iso) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });

/** The node you clicked, opened: the hundred words, its tags, and its neighbours. */
export default function ArticlePanel({ id, onClose, onSelect, onForget }) {
  const [article, setArticle] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    setArticle(null);
    setError(null);
    api
      .article(id)
      .then((d) => live && setArticle(d.article))
      .catch((err) => {
        // Without this the panel sits on "Fetching the hundred words…" for
        // ever — which is what a link to an article since forgotten does.
        if (!live) return;
        setError(err.status === 404 ? "That one isn't in your sky any more." : err.message);
      });
    return () => {
      live = false;
    };
  }, [id]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const forget = async () => {
    setBusy(true);
    try {
      await api.forget(id);
      onForget?.(id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="panel-scrim" />
      <aside className="panel" aria-label="Article">
        <div className="panel-head">
          <div style={{ flex: 1 }}>
            <div className="kicker-quiet" style={{ color: 'var(--color-accent)', marginBottom: 12 }}>
              {error ? 'Nothing here' : article ? `Added ${addedOn(article.addedAt)}` : 'Opening'}
            </div>
            <h2>{error ? 'Gone' : (article?.title ?? '…')}</h2>
          </div>
          <button className="panel-close" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>

        {article?.url && (
          <div className="panel-link">
            <a href={article.url} target="_blank" rel="noreferrer noopener">
              {article.site}
              <OpenIcon />
            </a>
          </div>
        )}

        <div className="panel-rule">
          <hr className="fade-rule" />
        </div>

        <div className="panel-summary">
          {error ?? article?.summary ?? 'Fetching the hundred words…'}
        </div>

        {/* The detail, in buckets — a wall of prose is not something anyone
            rereads, and the headings are fixed so every article reads alike. */}
        {article?.sections?.map((section) => (
          <section key={section.heading} className="panel-section">
            <div className="kicker-quiet">{section.heading}</div>
            <ul>
              {section.points.map((point, i) => (
                <li key={i}>{point}</li>
              ))}
            </ul>
          </section>
        ))}

        {!!article?.tags?.length && (
          <div className="panel-tags">
            {article.tags.map((t, i) => (
              <span key={t} className={`tag ${i === 0 ? 'tag-accent' : 'tag-neutral'}`}>
                {t}
              </span>
            ))}
          </div>
        )}

        {!!article?.neighbours?.length && (
          <>
            <div className="panel-rule" style={{ paddingTop: 24 }}>
              <hr className="fade-rule" />
            </div>
            <div className="panel-near">
              <div className="kicker-quiet" style={{ marginBottom: 12 }}>
                Nearest in your sky
              </div>
              <div className="rows">
                {article.neighbours.map((n) => (
                  <button key={n.id} className="row" onClick={() => onSelect?.(n.id)}>
                    <span className="dot" style={{ background: n.color }} />
                    <span className="t">{n.title}</span>
                    <span className="sim">{n.sim.toFixed(2)}</span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        <div className="panel-actions">
          {error ? (
            <button className="btn btn-secondary" style={{ flex: 1 }} onClick={onClose}>
              Back to the sky
            </button>
          ) : (
            <>
              <a
                className="btn btn-secondary"
                style={{ flex: 1 }}
                href={article?.url ?? '#'}
                target="_blank"
                rel="noreferrer noopener"
              >
                Open the original
              </a>
              <button
                className="btn btn-ghost"
                style={{ color: 'rgba(233,233,237,.5)', paddingInline: 10 }}
                onClick={forget}
                disabled={busy || !article}
              >
                {busy ? 'Forgetting…' : 'Forget this'}
              </button>
            </>
          )}
        </div>
      </aside>
    </>
  );
}
