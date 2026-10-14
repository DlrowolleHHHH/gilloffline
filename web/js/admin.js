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
  newId,
  packBoard,
  rectFree,
  rectOf,
  repairBoard,
  toast,
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

function renderSite() {
  const site = state.doc.site || {};
  // '自动' only means something to the flow layout
  const auto = $('site-columns').querySelector('option[value="0"]');
  auto.disabled = isBoard();
  auto.textContent = isBoard() ? '自动（棋盘布局用不了）' : '自动（按窗口宽度铺满）';
  // nor does the board allow a column count below its widest cell
  const floor = widestCell();
  for (const option of $('site-columns').options) {
    const value = Number(option.value);
    option.disabled = (value === 0 && isBoard()) || (value > 0 && value < floor);
  }
  const columnsHint = $('site-columns-hint');
  if (columnsHint) {
    columnsHint.textContent =
      isBoard() && floor > 1
        ? `棋盘上最宽的格子占 ${floor} 列，所以列数不能小于 ${floor}。`
        : COLUMNS_HINT;
  }
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
}

function bindSitePanel() {
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
      markDirty();
    });
  }
}

/* --------------------------------------------------------------- the board */

/** The standing explanation under the column select. */
const COLUMNS_HINT = $('site-columns-hint').textContent;

const boardEl = $('board');

const board = createBoard({
  root: boardEl,
  onEdit: (id) => openDrawer(id),
  onDuplicate: (id) => duplicateCell(id),
  onRemove: (id) => removeCell(id),
  onSelect: (id) => openDrawer(id),
  // a move or a resize has already patched its own slot, so there is nothing to
  // re-render here — just remember that the document is unsaved
  onChange: () => markDirty(),
});

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
  applyGridLayout(boardEl, boardCols(), { layout: 'board', cells, minCell: 56 });
  $('board-status').textContent = isBoard() ? '' : '现在是自动排布：在棋盘上动一下，就会按现在这个样子固定下来。';
  renderCount();
}

function renderCount() {
  const count = state.doc.cells.length;
  $('cell-count').textContent = count ? `共 ${count} 个格子` : '还没有格子，在下面空白处拖一个出来';
}

function addCellAtFreeSpot(cell) {
  toBoard();
  state.doc.cells.push(cell);
  markDirty();
  renderBoard();
  openDrawer(cell.id);
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
      openDrawer(cell.id);
      board.select(cell.id);
    },
  });
  boardEl.tabIndex = 0;
  boardEl.addEventListener('keydown', board.onKeyDown);
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
  posX: $('ed-pos-x'),
  posY: $('ed-pos-y'),
  posW: $('ed-pos-w'),
  posH: $('ed-pos-h'),
};

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const sixDigit = (value) => (typeof value === 'string' && HEX.test(value) ? value.slice(0, 7) : '#000000');

function setColorPicker(picker, text, value) {
  picker.value = sixDigit(value);
  text.value = value || '';
}

/** The text field wins when it holds a valid hex literal, so 8-digit alpha works. */
function readColorPicker(picker, text, fallback) {
  return HEX.test(text.value.trim()) ? text.value.trim() : picker.value || fallback;
}

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
  els.type.value = cell.type;
  els.borderWidth.value = cell.borderWidth;
  els.radius.value = cell.radius;
  setColorPicker(els.borderColor, els.borderColorText, cell.borderColor);
  els.image.value = cell.image;
  els.html.value = cell.html || '';
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

  const units = cellUnits(cell);
  const pos = cell.pos || { x: 0, y: 0 };
  els.posX.value = String(pos.x);
  els.posY.value = String(pos.y);
  els.posW.value = String(units.w);
  els.posH.value = String(units.h);

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

function syncTypeVisibility() {
  const type = els.type.value;
  $('fs-image').hidden = type !== 'image';
  $('fs-html').hidden = type !== 'html';
  $('fs-solid').hidden = type !== 'solid';
  // the always-on caption sits under both an image and an embedded page
  $('fs-caption').hidden = type !== 'image' && type !== 'html';
  // positions only mean something on a board
  $('fs-pos').hidden = !isBoard();
}

/** Pull every field back into the cell being edited. */
function applyForm() {
  const cell = currentCell();
  if (!cell) return;
  cell.type = els.type.value;
  cell.borderWidth = Number(els.borderWidth.value) || 0;
  cell.radius = Number(els.radius.value) || 0;
  cell.borderColor = readColorPicker(els.borderColor, els.borderColorText, '#7e46b9');
  cell.image = els.image.value.trim();
  cell.html = els.html.value.trim();
  cell.imageFit = els.fit.value;
  cell.imageTitle = els.imageTitle.value;
  cell.imageTitleColor = readColorPicker(els.imageTitleColor, els.imageTitleColorText, '#ffffff');
  cell.color = readColorPicker(els.color, els.colorText, '#7e46b9');
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

  if (isBoard()) {
    const wanted = {
      x: Math.max(0, Math.round(Number(els.posX.value) || 0)),
      y: Math.max(0, Math.round(Number(els.posY.value) || 0)),
      w: Math.max(1, Math.round(Number(els.posW.value) || 1)),
      h: Math.max(1, Math.round(Number(els.posH.value) || 1)),
    };
    const others = state.doc.cells.filter((item) => item.id !== cell.id).map(rectOf).filter(Boolean);
    const fits =
      wanted.x + wanted.w <= boardCols() && wanted.w <= 12 && wanted.h <= 12 && rectFree(others, wanted);
    if (fits) {
      cell.pos = wanted;
    } else {
      toast('那里放不下，位置没改（和别的格子重叠或者超出棋盘了）', 'error');
      const pos = cell.pos || { x: 0, y: 0 };
      const units = cellUnits(cell);
      els.posX.value = String(pos.x);
      els.posY.value = String(pos.y);
      els.posW.value = String(units.w);
      els.posH.value = String(units.h);
    }
  }
}

function onEdited() {
  applyForm();
  renderPreview();
  const cell = currentCell();
  if (cell) {
    board.refresh(boardCells().find((item) => item.id === cell.id) || cell);
    applyGridLayout(boardEl, boardCols(), { layout: 'board', cells: boardCells(), minCell: 56 });
  }
  markDirty();
}

function renderPreview() {
  const cell = currentCell();
  preview.replaceChildren();
  if (!cell) return;
  preview.append(createCell(cell));
  // the preview follows the site's layout settings, so it looks like the real page
  applyGridLayout(preview, Number(state.doc.site?.columns) || 0, { layout: layoutMode(), cells: [cell] });
}

function openDrawer(id) {
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
  renderPreview();
}

function closeDrawer() {
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
    els.type, els.borderWidth, els.radius, els.image, els.html, els.fit, els.imageTitle,
    els.color, els.color, els.ovEnabled, els.ovTitle, els.ovBody, els.ovDir,
    els.ovRatio, els.link,
  ];
  for (const element of new Set(live)) element.addEventListener('input', onEdited);

  els.type.addEventListener('change', () => {
    syncTypeVisibility();
    onEdited();
  });

  for (const [picker, text] of [
    [els.borderColor, els.borderColorText],
    [els.imageTitleColor, els.imageTitleColorText],
    [els.color, els.colorText],
    [els.ovBg, els.ovBgText],
    [els.ovFg, els.ovFgText],
  ]) {
    picker.addEventListener('input', () => {
      text.value = picker.value;
      onEdited();
    });
    text.addEventListener('input', () => {
      if (HEX.test(text.value.trim())) picker.value = sixDigit(text.value.trim());
      onEdited();
    });
  }

  $('drawer-close').addEventListener('click', closeDrawer);
  $('ed-done').addEventListener('click', closeDrawer);
  scrim.addEventListener('click', closeDrawer);
  $('ed-delete').addEventListener('click', () => removeCell(state.editingId));

  bindUpload('btn-upload', 'upload-file', 'uploads', els.image, '图片已上传');
  bindUpload('btn-upload-html', 'upload-file-html', 'pages', els.html, 'HTML 文件已上传');
  $('btn-clear-upload').addEventListener('click', () => {
    els.image.value = '';
    onEdited();
  });
  $('btn-open-html').addEventListener('click', () => {
    const target = els.html.value.trim();
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
    const rects = state.doc.cells.map(rectOf).filter(Boolean);
    const cell = defaultCell({ overlay: defaultOverlay(), pos: firstFreeSpot(rects, boardCols(), 1, 1) });
    state.doc.cells.push(cell);
    markDirty();
    renderBoard();
    openDrawer(cell.id);
    board.select(cell.id);
    drawer.querySelector('.drawer__body').scrollTop = 0;
  });
  $('btn-save').addEventListener('click', save);
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
