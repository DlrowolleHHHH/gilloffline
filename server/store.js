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

const SIZES = ['1x1', '2x2', '3x3', '4x4', '1x2', '1x4', '2x4', '3x6', '4x8'];
/** The units each named size spans — mirrors `SIZES` in web/js/shared.js. */
const SIZE_UNITS = {
  '1x1': { w: 1, h: 1 },
  '2x2': { w: 2, h: 2 },
  '3x3': { w: 3, h: 3 },
  '4x4': { w: 4, h: 4 },
  '1x2': { w: 2, h: 1 },
  '1x4': { w: 4, h: 1 },
  '2x4': { w: 4, h: 2 },
  '3x6': { w: 6, h: 3 },
  '4x8': { w: 8, h: 4 },
};
const DIRECTIONS = ['left', 'right', 'top', 'bottom'];
const RATIOS = ['1/1', '1/2'];
const TYPES = ['image', 'solid', 'html'];
const FITS = ['cover', 'contain'];
/** 'flow' = an ordered list CSS packs; 'board' = every cell has a position. */
const LAYOUTS = ['flow', 'board'];
/** How much air to leave between cells: s / m / l → 8 / 16 / 28 px. */
const GAP_LEVELS = ['s', 'm', 'l'];

const MAX_CELLS = 200;
const MAX_TITLE = 120;
const MAX_BODY = 2000;
const MAX_URL = 2048;
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_COLS = 12;
const MIN_BOARD_COLS = 3;
const DEFAULT_BOARD_COLS = 12;
const MAX_CELL_UNITS = 12;

/**
 * 窄屏重排（只有棋盘布局用得上）：视口低于阈值时，把格子按顺序紧密重排成这么多列。
 * 阈值是「设备宽度」的概念，和 CSS 媒体查询同一套语言。这些默认值必须和
 * web/js/shared.js 里的保持一致。
 */
const MIN_BREAKPOINT = 240;
const MAX_BREAKPOINT = 4096;
const DEFAULT_PAD_WIDTH = 1024;
const DEFAULT_PHONE_WIDTH = 640;
const DEFAULT_PAD_COLUMNS = 4;
const DEFAULT_PHONE_COLUMNS = 2;
/** Rows are not really limited — this only stops a runaway number from being
 *  stored. The board grows as far as anyone drags a cell. */
const MAX_ROWS = 1000;

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
  // a sub-admin's own files live under /u/<userid>/…
  if (/^\/u\/[0-9a-f]{64}\/(?:uploads|assets|pages)\//.test(raw)) return raw;
  // the site's own pages: /admin and /editor follow whoever's site they sit on,
  // so a cell can be an entry point that works for the owner and for every user
  if (raw === '/admin' || raw === '/editor' || raw === '/user') return raw;
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
  if (/^\/pages\/(?!\.\.?$)[\p{L}\p{N}._-]+$/u.test(raw)) return raw;
  if (/^\/u\/[0-9a-f]{64}\/pages\/(?!\.\.?$)[\p{L}\p{N}._-]+$/u.test(raw)) return raw;
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

/**
 * A cell's position on a board: x/y from the top-left, w/h in units. All four or
 * nothing — a half-specified rect would place a cell somewhere nobody asked for.
 * The width is capped by the board, the height is free-ish.
 */
function normalizePos(raw, cols) {
  const src = raw && typeof raw === 'object' ? raw : null;
  if (!src) return null;
  const [x, y, w, h] = [src.x, src.y, src.w, src.h].map(Number);
  if (![x, y, w, h].every(Number.isFinite)) return null;
  const width = Math.min(Math.max(Math.round(w), 1), Math.min(cols, MAX_CELL_UNITS));
  const height = Math.min(Math.max(Math.round(h), 1), MAX_CELL_UNITS);
  return {
    x: Math.min(Math.max(Math.round(x), 0), Math.max(0, cols - width)),
    y: Math.min(Math.max(Math.round(y), 0), MAX_ROWS - height),
    w: width,
    h: height,
  };
}

const sizeUnits = (cell) => SIZE_UNITS[cell.size] || SIZE_UNITS['1x1'];

function normalizeCell(raw, { layout = 'flow', columns = MAX_COLS } = {}) {
  const src0 = raw && typeof raw === 'object' ? raw : {};
  // 过渡：早先试过一版「封面模式」（htmlCover 布尔，页面藏在封面后面）。
  // 现在「封面」和「嵌入的页面」是两个字段，那一版的意思就是「网页当嵌入的页面、
  // 封面退成纯色」，照这个搬过来，老数据看上去不会变。
  const src = src0.htmlCover === true
    ? { ...src0, type: src0.type === 'html' ? 'solid' : src0.type, embed: src0.embed || src0.html, html: '' }
    : src0;
  const type = oneOf(src.type, TYPES, 'image');
  const cell = {
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
    // 「网页封面」那张页面：直接铺在格子上渲染（多半是个带动画的 HTML）
    html: safePageUrl(src.html),
    // 「嵌入的页面」：任何类型都能再嵌一个，和封面是两回事 ——
    // 有它，格子上才会浮出放大角标、点开全屏
    embed: safePageUrl(src.embed),
    // shared
    link: safeUrl(src.link),
    overlay: normalizeOverlay(src.overlay),
  };

  // Positions are kept in both layouts: a flow doc that has been on a board must
  // not lose its arrangement when it switches back and forth.
  const pos = normalizePos(src.pos, layout === 'board' ? columns : MAX_COLS);
  if (pos) cell.pos = pos;
  return cell;
}

const rectsOverlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function firstFreeSpot(rects, cols, w, h) {
  const width = Math.max(1, Math.min(w, cols));
  for (let y = 0; y < MAX_ROWS; y += 1) {
    for (let x = 0; x + width <= cols; x += 1) {
      const rect = { x, y, w: width, h };
      if (!rects.some((other) => rectsOverlap(other, rect))) return rect;
    }
  }
  return { x: 0, y: 0, w: width, h };
}

/**
 * Board documents arrive from the browser, from a hand-edited site.json, or
 * from an import — and CSS grid will happily stack explicitly placed items on
 * top of each other, so the server is the last line of defence: every cell
 * either keeps a position that is free and inside the board, or gets moved to
 * the first free spot. It never drops a cell, and it is deterministic.
 */
function resolveBoard(cells, cols) {
  const placed = [];
  for (const cell of cells) {
    const units = cell.pos || { w: sizeUnits(cell).w, h: sizeUnits(cell).h };
    const wanted = { x: cell.pos ? cell.pos.x : 0, y: cell.pos ? cell.pos.y : 0, ...units };
    const clashes = placed.some((other) => rectsOverlap(other, wanted));
    const outOfBounds = wanted.x + wanted.w > cols || wanted.x < 0 || wanted.y < 0;

    if (cell.pos && !clashes && !outOfBounds) {
      placed.push(cell.pos);
      continue;
    }
    const spot = firstFreeSpot(placed, cols, units.w, units.h);
    if (cell.pos) console.warn('[store] board repaired: %s moved to %d,%d', cell.id, spot.x, spot.y);
    cell.pos = spot;
    placed.push(spot);
  }
  return cells;
}

function normalizeDoc(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const site = src.site && typeof src.site === 'object' ? src.site : {};
  const layout = oneOf(site.layout, LAYOUTS, 'flow');
  let columns = safeNumber(site.columns, 0, MAX_COLS, 0);
  // a board is a fixed layout: it needs a real column count
  if (layout === 'board') columns = Math.min(MAX_COLS, Math.max(MIN_BOARD_COLS, columns || DEFAULT_BOARD_COLS));

  // 窄屏重排的阈值。夹紧而不是交换 —— 交换会一次改掉两个值，面板上显示的和刚输入的
  // 就对不上了；写反了就把手机阈值压到 pad 下面，别让 pad 档整个消失。
  // 注意 safeNumber 对非法值是直接返回 fallback、不做夹紧，所以不能靠传 max 实现。
  const padWidth = safeNumber(site.padWidth, MIN_BREAKPOINT, MAX_BREAKPOINT, DEFAULT_PAD_WIDTH);
  const phoneWidth = Math.min(
    safeNumber(site.phoneWidth, MIN_BREAKPOINT, MAX_BREAKPOINT, DEFAULT_PHONE_WIDTH),
    padWidth - 1
  );
  const cells = Array.isArray(src.cells)
    ? src.cells.slice(0, MAX_CELLS).map((cell) => normalizeCell(cell, { layout, columns }))
    : [];

  // ids must stay unique or the admin UI keys collide
  const seen = new Set();
  for (const cell of cells) {
    if (seen.has(cell.id)) cell.id = newId();
    seen.add(cell.id);
  }

  if (layout === 'board') resolveBoard(cells, columns);

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
      // 0 = fill the window with as many cells as fit (flow only); otherwise the
      // number of columns, which a board needs to be able to rely on
      columns,
      // 'flow' = an ordered list that CSS packs; 'board' = cells have positions.
      // Absent means flow, which is what every document written before boards is.
      layout,
      // the air between cells, three steps; the CSS var --gap comes from it
      gap: oneOf(site.gap, GAP_LEVELS, 'm'),
      // 棋盘在窄屏上重排成几列。0 是合法值（这一档不重排、保持棋盘原样），
      // 所以读的时候不能用 `||`。默认关闭：老文档没有这些键 = 维持今天的行为。
      responsive: site.responsive === true,
      padWidth,
      phoneWidth,
      padColumns: safeNumber(site.padColumns, 0, MAX_COLS, DEFAULT_PAD_COLUMNS),
      phoneColumns: safeNumber(site.phoneColumns, 0, MAX_COLS, DEFAULT_PHONE_COLUMNS),
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
function seedAssetsInto(dir) {
  if (fs.existsSync(dir)) return;
  let bundled = [];
  try {
    bundled = fs.readdirSync(SEED_ASSETS_DIR).filter((name) => !name.startsWith('.'));
  } catch {
    bundled = []; // trimmed checkout: nothing to seed
  }
  fs.mkdirSync(dir, { recursive: true });
  for (const name of bundled) {
    fs.copyFileSync(path.join(SEED_ASSETS_DIR, name), path.join(dir, name));
  }
  if (bundled.length) console.log('[store] seeded %d bundled file(s) into %s', bundled.length, dir);
}

const seedAssets = () => seedAssetsInto(ASSETS_DIR);

/** Atomic JSON write: temp file next to the target, then rename over it. */
function writeJsonAtomic(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
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
  SEED_DIR,
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
  seedAssetsInto,
  writeJsonAtomic,
  read,
  write,
};
