'use strict';

/**
 * Sub-admins: everyone who registers gets their own little site.
 *
 * Content lives one directory per user under USERS_DIR, laid out exactly like
 * the owner's data directory (site.json + assets/ + uploads/ + pages/), and is
 * served under /u/<userid>/…. Two small index files sit in the data directory:
 *
 *   users.json     who exists — name, id, password hash
 *   invites.json   the invite codes that gate registration, with their limits
 *
 * A userid is 64 hex characters: username hash (16) + registration time (32,
 * hex, zero padded) + random (16). It doubles as the directory name, so it is
 * shape-checked everywhere it arrives from a request.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const store = require('./store');

const USERS_DIR = process.env.USERS_DIR || path.join(store.ROOT, 'users.local');
const ARCHIVE_DIR = path.join(USERS_DIR, '.deleted');
const INDEX_FILE = path.join(store.DATA_DIR, 'users.json');
const INVITES_FILE = path.join(store.DATA_DIR, 'invites.json');

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

/* ------------------------------------------------------------- index files */

function readJson(file, fallback) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

const readUsers = () => {
  const data = readJson(INDEX_FILE, { users: [] });
  return Array.isArray(data.users) ? data.users.filter((user) => isUserid(user.userid)) : [];
};

const writeUsers = (users) => store.writeJsonAtomic(INDEX_FILE, { version: 1, users });

const readInvites = () => {
  const data = readJson(INVITES_FILE, { invites: [] });
  return Array.isArray(data.invites) ? data.invites.filter((invite) => INVITE_RE.test(invite.code)) : [];
};

const writeInvites = (invites) => store.writeJsonAtomic(INVITES_FILE, { version: 1, invites });

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
  return readUsers().map(publicUser).sort((a, b) => b.createdAt - a.createdAt);
}

const findUser = (userid) => (isUserid(userid) ? readUsers().find((u) => u.userid === userid) : undefined);

const findByName = (username) => {
  const key = nameKey(username || '');
  return readUsers().find((user) => nameKey(user.username) === key);
};

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
  const record = {
    userid,
    username: name,
    createdAt: Date.now(),
    password: hashPassword(password),
  };

  // assets first: seedAssetsInto creates the directory itself and only seeds one
  // that does not exist yet, so it has to run before ensureUserDirs makes it
  store.seedAssetsInto(kindDir(userid, 'assets'));
  ensureUserDirs(userid);
  seedSite(userid);

  const users = readUsers();
  users.push(record);
  writeUsers(users);
  console.log('[users] created %s (%s)', name, userid);
  return publicUser(record);
}

/**
 * Remove a user: the login record goes, the directory is moved into
 * USERS_DIR/.deleted/<userid>-<stamp>/ (a rename, so it is instant and can be
 * undone by hand).
 */
function removeUser(userid) {
  const user = findUser(userid);
  if (!user) throw FAIL('没有这个用户。', 404);

  const dir = userDir(userid);
  if (fs.existsSync(dir)) {
    fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const target = path.join(ARCHIVE_DIR, `${userid}-${stamp}`);
    fs.renameSync(dir, target);
    console.log('[users] archived %s to %s', userid, target);
  }

  writeUsers(readUsers().filter((entry) => entry.userid !== userid));
  return { ...publicUser(user), archivedAt: path.join(ARCHIVE_DIR, `${userid}-*`) };
}

/* ----------------------------------------------------------------- invites */

/** 128 bits of randomness; the alphabet keeps it pasteable. */
const newInviteCode = () => crypto.randomBytes(16).toString('hex');

function listInvites() {
  return readInvites().sort((a, b) => b.createdAt - a.createdAt);
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
  const invites = readInvites();
  invites.push(invite);
  writeInvites(invites);
  console.log('[users] invite %s created (max %d)', invite.code.slice(0, 8), limit);
  return invite;
}

function removeInvite(code) {
  if (!INVITE_RE.test(String(code || ''))) throw FAIL('邀请码不合法。');
  const invites = readInvites();
  const next = invites.filter((invite) => invite.code !== code);
  if (next.length === invites.length) throw FAIL('没有这个邀请码。', 404);
  writeInvites(next);
  return { ok: true };
}

/** Is this invite usable? Throws when it is not. Does not spend a use. */
function checkInvite(code) {
  const value = String(code || '').trim().toLowerCase();
  if (!INVITE_RE.test(value)) throw FAIL('邀请码不合法。');
  const invite = readInvites().find((entry) => entry.code === value);
  if (!invite) throw FAIL('邀请码不对。');
  if (invite.uses >= invite.maxUses) throw FAIL('这个邀请码已经用完了。');
  return invite;
}

/** Spend one use of an invite. Called after the account was created. */
function consumeInvite(code) {
  checkInvite(code);
  const value = String(code).trim().toLowerCase();
  const invites = readInvites();
  const invite = invites.find((entry) => entry.code === value);
  invite.uses += 1;
  writeInvites(invites);
  return invite;
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
  passwordMatches,
  listInvites,
  createInvite,
  removeInvite,
  checkInvite,
  consumeInvite,
};
