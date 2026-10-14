'use strict';

/**
 * Static file server + API host.
 *
 * In production nginx sits in front of this process and terminates TLS; the
 * process itself only listens on loopback. Running it directly
 * (`npm start`) gives you plain HTTP on :3000 for local development.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const store = require('./store');
const api = require('./api');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const WEB_DIR = path.resolve(process.env.WEB_DIR || path.join(store.ROOT, 'web'));

/**
 * Everything under these prefixes is served straight out of the data directory:
 * the site's own images, uploaded images, and embedded HTML pages. All of it can
 * be replaced from the admin page at any time, so responses are revalidated
 * (ETag) instead of being cached blindly.
 */
const DATA_MOUNTS = [
  ['/assets/', () => store.ASSETS_DIR],
  ['/uploads/', () => store.UPLOAD_DIR],
  ['/pages/', () => store.PAGES_DIR],
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

const contentType = (file) => MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Length': Buffer.byteLength(body),
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(body);
}

function sendFile(res, file, { cache = 'no-cache', download = false } = {}) {
  let stat;
  try {
    stat = fs.statSync(file);
    if (!stat.isFile()) throw new Error('not a file');
  } catch {
    return false;
  }
  const etag = `W/"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`;
  const headers = {
    'Content-Type': contentType(file),
    'Cache-Control': cache,
    ETag: etag,
    'X-Content-Type-Options': 'nosniff',
  };
  if (download) headers['Content-Disposition'] = `attachment; filename="${path.basename(file)}"`;
  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
  return true;
}

/** Resolve a URL path inside `base`, refusing anything that escapes it. */
function resolveInside(base, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null; // malformed percent-escape: nothing to serve
  }
  const full = path.resolve(base, '.' + path.posix.normalize(decoded));
  return full === base || full.startsWith(base + path.sep) ? full : null;
}

/** Serve one URL path out of `base`; 404 when it is missing or tries to escape. */
function serveFrom(res, base, urlPath, cache) {
  const target = resolveInside(base, urlPath);
  if (target && sendFile(res, target, { cache })) return undefined;
  return send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
}

function serveStatic(res, pathname) {
  // the pretty URLs, neither of which is linked from the showcase page
  let rel = { '/admin': '/admin.html', '/editor': '/editor.html' }[pathname] || pathname;
  if (rel.endsWith('/')) rel += 'index.html';

  const target = resolveInside(WEB_DIR, rel);
  if (target && sendFile(res, target, { cache: 'no-cache' })) return undefined;

  return send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
}

const server = http.createServer((req, res) => {
  const pathname = (() => {
    try {
      return new URL(req.url, 'http://localhost').pathname;
    } catch {
      return '/';
    }
  })();

  Promise.resolve()
    .then(() => {
      if (pathname.startsWith('/api/')) {
        const url = new URL(req.url, 'http://localhost');
        return api.handle(req, res, url);
      }
      for (const [prefix, dir] of DATA_MOUNTS) {
        if (pathname.startsWith(prefix)) {
          return serveFrom(res, dir(), pathname.slice(prefix.length - 1), 'no-cache');
        }
      }
      return serveStatic(res, pathname);
    })
    .catch((err) => {
      const status = err && err.status ? err.status : 500;
      if (status >= 500) console.error('[http] %s %s -> %s', req.method, req.url, err.stack || err);
      if (!res.headersSent) {
        send(res, status, JSON.stringify({ error: status === 500 ? '服务器内部错误' : err.message }), {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        });
      } else {
        res.end();
      }
    });
});

store.ensureDirs();
store.seedIfMissing();

server.listen(PORT, HOST, () => {
  console.log('[http] gilloffline listening on http://%s:%d', HOST, PORT);
  console.log('[http] web root   : %s', WEB_DIR);
  console.log('[http] data dir   : %s', store.DATA_DIR);
  if (!process.env.ADMIN_PASSWORD) {
    console.warn('[http] ADMIN_PASSWORD is not set — the admin page is disabled');
  }
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log('[http] %s received, shutting down', signal);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
