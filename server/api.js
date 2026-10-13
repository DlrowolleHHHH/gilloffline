'use strict';

/**
 * JSON API.
 *
 *   GET    /api/health            liveness probe (no auth)
 *   GET    /api/site              public grid content
 *   GET    /api/session           am I logged in? is a password configured?
 *   POST   /api/login             { password } -> session cookie
 *   POST   /api/logout            clears the cookie
 *   PUT    /api/site              replace the whole document (auth)
 *   GET    /api/uploads           list uploaded files (auth)
 *   POST   /api/uploads?name=x    raw binary upload (auth)
 *   DELETE /api/uploads?name=x    delete an upload (auth)
 */

const fs = require('fs');
const path = require('path');

const store = require('./store');
const auth = require('./auth');

const MAX_BODY_BYTES = 24 * 1024 * 1024;
const ALLOWED_UPLOAD_TYPES = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/avif': '.avif',
  'image/svg+xml': '.svg',
};

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

function requireAuth(req, res) {
  if (!auth.isConfigured()) {
    sendJson(res, 503, { error: '服务端未配置 ADMIN_PASSWORD，管理功能已禁用。' });
    return false;
  }
  if (!auth.isAuthenticated(req)) {
    sendJson(res, 401, { error: '登录已失效，请重新登录。' });
    return false;
  }
  return true;
}

/** Strip directory components and anything that is not a sane filename. */
function sanitizeFilename(name) {
  const base = path.basename(String(name || '')).replace(/[^\w.\-]/g, '_');
  return base.replace(/^\.+/, '').slice(0, 96);
}

function uploadPath(name) {
  const safe = sanitizeFilename(name);
  if (!safe) return null;
  const full = path.join(store.UPLOAD_DIR, safe);
  if (!full.startsWith(store.UPLOAD_DIR + path.sep)) return null;
  return full;
}

/* ------------------------------------------------------------------ router */

async function handle(req, res, url) {
  const { pathname } = url;
  const method = req.method || 'GET';

  if (pathname === '/api/health' && method === 'GET') {
    return sendJson(res, 200, { ok: true, uptime: Math.round(process.uptime()) });
  }

  if (pathname === '/api/site' && method === 'GET') {
    return sendJson(res, 200, store.read());
  }

  if (pathname === '/api/session' && method === 'GET') {
    return sendJson(res, 200, {
      configured: auth.isConfigured(),
      authenticated: auth.isAuthenticated(req),
    });
  }

  if (pathname === '/api/login' && method === 'POST') {
    const ip = clientIp(req);
    if (!auth.isConfigured()) {
      return sendJson(res, 503, { error: '服务端未配置 ADMIN_PASSWORD，无法登录。' });
    }
    if (auth.tooManyFailures(ip)) {
      return sendJson(res, 429, { error: '尝试次数过多，请稍后再试。' });
    }
    const body = await readJson(req);
    if (!auth.passwordMatches(body.password)) {
      auth.recordFailure(ip);
      console.warn('[auth] failed login from %s', ip);
      return sendJson(res, 401, { error: '密码错误。' });
    }
    auth.clearFailures(ip);
    console.log('[auth] login ok from %s', ip);
    return sendJson(
      res,
      200,
      { ok: true },
      { 'Set-Cookie': auth.sessionCookie(auth.issueToken(), isSecureRequest(req)) }
    );
  }

  if (pathname === '/api/logout' && method === 'POST') {
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': auth.clearCookie() });
  }

  if (pathname === '/api/site' && method === 'PUT') {
    if (!requireAuth(req, res)) return undefined;
    const body = await readJson(req);
    const saved = await store.write(body);
    console.log('[api] site saved (%d cells)', saved.cells.length);
    return sendJson(res, 200, saved);
  }

  if (pathname === '/api/uploads' && method === 'GET') {
    if (!requireAuth(req, res)) return undefined;
    let names = [];
    try {
      names = fs.readdirSync(store.UPLOAD_DIR);
    } catch {
      names = [];
    }
    const files = names
      .filter((name) => !name.startsWith('.'))
      .map((name) => {
        const stat = fs.statSync(path.join(store.UPLOAD_DIR, name));
        return { name, url: `/uploads/${name}`, size: stat.size, mtime: stat.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
    return sendJson(res, 200, { files });
  }

  if (pathname === '/api/uploads' && method === 'POST') {
    if (!requireAuth(req, res)) return undefined;
    const ext = ALLOWED_UPLOAD_TYPES[String(req.headers['content-type'] || '').split(';')[0].trim()];
    if (!ext) return sendJson(res, 415, { error: '只支持 PNG / JPEG / GIF / WebP / AVIF / SVG 图片。' });

    const buf = await readBody(req);
    if (!buf.length) return sendJson(res, 400, { error: '空文件。' });
    if (buf.length > store.MAX_UPLOAD_BYTES) return sendJson(res, 413, { error: '图片超过 8 MB。' });

    const requested = url.searchParams.get('name') || '';
    let target = uploadPath(requested);
    if (!target) target = path.join(store.UPLOAD_DIR, store.newId() + ext);
    if (path.extname(target).toLowerCase() !== ext) target = target.replace(/\.[^.]*$/, '') + ext;

    fs.mkdirSync(store.UPLOAD_DIR, { recursive: true });
    fs.writeFileSync(target, buf);
    const name = path.basename(target);
    console.log('[api] upload %s (%d bytes)', name, buf.length);
    return sendJson(res, 201, { url: `/uploads/${name}`, name, size: buf.length });
  }

  if (pathname === '/api/uploads' && method === 'DELETE') {
    if (!requireAuth(req, res)) return undefined;
    const target = uploadPath(url.searchParams.get('name'));
    if (!target) return sendJson(res, 400, { error: '文件名不合法。' });
    try {
      fs.unlinkSync(target);
    } catch {
      return sendJson(res, 404, { error: '文件不存在。' });
    }
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 404, { error: '未知接口。' });
}

module.exports = { handle };
