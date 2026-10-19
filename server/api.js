'use strict';

/**
 * JSON API.
 *
 *   GET    /api/health            liveness probe (no auth)
 *   GET    /api/site              public grid content (?userid= for a sub-admin)
 *   PUT    /api/site              replace the whole document (that site's owner)
 *   GET    /api/session           who am I, and is a password configured?
 *   POST   /api/login             { password } or { username, password }
 *   POST   /api/logout            clears the cookie
 *   POST   /api/register          { username, password, invite } -> session
 *   GET    /api/files?kind=x      list a file collection (that site's owner)
 *   POST   /api/files?kind=x&name=y   raw binary upload
 *   DELETE /api/files?kind=x&name=y   delete a file
 *   GET|POST|DELETE /api/users    sub-admins (site owner only); PATCH sets canShare
 *   GET|POST|DELETE /api/invites  invite codes (site owner only)
 *   GET    /api/repository        the shared box repository (public)
 *   POST   /api/repository        share one of your cells (needs share permission)
 *   PATCH  /api/repository/:id    relabel / re-describe a box (its sharer or the owner)
 *   DELETE /api/repository/:id    remove a box (its sharer or the owner)
 *
 * `kind` is one of `assets` (the site's own images), `uploads` (images used in
 * cells) or `pages` (HTML pages embedded in cells). Without `userid` they are
 * the owner's own collections; with one they are that sub-admin's, which live
 * in their own directory and are served under /u/<userid>/…
 */

const fs = require('fs');
const path = require('path');

const store = require('./store');
const auth = require('./auth');
const users = require('./users');
const repository = require('./repository');

const MAX_BODY_BYTES = 24 * 1024 * 1024;

const IMAGE_TYPES = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/avif': '.avif',
  'image/svg+xml': '.svg',
  'image/x-icon': '.ico',
  'image/vnd.microsoft.icon': '.ico',
};

/** What each collection accepts. Where it lives depends on whose site it is. */
const FILE_KINDS = {
  assets: { types: IMAGE_TYPES, label: 'PNG / JPEG / GIF / WebP / AVIF / SVG / ICO 图片' },
  uploads: { types: IMAGE_TYPES, label: 'PNG / JPEG / GIF / WebP / AVIF / SVG / ICO 图片' },
  // an embedded page may bring its own css / js / images along
  pages: {
    types: {
      'text/html': '.html',
      'text/css': '.css',
      'text/javascript': '.js',
      'application/javascript': '.js',
      'application/json': '.json',
      ...IMAGE_TYPES,
    },
    label: 'HTML / CSS / JS / JSON 或图片',
  },
};

/** The owner's collections: the data directory, served at the site root. */
const OWNER_TARGETS = {
  assets: { dir: () => store.ASSETS_DIR, prefix: '/assets/' },
  uploads: { dir: () => store.UPLOAD_DIR, prefix: '/uploads/' },
  pages: { dir: () => store.PAGES_DIR, prefix: '/pages/' },
};

const fail = (message, status = 400) => Object.assign(new Error(message), { status });

/* ----------------------------------------------------------------- helpers */

function sendJson(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('请求体过大'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const buf = await readBody(req);
  if (!buf.length) return {};
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    throw Object.assign(new Error('请求体不是合法 JSON'), { status: 400 });
  }
}

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length) return forwarded.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

const isSecureRequest = (req) =>
  String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';

/** Only the site owner: managing sub-admins and invite codes. */
function requireOwner(req, res) {
  const subject = auth.sessionSubject(req);
  if (subject === null) {
    sendJson(res, 401, { error: '登录已失效，请重新登录。' });
    return false;
  }
  if (subject !== 'admin') {
    sendJson(res, 403, { error: '这个操作只有站主能做。' });
    return false;
  }
  return true;
}

/**
 * Which site a request is about: null for the owner's own, otherwise a
 * sub-admin's userid. An unknown userid is a 404 rather than a quiet fallback
 * to the owner's site.
 */
function requestUserid(url) {
  const raw = url.searchParams.get('userid');
  if (!raw) return null;
  if (!users.exists(raw)) throw fail('没有这个用户。', 404);
  return raw;
}

/** Edit rights on that site: the owner, or that sub-admin. */
function requireEditor(req, res, userid) {
  if (auth.canEdit(req, userid)) return true;
  const subject = auth.sessionSubject(req);
  sendJson(res, subject ? 403 : 401, {
    error: subject ? '你没有这个页面的编辑权限。' : '登录已失效，请重新登录。',
  });
  return false;
}

/** Where a collection lives for a given site, and the URL it is served at. */
function fileTarget(kind, userid) {
  if (!FILE_KINDS[kind]) throw fail('未知的文件类别。');
  if (!userid) return OWNER_TARGETS[kind];
  return { dir: () => users.kindDir(userid, kind), prefix: users.urlPrefix(userid, kind) };
}

/**
 * Strip directory components and anything that is not a sane filename. Letters
 * and digits from any script are kept, so 中文文件名 survives the round trip.
 */
function sanitizeFilename(name) {
  const base = path.basename(String(name || '')).replace(/[^\p{L}\p{N}._-]/gu, '_');
  // slice by code point: cutting a surrogate pair in half would corrupt the name
  return [...base.replace(/^\.+/, '')].slice(0, 96).join('');
}

/** Absolute path of `name` inside the target's directory, or null if unsafe. */
function filePath(target, name) {
  const safe = sanitizeFilename(name);
  if (!safe) return null;
  const base = target.dir();
  const full = path.join(base, safe);
  if (!full.startsWith(base + path.sep)) return null;
  return full;
}

function listFiles(target, res) {
  let names = [];
  try {
    names = fs.readdirSync(target.dir());
  } catch {
    names = [];
  }
  const files = names
    .filter((name) => !name.startsWith('.'))
    .map((name) => {
      const stat = fs.statSync(path.join(target.dir(), name));
      return { name, url: target.prefix + name, size: stat.size, mtime: stat.mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
  return sendJson(res, 200, { files });
}

/** Raw binary upload; overwriting an existing name is how a page gets updated. */
async function uploadFile(kind, target, req, res, url) {
  const ext = FILE_KINDS[kind].types[String(req.headers['content-type'] || '').split(';')[0].trim()];
  if (!ext) return sendJson(res, 415, { error: `只支持 ${FILE_KINDS[kind].label}。` });

  const buf = await readBody(req);
  if (!buf.length) return sendJson(res, 400, { error: '空文件。' });
  if (buf.length > store.MAX_UPLOAD_BYTES) return sendJson(res, 413, { error: '文件超过 8 MB。' });

  const requested = url.searchParams.get('name') || '';
  let full = filePath(target, requested);
  if (!full) full = path.join(target.dir(), store.newId() + ext);
  if (path.extname(full).toLowerCase() !== ext) full = full.replace(/\.[^.]*$/, '') + ext;

  fs.mkdirSync(target.dir(), { recursive: true });
  fs.writeFileSync(full, buf);
  const name = path.basename(full);
  console.log('[api] upload %s (%d bytes)', name, buf.length);
  return sendJson(res, 201, { url: target.prefix + name, name, size: buf.length });
}

function deleteFile(target, res, url) {
  const full = filePath(target, url.searchParams.get('name'));
  if (!full) return sendJson(res, 400, { error: '文件名不合法。' });
  try {
    fs.unlinkSync(full);
  } catch {
    return sendJson(res, 404, { error: '文件不存在。' });
  }
  return sendJson(res, 200, { ok: true });
}

/* ------------------------------------------------------------------ router */

async function handle(req, res, url) {
  const { pathname } = url;
  const method = req.method || 'GET';

  if (pathname === '/api/health' && method === 'GET') {
    return sendJson(res, 200, { ok: true, uptime: Math.round(process.uptime()) });
  }

  if (pathname === '/api/site' && method === 'GET') {
    const userid = requestUserid(url);
    return sendJson(res, 200, userid ? users.readSite(userid) : store.read());
  }

  if (pathname === '/api/session' && method === 'GET') {
    const subject = auth.sessionSubject(req);
    const user = subject && subject !== 'admin' ? users.findUser(subject) : null;
    return sendJson(res, 200, {
      configured: auth.isConfigured(),
      authenticated: subject === 'admin' || Boolean(user),
      subject: subject || null,
      username: subject === 'admin' ? 'admin' : user ? user.username : null,
      // 共享盒子的权限：站主天然有，子管理员要站主开
      canShare: subject === 'admin' || Boolean(user && user.canShare),
    });
  }

  if (pathname === '/api/login' && method === 'POST') {
    const ip = clientIp(req);
    if (auth.tooManyFailures(ip)) {
      return sendJson(res, 429, { error: '尝试次数过多，请稍后再试。' });
    }
    const body = await readJson(req);

    // a username means a sub-admin; no username means the site owner
    if (body.username) {
      const user = users.findByName(body.username);
      if (!user || !users.passwordMatches(user, body.password)) {
        auth.recordFailure(ip);
        console.warn('[auth] failed login for %s from %s', body.username, ip);
        return sendJson(res, 401, { error: '用户名或密码不对。' });
      }
      auth.clearFailures(ip);
      console.log('[auth] %s logged in from %s', user.username, ip);
      return sendJson(
        res,
        200,
        { ok: true, subject: user.userid, username: user.username },
        { 'Set-Cookie': auth.sessionCookie(auth.issueToken(user.userid), isSecureRequest(req)) }
      );
    }

    if (!auth.isConfigured()) {
      return sendJson(res, 503, { error: '服务端未配置 ADMIN_PASSWORD，无法登录。' });
    }
    if (!auth.passwordMatches(body.password)) {
      auth.recordFailure(ip);
      console.warn('[auth] failed login from %s', ip);
      return sendJson(res, 401, { error: '密码错误。' });
    }
    auth.clearFailures(ip);
    console.log('[auth] admin logged in from %s', ip);
    return sendJson(
      res,
      200,
      { ok: true, subject: 'admin', username: 'admin' },
      { 'Set-Cookie': auth.sessionCookie(auth.issueToken('admin'), isSecureRequest(req)) }
    );
  }

  if (pathname === '/api/register' && method === 'POST') {
    const ip = clientIp(req);
    if (auth.tooManyFailures(ip)) {
      return sendJson(res, 429, { error: '尝试次数过多，请稍后再试。' });
    }
    const body = await readJson(req);
    try {
      users.checkInvite(body.invite); // validated first, so a failed signup costs no use
      const user = users.createUser({ username: body.username, password: body.password });
      users.consumeInvite(body.invite);
      auth.clearFailures(ip);
      console.log('[auth] registered %s from %s', user.username, ip);
      return sendJson(
        res,
        201,
        { ok: true, subject: user.userid, username: user.username },
        { 'Set-Cookie': auth.sessionCookie(auth.issueToken(user.userid), isSecureRequest(req)) }
      );
    } catch (err) {
      auth.recordFailure(ip);
      return sendJson(res, err.status || 400, { error: err.message });
    }
  }

  if (pathname === '/api/logout' && method === 'POST') {
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': auth.clearCookie() });
  }

  if (pathname === '/api/users/restore' && method === 'POST') {
    if (!requireOwner(req, res)) return undefined;
    const body = await readJson(req);
    return sendJson(res, 200, users.restoreUser(body.userid));
  }

  if (pathname === '/api/users') {
    if (!requireOwner(req, res)) return undefined;
    if (method === 'GET') {
      return sendJson(res, 200, { users: users.listUsers(), deleted: users.listDeleted() });
    }
    if (method === 'POST') {
      const body = await readJson(req);
      return sendJson(res, 201, users.createUser({ username: body.username, password: body.password }));
    }
    if (method === 'DELETE') {
      return sendJson(res, 200, users.removeUser(url.searchParams.get('userid')));
    }
    if (method === 'PATCH') {
      const body = await readJson(req);
      return sendJson(res, 200, users.setShare(body.userid, body.canShare === true));
    }
  }

  if (pathname === '/api/invites') {
    if (!requireOwner(req, res)) return undefined;
    if (method === 'GET') return sendJson(res, 200, { invites: users.listInvites() });
    if (method === 'POST') {
      const body = await readJson(req);
      return sendJson(res, 201, users.createInvite(body));
    }
    if (method === 'DELETE') {
      return sendJson(res, 200, users.removeInvite(url.searchParams.get('code')));
    }
  }

  if (pathname === '/api/site' && method === 'PUT') {
    const userid = requestUserid(url);
    if (!requireEditor(req, res, userid)) return undefined;
    const body = await readJson(req);
    const saved = userid ? users.writeSite(userid, body) : await store.write(body);
    console.log('[api] site saved (%d cells)%s', saved.cells.length, userid ? ` for ${userid.slice(0, 8)}…` : '');
    return sendJson(res, 200, saved);
  }

  if (pathname === '/api/repository') {
    if (method === 'GET') return sendJson(res, 200, { boxes: repository.list() });
    if (method === 'POST') {
      const subject = auth.sessionSubject(req);
      if (subject === null) return sendJson(res, 401, { error: '登录已失效，请重新登录。' });
      const user = subject === 'admin' ? null : users.findUser(subject);
      if (subject !== 'admin' && !(user && user.canShare)) {
        return sendJson(res, 403, { error: '你还没有分享权限，请联系站主开通。' });
      }
      const body = await readJson(req);
      const box = repository.add({
        label: body.label,
        info: body.info,
        cell: body.cell,
        sharer: subject,
        sharerName: subject === 'admin' ? '站主' : user.username,
      });
      console.log('[api] box shared: %s by %s', box.label, subject === 'admin' ? 'admin' : subject.slice(0, 8) + '…');
      return sendJson(res, 201, box);
    }
  }

  const boxMatch = /^\/api\/repository\/([A-Za-z0-9_-]{1,40})$/.exec(pathname);
  if (boxMatch && (method === 'PATCH' || method === 'DELETE')) {
    const subject = auth.sessionSubject(req);
    if (subject === null) return sendJson(res, 401, { error: '登录已失效，请重新登录。' });
    if (method === 'DELETE') {
      const box = repository.remove(boxMatch[1], subject);
      console.log('[api] box removed: %s', box.id);
      return sendJson(res, 200, { ok: true });
    }
    const body = await readJson(req);
    return sendJson(res, 200, repository.update(boxMatch[1], { label: body.label, info: body.info }, subject));
  }

  if (pathname === '/api/files') {
    const userid = requestUserid(url);
    if (!requireEditor(req, res, userid)) return undefined;
    const kind = url.searchParams.get('kind');
    const target = fileTarget(kind, userid);
    if (method === 'GET') return listFiles(target, res);
    if (method === 'POST') return uploadFile(kind, target, req, res, url);
    if (method === 'DELETE') return deleteFile(target, res, url);
  }

  return sendJson(res, 404, { error: '未知接口。' });
}

module.exports = { handle };
