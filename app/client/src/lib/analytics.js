import posthog from 'posthog-js';

const KEY = import.meta.env.VITE_POSTHOG_KEY?.trim();
const HOST = import.meta.env.VITE_POSTHOG_HOST?.trim() || 'https://us.i.posthog.com';

let live = false;

/**
 * Analytics, off unless a key is configured.
 *
 * Autocapture is deliberately disabled. It records the text of whatever a
 * person clicks, and in this app that text is the titles of things they have
 * read — which is the one thing the product promises is theirs alone. Every
 * event below is written by hand, and none of them carries an article's title,
 * its URL, or what someone searched for.
 */
export function startAnalytics() {
  if (!KEY || live) return;
  posthog.init(KEY, {
    api_host: HOST,
    autocapture: false,
    capture_pageview: false, // sent on navigation instead, so SPA routes register
    capture_pageleave: true,
    disable_session_recording: true,
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
