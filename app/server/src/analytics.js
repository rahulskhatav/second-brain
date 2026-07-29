import { PostHog } from 'posthog-node';

const KEY = process.env.POSTHOG_KEY?.trim();
const HOST = process.env.POSTHOG_HOST?.trim() || 'https://us.i.posthog.com';

/**
 * Server-side events, off unless a key is configured.
 *
 * Worth having separately from the browser's, because the part of this app most
 * worth measuring — whether an article actually got read, how long it took, why
 * it failed — happens here. The browser only ever sees the polling.
 *
 * Batching is disabled. On a serverless host the process is frozen the moment
 * the response is sent, so anything still sitting in a queue is simply lost;
 * each event is sent as it is captured and awaited before the handler returns.
 */
const client = KEY ? new PostHog(KEY, { host: HOST, flushAt: 1, flushInterval: 0 }) : null;

/** Never throws and never delays the caller by more than a moment. */
export async function record(userId, event, properties = {}) {
  if (!client) return;
  try {
    client.capture({ distinctId: String(userId), event, properties });
    await client.flush();
  } catch {
    /* analytics must never be the reason an article fails to be read */
  }
}

export const analyticsEnabled = () => Boolean(client);
