'use strict';

/**
 * Tiny JSON data store.
 *
 * The whole site (settings + showcase cells) lives in a single JSON document so
 * that a save is always atomic and the file is trivial to back up / hand-edit.
 * No database, no dependencies.
 *
 * `data/site.json` is the committed example and is read-only at runtime: it
 * seeds an empty data directory, so running the app can never dirty the tree.
 *
 * Everything the site serves at runtime lives in DATA_DIR (the mounted volume):
 *   site.json    the content above, plus .session-secret from auth.js
 *   assets/      the site's own images, seeded from the checkout once
 *   uploads/     images uploaded from the admin page
 *   pages/       HTML pages embedded in showcase cells
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
/** Where writes land: a throwaway copy on a dev box, the mounted volume in Docker. */
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data.local');
/** The committed example, copied into DATA_DIR the first time it is empty. */
const SEED_DIR = process.env.SEED_DIR || path.join(ROOT, 'data');
const SITE_FILE = path.join(DATA_DIR, 'site.json');
/** Uploaded images. */
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
/** Uploaded HTML pages (plus any css/js/images they bring along). */
const PAGES_DIR = path.join(DATA_DIR, 'pages');
/** The site's own images (logo.svg / title.png), seeded from the checkout. */
const ASSETS_DIR = path.join(DATA_DIR, 'assets');
/** Where those images ship: the repo's assets/, or /app/assets in Docker. */
const SEED_ASSETS_DIR = path.join(ROOT, 'assets');

/* ------------------------------------------------------------------ limits */

const SIZES = ['1x1', '2x2', '1x2', '1x4', '2x4'];
const DIRECTIONS = ['left', 'right', 'top', 'bottom'];
const RATIOS = ['1/1', '1/2'];
const TYPES = ['image', 'solid', 'html'];
const FITS = ['cover', 'contain'];

const MAX_CELLS = 200;
const MAX_TITLE = 120;
const MAX_BODY = 2000;
const MAX_URL = 2048;
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/* -------------------------------------------------------------- sanitizing */

const clampText = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');

const oneOf = (value, allowed, fallback) =>
  typeof value === 'string' && allowed.includes(value) ? value : fallback;

/** Colours end up inside inline styles, so only accept plain hex literals. */
function safeColor(value, fallback) {
  return typeof value === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)
    ? value
    : fallback;
}

function safeNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Links that leave the site (the ICP filing badge) must be absolute http(s). */
function safeExternalUrl(value) {
  const raw = clampText(value, MAX_URL).trim();
  return /^https?:\/\//i.test(raw) ? raw : '';
}

/** Only relative asset paths, http(s) URLs and inline raster data URIs. */
function safeUrl(value) {
  const raw = clampText(value, MAX_URL).trim();
  if (!raw) return '';
  if (/^\/(?:uploads|assets|pages)\//.test(raw)) return raw;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^data:image\/(?:png|jpe?g|gif|webp|avif);base64,/i.test(raw)) return raw;
  return '';
}

/**
 * A cell's embedded page: a file uploaded under /pages/, or an absolute
 * http(s) URL for something hosted elsewhere. Nothing else — the value ends up
 * in an iframe's src.
 */
function safePageUrl(value) {
  const raw = clampText(value, MAX_URL).trim();
  if (!raw) return '';
  // and it has to name an actual file: /pages/.. and /pages/. do not
  if (/^\/pages\/(?!\.\.?$)[\w.\-]+$/.test(raw)) return raw;
  return /^https?:\/\//i.test(raw) ? raw : '';
}

function newId() {
  return 'c' + crypto.randomBytes(6).toString('hex');
}

/* ------------------------------------------------------------- normalizing */

function normalizeOverlay(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: src.enabled !== false,
    title: clampText(src.title, MAX_TITLE),
    body: clampText(src.body, MAX_BODY),
    direction: oneOf(src.direction, DIRECTIONS, 'left'),
    ratio: oneOf(src.ratio, RATIOS, '1/1'),
    bgColor: safeColor(src.bgColor, '#0b0a12f2'),
    textColor: safeColor(src.textColor, '#ffffff'),
  };
}

function normalizeCell(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const type = oneOf(src.type, TYPES, 'image');
  return {
    id: typeof src.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(src.id) ? src.id : newId(),
    type,
    size: oneOf(src.size, SIZES, '1x1'),
    borderColor: safeColor(src.borderColor, '#7e46b9'),
    borderWidth: safeNumber(src.borderWidth, 0, 20, 2),
    radius: safeNumber(src.radius, 0, 64, 14),
    // image cells
    image: safeUrl(src.image),
    imageFit: oneOf(src.imageFit, FITS, 'cover'),
    imageTitle: clampText(src.imageTitle, MAX_TITLE),
    imageTitleColor: safeColor(src.imageTitleColor, '#ffffff'),
    // solid cells
    color: safeColor(src.color, '#7e46b9'),
    // html cells — rendered in a sandboxed iframe on the home page
    html: safePageUrl(src.html),
    // shared
    link: safeUrl(src.link),
    overlay: normalizeOverlay(src.overlay),
  };
}

function normalizeDoc(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const site = src.site && typeof src.site === 'object' ? src.site : {};
  const cells = Array.isArray(src.cells) ? src.cells.slice(0, MAX_CELLS).map(normalizeCell) : [];

  // ids must stay unique or the admin UI keys collide
  const seen = new Set();
  for (const cell of cells) {
    if (seen.has(cell.id)) cell.id = newId();
    seen.add(cell.id);
  }

  return {
    version: 1,
    site: {
      title: clampText(site.title, MAX_TITLE) || 'Gill Offline',
      subtitle: clampText(site.subtitle, MAX_TITLE),
      // the title bar stays hidden until the admin explicitly turns it on
      subtitleEnabled: site.subtitleEnabled === true,
      // the footer is three slots, laid out left / centre / right; the centre
      // one carries the ICP filing number. `footer` is the pre-3-slot key.
      footerLeft: clampText(site.footerLeft ?? site.footer, MAX_TITLE),
      // trimmed: whitespace-only must not read as "the admin already set one"
      icp: clampText(site.icp, MAX_TITLE).trim(),
      // empty means "use the filing system's default address", not "no link"
      icpLink: safeExternalUrl(site.icpLink),
      footerRight: clampText(site.footerRight, MAX_TITLE),
      accent: safeColor(site.accent, '#7e46b9'),
    },
    cells,
  };
}

/* --------------------------------------------------------------- file i/o */

let writeChain = Promise.resolve();

/**
 * Deployment default: ICP_NUMBER fills the footer's centre slot for as long as
 * the stored value is empty. Once the admin saves a number the stored one wins,
 * and clearing the field hands control back to the environment.
 *
 * The overlay is applied on the way out only — never persisted — so the env
 * value cannot quietly freeze itself into site.json.
 */
function applyEnvDefaults(doc) {
  const icp = clampText(process.env.ICP_NUMBER, MAX_TITLE).trim();
  if (!icp || doc.site.icp) return doc;
  return { ...doc, site: { ...doc.site, icp, icpFromEnv: true } };
}

function ensureDirs() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.mkdirSync(PAGES_DIR, { recursive: true });
}

/**
 * Copy the bundled images into the data directory the first time it is made,
 * so that everything the site serves lives under DATA_DIR — and the admin page
 * can browse and replace them like any other file.
 *
 * An existing directory is never touched: a file missing from it was deleted on
 * purpose, not a gap to fill back in.
 */
function seedAssets() {
  if (fs.existsSync(ASSETS_DIR)) return;
  let bundled = [];
  try {
    bundled = fs.readdirSync(SEED_ASSETS_DIR).filter((name) => !name.startsWith('.'));
  } catch {
    bundled = []; // trimmed checkout: nothing to seed
  }
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
  for (const name of bundled) {
    fs.copyFileSync(path.join(SEED_ASSETS_DIR, name), path.join(ASSETS_DIR, name));
  }
  if (bundled.length) console.log('[store] seeded %d bundled file(s) into %s', bundled.length, ASSETS_DIR);
}

function seedIfMissing() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  seedAssets();
  if (fs.existsSync(SITE_FILE)) return;
  const seed = path.join(SEED_DIR, 'site.json');
  const initial = fs.existsSync(seed)
    ? fs.readFileSync(seed, 'utf8')
    : JSON.stringify(normalizeDoc({}), null, 2);
  fs.writeFileSync(SITE_FILE, initial);
  console.log('[store] seeded %s', SITE_FILE);
}

function read() {
  seedIfMissing();
  try {
    return applyEnvDefaults(normalizeDoc(JSON.parse(fs.readFileSync(SITE_FILE, 'utf8'))));
  } catch (err) {
    console.error('[store] site.json unreadable (%s), falling back to seed', err.message);
    return applyEnvDefaults(normalizeDoc({}));
  }
}

/** Atomic write: temp file + rename, serialised so concurrent saves cannot interleave. */
function write(rawDoc) {
  const doc = normalizeDoc(rawDoc);
  const payload = JSON.stringify(doc, null, 2);
  writeChain = writeChain.then(
    () =>
      new Promise((resolve, reject) => {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        const tmp = SITE_FILE + '.' + process.pid + '.tmp';
        fs.writeFile(tmp, payload, (err) => {
          if (err) return reject(err);
          // resolve with the same shape a read would hand out, env overlay included
          fs.rename(tmp, SITE_FILE, (renameErr) =>
            renameErr ? reject(renameErr) : resolve(applyEnvDefaults(doc))
          );
        });
      })
  );
  return writeChain;
}

module.exports = {
  ROOT,
  DATA_DIR,
  UPLOAD_DIR,
  PAGES_DIR,
  ASSETS_DIR,
  SITE_FILE,
  MAX_UPLOAD_BYTES,
  SIZES,
  DIRECTIONS,
  RATIOS,
  TYPES,
  FITS,
  normalizeDoc,
  normalizeCell,
  newId,
  ensureDirs,
  seedIfMissing,
  read,
  write,
};
