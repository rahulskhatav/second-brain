import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckIcon, InfoIcon, LinkIcon } from '../components/Icons.jsx';
import TopBar from '../components/TopBar.jsx';
import { api } from '../lib/api.js';
import { takePendingLink } from '../lib/pending.js';

const STAGES = [
  { key: 'fetching', name: 'Fetching', what: 'Page pulled, boilerplate stripped', at: 22 },
  { key: 'reading', name: 'Reading', what: 'Writing your hundred words', at: 64 },
  { key: 'connecting', name: 'Connecting', what: 'Finding its neighbours', at: 88 }
];

const sinceWords = (iso) => {
  if (!iso) return null;
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
};

export default function Home() {
  const navigate = useNavigate();
  const [url, setUrl] = useState('');
  const [active, setActive] = useState(null); // the article being ingested
  const [failure, setFailure] = useState(null);
  const [pasting, setPasting] = useState(false);
  const [pastedText, setPastedText] = useState('');
  const [library, setLibrary] = useState({ articles: [], tags: [], clusters: [], lastAddedAt: null });
  const pollRef = useRef(null);

  const loadLibrary = useCallback(() => {
    api.articles().then(setLibrary).catch(() => {});
  }, []);

  useEffect(loadLibrary, [loadLibrary]);

  /* Poll the row until the pipeline lets go of it. */
  useEffect(() => {
    if (!active || ['ready', 'failed'].includes(active.status)) return undefined;
    pollRef.current = setTimeout(async () => {
      try {
        const { article } = await api.article(active.id);
        setActive(article);
        if (article.status === 'ready') {
          loadLibrary();
          setTimeout(() => navigate(`/sky?focus=${article.id}`), 900);
        }
        if (article.status === 'failed') setFailure(article);
      } catch {
        setFailure({ error: 'We lost track of that one. Try it again.' });
        setActive(null);
      }
    }, 800);
    return () => clearTimeout(pollRef.current);
  }, [active, loadLibrary, navigate]);

  /**
   * Create the row, then kick off the reading.
   *
   * The run request is deliberately not awaited: it stays open for as long as
   * the reading takes, while the poll above watches the row move through its
   * stages. If another article is already being read the server answers 409 and
   * we come back to it — they're read one at a time so the tags line up.
   */
  const runUntilAccepted = useCallback(async (id) => {
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        await api.runArticle(id);
        return;
      } catch (err) {
        if (err.status !== 409) throw err;
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }, []);

  const submit = useCallback(
    async (payload) => {
      setFailure(null);
      try {
        const { article } = await api.addArticle(payload);
        setActive(article);
        setUrl('');
        setPasting(false);
        setPastedText('');
        runUntilAccepted(article.id).catch((err) =>
          setFailure({ error: err.message, errorKind: 'reader' })
        );
      } catch (err) {
        setFailure({ error: err.message });
      }
    },
    [runUntilAccepted]
  );

  // A link pasted on the landing page before signing up gets read first.
  useEffect(() => {
    const pending = takePendingLink();
    if (pending) submit({ url: pending });
  }, [submit]);

  const stageIndex = STAGES.findIndex((s) => s.key === active?.status);
  const progress = active?.status === 'ready' ? 100 : (STAGES[stageIndex]?.at ?? 8);

  const cloud = useMemo(() => {
    const max = library.tags[0]?.count ?? 1;
    const clusterNames = new Set(library.clusters.map((c) => c.name));
    return library.tags.slice(0, 18).map(({ name, count }) => {
      const t = count / max;
      const size = 13 + t * 21;
      const isCluster = clusterNames.has(name);
      const color = isCluster
        ? library.clusters.find((c) => c.name === name)?.color ?? 'var(--color-accent-400)'
        : `rgba(233,233,237,${(0.4 + t * 0.46).toFixed(2)})`;
      return { name, count, size, color, weight: size > 24 ? 500 : 400 };
    });
  }, [library]);

  const readyCount = library.articles.filter((a) => a.status === 'ready').length;
  const ingesting = active && !['ready', 'failed'].includes(active.status);

  return (
    <div className="page page-app">
      <TopBar />

      <section className="home-hero">
        {ingesting || active?.status === 'ready' ? (
          <>
            <h1>
              {active.status === 'ready'
                ? "It's yours now"
                : active.status === 'queued'
                  ? 'It’s in the queue'
                  : "Hang on, we're reading it"}
            </h1>
            <p>
              {active.status === 'ready'
                ? 'Hung in your sky, next to the things it belongs with.'
                : active.status === 'queued'
                  ? 'Waiting on the one before it — they’re read one at a time so the tags line up. You can close this tab.'
                  : "Ten seconds or so. You can close this tab — it'll finish without you."}
            </p>

            <div className="ingest">
              <div className="ingest-url">
                <LinkIcon size={13} color="rgba(233,233,237,.4)" />
                <span>{active.site ?? active.url}</span>
              </div>
              <div className="ingest-bar">
                <div style={{ width: `${progress}%` }} />
              </div>
              <div className="ingest-stages">
                {STAGES.map((stage, i) => {
                  const done = active.status === 'ready' || i < stageIndex;
                  const current = i === stageIndex;
                  return (
                    <div
                      key={stage.key}
                      className={`ingest-stage${current ? ' is-active' : ''}${!done && !current ? ' is-waiting' : ''}`}
                    >
                      {done ? <CheckIcon /> : current ? <span className="stage-spinner" /> : <span className="stage-dot" />}
                      <div>
                        <div className="name">{stage.name}</div>
                        <div className="what">{stage.what}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        ) : (
          <>
            <h1>What did you read today?</h1>
            <p>One link at a time. It takes about ten seconds and then it's yours forever.</p>
            <form
              className="home-paste"
              onSubmit={(e) => {
                e.preventDefault();
                if (url.trim()) submit({ url: url.trim() });
              }}
            >
              <div className="input">
                <LinkIcon size={16} color="rgba(233,233,237,.4)" />
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://"
                  aria-label="Article link"
                  autoFocus
                />
              </div>
              <button className="btn btn-primary" style={{ minHeight: 48, paddingInline: 22 }} type="submit">
                Remember it
              </button>
            </form>
            <div className="home-note">
              Behind a paywall or a login?{' '}
              <a
                href="#paste"
                onClick={(e) => {
                  e.preventDefault();
                  setPasting((p) => !p);
                }}
              >
                Paste the text instead
              </a>
              .
            </div>
          </>
        )}

        {pasting && !ingesting && (
          <form
            className="paste-text-area"
            onSubmit={(e) => {
              e.preventDefault();
              if (pastedText.trim()) submit({ url: url.trim() || null, text: pastedText });
            }}
          >
            <textarea
              className="input"
              value={pastedText}
              onChange={(e) => setPastedText(e.target.value)}
              placeholder="Paste the article text here. The link, if you have it, stays attached."
              aria-label="Article text"
            />
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-primary" type="submit">
                Remember it
              </button>
              <button className="btn btn-ghost" type="button" onClick={() => setPasting(false)}>
                Never mind
              </button>
            </div>
          </form>
        )}

        {failure && (
          <div className="notice">
            <InfoIcon style={{ marginTop: 2 }} />
            <div>
              <div className="title">
                {failure.errorKind === 'reader' ? "The reader isn't answering" : "Last one wouldn't open"}
              </div>
              <div className="body">
                {failure.error}
                {failure.errorKind !== 'reader' && ' Paste the article text instead — the link stays attached.'}
              </div>
              {/* Pasting the text only helps when it was the page that failed. */}
              {failure.errorKind !== 'reader' && (
                <button
                  className="btn btn-secondary"
                  style={{ marginTop: 12, fontSize: 13 }}
                  onClick={() => {
                    setUrl(failure.url ?? url);
                    setActive(null);
                    setPasting(true);
                  }}
                >
                  Paste the text
                </button>
              )}
            </div>
          </div>
        )}
      </section>

      {readyCount > 0 && (
        <section className="thinking-about">
          <hr className="fade-rule" />
          <div className="thinking-head">
            <h2>What you've been thinking about</h2>
            <span>
              {readyCount} article{readyCount === 1 ? '' : 's'} · {library.clusters.length} cluster
              {library.clusters.length === 1 ? '' : 's'}
              {library.lastAddedAt ? ` · last added ${sinceWords(library.lastAddedAt)}` : ''}
            </span>
          </div>
          <div className="tag-cloud">
            {cloud.map((t) => (
              <button
                key={t.name}
                style={{ fontSize: t.size, color: t.color, fontWeight: t.weight }}
                onClick={() => navigate(`/sky?q=${encodeURIComponent(t.name)}`)}
                title={`${t.count} article${t.count === 1 ? '' : 's'}`}
              >
                {t.name}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
