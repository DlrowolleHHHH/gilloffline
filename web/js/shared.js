/**
 * Cell vocabulary + DOM builder shared by the showcase page and the editor.
 */

/**
 * Cell sizes. The key reads 行 × 列 — `1x2` is one row tall and two columns
 * wide — which is how the labels and the README have always described them.
 */
export const SIZES = {
  '1x1': { w: 1, h: 1, label: '方形', note: '宽 1 × 高 1' },
  '2x2': { w: 2, h: 2, label: '大方形', note: '宽 2 × 高 2' },
  '3x3': { w: 3, h: 3, label: '大方块', note: '宽 3 × 高 3' },
  '4x4': { w: 4, h: 4, label: '巨方块', note: '宽 4 × 高 4' },
  '1x2': { w: 2, h: 1, label: '矩形', note: '宽 2 × 高 1' },
  '1x4': { w: 4, h: 1, label: '长矩形', note: '宽 4 × 高 1' },
  '2x4': { w: 4, h: 2, label: '大矩形', note: '宽 4 × 高 2' },
  '3x6': { w: 6, h: 3, label: '宽横幅', note: '宽 6 × 高 3' },
  '4x8': { w: 8, h: 4, label: '全宽横幅', note: '宽 8 × 高 4' },
};

export const SIZE_ORDER = ['1x1', '1x2', '1x4', '2x2', '3x3', '4x4', '2x4', '3x6', '4x8'];

/** `direction` is the side the detail panel slides in from. */
export const DIRECTIONS = [
  { value: 'left', label: '从左滑入' },
  { value: 'right', label: '从右滑入' },
  { value: 'top', label: '从上滑入' },
  { value: 'bottom', label: '从下滑入' },
];

export const RATIOS = [
  { value: '1/1', label: '覆盖整个格子（1/1）' },
  { value: '1/2', label: '覆盖一半（1/2）' },
];

/** Unique id for a freshly created cell. */
export function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return 'c' + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function defaultOverlay() {
  return {
    enabled: true,
    title: '',
    body: '',
    direction: 'left',
    ratio: '1/1',
    bgColor: '#0b0a12f2',
    textColor: '#ffffff',
  };
}

/** 全屏展开的默认观感：铺满、深色留白。 */
export function defaultFullscreen() {
  return { top: 0, right: 0, bottom: 0, left: 0, color: '#08070d' };
}

export function defaultCell(overrides = {}) {
  return {
    id: newId(),
    type: 'image',
    size: '1x1',
    borderColor: '#7e46b9',
    borderWidth: 2,
    radius: 14,
    image: '',
    imageFit: 'cover',
    imageTitle: '',
    imageTitleColor: '#ffffff',
    color: '#7e46b9',
    html: '',
    link: '',
    overlay: defaultOverlay(),
    fullscreen: defaultFullscreen(),
    ...overrides,
  };
}

/**
 * Permissions handed to an embedded page. Scripts are allowed, but omitting
 * `allow-same-origin` leaves the frame on an opaque origin: it cannot read the
 * site's cookies or call its API, and it cannot reach the page around it.
 */
const FRAME_SANDBOX = 'allow-scripts allow-forms allow-popups allow-modals allow-downloads';

/**
 * The one reader of a cell's size. A cell placed on a board carries `pos`
 * (x/y/w/h in grid units, possibly a freehand size); everything else falls back
 * to the named size. Nothing ever derives one from the other — the key order in
 * `size` is 行×列 (`3x6` is 6 wide, 3 tall), so string-parsing it is a trap.
 */
export function cellUnits(cell) {
  const pos = cell && cell.pos;
  if (pos && Number.isFinite(pos.w) && Number.isFinite(pos.h)) {
    return { w: Math.max(1, Math.round(pos.w)), h: Math.max(1, Math.round(pos.h)) };
  }
  const size = SIZES[(cell && cell.size) || ''] || SIZES['1x1'];
  return { w: size.w, h: size.h };
}

/**
 * The placement classes describe the named size, which is what the flow layout
 * uses; a cell drawn freehand on a board carries a `pos` instead and gets its
 * real size from the board layout pass.
 */
export function cellClasses(cell) {
  const size = SIZES[cell.size] || SIZES['1x1'];
  const classes = ['cell', `cell--${cell.type}`, `w${size.w}`, `h${size.h}`];
  if (size.w > 1) classes.push(`cell--w${size.w}`);
  return classes;
}

export function applyCellStyle(node, cell) {
  node.style.setProperty('--radius', `${cell.radius}px`);
  node.style.setProperty('--bw', `${cell.borderWidth}px`);
  // 空串 = 无：边框还在（粗细占位不变），只是不画颜色；底色则是整块透明
  node.style.setProperty('--border', cell.borderColor || 'transparent');
  node.style.setProperty('--caption-fg', cell.imageTitleColor);
  if (cell.type === 'solid') node.style.setProperty('--solid', cell.color || 'transparent');
}

/**
 * 沙箱里的 iframe —— 格子里和全屏展开用的是同一个。
 *
 * 集中在这里，是为了让「HTML 页面一律跑在非 same-origin 的沙箱里」这条规则只有
 * 一个出处：沙箱**不能**加 allow-same-origin（那等于把本站的登录状态交给页面）。
 */
export function createFrame(src, title) {
  const frame = document.createElement('iframe');
  frame.className = 'cell__frame';
  frame.src = src;
  frame.loading = 'lazy';
  frame.title = title || '嵌入的页面';
  frame.referrerPolicy = 'no-referrer';
  frame.setAttribute('sandbox', FRAME_SANDBOX);
  return frame;
}

/**
 * Build the DOM for one showcase cell. Everything is written with textContent,
 * never innerHTML, so stored values can never inject markup.
 */
/** Pages that follow whoever's site they are on. */
const SITE_PAGES = ['/admin', '/editor'];

/**
 * Resolve a cell's link for the page we are on: an entry point stored as
 * `/admin` (or `/editor`) picks up the current userid, so the same cell in the
 * seed leads the owner to /admin and a sub-admin to /admin?userid=….
 */
export function resolveLink(link) {
  return SITE_PAGES.includes(link) ? withUserid(link) : link;
}

export function createCell(cell) {
  // 「跳转链接」和「嵌入的页面」互斥：两个地址都留着，由 clickMode 说哪个生效
  const clickEmbed = cell.clickMode !== 'link' ? cell.embed || '' : '';
  const clickLink = cell.clickMode === 'link' ? cell.link || '' : '';
  const node = document.createElement(clickLink ? 'a' : 'article');
  node.className = cellClasses(cell).join(' ');
  node.dataset.id = cell.id;
  node.dataset.fit = cell.imageFit;
  // the layout pass needs the units; the classes alone are not readable back
  node.dataset.w = SIZES[cell.size] ? SIZES[cell.size].w : 1;
  node.dataset.h = SIZES[cell.size] ? SIZES[cell.size].h : 1;
  if (clickLink) node.draggable = false; // a native link drag fights the board
  applyCellStyle(node, cell);

  if (clickLink) {
    node.href = resolveLink(clickLink);
    node.target = '_blank';
    node.rel = 'noopener noreferrer';
  }

  if (cell.type === 'image') {
    const media = document.createElement('div');
    media.className = 'cell__media';
    if (cell.image) {
      const img = document.createElement('img');
      img.src = cell.image;
      img.alt = cell.imageTitle || '';
      img.loading = 'lazy';
      img.decoding = 'async';
      media.append(img);
    }
    node.append(media);
  }

  if (cell.type === 'html') {
    const media = document.createElement('div');
    media.className = 'cell__media';
    if (cell.html) {
      // 网页封面：封面本身就是一张页面（多半是个带动画的 HTML），直接铺在格子上
      media.append(createFrame(cell.html, cell.imageTitle));
    } else {
      media.classList.add('cell__media--empty');
      const hint = document.createElement('span');
      hint.className = 'cell__hint';
      hint.textContent = '还没有封面页面';
      media.append(hint);
    }
    node.append(media);
  }

  /*
   * 嵌入的页面：和封面是两回事，任何类型都能有一个（图片/纯色封面 + 里面嵌一个应用）。
   * 有它，格子上才会浮出放大角标、点一下全屏展开；页面本身**不加载**，等点开再说。
   * 地址挂在 dataset 上给主页用。
   *
   * 用 <span> 而不是 <button>：格子配了链接时整格是 <a>，<a> 里不能再放交互元素。
   */
  if (clickEmbed) {
    node.dataset.fullscreen = clickEmbed;
    // 全屏展开时的四边留白和留白色（主页 openFullscreen 读它）
    const fs = cell.fullscreen || defaultFullscreen();
    node.dataset.fsMargin = [fs.top, fs.right, fs.bottom, fs.left].map((n) => Number(n) || 0).join(',');
    node.dataset.fsColor = fs.color || defaultFullscreen().color;
    const expand = document.createElement('span');
    expand.className = 'cell__expand';
    expand.setAttribute('role', 'button');
    expand.setAttribute('tabindex', '0');
    expand.setAttribute('aria-label', `全屏查看：${cell.imageTitle || '嵌入的页面'}`);
    node.append(expand);
  }

  // 角标三种类型都有：它常显在底部，和封面是什么无关
  if (cell.imageTitle) {
    const caption = document.createElement('span');
    caption.className = 'cell__caption';
    caption.textContent = cell.imageTitle;
    node.append(caption);
  }

  const overlay = cell.overlay || {};
  const hasDetail = overlay.enabled !== false && (overlay.title || overlay.body);
  if (hasDetail) {
    const panel = document.createElement('div');
    panel.className = 'cell__overlay';
    panel.dataset.dir = overlay.direction || 'left';
    panel.dataset.ratio = overlay.ratio || '1/1';
    panel.style.setProperty('--ov-bg', overlay.bgColor);
    panel.style.setProperty('--ov-fg', overlay.textColor);

    if (overlay.title) {
      const heading = document.createElement('h3');
      heading.className = 'cell__overlay-title';
      heading.textContent = overlay.title;
      panel.append(heading);
    }
    if (overlay.body) {
      const body = document.createElement('p');
      body.className = 'cell__overlay-body';
      body.textContent = overlay.body;
      panel.append(body);
    }

    node.append(panel);
    node.tabIndex = 0;
  }

  return node;
}

/**
 * Whose page are we on? `?userid=…` for a sub-admin's site, empty for the
 * owner's own. Every page that talks to the API carries it along, which is what
 * keeps the two kinds of site apart.
 */
export function currentUserid() {
  return new URLSearchParams(location.search).get('userid') || '';
}

/** Add the current userid to an API path, when there is one. */
export function withUserid(path) {
  const userid = currentUserid();
  if (!userid) return path;
  return `${path}${path.includes('?') ? '&' : '?'}userid=${encodeURIComponent(userid)}`;
}

/** A bundled site image (logo.svg, title.png) belonging to whoever owns the page. */
export function assetUrl(name) {
  const userid = currentUserid();
  return userid ? `/u/${userid}/assets/${name}` : `/assets/${name}`;
}

/** Smallest a cell may get before the layout drops a column instead. */
const MIN_CELL = 96;
/** The board is at most this wide — and only nominally this tall. */
export const MAX_COLS = 12;
export const MAX_ROWS = 1000;

/** The air between cells, three steps. Mirrors GAP_LEVELS in server/store.js. */
export const GAP_PX = { s: 8, m: 16, l: 28 };
export const gapPx = (level) => GAP_PX[level] || GAP_PX.m;

/**
 * 读一个「数字设置」：空值回落到默认值，其余原样转数字。
 * 不能写成 `Number(v) || 默认值` —— 列数里的 0 是合法值（这一档不重排），会被吃掉；
 * 管理页刚改完还没保存时，存进文档的是输入框的**字符串**，也要能读。
 */
export function numberSetting(value, fallback) {
  if (value === '' || value === null || value === undefined) return fallback;
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? n : fallback;
}

/**
 * 视口宽度。用 documentElement.clientWidth 而不是 window.innerWidth：媒体查询看的就是
 * 前者（不含经典滚动条），innerWidth 在 Windows/Linux 上会大十几像素，让这些阈值和
 * showcase.css 里那几个断点在边界附近互相打架。也不用容器宽——阈值是「设备」的概念。
 */
export const viewportWidth = () => document.documentElement.clientWidth;

/**
 * 窄屏该把棋盘重排成几列；**0 = 不重排**（保持棋盘构图）。
 *
 * 只对 `layout: 'board'` 有意义：flow 本来就跟着窗口重排，档位对它是多余的。
 * 这里替调用点把这件事挡住，免得有人把档位列数喂给 applyGridLayout 的 board 分支
 * ——那个分支会把 columns 当成**棋盘列数**用，棋盘会被压扁。
 *
 * 永远返回 Number（文档里的值可能是字符串），并且先判窄档再判宽档：反过来的话
 * pad 档永远命中，手机档形同虚设。
 */
export function repackColumns(site, width = viewportWidth()) {
  const src = site || {};
  if (src.layout !== 'board' || src.responsive !== true) return 0;
  if (width < numberSetting(src.phoneWidth, 640)) return Math.max(0, numberSetting(src.phoneColumns, 2));
  if (width < numberSetting(src.padWidth, 1024)) return Math.max(0, numberSetting(src.padColumns, 4));
  return 0;
}

/** What the layout pass positions: the cells, or their wrappers on the board. */
const PLACED = ':scope > [data-w]';

/* ------------------------------------------------------------------ geometry */

/** Flat rects ({x,y,w,h} in grid units) — what all the collision checks speak. */
export const rectsOverlap = (a, b) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export const rectOf = (cell) => (cell.pos ? { id: cell.id, ...cell.pos } : null);

/** Do the placed rects (a list of flat rects) leave this one alone? */
export const rectFree = (rects, rect) => !rects.some((other) => rectsOverlap(other, rect));

/**
 * First free spot for a w×h box, scanning row by row — the same order CSS
 * `grid-auto-flow: row dense` fills, which is what makes the flow → board
 * conversion reproduce the layout that is on screen today.
 */
export function firstFreeSpot(rects, cols, w, h) {
  const width = Math.max(1, Math.min(w, cols));
  for (let y = 0; y < MAX_ROWS; y += 1) {
    for (let x = 0; x + width <= cols; x += 1) {
      const rect = { x, y, w: width, h };
      if (rectFree(rects, rect)) return rect;
    }
  }
  return { x: 0, y: 0, w: width, h };
}

/**
 * Keep the positions that are free and inside the board, and re-place the rest —
 * what the server does on save, mirrored here so an import previews correctly.
 */
export function repairBoard(cells, cols) {
  const rects = [];
  return cells.map((cell) => {
    const { w, h } = cellUnits(cell);
    const width = Math.max(1, Math.min(w, cols));
    const wanted = cell.pos && {
      x: Math.round(cell.pos.x) || 0,
      y: Math.round(cell.pos.y) || 0,
      w: width,
      h: Math.max(1, Math.round(cell.pos.h) || h),
    };
    const fits =
      wanted && wanted.x >= 0 && wanted.y >= 0 && wanted.x + wanted.w <= cols && rectFree(rects, wanted);
    const rect = fits ? wanted : firstFreeSpot(rects, cols, width, h);
    rects.push({ id: cell.id, ...rect });
    return { ...cell, pos: rect };
  });
}

/** Give every cell a position, packing them in array order (the flow order). */
export function packBoard(cells, cols) {
  const rects = [];
  return cells.map((cell) => {
    const { w, h } = cellUnits(cell);
    const rect = firstFreeSpot(rects, cols, w, h);
    rects.push({ id: cell.id, ...rect });
    return { ...cell, pos: rect };
  });
}

/* -------------------------------------------------------------------- layout */

/**
 * Lay out a grid of cells.
 *
 * `layout: 'flow'` is the original behaviour: cells are an ordered list and CSS
 * places them (auto-fill when `columns` is 0, otherwise that many evenly sized
 * columns, with wide cells capped and dropped on narrow windows).
 *
 * `layout: 'board'` positions every item from its own x/y/w/h — nothing reflows,
 * the cells just scale with the container. It is up to the caller (and the
 * server) to keep those positions inside the board and out of each other's way:
 * CSS grid happily stacks explicitly placed items on top of one another.
 */
export function applyGridLayout(
  grid,
  columns,
  { layout = 'flow', cells = [], minCell = MIN_CELL, scale = 1 } = {}
) {
  const style = getComputedStyle(grid);
  const gap = Number.parseFloat(style.getPropertyValue('--gap')) || 16;
  const items = [...grid.querySelectorAll(PLACED)];
  const width = grid.clientWidth || grid.parentElement?.clientWidth || 0;
  if (!width) return; // hidden (a closed drawer): the next pass will size it

  grid.classList.toggle('is-board', layout === 'board');

  if (layout === 'board') {
    const cols = Math.max(1, Math.min(MAX_COLS, Math.round(columns) || MAX_COLS));
    // `scale` is the editor's zoom, always ≤ 1: more of the board fits into the
    // panel at once. It multiplies the gap as well as the cell, so the whole
    // board scales as one picture — the fit itself is measured at the site's
    // real spacing, which keeps 50% exactly half.
    const zoomGap = gap * scale;
    const size = Math.max(minCell, (width - (cols - 1) * gap) / cols) * scale;
    const padX = Number.parseFloat(style.paddingLeft) || 0;
    const padY = Number.parseFloat(style.paddingTop) || 0;
    const padRight = Number.parseFloat(style.paddingRight) || 0;

    // The lattice and the pointer maths both need to know where the tracks are.
    // The tracks are centred (see .admin-board), which at 100% means nothing and
    // at 15% means the whole board sits in the middle of an empty panel.
    const tracks = cols * size + (cols - 1) * zoomGap;
    const free = grid.clientWidth - padX - padRight - tracks;
    const centered = Math.max(0, free / 2);

    grid.classList.add('is-fixed');
    grid.style.setProperty('--gap', `${zoomGap.toFixed(2)}px`);
    grid.style.setProperty('--cols', String(cols));
    grid.style.setProperty('--cell-size', `${size.toFixed(2)}px`);
    grid.style.setProperty('--board-x', `${(padX + centered).toFixed(2)}px`);
    grid.style.setProperty('--board-y', `${padY.toFixed(2)}px`);
    grid.style.setProperty('--board-w', `${tracks.toFixed(2)}px`);
    grid.dataset.cols = String(cols);
    grid.dataset.pitch = (size + zoomGap).toFixed(2); // the editor measures pointers with this
    // where the tracks actually start, measured from the border box the pointer
    // arrives in — border, padding and centring included
    grid.dataset.inset = `${(grid.clientLeft + padX + centered).toFixed(2)},${(grid.clientTop + padY).toFixed(2)}`;

    const byId = new Map(cells.map((cell) => [cell.id, cell]));
    for (const item of items) {
      const cell = byId.get(item.dataset.id);
      const { w, h } = cellUnits(cell || {});
      const pos = (cell && cell.pos) || { x: 0, y: 0 };
      const span = Math.max(1, Math.min(w, cols));
      const x = Math.max(0, Math.min(Math.round(pos.x) || 0, cols - span));
      const y = Math.max(0, Math.round(pos.y) || 0);
      item.style.gridColumn = `${x + 1} / span ${span}`;
      item.style.gridRow = `${y + 1} / span ${Math.max(1, h)}`;
    }
    return;
  }

  // switching back from a board must not leave absolute placement behind
  for (const item of items) item.style.removeProperty('grid-row');

  if (!columns) {
    grid.classList.remove('is-fixed');
    grid.style.removeProperty('--cols');
    grid.style.removeProperty('--cell-size');
    for (const item of items) item.style.removeProperty('grid-column');
    return;
  }

  const fit = Math.max(1, Math.floor((width + gap) / (minCell + gap)));
  const cols = Math.max(1, Math.min(Math.round(columns), fit));
  const size = Math.max(minCell, (width - (cols - 1) * gap) / cols);

  grid.classList.add('is-fixed');
  grid.style.setProperty('--cols', String(cols));
  grid.style.setProperty('--cell-size', `${size.toFixed(2)}px`);
  for (const item of items) {
    const span = Number(item.dataset.w) || 1;
    item.style.gridColumn = `span ${Math.min(span, cols)}`;
  }
}

export async function fetchSite() {
  const res = await fetch(withUserid('/api/site'), { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`加载失败（${res.status}）`);
  return res.json();
}

export function toast(message, kind = '') {
  let node = document.querySelector('.toast');
  if (!node) {
    node = document.createElement('div');
    node.className = 'toast';
    document.body.append(node);
  }
  node.textContent = message;
  node.className = `toast is-visible ${kind ? `is-${kind}` : ''}`.trim();
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => node.classList.remove('is-visible'), 2600);
}
