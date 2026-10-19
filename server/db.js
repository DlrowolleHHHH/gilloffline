'use strict';

/**
 * The accounts database.
 *
 * SQLite through Node's own `node:sqlite` — nothing to install, which is the
 * point of this backend. It holds who exists (users, including the tombstones a
 * delete leaves behind) and the invite codes. The *content* of every site stays
 * where it always was: site.json plus its files.
 *
 * Older installs kept these two tables as /app/data/users.json and
 * invites.json; the first open imports them and renames the files to
 * *.imported so they stay around as a backup.
 */

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const store = require('./store');

const DB_FILE = path.join(store.DATA_DIR, 'gilloffline.db');

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    userid       TEXT PRIMARY KEY,
    username     TEXT NOT NULL,
    username_key TEXT NOT NULL,
    created_at   INTEGER NOT NULL,
    pw_salt      TEXT NOT NULL,
    pw_hash      TEXT NOT NULL,
    deleted_at   INTEGER,
    archive      TEXT,
    can_share    INTEGER NOT NULL DEFAULT 0
  );
  -- a name is only taken while someone is actually using it: deleted users keep
  -- their name in a tombstone, which must not block a new signup
  CREATE UNIQUE INDEX IF NOT EXISTS users_active_name
    ON users (username_key) WHERE deleted_at IS NULL;

  CREATE TABLE IF NOT EXISTS invites (
    code       TEXT PRIMARY KEY,
    max_uses   INTEGER NOT NULL,
    uses       INTEGER NOT NULL DEFAULT 0,
    note       TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );

  -- 盒子仓库：全局共享的盒子清单，按 label 归类。cell 是整颗格子的 JSON。
  CREATE TABLE IF NOT EXISTS boxes (
    id          TEXT PRIMARY KEY,
    label       TEXT NOT NULL,
    info        TEXT NOT NULL DEFAULT '',
    sharer      TEXT NOT NULL,
    sharer_name TEXT NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL,
    cell        TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS boxes_label ON boxes (label);
  CREATE INDEX IF NOT EXISTS boxes_created ON boxes (created_at DESC);
  CREATE INDEX IF NOT EXISTS boxes_sharer ON boxes (sharer);
`;

let db = null;

function open() {
  if (db) return db;
  fs.mkdirSync(store.DATA_DIR, { recursive: true });
  db = new DatabaseSync(DB_FILE);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec(SCHEMA);
  migrate(db);
  importLegacy(db);
  return db;
}

const get = () => open();

/** Schema additions for databases created by an older build. */
function migrate(database) {
  const columns = database.prepare('PRAGMA table_info(users)').all();
  if (!columns.some((column) => column.name === 'can_share')) {
    database.exec('ALTER TABLE users ADD COLUMN can_share INTEGER NOT NULL DEFAULT 0');
    console.log('[db] added users.can_share');
  }
}

/* --------------------------------------------------------------- migration */

function importLegacy(database) {
  const dir = store.DATA_DIR;
  const usersFile = path.join(dir, 'users.json');
  const invitesFile = path.join(dir, 'invites.json');
  if (!fs.existsSync(usersFile) && !fs.existsSync(invitesFile)) return;

  const read = (file, key) => {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return Array.isArray(parsed[key]) ? parsed[key] : [];
    } catch {
      return [];
    }
  };

  const accounts = [...read(usersFile, 'users'), ...read(usersFile, 'deleted')].filter(
    (record) => record && typeof record.userid === 'string' && record.password
  );
  const invites = read(invitesFile, 'invites').filter((invite) => invite && invite.code);

  const insertUser = database.prepare(
    `INSERT OR IGNORE INTO users
       (userid, username, username_key, created_at, pw_salt, pw_hash, deleted_at, archive)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const record of accounts) {
    insertUser.run(
      record.userid,
      String(record.username || ''),
      String(record.username || '').toLowerCase(),
      Number(record.createdAt) || Date.now(),
      String(record.password.salt || ''),
      String(record.password.hash || ''),
      Number.isFinite(record.deletedAt) ? record.deletedAt : null,
      record.archive || null
    );
  }

  const insertInvite = database.prepare(
    'INSERT OR IGNORE INTO invites (code, max_uses, uses, note, created_at) VALUES (?, ?, ?, ?, ?)'
  );
  for (const invite of invites) {
    insertInvite.run(
      String(invite.code),
      Number(invite.maxUses) || 10,
      Number(invite.uses) || 0,
      String(invite.note || ''),
      Number(invite.createdAt) || Date.now()
    );
  }

  for (const file of [usersFile, invitesFile]) {
    if (!fs.existsSync(file)) continue;
    try {
      fs.renameSync(file, `${file}.imported`);
    } catch (err) {
      console.warn('[db] could not rename %s (%s)', file, err.message);
    }
  }
  console.log('[db] imported %d account(s) and %d invite(s) from the old JSON files', accounts.length, invites.length);
}

/* -------------------------------------------------------------- statements */

const cache = new Map();

/** Prepared statements, kept for the life of the process. */
function sql(text) {
  let statement = cache.get(text);
  if (!statement) {
    statement = get().prepare(text);
    cache.set(text, statement);
  }
  return statement;
}

module.exports = { DB_FILE, get, sql };
