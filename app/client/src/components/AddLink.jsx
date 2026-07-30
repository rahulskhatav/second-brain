import { useEffect, useRef, useState } from 'react';
import { InfoIcon, LinkIcon } from './Icons.jsx';
import { STAGES } from '../lib/useIngest.js';

/**
 * Adding an article without leaving the sky.
 *
 * The same three stages the intake screen shows, at panel scale — you watch the
 * thing you just pasted arrive in the map behind it.
 */
export default function AddLink({ ingest, onClose }) {
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [pasting, setPasting] = useState(false);
  const inputRef = useRef(null);

  const { active, failure, submit, reset, busy, stageIndex, progress } = ingest;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (busy) return; // don't let Escape hide work in progress
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const send = (e) => {
    e.preventDefault();
    if (pasting ? text.trim() : url.trim()) {
      submit(pasting ? { url: url.trim() || null, text } : { url: url.trim() });
    }
  };

  const done = active?.status === 'ready';

  return (
    <div className="glass add-link" role="dialog" aria-label="Add a link">
      <div className="add-link-head">
        <span className="kicker-quiet">{done ? 'Hung in your sky' : 'Add to your sky'}</span>
        <button className="add-link-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>

      {!active && (
        <form onSubmit={send}>
          {pasting ? (
            <textarea
              ref={inputRef}
              className="input add-link-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste the article text. The link, if you have it, stays attached."
              aria-label="Article text"
            />
          ) : (
            <div className="input add-link-field">
              <LinkIcon size={14} color="rgba(233,233,237,.4)" />
              <input
                ref={inputRef}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="Paste a link, or a YouTube video"
                aria-label="Article link"
              />
            </div>
          )}

          {pasting && (
            <div className="input add-link-field" style={{ marginTop: 8 }}>
              <LinkIcon size={14} color="rgba(233,233,237,.4)" />
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="Original link (optional)"
                aria-label="Original link"
              />
            </div>
          )}

          <div className="add-link-actions">
            <button className="btn btn-primary" type="submit" style={{ flex: 1 }}>
              Remember it
            </button>
          </div>

          <button className="add-link-alt" type="button" onClick={() => setPasting((p) => !p)}>
            {pasting ? 'Have a link instead?' : 'Behind a paywall? Paste the text'}
          </button>
        </form>
      )}

      {active && (
        <>
          <div className="add-link-url">
            <LinkIcon size={12} color="rgba(233,233,237,.4)" />
            <span>{active.site ?? active.url}</span>
          </div>
          <div className="ingest-bar">
            <div style={{ width: `${progress}%` }} />
          </div>

          {active.status === 'queued' && (
            <div className="add-link-note">Waiting on the one before it — they’re read one at a time.</div>
          )}

          {!done && active.status !== 'failed' && (
            <ul className="add-link-stages">
              {STAGES.map((stage, i) => (
                <li
                  key={stage.key}
                  className={i === stageIndex ? 'is-active' : i < stageIndex ? 'is-done' : 'is-waiting'}
                >
                  {stage.name}
                </li>
              ))}
            </ul>
          )}

          {done && <div className="add-link-note">“{active.title}” — it’s in the map behind this.</div>}

          {(done || active.status === 'failed') && (
            <div className="add-link-actions">
              <button
                className="btn btn-secondary"
                style={{ flex: 1 }}
                onClick={() => {
                  reset();
                  setUrl('');
                  setText('');
                }}
              >
                Add another
              </button>
              <button className="btn btn-ghost" onClick={onClose}>
                Done
              </button>
            </div>
          )}
        </>
      )}

      {failure && (
        <div className="add-link-error">
          <InfoIcon size={13} color="currentColor" />
          <span>{failure.error}</span>
        </div>
      )}
    </div>
  );
}
