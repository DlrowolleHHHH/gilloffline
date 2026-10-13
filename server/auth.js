'use strict';

/**
 * Password auth for the admin page.
 *
 * The password comes from the ADMIN_PASSWORD environment variable at deploy
 * time and is never written to disk. Sessions are stateless HMAC-signed
 * cookies; the signing secret is generated once and persisted in the data
 * directory so that a container restart does not log you out.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const store = require('./store');

const COOKIE_NAME = 'gill_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const PASSWORD = process.env.ADMIN_PASSWORD || '';
const LOGIN_MAX_FAILURES = 8;
const LOGIN_WINDOW_MS = 5 * 60 * 1000;

/* ------------------------------------------------------------------ secret */

function loadSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const file = path.join(store.DATA_DIR, '.session-secret');
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing.length >= 32) return existing;
  } catch {
    /* first run */
  }
  const generated = crypto.randomBytes(32).toString('hex');
  try {
    fs.mkdirSync(store.DATA_DIR, { recursive: true });
    fs.writeFileSync(file, generated, { mode: 0o600 });
  } catch (err) {
    console.warn('[auth] could not persist session secret: %s', err.message);
  }
  return generated;
}

const SECRET = loadSecret();

/* ------------------------------------------------------------ password ops */

/** Constant-time comparison; hashing first keeps the comparison length-safe. */
function passwordMatches(candidate) {
  if (!PASSWORD) return false;
  const a = crypto.createHash('sha256').update(String(candidate)).digest();
  const b = crypto.createHash('sha256').update(PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

/* ------------------------------------------------------------------ tokens */

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function sign(payload) {
  const data = b64url(JSON.stringify(payload));
  const mac = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  return `${data}.${mac}`;
}

function verify(token) {
  if (typeof token !== 'string' || token.length > 4096) return false;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return false;
  const data = token.slice(0, dot);
  const mac = token.slice(dot + 1);

  const expected = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;

  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    return typeof payload.exp === 'number' && payload.exp > Date.now();
  } catch {
    return false;
  }
}

function issueToken() {
  return sign({ exp: Date.now() + SESSION_TTL_MS });
}

/* -------------------------------------------------------------- rate limit */

const failures = new Map(); // ip -> { count, resetAt }

function tooManyFailures(ip) {
  const entry = failures.get(ip);
  if (!entry) return false;
  if (entry.resetAt < Date.now()) {
    failures.delete(ip);
    return false;
  }
  return entry.count >= LOGIN_MAX_FAILURES;
}

function recordFailure(ip) {
  const now = Date.now();
  const entry = failures.get(ip);
  if (!entry || entry.resetAt < now) {
    failures.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return;
  }
  entry.count += 1;
}

function clearFailures(ip) {
  failures.delete(ip);
}

/** Housekeeping so the map cannot grow unbounded. */
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of failures) if (entry.resetAt < now) failures.delete(ip);
}, LOGIN_WINDOW_MS);
sweeper.unref();

/* ----------------------------------------------------------------- cookies */

function parseCookies(header) {
  const out = Object.create(null);
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    if (key) out[key] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

function sessionCookie(token, secure) {
  const attrs = [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

function clearCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

function isAuthenticated(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  return verify(token);
}

module.exports = {
  COOKIE_NAME,
  isConfigured: () => PASSWORD.length > 0,
  passwordMatches,
  issueToken,
  sessionCookie,
  clearCookie,
  isAuthenticated,
  parseCookies,
  tooManyFailures,
  recordFailure,
  clearFailures,
};
