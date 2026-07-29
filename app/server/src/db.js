import pg from 'pg';

/**
 * Postgres, because the app runs on Vercel.
 *
 * Serverless has no durable filesystem — a SQLite file written by one
 * invocation is gone by the next — so the database has to live outside the
 * function. Vercel Postgres (Neon) provisions POSTGRES_URL; anything speaking
 * Postgres works via DATABASE_URL.
 *
 * One connection per instance: a serverless platform can run many instances at
 * once, and a large pool in each is how you exhaust a database's connection
 * limit. Use the *pooled* connection string.
 */
const connectionString =
  process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL;

if (!connectionString) {
  throw new Error(
    'No database. Set DATABASE_URL (or POSTGRES_URL) — locally in app/.env, on Vercel in the project env vars.'
  );
}

const pool = new pg.Pool({
  connectionString,
  max: 1,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 10000,
  // Hosted Postgres terminates TLS at the pooler with a certificate the
  // platform, not the system store, vouches for.
  ssl: /localhost|127\.0\.0\.1/.test(connectionString) ? false : { rejectUnauthorized: false }
});

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    username      TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users (LOWER(username));

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS articles (
    id         SERIAL PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    url        TEXT,
    site       TEXT,
    title      TEXT NOT NULL,
    summary    TEXT,
    source_text TEXT,
    tags       TEXT NOT NULL DEFAULT '[]',
    embedding  TEXT,
    status     TEXT NOT NULL,
    error      TEXT,
    error_kind TEXT,
    x          DOUBLE PRECISION,
    y          DOUBLE PRECISION,
    added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ
  );

  CREATE INDEX IF NOT EXISTS idx_articles_user ON articles(user_id);
`;

/* Run once per instance rather than once per request — concurrent cold starts
   can race here, and CREATE ... IF NOT EXISTS is idempotent under that race. */
let ready = null;
const ensureSchema = () => (ready ??= pool.query(SCHEMA).catch((err) => {
  ready = null; // let the next request retry rather than poisoning the instance
  throw err;
}));

export async function query(text, params = []) {
  await ensureSchema();
  return pool.query(text, params);
}

/** One row or undefined. */
export async function one(text, params = []) {
  const { rows } = await query(text, params);
  return rows[0];
}

/** Every row. */
export async function all(text, params = []) {
  const { rows } = await query(text, params);
  return rows;
}

export const now = () => new Date().toISOString();
