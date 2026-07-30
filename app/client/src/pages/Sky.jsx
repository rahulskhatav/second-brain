import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import AddLink from '../components/AddLink.jsx';
import ArticlePanel from '../components/ArticlePanel.jsx';
import Constellation from '../components/Constellation.jsx';
import Dust from '../components/Dust.jsx';
import { CrosshairIcon, HistoryIcon, MinusIcon, PlusIcon, SearchIcon } from '../components/Icons.jsx';
import Mark from '../components/Mark.jsx';
import ProfileMenu from '../components/ProfileMenu.jsx';
import Timeline from '../components/Timeline.jsx';
import { track } from '../lib/analytics.js';
import { api } from '../lib/api.js';
import { useIngest } from '../lib/useIngest.js';

const day = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

export default function Sky() {
  const [params, setParams] = useSearchParams();

  const [graph, setGraph] = useState({ nodes: [], links: [], clusters: [] });
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [results, setResults] = useState([]);
  const [selectedId, setSelectedId] = useState(params.get('focus') ? Number(params.get('focus')) : null);
  const [adding, setAdding] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const [articles, setArticles] = useState([]);
  const skyRef = useRef(null);

  const load = useCallback(
    () =>
      Promise.all([
        api.graph().then(setGraph),
        // The timeline wants everything, including what is still being read.
        api.articles().then((d) => setArticles(d.articles))
      ])
        .catch(() => {})
        .finally(() => setLoading(false)),
    []
  );

  useEffect(() => {
    load();
  }, [load]);

  /* Search runs against the summaries and tags; the sky stays put behind it. */
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return undefined;
    }
    const controller = new AbortController();
    const t = setTimeout(() => {
      api
        .search(q, controller.signal)
        .then((d) => {
          setResults(d.results);
          // How long it was and whether it found anything — never the words.
          track('search_run', { length: q.length, results: d.results.length });
        })
        .catch(() => {});
    }, 160);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [query]);

  const searching = query.trim().length >= 2;
  const highlightIds = useMemo(
    () => (searching ? new Set(results.map((r) => r.id)) : null),
    [searching, results]
  );

  const saveLayout = useCallback((positions) => {
    api.saveLayout(positions).catch(() => {});
  }, []);

  const select = useCallback(
    (id) => {
      setSelectedId(id);
      setParams(id ? { focus: String(id) } : {}, { replace: true });
      if (id) {
        skyRef.current?.centerOn(id);
        track('article_opened'); // that one was opened, not which one
      }
    },
    [setParams]
  );

  // Adding without leaving the map: when it lands, the sky reloads underneath
  // the panel and the new article is the one selected.
  const ingest = useIngest({
    onReady: (article) => {
      load().then(() => select(article.id));
    },
    // Already in the sky — go and open it rather than reading it again.
    onExisting: (article) => select(article.id)
  });

  const openFromSearch = (id) => {
    setQuery('');
    select(id);
  };

  const closeAdd = useCallback(() => {
    setAdding(false);
    ingest.reset();
  }, [ingest]);

  const isEmpty = !loading && graph.nodes.length === 0;
  const linkCount = graph.links.length;

  return (
    <div className="sky">
      {isEmpty ? (
        <>
          <Dust />
          <div className="empty">
            <div className="empty-orbit">
              <div className="ring" />
              <div className="ring-in" />
              <div className="core" />
            </div>
            <h1>One star so far</h1>
            <p>
              Your sky starts empty and that's fine. Add the last thing you read and come back tomorrow —
              connections need two.
            </p>
            <button
              className="btn btn-primary"
              style={{ marginTop: 22, minHeight: 42, paddingInline: 22 }}
              onClick={() => setAdding(true)}
            >
              Add your first link
            </button>
          </div>
        </>
      ) : (
        <Constellation
          ref={skyRef}
          data={graph}
          dim={searching}
          showLabels={!searching}
          selectedId={selectedId}
          highlightIds={highlightIds}
          onSelect={select}
          onLayoutSettled={saveLayout}
        />
      )}

      {searching && <div className="sky-veil" />}

      <div className="sky-tl">
        <div className="glass sky-brand">
          <Mark to="/home" size={12} glow={10} />
        </div>
        {!isEmpty && (
          <div className={`glass sky-search${searching ? ' is-active' : ''}`}>
            <SearchIcon color={searching ? '#9184d9' : 'rgba(233,233,237,.45)'} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Look for something…"
              aria-label="Search your sky"
              onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
            />
            {searching && <span className="found">{results.length} found</span>}
          </div>
        )}
      </div>

      <div className="sky-tr">
        <button
          className={`btn btn-primary sky-add${adding ? ' is-open' : ''}`}
          onClick={() => (adding ? closeAdd() : setAdding(true))}
          aria-expanded={adding}
        >
          <PlusIcon />
          Add a link
        </button>
        <ProfileMenu className="sky-avatar" />
      </div>

      {adding && <AddLink ingest={ingest} onClose={closeAdd} />}

      {showTimeline && (
        <Timeline
          articles={articles}
          selectedId={selectedId}
          onSelect={(id) => {
            setQuery('');
            select(id);
          }}
          onClose={() => setShowTimeline(false)}
        />
      )}

      {!isEmpty && (
        <>
          <div className="sky-bl">
            <div className="glass zoom-group">
              <button onClick={() => skyRef.current?.zoomIn()} aria-label="Zoom in">
                <PlusIcon size={15} />
              </button>
              <div className="sep" />
              <button onClick={() => skyRef.current?.zoomOut()} aria-label="Zoom out">
                <MinusIcon size={15} />
              </button>
              <div className="sep" />
              <button onClick={() => skyRef.current?.fit()} aria-label="Fit the whole sky">
                <CrosshairIcon />
              </button>
              <div className="sep" />
              <button
                className={showTimeline ? 'is-on' : ''}
                onClick={() =>
                  setShowTimeline((v) => {
                    if (!v) track('timeline_opened', { articles: articles.length });
                    return !v;
                  })
                }
                aria-label="Everything you've read, in order"
                aria-pressed={showTimeline}
                title="Everything you've read, in order"
              >
                <HistoryIcon />
              </button>
            </div>
            <div className="glass sky-count">
              <span>
                {graph.nodes.length} article{graph.nodes.length === 1 ? '' : 's'}
              </span>
              <span style={{ opacity: 0.4 }}>·</span>
              <span>
                {linkCount} connection{linkCount === 1 ? '' : 's'}
              </span>
            </div>
          </div>

          {graph.clusters.length > 0 && (
            <div className="sky-br glass legend">
              <div className="kicker-quiet">Clusters</div>
              {graph.clusters.map((c) => (
                <button key={c.name} onClick={() => setQuery(c.name)} title={`Search for ${c.name}`}>
                  <span className="swatch" style={{ background: c.color }} />
                  <span className="name">{c.name}</span>
                  <span className="count">{c.count}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {searching && (
        <div className="results-wrap">
          <div className="results">
            <div className="kicker-quiet">
              {results.length === 0
                ? 'Nothing you’ve read matches that'
                : `${results.length} thing${results.length === 1 ? '' : 's'} you've read about this`}
            </div>
            {results.map((r, i) => (
              <div key={r.id}>
                {i > 0 && <hr className="fade-rule" />}
                <button className={`result${i === 0 ? ' is-top' : ''}`} onClick={() => openFromSearch(r.id)}>
                  <div className="line">
                    <h3>{r.title}</h3>
                    <span className="when">{day(r.addedAt)}</span>
                  </div>
                  <p>{r.summary}</p>
                  <div className="tags">
                    {r.tags.slice(0, 2).map((t, ti) => (
                      <span key={t} className={`tag ${ti === 0 && i === 0 ? 'tag-accent' : 'tag-neutral'}`}>
                        {t}
                      </span>
                    ))}
                  </div>
                </button>
              </div>
            ))}
            <div className="results-foot">Clear the field to put the sky back — nothing moves.</div>
          </div>
        </div>
      )}

      {selectedId && !searching && !adding && (
        <ArticlePanel
          id={selectedId}
          onClose={() => select(null)}
          onSelect={select}
          onForget={(id) => {
            select(null);
            setGraph((g) => ({
              ...g,
              nodes: g.nodes.filter((n) => n.id !== id),
              links: g.links.filter((l) => l.source !== id && l.target !== id)
            }));
            load();
          }}
        />
      )}
    </div>
  );
}
