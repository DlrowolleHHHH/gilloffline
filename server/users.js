'use strict';

/**
 * Sub-admins: everyone who registers gets their own little site.
 *
 * Content lives one directory per user under USERS_DIR, laid out exactly like
 * the owner's data directory (site.json + assets/ + uploads/ + pages/), and is
 * served under /u/<userid>/…. Who exists (accounts, including the tombstones a
 * delete leaves) and the invite codes live in the SQLite database — see db.js.
 *
 * A userid is 64 hex characters: username hash (16) + registration time (32,
 * hex, zero padded) + random (16). It doubles as the directory name, so it is
 * shape-checked everywhere it arrives from a request.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const store = require('./store');
const db = require('./db');

const USERS_DIR = process.env.USERS_DIR || path.join(store.ROOT, 'users.local');
const ARCHIVE_DIR = path.join(USERS_DIR, '.deleted');

const USERID_RE = /^[0-9a-f]{64}$/;
const USERNAME_RE = /^[\p{L}\p{N}_-]{2,24}$/u;
const INVITE_RE = /^[0-9a-f]{32}$/;
const MIN_PASSWORD = 6;
const MAX_PASSWORD = 128;
const DEFAULT_MAX_USES = 10;
const MAX_MAX_USES = 1000;
/** The three per-user directories, mirroring the owner's. */
const FILE_KINDS = ['assets', 'uploads', 'pages'];

const FAIL = (message, status = 400) => Object.assign(new Error(message), { status });

/* ------------------------------------------------------------------- shapes */

const isUserid = (value) => typeof value === 'string' && USERID_RE.test(value);

/** Usernames differ only by case where case means something; store as typed. */
const nameKey = (username) => String(username).trim().toLowerCase();

const fingerprint = (username) =>
  crypto.createHash('sha256').update(nameKey(username)).digest('hex').slice(0, 16);

/** username hash (16) + registration time (32 hex) + random (16) = 64 chars. */
function newUserid(username) {
  const stamp = Date.now().toString(16).padStart(32, '0');
  const random = crypto.randomBytes(8).toString('hex');
  return `${fingerprint(username)}${stamp}${random}`;
}

/* --------------------------------------------------------------- passwords */

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
  return { algo: 'scrypt', salt, hash: hash.toString('hex') };
}

function passwordMatches(record, password) {
  if (!record || !record.password || typeof password !== 'string') return false;
  try {
    const candidate = crypto.scryptSync(password, record.password.salt, 32, { N: 16384, r: 8, p: 1 });
    const stored = Buffer.from(record.password.hash, 'hex');
    return candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------- row shapes */

/**
 * A `users` row → the account object the rest of the server passes around. A
 * deleted account keeps its row (deleted_at set, `archive` pointing at where
 * the content went) — that tombstone is what makes a delete undoable.
 */
const toAccount = (row) =>
  row && {
    userid: row.userid,
    username: row.username,
    createdAt: row.created_at,
    password: { salt: row.pw_salt, hash: row.pw_hash },
    deletedAt: row.deleted_at ?? undefined,
    archive: row.archive || '',
  };

const toInvite = (row) =>
  row && {
    code: row.code,
    maxUses: row.max_uses,
    uses: row.uses,
    note: row.note,
    createdAt: row.created_at,
  };

/* ------------------------------------------------------------------- paths */

function userDir(userid) {
  if (!isUserid(userid)) throw FAIL('用户 ID 不合法。');
  return path.join(USERS_DIR, userid);
}

function kindDir(userid, kind) {
  if (!FILE_KINDS.includes(kind)) throw FAIL('未知的文件类别。');
  return path.join(userDir(userid), kind);
}

const urlPrefix = (userid, kind) => `/u/${userid}/${kind}/`;

/* --------------------------------------------------------------- site file */

const siteFile = (userid) => path.join(userDir(userid), 'site.json');

/** Read a user's site; missing or broken falls back to a freshly normalised doc. */
function readSite(userid) {
  try {
    return store.normalizeDoc(JSON.parse(fs.readFileSync(siteFile(userid), 'utf8')));
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('[users] %s site unreadable (%s)', userid, err.message);
    return store.normalizeDoc({});
  }
}

function writeSite(userid, rawDoc) {
  const doc = store.normalizeDoc(rawDoc);
  fs.mkdirSync(userDir(userid), { recursive: true });
  store.writeJsonAtomic(siteFile(userid), doc);
  return doc;
}

/**
 * A new user starts from the committed example. That example points at the
 * owner's /assets/…, so those paths are rewritten to the user's own copy —
 * otherwise everyone would be showing the owner's logo.
 */
function seedSite(userid) {
  let raw = '{}';
  try {
    raw = fs.readFileSync(path.join(store.SEED_DIR, 'site.json'), 'utf8');
  } catch {
    /* trimmed checkout: start from an empty document */
  }
  const rewritten = raw.replace(/"\/assets\//g, `"/u/${userid}/assets/`);
  let parsed;
  try {
    parsed = JSON.parse(rewritten);
  } catch {
    parsed = {};
  }
  return writeSite(userid, parsed);
}

function ensureUserDirs(userid) {
  fs.mkdirSync(userDir(userid), { recursive: true });
  for (const kind of FILE_KINDS) fs.mkdirSync(kindDir(userid, kind), { recursive: true });
}

/* ------------------------------------------------------------------- users */

const publicUser = (user) => ({
  userid: user.userid,
  username: user.username,
  createdAt: user.createdAt,
});

function listUsers() {
  return db
    .sql('SELECT * FROM users WHERE deleted_at IS NULL ORDER BY created_at DESC')
    .all()
    .map((row) => publicUser(toAccount(row)));
}

const findUser = (userid) =>
  isUserid(userid)
    ? toAccount(db.sql('SELECT * FROM users WHERE userid = ? AND deleted_at IS NULL').get(userid))
    : undefined;

const findByName = (username) =>
  toAccount(
    db.sql('SELECT * FROM users WHERE username_key = ? AND deleted_at IS NULL').get(nameKey(username || ''))
  );

const exists = (userid) => Boolean(findUser(userid));

function createUser({ username, password }) {
  const name = String(username || '').trim();
  if (!USERNAME_RE.test(name)) throw FAIL('用户名要 2–24 个字，只能用中英文、数字、下划线或短横线。');
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
    throw FAIL(`密码至少 ${MIN_PASSWORD} 位。`);
  }
  if (password.length > MAX_PASSWORD) throw FAIL('密码太长了。');
  if (findByName(name)) throw FAIL('这个用户名已经有人用了。');

  const userid = newUserid(name);
  const secret = hashPassword(password);
  const record = { userid, username: name, createdAt: Date.now() };

  // assets first: seedAssetsInto creates the directory itself and only seeds one
  // that does not exist yet, so it has to run before ensureUserDirs makes it
  store.seedAssetsInto(kindDir(userid, 'assets'));
  ensureUserDirs(userid);
  seedSite(userid);

  db.sql(
    `INSERT INTO users (userid, username, username_key, created_at, pw_salt, pw_hash)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(userid, name, nameKey(name), record.createdAt, secret.salt, secret.hash);
  console.log('[users] created %s (%s)', name, userid);
  return publicUser(record);
}

/**
 * Remove a user: the directory is moved into USERS_DIR/.deleted/<userid>-<stamp>/
 * (a rename, so it is instant) and the account becomes a tombstone that
 * remembers the password hash and the archive — which is what `restoreUser`
 * needs to put everything back.
 */
function removeUser(userid) {
  const account = findUser(userid);
  if (!account) throw FAIL('没有这个用户。', 404);

  let archive = '';
  const dir = userDir(userid);
  if (fs.existsSync(dir)) {
    fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    archive = path.join(ARCHIVE_DIR, `${userid}-${stamp}`);
    fs.renameSync(dir, archive);
    console.log('[users] archived %s to %s', userid, archive);
  }

  db.sql('UPDATE users SET deleted_at = ?, archive = ? WHERE userid = ? AND deleted_at IS NULL').run(
    Date.now(),
    archive || null,
    userid
  );
  return { ...publicUser(account), archived: Boolean(archive) };
}

/** Tombstones, with whether their content is still sitting in the archive. */
function listDeleted() {
  return db
    .sql('SELECT * FROM users WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC')
    .all()
    .map((row) => ({
      userid: row.userid,
      username: row.username,
      createdAt: row.created_at,
      deletedAt: row.deleted_at,
      hasContent: Boolean(row.archive) && fs.existsSync(row.archive),
    }));
}

/**
 * Undo a delete: move the archived directory back and the account out of the
 * tombstones. If the archive is gone (someone cleaned .deleted/), the account
 * still comes back and starts over from the example content.
 */
function restoreUser(userid) {
  const tombstone = toAccount(
    db.sql('SELECT * FROM users WHERE userid = ? AND deleted_at IS NOT NULL').get(userid)
  );
  if (!tombstone) throw FAIL('没有这个已删除的用户。', 404);
  if (findByName(tombstone.username)) {
    throw FAIL(`「${tombstone.username}」这个名字现在被别人占用了，先处理重名再恢复。`);
  }

  let contentRestored = false;
  if (tombstone.archive && fs.existsSync(tombstone.archive)) {
    fs.renameSync(tombstone.archive, userDir(userid));
    contentRestored = true;
  } else {
    store.seedAssetsInto(kindDir(userid, 'assets'));
    ensureUserDirs(userid);
    seedSite(userid);
  }

  db.sql('UPDATE users SET deleted_at = NULL, archive = NULL WHERE userid = ?').run(userid);
  console.log('[users] restored %s (%s), content: %s', tombstone.username, userid, contentRestored);
  return { ...publicUser(tombstone), contentRestored };
}

/* ----------------------------------------------------------------- invites */

/** 128 bits of randomness; the alphabet keeps it pasteable. */
const newInviteCode = () => crypto.randomBytes(16).toString('hex');

function listInvites() {
  return db.sql('SELECT * FROM invites ORDER BY created_at DESC').all().map(toInvite);
}

function createInvite({ maxUses = DEFAULT_MAX_USES, note = '' } = {}) {
  const limit = Math.min(MAX_MAX_USES, Math.max(1, Math.round(Number(maxUses) || DEFAULT_MAX_USES)));
  const invite = {
    code: newInviteCode(),
    maxUses: limit,
    uses: 0,
    note: String(note || '').slice(0, 60),
    createdAt: Date.now(),
  };
  db.sql('INSERT INTO invites (code, max_uses, uses, note, created_at) VALUES (?, ?, ?, ?, ?)').run(
    invite.code,
    invite.maxUses,
    invite.uses,
    invite.note,
    invite.createdAt
  );
  console.log('[users] invite %s created (max %d)', invite.code.slice(0, 8), limit);
  return invite;
}

function removeInvite(code) {
  if (!INVITE_RE.test(String(code || ''))) throw FAIL('邀请码不合法。');
  const result = db.sql('DELETE FROM invites WHERE code = ?').run(String(code));
  if (!result.changes) throw FAIL('没有这个邀请码。', 404);
  return { ok: true };
}

/** Is this invite usable? Throws when it is not. Does not spend a use. */
function checkInvite(code) {
  const value = String(code || '').trim().toLowerCase();
  if (!INVITE_RE.test(value)) throw FAIL('邀请码不合法。');
  const invite = toInvite(db.sql('SELECT * FROM invites WHERE code = ?').get(value));
  if (!invite) throw FAIL('邀请码不对。');
  if (invite.uses >= invite.maxUses) throw FAIL('这个邀请码已经用完了。');
  return invite;
}

/**
 * Spend one use of an invite. Called after the account was created. The
 * `uses < max_uses` in the WHERE clause is what makes it safe: two signups
 * racing for the last use cannot both win it.
 */
function consumeInvite(code) {
  const value = String(code || '').trim().toLowerCase();
  const result = db.sql('UPDATE invites SET uses = uses + 1 WHERE code = ? AND uses < max_uses').run(value);
  if (!result.changes) throw FAIL('这个邀请码已经用完了。');
  return toInvite(db.sql('SELECT * FROM invites WHERE code = ?').get(value));
}

module.exports = {
  USERS_DIR,
  ARCHIVE_DIR,
  FILE_KINDS,
  MIN_PASSWORD,
  DEFAULT_MAX_USES,
  isUserid,
  userDir,
  kindDir,
  urlPrefix,
  ensureUserDirs,
  readSite,
  writeSite,
  listUsers,
  findUser,
  findByName,
  exists,
  createUser,
  removeUser,
  listDeleted,
  restoreUser,
  passwordMatches,
  listInvites,
  createInvite,
  removeInvite,
  checkInvite,
  consumeInvite,
};
