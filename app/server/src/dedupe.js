import { all, query } from './db.js';
import { urlKey } from './extract.js';

/**
 * Makes the same link twice impossible, once.
 *
 * Runs one time per instance: fills in url_key for everything added before
 * there was one, deletes the duplicates that got in meanwhile, and then puts a
 * unique index across (user_id, url_key) so the database refuses the next one
 * rather than relying on the application to remember to check.
 *
 * The index has to come last — Postgres will not create it while duplicates are
 * still there, which is exactly the behaviour we want as a guarantee.
 */
let done = null;
export const ensureNoDuplicates = () => (done ??= run().catch((err) => {
  done = null; // a failure here must not permanently wedge the instance
  throw err;
}));

async function run() {
  // 1 — key everything that has a URL and no key yet.
  const unkeyed = await all('SELECT id, url FROM articles WHERE url IS NOT NULL AND url_key IS NULL');
  for (const row of unkeyed) {
    let key = null;
    try {
      key = urlKey(new URL(row.url));
    } catch {
      key = null; // an unparseable URL is left unkeyed rather than guessed at
    }
    if (key) await query('UPDATE articles SET url_key = $1 WHERE id = $2', [key, row.id]);
  }

  /* 2 — of each set of duplicates, keep one: a finished read over an unfinished
     one, and the earliest of those. Deleting the newer copies keeps whatever
     position the sky has already learned for the original. */
  const { rowCount: removed } = await query(`
    DELETE FROM articles WHERE id IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (
          PARTITION BY user_id, url_key
          ORDER BY (status = 'ready') DESC, added_at ASC, id ASC
        ) AS copy
        FROM articles
        WHERE url_key IS NOT NULL
      ) ranked WHERE copy > 1
    )
  `);

  // 3 — and now it cannot happen again.
  await query(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_user_url ON articles (user_id, url_key) WHERE url_key IS NOT NULL'
  );

  if (unkeyed.length || removed) {
    console.log(`  deduped: keyed ${unkeyed.length} article(s), removed ${removed} duplicate(s)`);
  }
  return { keyed: unkeyed.length, removed };
}
