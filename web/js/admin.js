import {
  SIZES,
  SIZE_ORDER,
  DIRECTIONS,
  RATIOS,
  applyGridLayout,
  cellUnits,
  createCell,
  currentUserid,
  defaultCell,
  defaultOverlay,
  firstFreeSpot,
  gapPx,
  numberSetting,
  newId,
  packBoard,
  rectFree,
  rectOf,
  repairBoard,
  toast,
  viewportWidth,
  withUserid,
} from './shared.js';
import { createBoard } from './board.js';

const $ = (id) => document.getElementById(id);

/** Whose page this is: a sub-admin when ?userid=… is present, else the owner's. */
const userid = currentUserid();
const isOwnerPage = userid === '';

const state = {
  doc: { site: {}, cells: [] },
  editingId: null,
  dirty: false,
};

/* --------------------------------------------------------------------- api */

async function api(path, { method = 'GET', body, raw, headers = {} } = {}) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: raw ? headers : { 'Content-Type': 'application/json', ...headers },
    body: raw ? body : body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return null;
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(payload.error || `请求失败（${res.status}）`);
    error.status = res.status;
    throw error;
  }
  return payload;
}

/* ------------------------------------------------------------------- views */

const loginView = $('login-view');
const appView = $('app-view');
const topbar = $('topbar-actions');

function showLogin(message) {
  loginView.hidden = false;
  appView.hidden = true;
  topbar.hidden = true;
  // a sub-admin's page wants a username; the owner's page only a password
  $('login-username').hidden = isOwnerPage;
  $('login-hint').textContent = isOwnerPage
    ? '请输入部署时通过环境变量配置的管理密码。'
    : '用注册时的用户名和密码登录。站主在这个页面输密码可以直接代管。';
  if (message) {
    const error = $('login-error');
    error.textContent = message;
    error.hidden = false;
  }
  $(isOwnerPage ? 'login-password' : 'login-username').focus();
}

function showApp() {
  loginView.hidden = true;
  appView.hidden = false;
  topbar.hidden = false;
  $('login-error').hidden = true;
  $('login-password').value = '';
  // managing people is the owner's job, and only from the owner's own page
  $('people-panel').hidden = !isOwnerPage;
  $('link-preview').href = withUserid('/');
  $('link-editor').href = withUserid('/editor');
}

/* --------------------------------------------------------------- site meta */

/** The ICP number the server took from the ICP_NUMBER env var, for the hint. */
let envIcp = '';

/**
 * An ICP number served from the ICP_NUMBER env var is a fallback, not stored
 * content: drop it from the document we hold so that saving the panel for some
 * unrelated reason cannot quietly freeze it into site.json.
 */
function absorbDoc(doc) {
  const fromEnv = doc.site?.icpFromEnv === true;
  if (fromEnv) {
    envIcp = doc.site.icp;
    doc.site.icp = '';
  } else {
    envIcp = '';
  }
  return doc;
}

/**
 * 棋盘上最宽的格子占几列：比它小的列数选项禁用掉，并说明原因。
 *
 * 格子的宽度随时会变（拖右下角手柄、新建、删除、抽屉里改宽），所以这件事挂在
 * `markDirty()` 上 —— 它是所有改动路径唯一的漏斗。只在加载/保存时算一次的话，
 * 拖完手柄提示还停在旧值上。
 */
function updateColumnFloor() {
  const floor = widestCell();
  for (const option of $('site-columns').options) {
    const value = Number(option.value);
    option.disabled = (value === 0 && isBoard()) || (value > 0 && value < floor);
  }
  // the standing explanation lives in the control's tooltip; this line only
  // speaks up when the board is currently refusing something
  const hint = $('site-columns-hint');
  hint.hidden = !(isBoard() && floor > 1);
  hint.textContent = `棋盘上最宽的格子占 ${floor} 列，列数不能小于它。`;
}

function renderSite() {
  const site = state.doc.site || {};
  // '自动' only means something to the flow layout
  const auto = $('site-columns').querySelector('option[value="0"]');
  auto.disabled = isBoard();
  auto.textContent = isBoard() ? '自动（棋盘用不了）' : '自动';
  updateColumnFloor();
  for (const input of document.querySelectorAll('[data-site]')) {
    const key = input.dataset.site;
    if (input.type === 'checkbox') input.checked = site[key] === true;
    else input.value = site[key] ?? (key === 'accent' ? '#7e46b9' : '');
  }

  const hint = $('icp-env-hint');
  hint.hidden = !site.icpFromEnv;
  if (site.icpFromEnv) {
    hint.textContent = `主页当前显示的是环境变量 ICP_NUMBER 里的「${envIcp}」，在上面填写并保存即可覆盖它。`;
  }

  renderResponsiveHint();
}

/**
 * 档位列数的选项：0 = 这一档不重排，其余 2–12。
 * 自己列一份是因为工具条那份没有 2，而手机上常用的就是 2 列。
 */
function buildResponsiveOptions() {
  for (const id of ['site-pad-columns', 'site-phone-columns']) {
    const select = $(id);
    for (const value of [0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
      const option = document.createElement('option');
      option.value = String(value);
      option.textContent = value === 0 ? '不重排' : `${value} 列`;
      select.append(option);
    }
  }
}

/**
 * 面板顶上那行实时说明：三档各自的取值，以及**当前窗口**命中哪一档——
 * 不用改窗口就能看懂这几个数字在说什么。
 */
function renderResponsiveHint() {
  const hint = $('responsive-hint');
  const site = state.doc.site || {};
  const describe = (value) => {
    const n = numberSetting(value, 0);
    return n > 0 ? `重排 ${n} 列` : '不重排';
  };
  if (!isBoard()) {
    hint.textContent = '当前是自动排布（flow）：它本来就会跟着窗口宽度重排，用不到这些设置。';
    return;
  }
  if (site.responsive !== true) {
    hint.textContent = '未使能：窄屏下棋盘整体缩小，缩到每格 96px 以下就横向滚动（今天的行为）。';
    return;
  }
  const pad = numberSetting(site.padWidth, 1024);
  const phone = numberSetting(site.phoneWidth, 640);
  const width = viewportWidth();
  const tier = width < phone ? '手机档' : width < pad ? 'pad 档' : '桌面档';
  hint.textContent =
    `≥ ${pad}px 棋盘原样 · ${phone}–${pad - 1}px ${describe(site.padColumns)}` +
    ` · < ${phone}px ${describe(site.phoneColumns)}　｜　当前窗口 ${width}px → ${tier}`;
}

function bindSitePanel() {
  buildResponsiveOptions();
  for (const input of document.querySelectorAll('[data-site]')) {
    const isToggle = input.type === 'checkbox';
    input.addEventListener(isToggle ? 'change' : 'input', () => {
      const key = input.dataset.site;
      if (key === 'columns' && isBoard()) {
        const floor = widestCell();
        const wanted = Number(input.value) || 0;
        if (wanted > 0 && wanted < floor) {
          toast(`棋盘上最宽的格子占 ${floor} 列，列数不能比它小`, 'error');
          input.value = String(Number(state.doc.site?.columns) || 12);
          return;
        }
      }
      state.doc.site = state.doc.site || {};
      state.doc.site[key] = isToggle ? input.checked : input.value;
      if (key === 'accent') document.documentElement.style.setProperty('--accent', input.value);
      if (key === 'columns') {
        if (isBoard()) {
          state.doc.cells = repairBoard(state.doc.cells, boardCols());
          renderBoard();
        }
        if (state.editingId) renderPreview();
      }
      // the gap is drawn by the board and the preview too, not just the home page
      if (key === 'gap') {
        layoutBoard();
        if (state.editingId) renderPreview();
      }
      if (RESPONSIVE_KEYS.includes(key)) {
        // 阈值反着写会让 pad 档整个消失；按服务端同一条规则（夹紧，不交换）先说一声并修正
        const pad = numberSetting(state.doc.site.padWidth, 1024);
        const phone = numberSetting(state.doc.site.phoneWidth, 640);
        if (phone >= pad) {
          state.doc.site.phoneWidth = Math.max(240, pad - 1);
          $('site-phone-width').value = String(state.doc.site.phoneWidth);
          toast(`手机阈值要小于 pad 阈值，已改成 ${state.doc.site.phoneWidth}`, 'error');
        }
        renderResponsiveHint();
      }
      markDirty();
    });
  }
}

/* --------------------------------------------------------------- the board */

const boardEl = $('board');

/**
 * 抽屉已经开着这颗格子，就别再开一遍：重新走 `openDrawer` 会用默认参数，
 * 把「＋ 添加格子」那条路设好的抽屉状态（尺寸模版 / 位置与尺寸）冲掉。
 * 关掉抽屉再点它，照旧是完整的编辑器。
 */
const openDrawerUnlessCurrent = (id, options) => {
  if (state.editingId !== id) openDrawer(id, options);
};

const board = createBoard({
  root: boardEl,
  // 编辑已有的格子：它已经有尺寸了
  onEdit: (id) => openDrawerUnlessCurrent(id, { withSizes: true }),
  onDuplicate: (id) => duplicateCell(id),
  onRemove: (id) => removeCell(id),
  onSelect: (id) => openDrawerUnlessCurrent(id, { withSizes: true }),
  // a move or a resize has already patched its own slot, so there is nothing to
  // re-render here — just remember that the document is unsaved
  onChange: () => markDirty(),
});

/** 响应式面板上的那几个设置键，改动它们只需要刷新那行说明。 */
const RESPONSIVE_KEYS = ['responsive', 'padWidth', 'phoneWidth', 'padColumns', 'phoneColumns'];

/** The widest cell on the board — the column count may never go below it. */
const widestCell = () =>
  isBoard() ? state.doc.cells.reduce((max, cell) => Math.max(max, cellUnits(cell).w), 1) : 1;

/**
 * A board is a fixed layout, so it needs a real column count — and it can never
 * be narrower than the widest cell, or that cell would have to be squeezed.
 */
const boardCols = () =>
  Math.min(12, Math.max(3, widestCell(), Number(state.doc.site?.columns) || 12));
const isBoard = () => state.doc.site?.layout === 'board';

/** What to draw: the stored positions, or how CSS would pack the flow today. */
const boardCells = () => (isBoard() ? state.doc.cells : packBoard(state.doc.cells, boardCols()));

/**
 * The editor's zoom. Not site data: it is how *this* person likes to look at the
 * board, so it is not saved anywhere and starts at 100% on every visit.
 */
let boardZoom = 1;

/**
 * Lay the board out at its own scale: the site's real spacing, zoomed so the
 * board stays a comfortable size to aim at. The gap is set back to its unscaled
 * value first — the layout pass multiplies it by the zoom itself, and feeding it
 * a scaled gap would compound on every call.
 */
function layoutBoard(cells = boardCells()) {
  boardEl.style.setProperty('--gap', `${gapPx(state.doc.site?.gap)}px`);
  applyGridLayout(boardEl, boardCols(), { layout: 'board', cells, minCell: 56, scale: boardZoom });
}

/** The first board edit turns a flow document into a positioned one. */
function toBoard() {
  if (isBoard()) return;
  const cols = boardCols();
  state.doc.cells = packBoard(state.doc.cells, cols);
  state.doc.site = { ...(state.doc.site || {}), layout: 'board', columns: cols };
  markDirty();
}

function renderBoard() {
  const cells = boardCells();
  board.render(cells, { columns: boardCols(), selectedId: state.editingId });
  layoutBoard(cells);
  $('board-status').textContent = boardNotices();
  renderCount();
}

/** The standing notes under the board: how it paints, and the current zoom. */
function boardNotices() {
  const notes = [];
  if (!isBoard()) notes.push('现在是自动排布：在棋盘上动一下，就会按现在这个样子固定下来。');
  if (boardZoom !== 1) notes.push(`棋盘缩放 ${Math.round(boardZoom * 100)}%，只影响这里的显示。`);
  return notes.join(' ');
}

function renderCount() {
  const count = state.doc.cells.length;
  $('cell-count').textContent = count ? `共 ${count} 个格子` : '还没有格子，在下面空白处拖一个出来';
}

function removeCell(id) {
  const index = state.doc.cells.findIndex((cell) => cell.id === id);
  if (index < 0) return;
  if (!confirm('确定删除这个格子？')) return;
  state.doc.cells.splice(index, 1);
  if (state.editingId === id) closeDrawer();
  markDirty();
  renderBoard();
}

function duplicateCell(id) {
  const index = state.doc.cells.findIndex((cell) => cell.id === id);
  if (index < 0) return;
  toBoard();
  const source = state.doc.cells[index];
  const copy = structuredClone(source);
  copy.id = newId();
  const { w, h } = cellUnits(source);
  const rects = state.doc.cells.map(rectOf).filter(Boolean);
  copy.pos = firstFreeSpot(rects, boardCols(), w, h);
  state.doc.cells.splice(index + 1, 0, copy);
  markDirty();
  renderBoard();
  toast('已复制到空位', 'ok');
}

function bindBoard() {
  board.setStatus($('board-status'));
  board.bind({
    // a drop or a resize: make sure the document is a board, then store the rect
    onPlace: (id, rect) => {
      toBoard();
      const cell = state.doc.cells.find((item) => item.id === id);
      if (!cell) return;
      cell.pos = { ...rect };
      board.patch(cell);
    },
    onDraw: (rect) => {
      toBoard();
      const cell = defaultCell({ size: '1x1', pos: { ...rect } });
      state.doc.cells.push(cell);
      markDirty();
      renderBoard();
      openDrawer(cell.id, { withSizes: true }); // 手势画出来的，尺寸已经定了
      board.select(cell.id);
    },
  });
  boardEl.tabIndex = 0;
  boardEl.addEventListener('keydown', board.onKeyDown);

  $('board-zoom').addEventListener('change', (event) => {
    boardZoom = Number(event.target.value) || 1;
    layoutBoard();
    $('board-status').textContent = boardNotices();
  });

  /*
   * 右下角那个方块拖起来是改尺寸还是挪位置。触屏专用的开关（那一栏本身只在
   * (hover: none) 下显示），不写进站点数据 —— 它是「这台设备上怎么操作」的偏好。
   * 按钮上的 is-on 由这里同步，别在 HTML 里写死状态。
   */
  const modeButtons = [...document.querySelectorAll('#handle-mode .segmented__btn')];
  const setHandleMode = (mode) => {
    board.setHandleMode(mode);
    for (const btn of modeButtons) {
      const on = btn.dataset.mode === mode;
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', String(on));
    }
  };
  for (const btn of modeButtons) btn.addEventListener('click', () => setHandleMode(btn.dataset.mode));

  // the cell size is measured from the panel, so a resize has to re-measure
  window.addEventListener('resize', () => {
    layoutBoard();
    if (state.editingId) renderPreview();
    renderResponsiveHint(); // 换档的判据就是窗口宽度，说明那行得跟着变
  });
}

/* ------------------------------------------------------------------ editor */

const drawer = $('drawer');
const scrim = $('scrim');
const preview = $('preview');

const els = {
  type: $('ed-type'),
  borderWidth: $('ed-border-width'),
  radius: $('ed-radius'),
  borderColor: $('ed-border-color'),
  borderColorText: $('ed-border-color-text'),
  image: $('ed-image'),
  html: $('ed-html'),
  embed: $('ed-embed'),
  fit: $('ed-fit'),
  imageTitle: $('ed-image-title'),
  imageTitleColor: $('ed-image-title-color'),
  imageTitleColorText: $('ed-image-title-color-text'),
  color: $('ed-color'),
  colorText: $('ed-color-text'),
  ovEnabled: $('ed-ov-enabled'),
  ovTitle: $('ed-ov-title'),
  ovBody: $('ed-ov-body'),
  ovDir: $('ed-ov-dir'),
  ovRatio: $('ed-ov-ratio'),
  ovBg: $('ed-ov-bg'),
  ovBgText: $('ed-ov-bg-text'),
  ovFg: $('ed-ov-fg'),
  ovFgText: $('ed-ov-fg-text'),
  link: $('ed-link'),
  sizes: $('ed-sizes'),
};

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** 色板上画出当前颜色。空串（透明）时换成红斜杠图标 —— 就是面板里那个透明色按钮。 */
function paintSwatch(swatch) {
  const value = swatch.dataset.color || '';
  swatch.classList.toggle('swatch--none', value === '');
  swatch.style.setProperty('--sw', value || 'transparent');
}

function setColorPicker(swatch, text, value, fallback = '#7e46b9') {
  swatch.dataset.color = value || '';
  swatch.dataset.fallback = fallback; // 点开面板时从这儿起步
  paintSwatch(swatch);
  text.value = value || '';
}

/** The text field wins when it holds a valid hex literal, so 8-digit alpha works. */
function readColorPicker(swatch, text, fallback) {
  return HEX.test(text.value.trim()) ? text.value.trim() : swatch.dataset.color || fallback;
}

/** 「透明」也算合法值的颜色行（边框颜色、底色）：文本空 = 这一项不填，存成空串。 */
function readOptionalColor(swatch, text, fallback) {
  return text.value.trim() === '' ? '' : readColorPicker(swatch, text, fallback);
}

/* -------------------------------------------------------------- 取色面板 */

const pop = {
  box: $('color-pop'),
  sv: $('color-pop-sv'),
  knob: $('color-pop-knob'),
  hue: $('color-pop-hue'),
  alpha: $('color-pop-alpha'),
  preview: $('color-pop-preview'),
  value: $('color-pop-value'),
  none: $('color-pop-none'),
};

/** 面板正在调的那一行：{ swatch, text, allowNone }。 */
let popTarget = null;
let popHsv = { h: 0, s: 0, v: 0, a: 1 };
let popDragging = false;

const clamp01 = (n) => Math.min(1, Math.max(0, n));

/** #rgb / #rrggbb / #rrggbbaa → 0..1 的 rgba。 */
function hexToRgba(hex) {
  const raw = hex.replace('#', '');
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  return {
    r: parseInt(full.slice(0, 2), 16) / 255,
    g: parseInt(full.slice(2, 4), 16) / 255,
    b: parseInt(full.slice(4, 6), 16) / 255,
    a: full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1,
  };
}

function rgbToHsv({ r, g, b }) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max > 0 ? d / max : 0, v: max };
}

function hsvToRgb({ h, s, v }) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return { r: r + m, g: g + m, b: b + m };
}

/** 不透明度满时给 6 位，否则追加两位 alpha（和数据的 hex 格式一致）。 */
function rgbaToHex({ r, g, b, a }) {
  const part = (n) => Math.round(n * 255).toString(16).padStart(2, '0');
  const base = `#${part(r)}${part(g)}${part(b)}`;
  return a >= 1 ? base : `${base}${part(a)}`;
}

const popColor = () => rgbaToHex({ ...hsvToRgb(popHsv), a: popHsv.a });

function paintPop() {
  const solid = rgbaToHex({ ...hsvToRgb(popHsv), a: 1 });
  pop.sv.style.setProperty('--hue', String(Math.round(popHsv.h)));
  pop.knob.style.left = `${popHsv.s * 100}%`;
  pop.knob.style.top = `${(1 - popHsv.v) * 100}%`;
  pop.knob.style.background = solid;
  pop.hue.value = String(Math.round(popHsv.h));
  pop.alpha.value = String(Math.round(popHsv.a * 100));
  pop.alpha.style.setProperty('--solid', solid);
  pop.preview.style.setProperty('--sw', popColor());
  pop.value.textContent = popColor();
}

/** 面板里的改动立刻写回表单和预览（拖动时每一帧都会被调用）。 */
function applyPopColor() {
  if (!popTarget) return;
  const hex = popColor();
  popTarget.swatch.dataset.color = hex;
  paintSwatch(popTarget.swatch);
  popTarget.text.value = hex;
  pop.none.setAttribute('aria-pressed', 'false');
  onEdited();
}

function moveSv(event) {
  const box = pop.sv.getBoundingClientRect();
  popHsv.s = clamp01((event.clientX - box.left) / box.width);
  popHsv.v = 1 - clamp01((event.clientY - box.top) / box.height);
  paintPop();
  applyPopColor();
}

function positionPop(swatch) {
  const rect = swatch.getBoundingClientRect();
  const width = pop.box.offsetWidth;
  const height = pop.box.offsetHeight;
  // 贴在色板下面；下面放不下就翻到上面；两头都夹回视口里（抽屉滚动后色板可能在视野外）
  const clampX = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
  const clampY = Math.max(8, window.innerHeight - height - 8);
  let top = rect.bottom + 8;
  if (top > clampY) top = rect.top - height - 8;
  pop.box.style.left = `${clampX}px`;
  pop.box.style.top = `${Math.min(Math.max(8, top), clampY)}px`;
}

function openColorPop(swatch, text, allowNone) {
  const base = swatch.dataset.color || swatch.dataset.fallback || '#7e46b9';
  const rgba = hexToRgba(base);
  popHsv = { ...rgbToHsv(rgba), a: rgba.a };
  popTarget = { swatch, text, allowNone };
  pop.none.hidden = !allowNone; // 只有边框颜色、底色有「透明」这个值
  pop.none.setAttribute('aria-pressed', String((swatch.dataset.color || '') === ''));
  pop.box.hidden = false;
  paintPop();
  positionPop(swatch);
}

function closeColorPop() {
  if (pop.box.hidden) return;
  pop.box.hidden = true;
  popDragging = false;
  popTarget = null;
}

pop.sv.addEventListener('pointerdown', (event) => {
  popDragging = true;
  pop.sv.setPointerCapture(event.pointerId);
  moveSv(event);
  event.preventDefault();
});
pop.sv.addEventListener('pointermove', (event) => {
  if (popDragging) moveSv(event);
});
pop.sv.addEventListener('pointerup', () => {
  popDragging = false;
});
pop.sv.addEventListener('pointercancel', () => {
  popDragging = false;
});

pop.hue.addEventListener('input', () => {
  popHsv.h = Number(pop.hue.value);
  paintPop();
  applyPopColor();
});
pop.alpha.addEventListener('input', () => {
  popHsv.a = Number(pop.alpha.value) / 100;
  paintPop();
  applyPopColor();
});

pop.none.addEventListener('click', () => {
  if (!popTarget) return;
  popTarget.swatch.dataset.color = '';
  paintSwatch(popTarget.swatch);
  popTarget.text.value = '';
  pop.none.setAttribute('aria-pressed', 'true');
  onEdited();
  closeColorPop();
});

// 点到面板和色板以外、按 Esc、页面滚动或改窗口大小 → 收起来
document.addEventListener(
  'pointerdown',
  (event) => {
    if (pop.box.hidden) return;
    if (pop.box.contains(event.target) || event.target.closest('.swatch')) return;
    closeColorPop();
  },
  true
);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !pop.box.hidden) {
    // Esc 先收最里面这层（取色面板），抽屉留着。
    // 这里必须 stopImmediatePropagation：抽屉的 Esc 处理也挂在 document 上，
    // 普通 stopPropagation 拦不住同一个节点上的其它监听 —— 会连抽屉一起关掉。
    closeColorPop();
    event.stopImmediatePropagation();
  }
});
window.addEventListener('resize', closeColorPop);
$('drawer').addEventListener('scroll', closeColorPop, { passive: true });

function buildSizeOptions() {
  els.sizes.replaceChildren();
  for (const key of SIZE_ORDER) {
    const size = SIZES[key];
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'size-option';
    button.dataset.size = key;
    button.setAttribute('aria-pressed', 'false');

    // a dot per grid unit, drawn on the biggest board we support (8 × 4)
    const shape = document.createElement('span');
    shape.className = 'size-option__shape';
    for (let row = 0; row < 4; row += 1) {
      for (let col = 0; col < 8; col += 1) {
        const dot = document.createElement('span');
        if (col >= size.w || row >= size.h) dot.style.visibility = 'hidden';
        shape.append(dot);
      }
    }

    const label = document.createElement('span');
    label.textContent = `${size.label} ${key}`;
    const note = document.createElement('span');
    note.textContent = size.note;

    button.append(shape, label, note);
    button.addEventListener('click', () => {
      const cell = currentCell();
      if (!cell) return;
      cell.size = key; // the flow layout's size, kept in step for the fallback
      if (isBoard()) {
        const others = state.doc.cells.filter((item) => item.id !== cell.id).map(rectOf).filter(Boolean);
        const current = cell.pos || { x: 0, y: 0 };
        const wanted = { x: current.x, y: current.y, w: Math.min(size.w, boardCols()), h: size.h };
        const fits = wanted.x + wanted.w <= boardCols() && rectFree(others, wanted);
        cell.pos = fits ? wanted : firstFreeSpot(others, boardCols(), size.w, size.h);
      }
      syncSizeButtons();
      onEdited();
    });
    els.sizes.append(button);
  }
}

function syncSizeButtons() {
  const cell = currentCell();
  const units = cell ? cellUnits(cell) : null;
  for (const button of els.sizes.querySelectorAll('.size-option')) {
    const size = SIZES[button.dataset.size];
    // on a board the real size is pos.w/h — a freehand size matches no preset
    const pressed = isBoard()
      ? units && units.w === size.w && units.h === size.h
      : button.dataset.size === cell?.size;
    button.setAttribute('aria-pressed', String(Boolean(pressed)));
    button.disabled = isBoard() && size.w > boardCols();
  }
}

function buildSelects() {
  els.ovDir.replaceChildren();
  for (const option of DIRECTIONS) els.ovDir.append(new Option(option.label, option.value));
  els.ovRatio.replaceChildren();
  for (const option of RATIOS) els.ovRatio.append(new Option(option.label, option.value));
}

function currentCell() {
  return state.doc.cells.find((cell) => cell.id === state.editingId) || null;
}

function fillForm(cell) {
  closeColorPop(); // 换了一颗格子，面板里调的就不是它了
  els.type.value = cell.type;
  els.borderWidth.value = cell.borderWidth;
  els.radius.value = cell.radius;
  setColorPicker(els.borderColor, els.borderColorText, cell.borderColor);
  els.image.value = cell.image;
  els.html.value = cell.html || '';
  els.embed.value = cell.embed || '';
  els.fit.value = cell.imageFit;
  els.imageTitle.value = cell.imageTitle;
  setColorPicker(els.imageTitleColor, els.imageTitleColorText, cell.imageTitleColor);
  setColorPicker(els.color, els.colorText, cell.color);
  els.ovEnabled.checked = cell.overlay.enabled;
  els.ovTitle.value = cell.overlay.title;
  els.ovBody.value = cell.overlay.body;
  els.ovDir.value = cell.overlay.direction;
  els.ovRatio.value = cell.overlay.ratio;
  setColorPicker(els.ovBg, els.ovBgText, cell.overlay.bgColor);
  setColorPicker(els.ovFg, els.ovFgText, cell.overlay.textColor);
  els.link.value = cell.link;
  // 打开时用数据里记着的那个；老数据没有这个字段时，服务端已经按老规矩补好了
  actionTab = cell.clickMode === 'link' ? 'link' : 'embed';
  syncActionTabs();

  const thumbWrap = $('thumb-current');
  if (cell.image) {
    $('thumb-img').src = cell.image;
    $('thumb-name').textContent = cell.image.length > 46 ? `…${cell.image.slice(-44)}` : cell.image;
    thumbWrap.hidden = false;
  } else {
    thumbWrap.hidden = true;
  }

  syncSizeButtons();
  syncTypeVisibility();
}

/**
 * 抽屉里的「点击这个格子时」是两个互斥选项：跳转链接 / 嵌入 HTML。
 * 两者都绑在格子的点击上，同一时刻只有一个生效 —— 所以用按钮切换。
 *
 * 但**两个地址都保留**：切换只是改「哪个生效」，填过的内容不丢，随时能切回来。
 * 生效的那个记在数据的 `clickMode` 里（老数据没有这个字段时由服务端按老规矩补上）。
 * 界面上的 `actionTab` 就是它的一份投影。
 */
let actionTab = 'link';

function syncActionTabs() {
  for (const btn of document.querySelectorAll('.segmented__btn')) {
    const on = btn.dataset.action === actionTab;
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-selected', String(on));
  }
  $('panel-link').hidden = actionTab !== 'link';
  $('panel-embed').hidden = actionTab !== 'embed';
}

/**
 * 切到另一边。两边的地址都**保留**：填过的内容不因为切换而丢，只是生效的换一个，
 * 想换回来点一下就行。生效的那个记在数据的 clickMode 里。
 */
function switchActionTab(next) {
  if (next === actionTab) return;
  actionTab = next;
  syncActionTabs();
  onEdited();
}

function bindActionTabs() {
  for (const btn of document.querySelectorAll('#action-tabs .segmented__btn')) {
    btn.addEventListener('click', () => switchActionTab(btn.dataset.action));
  }
}

function syncTypeVisibility() {
  const type = els.type.value;
  $('fs-image').hidden = type !== 'image';
  // 「封面的 HTML」只有网页封面用；「嵌入的 HTML」和「角标文字」三种类型都有，一直显示
  $('fs-html').hidden = type !== 'html';
  $('fs-solid').hidden = type !== 'solid';
}

/** Pull every field back into the cell being edited. */
function applyForm() {
  const cell = currentCell();
  if (!cell) return;
  cell.type = els.type.value;
  cell.borderWidth = Number(els.borderWidth.value) || 0;
  cell.radius = Number(els.radius.value) || 0;
  cell.borderColor = readOptionalColor(els.borderColor, els.borderColorText, '#7e46b9');
  cell.image = els.image.value.trim();
  cell.html = els.html.value.trim();
  // 两个地址都存下来（互斥只体现在 clickMode 上），填过的内容不会因为切换而丢
  cell.embed = els.embed.value.trim();
  cell.clickMode = actionTab;
  cell.imageFit = els.fit.value;
  cell.imageTitle = els.imageTitle.value;
  cell.imageTitleColor = readColorPicker(els.imageTitleColor, els.imageTitleColorText, '#ffffff');
  cell.color = readOptionalColor(els.color, els.colorText, '#7e46b9');
  cell.overlay = {
    enabled: els.ovEnabled.checked,
    title: els.ovTitle.value,
    body: els.ovBody.value,
    direction: els.ovDir.value,
    ratio: els.ovRatio.value,
    bgColor: readColorPicker(els.ovBg, els.ovBgText, '#0b0a12f2'),
    textColor: readColorPicker(els.ovFg, els.ovFgText, '#ffffff'),
  };
  cell.link = els.link.value.trim();
  // 位置和尺寸不在这里改：抽屉里没有那一栏，摆位靠拖拽（board.js 的 legal()）、
  // 尺寸靠拖右下角手柄或「尺寸」模版 —— 各自都带校验，这里不碰 cell.pos。
}

function onEdited() {
  applyForm();
  renderPreview();
  const cell = currentCell();
  if (cell) {
    board.refresh(boardCells().find((item) => item.id === cell.id) || cell);
    layoutBoard();
  }
  markDirty();
}

/** The preview draws a board unit at about this many px. */
const PREVIEW_UNIT = 62;
/** …and no taller than this, so a tall cell does not push the form down. */
const PREVIEW_MAX_H = 190;
/** On a 12-column page a cell is about this wide — the reference for the gap. */
const PREVIEW_REFERENCE = 98;

/** How much room the preview actually has (the box, minus its padding). */
function previewWidth() {
  const box = preview.parentElement;
  const style = getComputedStyle(box);
  const pad = (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0);
  return Math.max(80, (box.clientWidth || 320) - pad);
}

/**
 * What will this cell look like on the page?
 *
 * The answer is the same in both layouts: a cell spans `w × h` units, so the
 * preview draws **this cell and nothing else**, on a grid exactly that many
 * columns wide, scaled to fit the drawer.
 *
 * Drawing the real grid instead is what used to happen for a board document —
 * twelve columns of 96px is 1460px of grid inside a 390px drawer, with the cell
 * parked at its own column and therefore off-screen — and a flow document had
 * the mirror problem, a wide cell spilling out of the box (8 columns of 62px is
 * 566px). Both are the same bug: previewing the page instead of the cell.
 */
function renderPreview() {
  const cell = currentCell();
  preview.replaceChildren();
  if (!cell) return;
  preview.append(createCell(cell));

  const site = state.doc.site || {};
  const { w, h } = cellUnits(cell); // pos when it has one, the named size otherwise
  // Columns the page would give it: a board has a fixed count, a flow document
  // caps the span at the column setting (0 = auto, which is the cell's own width)
  const cols = Math.min(w, isBoard() ? boardCols() : Number(site.columns) || w);
  const box = previewWidth();
  // the page's spacing as a share of a cell, kept at whatever size we draw
  const ratio = gapPx(site.gap) / PREVIEW_REFERENCE;
  // how big one unit would be if the cell filled the box
  const fitUnit = box / (cols + (cols - 1) * ratio);
  const unit = Math.min(PREVIEW_UNIT, fitUnit, PREVIEW_MAX_H / (h + (h - 1) * ratio));
  // The gap is stated at the *fit* size, not at `unit`: the layout pass divides
  // the box by (cell + gap) and then multiplies by `scale` below, and the two
  // cancel out exactly — so the drawn gap is `ratio * unit` either way.
  preview.style.setProperty('--gap', `${(ratio * fitUnit).toFixed(2)}px`);
  applyGridLayout(preview, cols, {
    layout: 'board',
    cells: [{ ...cell, pos: { x: 0, y: 0, w: cols, h } }],
    minCell: 1, // the layout pass must not floor this: the preview always fits
    scale: unit / fitUnit,
  });
}

/**
 * 打开抽屉。
 *
 * `withSizes` = **这颗格子已经有尺寸了**：手势拖出来的（拖多大就是多大）、或者早就
 * 画好的、要编辑的格子。有尺寸就不给尺寸模版。
 *
 * 只有「＋ 添加格子」是反过来的：它刚落一颗 1×1，尺寸还没定 —— 所以给模版挑。
 *
 * 「位置与尺寸」那块整块不出现（见 admin.html 的注释）：摆位和改尺寸都靠棋盘上拖拽。
 */
function openDrawer(id, { withSizes = false } = {}) {
  const cell = state.doc.cells.find((item) => item.id === id);
  if (!cell) return;
  state.editingId = id;
  drawer.hidden = false;
  scrim.hidden = false;
  requestAnimationFrame(() => {
    drawer.classList.add('is-open');
    scrim.classList.add('is-open');
  });
  fillForm(cell);
  // 放在 fillForm 后面：它按格子类型开关那些块，别被覆盖
  $('field-sizes').hidden = withSizes;
  renderPreview();
}

function closeDrawer() {
  closeColorPop();
  state.editingId = null;
  drawer.classList.remove('is-open');
  scrim.classList.remove('is-open');
  setTimeout(() => {
    if (!state.editingId) {
      drawer.hidden = true;
      scrim.hidden = true;
    }
  }, 280);
}

/** Content types for files the browser hands over without one of its own. */
const MIME_BY_EXT = {
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  mjs: 'text/javascript',
  json: 'application/json',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jfif: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
};

function contentTypeOf(file) {
  const type = String(file.type || '');
  if (type === 'image/jpg') return 'image/jpeg';
  if (type) return type;
  return MIME_BY_EXT[file.name.split('.').pop().toLowerCase()] || 'application/octet-stream';
}

/** Wire an upload button + hidden file input to one of the file collections. */
function bindUpload(buttonId, inputId, kind, field, okMessage) {
  $(buttonId).addEventListener('click', () => $(inputId).click());
  $(inputId).addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const result = await api(filesApi(kind, file.name), {
        method: 'POST',
        raw: true,
        headers: { 'Content-Type': contentTypeOf(file) },
        body: file,
      });
      field.value = result.url;
      onEdited();
      toast(okMessage, 'ok');
      refreshFilesIfVisible();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

function bindEditor() {
  buildSelects();
  buildSizeOptions();

  const live = [
    els.type, els.borderWidth, els.radius, els.image, els.html, els.embed, els.fit,
    els.imageTitle, els.color, els.color, els.ovEnabled, els.ovTitle, els.ovBody,
    els.ovDir, els.ovRatio, els.link,
  ];
  for (const element of new Set(live)) element.addEventListener('input', onEdited);

  els.type.addEventListener('change', () => {
    syncTypeVisibility();
    onEdited();
  });

  // 每一行：点色板弹取色面板；文本框里手打 hex 也实时反映到色板上
  for (const [swatch, text, allowNone] of [
    [els.borderColor, els.borderColorText, true],
    [els.imageTitleColor, els.imageTitleColorText, false],
    [els.color, els.colorText, true],
    [els.ovBg, els.ovBgText, false],
    [els.ovFg, els.ovFgText, false],
  ]) {
    swatch.addEventListener('click', () => {
      if (!pop.box.hidden && popTarget && popTarget.swatch === swatch) closeColorPop();
      else openColorPop(swatch, text, allowNone);
    });
    text.addEventListener('input', () => {
      const value = text.value.trim();
      if (HEX.test(value)) {
        swatch.dataset.color = value;
        paintSwatch(swatch);
      } else if (value === '' && allowNone) {
        swatch.dataset.color = '';
        paintSwatch(swatch);
      }
      onEdited();
    });
  }

  $('drawer-close').addEventListener('click', closeDrawer);
  $('ed-done').addEventListener('click', closeDrawer);
  scrim.addEventListener('click', closeDrawer);
  $('ed-delete').addEventListener('click', () => removeCell(state.editingId));

  bindUpload('btn-upload', 'upload-file', 'uploads', els.image, '图片已上传');
  bindUpload('btn-upload-html', 'upload-file-html', 'pages', els.html, 'HTML 文件已上传');
  bindUpload('btn-upload-embed', 'upload-file-embed', 'pages', els.embed, 'HTML 文件已上传');
  $('btn-clear-upload').addEventListener('click', () => {
    els.image.value = '';
    onEdited();
  });
  $('btn-open-html').addEventListener('click', () => {
    const target = els.html.value.trim();
    if (!target) return toast('先填地址或上传一个 HTML 文件', 'error');
    window.open(target, '_blank', 'noopener');
  });
  bindActionTabs();
  $('btn-open-embed').addEventListener('click', () => {
    const target = els.embed.value.trim();
    if (!target) return toast('先填地址或上传一个 HTML 文件', 'error');
    window.open(target, '_blank', 'noopener');
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.editingId) closeDrawer();
  });
}

/* ------------------------------------------------------------ file manager */

/** The three collections under the data directory, as the server exposes them. */
const FILE_KINDS = {
  assets: {
    label: '站点资源',
    hint: '站点自己的图片，存在 assets/ 里，主页按 /assets/… 引用（logo.svg、title.png 就在这儿）',
    accept: 'image/*',
  },
  uploads: {
    label: '上传的图片',
    hint: '格子里展示的图片，地址是 /uploads/…，同名文件会被覆盖',
    accept: 'image/*',
  },
  pages: {
    label: '嵌入页面',
    hint: 'HTML 页面及它自带的 css / js / 图片，地址是 /pages/…，同名文件会被覆盖',
    accept: '.html,.htm,.css,.js,.json,image/*',
  },
};

let fileKind = 'assets';
let fileList = [];

/** File API path. The userid decides whose directory it lands in — or rather,
    the server decides from it that we are allowed anywhere near the files. */
const filesApi = (kind, name = '') =>
  withUserid(`/api/files?kind=${encodeURIComponent(kind)}${name ? `&name=${encodeURIComponent(name)}` : ''}`);

function refreshFilesIfVisible() {
  if ($('files-panel').open) loadFiles();
}

const formatSize = (bytes) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1048576).toFixed(1)} MB`;

/** How many cells point at this file — deleting it would break them. */
const usersOf = (url) => state.doc.cells.filter((cell) => cell.image === url || cell.html === url).length;

async function loadFiles(kind = fileKind) {
  fileKind = kind;
  try {
    const payload = await api(filesApi(kind));
    fileList = payload.files || [];
  } catch (err) {
    fileList = [];
    if (err.status === 401) return showLogin('登录已失效，请重新登录。');
    toast(err.message, 'error');
  }
  renderFiles();
  return undefined;
}

function fileRow(file) {
  const row = document.createElement('li');
  row.className = 'file-row';

  const thumb = document.createElement('span');
  thumb.className = 'file-row__thumb';
  if (/\.(png|jpe?g|gif|webp|avif|svg|ico)$/i.test(file.name)) {
    const img = document.createElement('img');
    img.src = file.url;
    img.alt = '';
    img.loading = 'lazy';
    thumb.append(img);
  } else {
    thumb.classList.add('file-row__thumb--text');
    thumb.textContent = file.name.split('.').pop().toUpperCase();
  }

  const name = document.createElement('span');
  name.className = 'file-row__name';
  name.textContent = file.name;

  const meta = document.createElement('span');
  meta.className = 'file-row__meta';
  meta.textContent = `${formatSize(file.size)} · ${new Date(file.mtime).toLocaleString('zh-CN', { hour12: false })}`;

  const used = usersOf(file.url);
  const badge = document.createElement('span');
  badge.className = 'file-row__badge';
  badge.textContent = used ? `${used} 个格子在用` : '';
  badge.hidden = !used;

  const actions = document.createElement('span');
  actions.className = 'file-row__acts';
  for (const [act, glyph, title] of [
    ['copy', '⧉', '复制链接'],
    ['open', '↗', '新标签页打开'],
    ['del', '✕', '删除'],
  ]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `btn btn--icon btn--ghost${act === 'del' ? ' file-row__del' : ''}`;
    button.dataset.act = act;
    button.dataset.name = file.name;
    button.title = title;
    button.setAttribute('aria-label', `${title} ${file.name}`);
    button.textContent = glyph;
    actions.append(button);
  }

  row.append(thumb, name, meta, badge, actions);
  return row;
}

function renderFiles() {
  for (const button of $('file-tabs').querySelectorAll('.file-tab')) {
    button.setAttribute('aria-selected', String(button.dataset.kind === fileKind));
  }
  $('file-hint').textContent = FILE_KINDS[fileKind].hint;
  $('file-input').setAttribute('accept', FILE_KINDS[fileKind].accept);

  const list = $('file-list');
  list.replaceChildren();
  if (!fileList.length) {
    const empty = document.createElement('li');
    empty.className = 'file-empty';
    empty.textContent = '这个目录还是空的。';
    list.append(empty);
    return;
  }
  for (const file of fileList) list.append(fileRow(file));
}

function buildFileTabs() {
  const tabs = $('file-tabs');
  tabs.replaceChildren();
  for (const [kind, meta] of Object.entries(FILE_KINDS)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'file-tab';
    button.dataset.kind = kind;
    button.textContent = meta.label;
    button.addEventListener('click', () => loadFiles(kind));
    tabs.append(button);
  }
}

async function copyFileUrl(file) {
  const absolute = new URL(file.url, location.origin).href;
  try {
    await navigator.clipboard.writeText(absolute);
    toast('链接已复制', 'ok');
  } catch {
    window.prompt('复制这个地址：', absolute);
  }
}

async function removeFile(file) {
  const used = usersOf(file.url);
  const warning = used
    ? `${used} 个格子正在引用 ${file.name}，删掉之后这些格子会显示不出来。确定删除？`
    : `确定删除 ${file.name}？`;
  if (!confirm(warning)) return;
  try {
    await api(filesApi(fileKind, file.name), { method: 'DELETE' });
    toast(`已删除 ${file.name}`, 'ok');
    await loadFiles();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function bindFiles() {
  buildFileTabs();

  $('file-upload').addEventListener('click', () => $('file-input').click());
  $('file-input').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      await api(filesApi(fileKind, file.name), {
        method: 'POST',
        raw: true,
        headers: { 'Content-Type': contentTypeOf(file) },
        body: file,
      });
      toast(`已上传 ${file.name}`, 'ok');
      await loadFiles();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  $('file-list').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-act]');
    if (!button) return;
    const file = fileList.find((item) => item.name === button.dataset.name);
    if (!file) return;
    if (button.dataset.act === 'copy') copyFileUrl(file);
    if (button.dataset.act === 'open') window.open(file.url, '_blank', 'noopener');
    if (button.dataset.act === 'del') removeFile(file);
  });

  // the list is only fetched once the panel is actually opened
  $('files-panel').addEventListener('toggle', () => {
    if ($('files-panel').open) loadFiles();
  });
}

/* ---------------------------------------------------------- users & invites */

/** Owner-only: invites are what let people in, users are who got in. */

const stampOf = (ms) => new Date(ms).toLocaleString('zh-CN', { hour12: false });

function actionButton(act, glyph, title, name) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `btn btn--icon btn--ghost${act === 'del' ? ' file-row__del' : ''}`;
  button.dataset.act = act;
  button.dataset.name = name;
  button.title = title;
  button.setAttribute('aria-label', `${title} ${name}`);
  button.textContent = glyph;
  return button;
}

function inviteRow(invite) {
  const row = document.createElement('li');
  row.className = 'file-row';

  const code = document.createElement('span');
  code.className = 'file-row__name file-row__code';
  code.textContent = invite.code;
  code.title = invite.code;

  const meta = document.createElement('span');
  meta.className = 'file-row__meta';
  meta.textContent = `${invite.uses} / ${invite.maxUses} 次 · ${stampOf(invite.createdAt)}${
    invite.note ? ` · ${invite.note}` : ''
  }`;

  const spent = invite.uses >= invite.maxUses;
  const badge = document.createElement('span');
  badge.className = 'file-row__badge';
  badge.textContent = spent ? '已用完' : `还能用 ${invite.maxUses - invite.uses} 次`;
  badge.hidden = false;

  const actions = document.createElement('span');
  actions.className = 'file-row__acts';
  actions.append(
    actionButton('copy', '⧉', '复制邀请码', invite.code),
    actionButton('del', '✕', '删除', invite.code)
  );

  row.append(code, meta, badge, actions);
  return row;
}

function userRow(user) {
  const row = document.createElement('li');
  row.className = 'file-row';

  const thumb = document.createElement('span');
  thumb.className = 'file-row__thumb file-row__thumb--text';
  thumb.textContent = [...user.username][0] || '?';

  const name = document.createElement('span');
  name.className = 'file-row__name';
  name.textContent = user.username;

  const meta = document.createElement('span');
  meta.className = 'file-row__meta';
  meta.textContent = `注册于 ${stampOf(user.createdAt)} · ${user.userid.slice(0, 8)}…`;

  const actions = document.createElement('span');
  actions.className = 'file-row__acts';
  const visit = actionButton('visit', '↗', '看他/她的主页', user.userid);
  const manage = actionButton('manage', '✎', '代管页面', user.userid);
  const remove = actionButton('del', '✕', '删除用户', user.userid);
  for (const button of [visit, manage, remove]) button.dataset.username = user.username;
  actions.append(visit, manage, remove);

  row.append(thumb, name, meta, actions);
  return row;
}

function deletedRow(tombstone) {
  const row = document.createElement('li');
  row.className = 'file-row';

  const thumb = document.createElement('span');
  thumb.className = 'file-row__thumb file-row__thumb--text';
  thumb.textContent = [...tombstone.username][0] || '?';

  const name = document.createElement('span');
  name.className = 'file-row__name';
  name.textContent = tombstone.username;

  const meta = document.createElement('span');
  meta.className = 'file-row__meta';
  meta.textContent = `删除于 ${stampOf(tombstone.deletedAt)}`;

  const badge = document.createElement('span');
  badge.className = 'file-row__badge';
  badge.textContent = tombstone.hasContent ? '内容还在归档里' : '归档已清理';
  badge.hidden = false;

  const actions = document.createElement('span');
  actions.className = 'file-row__acts';
  const restore = actionButton('restore', '↺', '恢复这个用户', tombstone.userid);
  restore.dataset.username = tombstone.username;
  actions.append(restore);

  row.append(thumb, name, meta, badge, actions);
  return row;
}

function renderDeleted(people) {
  const list = $('deleted-list');
  list.replaceChildren();
  if (!people.length) {
    const empty = document.createElement('li');
    empty.className = 'file-empty';
    empty.textContent = '没有删除过的用户。';
    list.append(empty);
    return;
  }
  for (const person of people) list.append(deletedRow(person));
}

async function loadPeople() {
  if (!isOwnerPage) return;
  try {
    const [invites, people] = await Promise.all([api('/api/invites'), api('/api/users')]);
    renderInvites(invites.invites || []);
    renderUsers(people.users || []);
    renderDeleted(people.deleted || []);
  } catch (err) {
    if (err.status === 401 || err.status === 403) return; // not logged in as the owner
    toast(err.message, 'error');
  }
}

function renderInvites(invites) {
  const list = $('invite-list');
  list.replaceChildren();
  if (!invites.length) {
    const empty = document.createElement('li');
    empty.className = 'file-empty';
    empty.textContent = '还没有邀请码。生成一个发给要注册的人。';
    list.append(empty);
    return;
  }
  for (const invite of invites) list.append(inviteRow(invite));
}

function renderUsers(people) {
  const list = $('user-list');
  list.replaceChildren();
  if (!people.length) {
    const empty = document.createElement('li');
    empty.className = 'file-empty';
    empty.textContent = '还没有用户。';
    list.append(empty);
    return;
  }
  for (const user of people) list.append(userRow(user));
}

async function createInvite() {
  const button = $('invite-add');
  button.disabled = true;
  try {
    const invite = await api('/api/invites', {
      method: 'POST',
      body: { maxUses: Number($('invite-uses').value) || 10, note: $('invite-note').value.trim() },
    });
    $('invite-note').value = '';
    await loadPeople();
    copyText(invite.code);
    toast('邀请码已生成并复制', 'ok');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    button.disabled = false;
  }
}

async function createUser() {
  const button = $('user-add');
  const username = $('user-name').value.trim();
  const password = $('user-pass').value;
  if (!username || !password) return toast('用户名和密码都要填', 'error');
  button.disabled = true;
  try {
    await api('/api/users', { method: 'POST', body: { username, password } });
    $('user-name').value = '';
    $('user-pass').value = '';
    await loadPeople();
    toast(`已添加用户 ${username}`, 'ok');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    button.disabled = false;
  }
}

async function removeUser(userid2, username) {
  if (!confirm(`删除用户「${username}」？他的目录会先归档到 users/.deleted/，账号随即删除。`)) return;
  try {
    await api(`/api/users?userid=${encodeURIComponent(userid2)}`, { method: 'DELETE' });
    await loadPeople();
    toast(`已删除 ${username}`, 'ok');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function restoreUser(userid2, username) {
  if (!confirm(`恢复用户「${username}」？账号（连同原密码）和归档的内容都会回来。`)) return;
  try {
    const restored = await api('/api/users/restore', { method: 'POST', body: { userid: userid2 } });
    await loadPeople();
    toast(
      restored.contentRestored ? `已恢复 ${username}（内容原样回来了）` : `已恢复 ${username}（归档没了，用新的默认内容）`,
      'ok'
    );
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function removeInvite(code) {
  if (!confirm('删除这个邀请码？已经用它注册的人不受影响。')) return;
  try {
    await api(`/api/invites?code=${encodeURIComponent(code)}`, { method: 'DELETE' });
    await loadPeople();
    toast('邀请码已删除', 'ok');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    window.prompt('复制这段内容：', text);
  }
}

function bindPeople() {
  $('invite-add').addEventListener('click', createInvite);
  $('user-add').addEventListener('click', createUser);

  $('invite-list').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-act]');
    if (!button) return;
    if (button.dataset.act === 'copy') {
      copyText(button.dataset.name);
      toast('邀请码已复制', 'ok');
    }
    if (button.dataset.act === 'del') removeInvite(button.dataset.name);
  });

  $('deleted-list').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-act="restore"]');
    if (!button) return;
    restoreUser(button.dataset.name, button.dataset.username || button.dataset.name);
  });

  $('user-list').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-act]');
    if (!button) return;
    const id = button.dataset.name;
    if (button.dataset.act === 'visit') window.open(`/?userid=${id}`, '_blank', 'noopener');
    if (button.dataset.act === 'manage') location.href = `/admin?userid=${id}`;
    if (button.dataset.act === 'del') removeUser(id, button.dataset.username || id);
  });
}

/* -------------------------------------------------------------- save/export */

function markDirty() {
  // 每次改动都可能动到格子的宽度，列数下限跟着重算（拖完手柄那一刻就生效）
  updateColumnFloor();
  state.dirty = true;
  $('dirty-flag').hidden = false;
}

async function save() {
  const button = $('btn-save');
  button.disabled = true;
  try {
    const saved = await api(withUserid('/api/site'), { method: 'PUT', body: state.doc });
    state.doc = absorbDoc(saved);
    state.dirty = false;
    $('dirty-flag').hidden = true;
    renderSite();
    renderBoard();
    if (state.editingId) renderPreview();
    refreshFilesIfVisible();
    toast('已保存', 'ok');
  } catch (err) {
    if (err.status === 401) {
      showLogin('登录已失效，请重新登录。');
    } else {
      toast(err.message, 'error');
    }
  } finally {
    button.disabled = false;
  }
}

function exportJson() {
  const blob = new Blob([JSON.stringify(state.doc, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `gilloffline-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function importJson(file) {
  try {
    const parsed = JSON.parse(await file.text());
    if (!parsed || !Array.isArray(parsed.cells)) throw new Error('文件格式不正确：缺少 cells 数组');
    state.doc = { site: parsed.site || {}, cells: parsed.cells };
    // the server will repair this on save; do the same here so the board shows it
    if (state.doc.site.layout === 'board') state.doc.cells = repairBoard(state.doc.cells, boardCols());
    renderSite();
    renderBoard();
    markDirty();
    toast('已导入，别忘了点击保存', 'ok');
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* -------------------------------------------------------------------- boot */

function bindToolbar() {
  $('btn-add').addEventListener('click', () => {
    toBoard();
    // 放在最下面：所有格子的下边缘里最靠下的那一行（那一整行必然是空的）
    const bottom = state.doc.cells.reduce(
      (max, cell) => (cell.pos ? Math.max(max, cell.pos.y + cell.pos.h) : max),
      0
    );
    const cell = defaultCell({ overlay: defaultOverlay(), pos: { x: 0, y: bottom, w: 1, h: 1 } });
    state.doc.cells.push(cell);
    markDirty();
    renderBoard();
    // 它是唯一「尺寸还没定」的入口：先落 1×1，在抽屉里点个模版就变那么大（位置不用调）
    openDrawer(cell.id);
    board.select(cell.id);
    drawer.querySelector('.drawer__body').scrollTop = 0;
    // 它在最下面，滚进视野——关掉抽屉就能看见
    boardEl.querySelector(`.slot[data-id="${CSS.escape(cell.id)}"]`)?.scrollIntoView({ block: 'nearest' });
  });
  $('btn-save').addEventListener('click', save);
  // ⌘S / Ctrl+S 也能保存 —— 不 preventDefault 的话浏览器会弹出「保存网页」对话框。
  // 只认不带 shift 的 s（⇧⌘S 是浏览器的「另存为」，别抢）。
  document.addEventListener('keydown', (event) => {
    if (event.key !== 's' || !(event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    // 登录页不触发；保存中（按钮被禁用）也不重复发请求
    if ($('app-view').hidden || $('btn-save').disabled) return;
    save();
  });
  $('btn-export').addEventListener('click', exportJson);
  $('btn-import').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) importJson(file);
  });
  $('btn-logout').addEventListener('click', async () => {
    if (state.dirty && !confirm('有未保存的更改，确定退出？')) return;
    await api('/api/logout', { method: 'POST' }).catch(() => {});
    state.dirty = false;
    showLogin('已退出登录。');
  });
}

function bindLogin() {
  $('login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = $('login-submit');
    const error = $('login-error');
    button.disabled = true;
    error.hidden = true;
    try {
      const username = $('login-username').value.trim();
      // no username means the site owner; with one it is that sub-admin
      await api('/api/login', {
        method: 'POST',
        body: username ? { username, password: $('login-password').value } : { password: $('login-password').value },
      });
      await start();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    } finally {
      button.disabled = false;
    }
  });
}

async function start() {
  const doc = await api(withUserid('/api/site'));
  state.doc = absorbDoc(doc);
  state.dirty = false;
  $('dirty-flag').hidden = true;
  showApp();
  renderSite();
  renderBoard();
  refreshFilesIfVisible();
  loadPeople();
}

async function boot() {
  // 回主页的两个入口都带上当前 userid：子管理员点回去应该是自己的站，不是站主的
  // （登录页上就要能用，所以放在这里而不是 showApp() 里）
  $('brand-home').href = withUserid('/');
  $('login-home').href = withUserid('/');
  bindLogin();
  bindToolbar();
  bindBoard();
  bindEditor();
  bindSitePanel();
  bindFiles();
  bindPeople();

  window.addEventListener('beforeunload', (event) => {
    if (!state.dirty) return undefined;
    event.preventDefault();
    event.returnValue = '';
    return '';
  });

  try {
    const session = await api('/api/session');
    if (!session.configured && isOwnerPage) {
      $('login-hint').textContent =
        '服务端没有配置 ADMIN_PASSWORD 环境变量，管理功能已禁用。请在部署时设置密码后重启容器。';
      $('login-submit').disabled = true;
      $('login-password').disabled = true;
      showLogin();
      return;
    }
    // the owner can open anyone's page; a sub-admin only their own
    const mine = session.subject === 'admin' || (userid !== '' && session.subject === userid);
    if (mine) await start();
    else showLogin();
  } catch (err) {
    showLogin(`无法连接服务器：${err.message}`);
  }
}

boot();
