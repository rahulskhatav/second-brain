import posthog from 'posthog-js';

const KEY = import.meta.env.VITE_POSTHOG_KEY?.trim();
const HOST = import.meta.env.VITE_POSTHOG_HOST?.trim() || 'https://us.i.posthog.com';

let live = false;

/**
 * Analytics, off unless a key is configured.
 *
 * Autocapture and replay are on, but never over the parts of the screen that
 * show what someone has read — those are the one thing the product promises is
 * theirs alone. Two classes do that work, and any new component showing a
 * title, a URL or a summary needs them:
 *
 *   ph-no-autocapture   the element and everything under it is not autocaptured
 *   ph-mask             its text is replaced with dots in a session replay
 *
 * The hand-written events below carry neither titles, URLs, nor search terms,
 * and that stays true regardless of what autocapture picks up.
 */
export function startAnalytics() {
  if (!KEY || live) return;
  posthog.init(KEY, {
    api_host: HOST,
    autocapture: true,
    capture_pageview: false, // sent on navigation instead, so SPA routes register
    capture_pageleave: true,
    capture_performance: true, // per-request timings, in the replay's network tab
    session_recording: {
      maskAllInputs: true, // the link box, the paste area, search, passwords
      maskTextSelector: '.ph-mask',
      /* The sky is a canvas, and without this every replay of the main screen
         plays back as a blank rectangle. The cost is that node labels are
         recorded — the one place replay sees what someone has read. The low
         frame rate and quality are for file size; they are not a privacy
         measure. Drop recordCanvas to false if that trade stops being worth it. */
      captureCanvas: { recordCanvas: true, canvasFps: 3, canvasQuality: '0.4' }
    },
    person_profiles: 'identified_only'
  });
  live = true;
}

export const track = (event, properties) => {
  if (live) posthog.capture(event, properties);
};

/** After signing in, so a person's sessions join up across visits. */
export const identify = (user) => {
  if (!live || !user) return;
  posthog.identify(String(user.id), { username: user.username, created_at: user.createdAt });
};

/** On the way out — the next person at this browser is not the last one. */
export const forgetPerson = () => {
  if (live) posthog.reset();
};

export const trackPageview = (path) => {
  if (live) posthog.capture('$pageview', { $current_url: window.location.origin + path, path });
};
