import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { one, query } from './db.js';

const COOKIE = 'sb_session';
const USERNAME_RE = /^[A-Za-z0-9_-]{3,32}$/;

const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  signed: true,
  maxAge: 1000 * 60 * 60 * 24 * 90,
  path: '/'
};

const publicUser = (u) => ({ id: u.id, username: u.username, createdAt: u.created_at });

/** A new row in sessions, and the token that names it. */
async function newSession(userId) {
  const token = randomBytes(32).toString('hex');
  await query('INSERT INTO sessions (token, user_id) VALUES ($1, $2)', [token, userId]);
  return token;
}

async function issueSession(res, userId) {
  res.cookie(COOKIE, await newSession(userId), cookieOptions);
}

/** The user these credentials belong to, or undefined. */
async function authenticate(username, password) {
  const user = await one('SELECT * FROM users WHERE LOWER(username) = LOWER($1)', [username]);
  return user && bcrypt.compareSync(password, user.password_hash) ? user : undefined;
}

/** The extension's `Authorization: Bearer <token>`, if it sent one. */
const bearerToken = (req) => /^Bearer\s+(.+)$/i.exec(req.get('authorization') ?? '')?.[1];

/**
 * Populates req.user from a session cookie, or from a bearer token.
 *
 * The browser extension has no usable cookie jar for this origin: the session
 * cookie is httpOnly, signed and SameSite=Lax, and a request fired from an
 * extension's service worker is cross-site, so a Lax cookie is withheld. It
 * carries the same session token in a header instead — same table, same row,
 * same lifetime, so nothing about sessions is duplicated.
 */
export async function sessionUser(req, _res, next) {
  try {
    const token = bearerToken(req) ?? req.signedCookies?.[COOKIE];
    if (token) {
      req.user = await one(
        'SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1',
        [token]
      );
    }
    next();
  } catch (err) {
    next(err);
  }
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Log in first.' });
  next();
}

export const authRouter = Router();

authRouter.get('/me', (req, res) => {
  res.json({ user: req.user ? publicUser(req.user) : null });
});

authRouter.post('/register', async (req, res, next) => {
  try {
    const username = String(req.body?.username ?? '').trim();
    const password = String(req.body?.password ?? '');

    if (!USERNAME_RE.test(username))
      return res.status(400).json({ error: '3–32 characters · letters, numbers, dash, underscore', field: 'username' });
    if (password.length < 8)
      return res.status(400).json({ error: 'At least 8 characters', field: 'password' });

    const taken = await one('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [username]);
    if (taken) return res.status(409).json({ error: 'That name is taken. Try another.', field: 'username' });

    const user = await one(
      'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING *',
      [username, bcrypt.hashSync(password, 10)]
    );

    await issueSession(res, user.id);
    res.status(201).json({ user: publicUser(user) });
  } catch (err) {
    // The unique index is the real arbiter — two simultaneous sign-ups with the
    // same name both pass the check above, and one of them lands here.
    if (err?.code === '23505')
      return res.status(409).json({ error: 'That name is taken. Try another.', field: 'username' });
    next(err);
  }
});

// One message for both failure modes — the design shows exactly this string.
const WRONG = 'Incorrect username or password. Please try again.';

authRouter.post('/login', async (req, res, next) => {
  try {
    const username = String(req.body?.username ?? '').trim();
    const password = String(req.body?.password ?? '');
    const user = await authenticate(username, password);
    if (!user) return res.status(401).json({ error: WRONG });

    await issueSession(res, user.id);
    res.json({ user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

/**
 * Signing in from somewhere with no cookie jar — the browser extension.
 *
 * The same credentials and the same sessions row as the form above; only where
 * the token ends up differs. The caller stores it and sends it back as
 * `Authorization: Bearer <token>`, which sessionUser accepts anywhere a cookie
 * is accepted. Sessions have no expiry, so this lasts until it is revoked.
 */
authRouter.post('/token', async (req, res, next) => {
  try {
    const username = String(req.body?.username ?? '').trim();
    const password = String(req.body?.password ?? '');
    const user = await authenticate(username, password);
    if (!user) return res.status(401).json({ error: WRONG });

    res.json({ token: await newSession(user.id), user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

/** Signing out from the extension: drop this token, leave the others alone. */
authRouter.post('/token/revoke', async (req, res, next) => {
  try {
    const token = bearerToken(req);
    if (token) await query('DELETE FROM sessions WHERE token = $1', [token]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/logout', async (req, res, next) => {
  try {
    const token = req.signedCookies?.[COOKIE];
    if (token) await query('DELETE FROM sessions WHERE token = $1', [token]);
    res.clearCookie(COOKIE, { ...cookieOptions, maxAge: undefined });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
