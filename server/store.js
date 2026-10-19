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
/** 瀑布子盒子的尺寸键（宽 1..3、高 1..4）—— 镜像 web/js/shared.js 的 WATERFALL_SIZES。 */
const WATERFALL_SIZES = ['1x1', '2x1', '3x1', '4x1', '1x2', '2x2', '3x2', '4x2', '1x3', '2x3', '3x3', '4x3'];
/** 子盒子尺寸白名单：普通尺寸 + 瀑布尺寸。 */
const NESTED_SIZES = [...new Set([...SIZES, ...WATERFALL_SIZES])];
/** 瀑布尺寸的占格数（键是「行×列」）。 */
const WATERFALL_SIZE_UNITS = {
  '1x1': { w: 1, h: 1 },
  '2x1': { w: 1, h: 2 },
  '3x1': { w: 1, h: 3 },
  '4x1': { w: 1, h: 4 },
  '1x2': { w: 2, h: 1 },
  '2x2': { w: 2, h: 2 },
  '3x2': { w: 2, h: 3 },
  '4x2': { w: 2, h: 4 },
  '1x3': { w: 3, h: 1 },
  '2x3': { w: 3, h: 2 },
  '3x3': { w: 3, h: 3 },
  '4x3': { w: 3, h: 4 },
};

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

/**
 * 把子盒子的尺寸键换算成「宽度已经裁到 columns」的瀑布尺寸键。
 * 例如 4x4（宽4高4）在 2 列容器里会存成 4x2（宽2高4）；
 * 这样数据里记的就是实际占格，下次打开尺寸选择器也能正确高亮。
 */
function waterfallSizeKey(size, columns) {
  const units = SIZE_UNITS[size] || WATERFALL_SIZE_UNITS[size] || SIZE_UNITS['1x1'];
  const w = Math.max(1, Math.min(units.w, columns));
  const h = Math.max(1, units.h);
  for (const [key, value] of Object.entries(WATERFALL_SIZE_UNITS)) {
    if (value.w === w && value.h === h) return key;
  }
  return '1x1';
}

const DIRECTIONS = ['left', 'right', 'top', 'bottom'];
const RATIOS = ['1/1', '1/2'];
const TYPES = ['image', 'solid', 'html', 'container'];
/** 容器里能放的类型：容器不能嵌套（子盒子不可以是容器）。 */
const CHILD_TYPES = ['image', 'solid', 'html'];
/** 容器的呈现模式：轮播 / 瀑布。 */
const CONTAINER_MODES = ['carousel', 'waterfall'];
/** 瀑布的排布方式：Z 字（行优先找第一个空位）/ 最短列（每次放当前最矮的一列）。 */
const CONTAINER_RENDERS = ['z', 'shortest'];
/** 轮播方向 = 内容移动的方向。和悬浮详情的 DIRECTIONS 是两套词。 */
const CONTAINER_DIRECTIONS = ['left', 'right', 'up', 'down'];
/** 瀑布的列数和默认值（客户端也有一份，必须同步）。 */
const MIN_CONTAINER_COLUMNS = 1;
const MAX_CONTAINER_COLUMNS = 3;
const DEFAULT_CONTAINER_COLUMNS = 2;
/** 格子的点击用哪个：跳转链接，还是全屏展开嵌入的页面（两者互斥，但两个地址都留着）。 */
const CLICK_MODES = ['link', 'embed'];
const FITS = ['cover', 'contain'];
/** 'flow' = an ordered list CSS packs; 'board' = every cell has a position. */
const LAYOUTS = ['flow', 'board'];
/** How much air to leave between cells: s / m / l → 8 / 16 / 28 px. */
const GAP_LEVELS = ['s', 'm', 'l'];

const MAX_CELLS = 200;
/** 一个容器最多放多少个盒子（防跑飞；客户端也有一份，必须同步）。 */
const MAX_CONTAINER_ITEMS = 30;
/** 自动轮播的间隔，秒。 */
const MIN_CONTAINER_INTERVAL = 2;
const MAX_CONTAINER_INTERVAL = 60;
const DEFAULT_CONTAINER_INTERVAL = 5;
const MAX_TITLE = 120;
const MAX_BODY = 2000;
const MAX_URL = 2048;
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_COLS = 12;
const MIN_BOARD_COLS = 3;
const DEFAULT_BOARD_COLS = 12;
const MAX_CELL_UNITS = 12;
/** 全屏展开时的留白档位：上下% / 左右%，'0/0' = 铺满。 */
const FS_MARGINS = ['0/0', '5/5', '5/10', '10/10', '10/15', '15/15', '20/20'];

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

/**
 * 颜色字段：合法 hex 照旧；**空串表示「无」**（不画边框 / 不铺底色）；
 * 其余（缺字段、写坏了）退回默认值。老数据全是 hex，行为不变。
 */
function safeColorOrNone(value, fallback) {
  return value === '' ? '' : safeColor(value, fallback);
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

/**
 * 全屏展开时的样子：留白档位（固定的几档，上下/左右两个百分比）、页面圆角、留白色。
 * 只收预置档位而不是任意数字 —— 界面上就是几个缩略图，省得每个人自己纠结填多少。
 */
function normalizeFullscreen(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    margin: oneOf(src.margin, FS_MARGINS, '0/0'),
    radius: safeNumber(src.radius, 0, 64, 14),
    color: safeColor(src.color, '#08070d'),
  };
}

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

/**
 * 容器盒子：一个格子里放多个子盒子。目前只有轮播模式。
 *
 * 子盒子仍是一颗完整的 cell（图片 / 纯色 / 网页、边框、角标、悬浮详情、链接 / 嵌入页都照旧），
 * 但它们**不参与摆位**：没有 id、没有 pos，size 固定成 1x1（只是占位 —— 渲染时永远铺满容器，
 * 绝不拿这个 size 去算尺寸）。删掉 id 也让归一化保持幂等：反复读取不会每次生成新 id。
 *
 * 容器不能嵌套：显式的 container 子项直接丢掉，`nested: true` 再兜一层
 * （子项 type 只能在 CHILD_TYPES 里取，取不到就回落成 image）。
 */
function normalizeContainer(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const mode = oneOf(src.mode, CONTAINER_MODES, 'carousel');
  const columns = safeNumber(
    src.columns,
    MIN_CONTAINER_COLUMNS,
    MAX_CONTAINER_COLUMNS,
    DEFAULT_CONTAINER_COLUMNS
  );
  const items = [];
  if (Array.isArray(src.items)) {
    for (const item of src.items) {
      if (items.length >= MAX_CONTAINER_ITEMS) break;
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      if (item.type === 'container') continue; // 容器不能嵌套
      // nestedSize：轮播会忽略它，瀑布用「宽度裁到列数、高度按模版」来排；
      // 保留尺寸也让轮播 / 瀑布来回切换时不丢子盒子的高矮设置。
      const child = normalizeCell(item, { nested: true, nestedSize: true });
      delete child.id;
      delete child.pos;
      // 瀑布直接把宽度裁到当前列数并落到对应的尺寸键上（4x4 + 2 列 → 4x2）；
      // 轮播保留原模版（渲染时不用，切回瀑布还能继续用）。
      if (mode === 'waterfall') child.size = waterfallSizeKey(child.size, columns);
      items.push(child);
    }
  }
  return {
    mode,
    // 内容移动方向：left = 当前张向左退出、下一张从右侧进入（轮播用）
    direction: oneOf(src.direction, CONTAINER_DIRECTIONS, 'left'),
    autoplay: typeof src.autoplay === 'boolean' ? src.autoplay : true,
    interval: safeNumber(
      src.interval,
      MIN_CONTAINER_INTERVAL,
      MAX_CONTAINER_INTERVAL,
      DEFAULT_CONTAINER_INTERVAL
    ),
    // 瀑布用：列数 1..3，排布方式 z / shortest
    columns,
    render: oneOf(src.render, CONTAINER_RENDERS, 'z'),
    items,
  };
}

function normalizeCell(raw, { layout = 'flow', columns = MAX_COLS, nested = false, nestedSize = false } = {}) {
  const src0 = raw && typeof raw === 'object' ? raw : {};
  // 过渡：早先试过一版「封面模式」（htmlCover 布尔，页面藏在封面后面）。
  // 现在「封面」和「嵌入的页面」是两个字段，那一版的意思就是「网页当嵌入的页面、
  // 封面退成纯色」，照这个搬过来，老数据看上去不会变。
  const src = src0.htmlCover === true
    ? { ...src0, type: src0.type === 'html' ? 'solid' : src0.type, embed: src0.embed || src0.html, html: '' }
    : src0;
  const type = oneOf(src.type, nested ? CHILD_TYPES : TYPES, 'image');
  const cell = {
    id: typeof src.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(src.id) ? src.id : newId(),
    type,
    // 轮播子盒子由容器决定尺寸（1x1 只是占位）；瀑布子盒子保留尺寸模版，
    // 宽度渲染时裁到容器列数、高度原样使用。
    size: nested ? (nestedSize ? oneOf(src.size, NESTED_SIZES, '1x1') : '1x1') : oneOf(src.size, SIZES, '1x1'),
    borderColor: safeColorOrNone(src.borderColor, '#7e46b9'),
    borderWidth: safeNumber(src.borderWidth, 0, 20, 2),
    radius: safeNumber(src.radius, 0, 64, 14),
    // image cells
    image: safeUrl(src.image),
    imageFit: oneOf(src.imageFit, FITS, 'cover'),
    imageTitle: clampText(src.imageTitle, MAX_TITLE),
    imageTitleColor: safeColor(src.imageTitleColor, '#ffffff'),
    // solid cells
    color: safeColorOrNone(src.color, '#7e46b9'),
    // 「网页封面」那张页面：直接铺在格子上渲染（多半是个带动画的 HTML）
    html: safePageUrl(src.html),
    // 「嵌入的页面」：任何类型都能再嵌一个，和封面是两回事 ——
    // 有它（且 clickMode 是 embed），格子上才会浮出放大角标、点开全屏
    embed: safePageUrl(src.embed),
    // 两个地址都留着，这里只记哪个生效。缺省按老规矩推断：只填了链接就是链接，
    // 其余情况（只填嵌入、两个都有、都没有）算嵌入 —— 和之前的渲染取舍一致。
    clickMode: oneOf(src.clickMode, CLICK_MODES, src.link && !src.embed ? 'link' : 'embed'),
    // shared
    link: safeUrl(src.link),
    overlay: normalizeOverlay(src.overlay),
    fullscreen: normalizeFullscreen(src.fullscreen),
  };

  if (!nested && type === 'container') {
    cell.container = normalizeContainer(src.container);
    // 容器本身不参与链接 / 嵌入 / 角标 / 悬浮详情：容器若是 <a>，里面的子盒子链接
    // 就成了嵌套 <a>。编辑面板也把这几项藏起来，这里把值也清成确定的空值（幂等）。
    cell.image = '';
    cell.html = '';
    cell.embed = '';
    cell.link = '';
    cell.imageTitle = '';
    cell.clickMode = 'embed';
    cell.overlay = normalizeOverlay({});
  }

  if (!nested) {
    // Positions are kept in both layouts: a flow doc that has been on a board must
    // not lose its arrangement when it switches back and forth.
    const pos = normalizePos(src.pos, layout === 'board' ? columns : MAX_COLS);
    if (pos) cell.pos = pos;
  }
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
  WATERFALL_SIZES,
  DIRECTIONS,
  RATIOS,
  TYPES,
  CHILD_TYPES,
  CONTAINER_MODES,
  CONTAINER_RENDERS,
  CONTAINER_DIRECTIONS,
  MIN_CONTAINER_COLUMNS,
  MAX_CONTAINER_COLUMNS,
  DEFAULT_CONTAINER_COLUMNS,
  MAX_CONTAINER_ITEMS,
  MIN_CONTAINER_INTERVAL,
  MAX_CONTAINER_INTERVAL,
  DEFAULT_CONTAINER_INTERVAL,
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
