import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import express from 'express';
import { authRouter, requireAuth, sessionUser } from './auth.js';
import { api } from './routes.js';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The Express app, with no listener attached.
 *
 * Locally `index.js` calls listen(); on Vercel `api/index.js` hands this
 * straight to the serverless runtime, which is why the two are separate.
 */
export const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1); // behind Vercel's proxy, for secure-cookie detection
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser(process.env.SESSION_SECRET || 'second-brain-dev-secret'));
app.use(sessionUser);

app.use('/api/auth', authRouter);
app.use('/api', (req, res, next) => (req.path === '/status' ? next() : requireAuth(req, res, next)), api);

// Only for `npm start` — on Vercel the built client is served as static files.
const dist = resolve(here, '../../client/dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(resolve(dist, 'index.html'));
  });
}

app.use((req, res) => res.status(404).json({ error: `No route ${req.method} ${req.path}` }));

app.use((err, _req, res, _next) => {
  console.error(err);
  const missingDb = /DATABASE_URL|POSTGRES_URL/.test(String(err?.message));
  res.status(500).json({
    error: missingDb ? 'The database is not configured.' : 'Something went wrong on our side.',
    // Postgres' own five-character code, which says what went wrong without
    // saying anything about the data. Diagnosing a failure that only happens on
    // the deployment is otherwise guesswork against logs you may not have open.
    code: err?.code ?? undefined,
    // TEMPORARY, while a failure that only reproduces on the deployment is
    // being chased. Remove before this is in front of anyone: an error message
    // can name internals, and this deployment is public.
    detail: String(err?.message ?? '').slice(0, 300) || undefined
  });
});
