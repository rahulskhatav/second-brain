import { useCallback, useEffect, useRef, useState } from 'react';
import { track } from './analytics.js';
import { api } from './api.js';

/** The three stages the UI names, and how far along the bar each one sits. */
export const STAGES = [
  { key: 'fetching', name: 'Fetching', what: 'Page pulled, boilerplate stripped', at: 22 },
  { key: 'reading', name: 'Reading', what: 'Writing your hundred words', at: 64 },
  { key: 'connecting', name: 'Connecting', what: 'Finding its neighbours', at: 88 }
];

/**
 * Reading one article, from either screen.
 *
 * Two requests, not one: `POST /articles` creates the row and returns, then the
 * run request does the reading and stays open for as long as that takes —
 * nothing may keep executing after a response on a serverless host. So the run
 * is fired and left alone while this polls the row for the stage it has
 * reached. A 409 means another article is being read; they go one at a time so
 * each sees the tags already in use, so we wait and ask again.
 */
export function useIngest({ onReady, onExisting } = {}) {
  const [active, setActive] = useState(null);
  const [failure, setFailure] = useState(null);
  const [alreadyHad, setAlreadyHad] = useState(null);
  const pollRef = useRef(null);
  const startedRef = useRef(0);
  const readyRef = useRef(onReady);
  readyRef.current = onReady;
  const onExistingRef = useRef(onExisting);
  onExistingRef.current = onExisting;

  useEffect(() => {
    if (!active || ['ready', 'failed'].includes(active.status)) return undefined;
    pollRef.current = setTimeout(async () => {
      try {
        const { article } = await api.article(active.id);
        setActive(article);
        if (article.status === 'failed') {
          setFailure(article);
          // The kind, never the article: 'page' means it wouldn't open,
          // 'reader' means Gemini did not answer.
          track('article_failed', { kind: article.errorKind ?? 'unknown' });
        }
        if (article.status === 'ready') {
          track('article_ready', { seconds: Math.round((Date.now() - startedRef.current) / 1000) });
          readyRef.current?.(article);
        }
      } catch {
        setFailure({ error: 'We lost track of that one. Try it again.' });
        setActive(null);
      }
    }, 800);
    return () => clearTimeout(pollRef.current);
  }, [active]);

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
      setAlreadyHad(null);
      startedRef.current = Date.now();
      track('article_submitted', { source: payload.text ? 'pasted text' : 'link' });
      try {
        const { article, existing } = await api.addArticle(payload);

        // Already in the sky: nothing to read, nothing to poll. Say so and go
        // to the one that is there.
        if (existing) {
          track('article_already_had');
          setAlreadyHad(article);
          onExistingRef.current?.(article);
          return article;
        }

        setActive(article);
        // Deliberately not awaited — this request *is* the reading.
        runUntilAccepted(article.id).catch((err) =>
          setFailure({ error: err.message, errorKind: 'reader' })
        );
        return article;
      } catch (err) {
        setFailure({ error: err.message });
        return null;
      }
    },
    [runUntilAccepted]
  );

  const reset = useCallback(() => {
    clearTimeout(pollRef.current);
    setActive(null);
    setFailure(null);
    setAlreadyHad(null);
  }, []);

  const stageIndex = STAGES.findIndex((s) => s.key === active?.status);
  const busy = Boolean(active) && !['ready', 'failed'].includes(active.status);

  return {
    active,
    alreadyHad,
    failure,
    setFailure,
    submit,
    reset,
    busy,
    stageIndex,
    progress: active?.status === 'ready' ? 100 : (STAGES[stageIndex]?.at ?? 8)
  };
}
