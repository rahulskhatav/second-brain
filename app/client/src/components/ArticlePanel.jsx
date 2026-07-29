import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { CloseIcon, OpenIcon } from './Icons.jsx';

const addedOn = (iso) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });

/** The node you clicked, opened: the hundred words, its tags, and its neighbours. */
export default function ArticlePanel({ id, onClose, onSelect, onForget }) {
  const [article, setArticle] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    setArticle(null);
    api
      .article(id)
      .then((d) => live && setArticle(d.article))
      .catch(() => live && setArticle(null));
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
              {article ? `Added ${addedOn(article.addedAt)}` : 'Opening'}
            </div>
            <h2>{article?.title ?? '…'}</h2>
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
          {article?.summary ?? 'Fetching the hundred words…'}
        </div>

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
            disabled={busy}
          >
            {busy ? 'Forgetting…' : 'Forget this'}
          </button>
        </div>
      </aside>
    </>
  );
}
