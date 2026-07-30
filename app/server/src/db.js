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
const SOURCES = ['DATABASE_URL', 'POSTGRES_URL', 'POSTGRES_PRISMA_URL'];

/** Which variable supplied the connection — the name only, never the value. */
export const connectionSource = SOURCES.find((name) => process.env[name]?.trim()) ?? null;
const connectionString = connectionSource ? process.env[connectionSource] : null;

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
    label      TEXT,                          -- at most three words, for the map
    sections   TEXT,                          -- JSON: [{ heading, points[] }]
    kind       TEXT NOT NULL DEFAULT 'article', -- 'article' or 'video'
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

  -- Added after the first deployment; databases created before it get it here.
  ALTER TABLE articles ADD COLUMN IF NOT EXISTS label TEXT;
  ALTER TABLE articles ADD COLUMN IF NOT EXISTS sections TEXT;
  ALTER TABLE articles ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'article';
  ALTER TABLE articles ADD COLUMN IF NOT EXISTS url_key TEXT;
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

/**
 * Can this connection actually write?
 *
 * Reads succeeding while writes fail is what a replica or a read-only endpoint
 * looks like from the application's side, and it is invisible in a connection
 * string. Both checks are themselves reads, so they are safe to run anywhere.
 */
export async function connectionHealth() {
  try {
    const { rows } = await query(
      "SELECT pg_is_in_recovery() AS replica, current_setting('transaction_read_only') AS read_only, current_database() AS db"
    );
    return {
      source: connectionSource,
      database: rows[0]?.db ?? null,
      replica: rows[0]?.replica === true,
      readOnly: rows[0]?.read_only === 'on'
    };
  } catch (err) {
    return { source: connectionSource, error: err?.code ?? 'unreachable' };
  }
}

export const now = () => new Date().toISOString();
