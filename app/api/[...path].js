/**
 * The Vercel entry point — a catch-all, so every /api/* request lands here.
 *
 * An Express app is already a (req, res) handler, so the runtime can call it
 * directly. This is a filesystem route rather than a rewrite on purpose: a
 * rewrite pointing at a single /api function can hand the function the
 * rewritten path instead of the original, and then every route below /api
 * stops matching. A catch-all preserves /api/auth/login as written.
 */
export { app as default } from '../server/src/app.js';
