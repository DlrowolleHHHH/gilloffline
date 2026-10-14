import {
  SIZES,
  SIZE_ORDER,
  DIRECTIONS,
  RATIOS,
  createCell,
  defaultCell,
  defaultOverlay,
  newId,
  toast,
} from './shared.js';

const $ = (id) => document.getElementById(id);

const state = {
  doc: { site: {}, cells: [] },
  editingId: null,
  dirty: false,
  dragId: null,
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
  if (message) {
    const error = $('login-error');
    error.textContent = message;
    error.hidden = false;
  }
  $('login-password').focus();
}

function showApp() {
  loginView.hidden = true;
  appView.hidden = false;
  topbar.hidden = false;
  $('login-error').hidden = true;
  $('login-password').value = '';
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
      state.doc.site = state.doc.site || {};
      state.doc.site[key] = isToggle ? input.checked : input.value;
      if (key === 'accent') document.documentElement.style.setProperty('--accent', input.value);
      markDirty();
    });
  }
}

/* --------------------------------------------------------------- cell list */

const list = $('list');

function slotFor(cell) {
  const size = SIZES[cell.size] || SIZES['1x1'];
  const slot = document.createElement('div');
  slot.className = `slot w${size.w} h${size.h}`;
  slot.dataset.id = cell.id;
  slot.draggable = true;

  const node = createCell(cell);
  node.querySelectorAll('img').forEach((img) => (img.draggable = false));
  slot.append(node);

  const bar = document.createElement('div');
  bar.className = 'slot__bar';
  const actions = [
    ['grab', '⠿', '拖动排序', 'slot__btn--grab'],
    ['edit', '✎', '编辑', ''],
    ['dup', '⧉', '复制', ''],
    ['up', '↑', '前移', ''],
    ['down', '↓', '后移', ''],
    ['del', '✕', '删除', 'slot__btn--danger'],
  ];
  for (const [act, glyph, title, extra] of actions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `slot__btn ${extra}`.trim();
    button.dataset.act = act;
    button.title = title;
    button.setAttribute('aria-label', title);
    button.textContent = glyph;
    bar.append(button);
  }
  slot.append(bar);
  return slot;
}

function renderList() {
  list.replaceChildren();
  for (const cell of state.doc.cells) list.append(slotFor(cell));
  const count = state.doc.cells.length;
  $('cell-count').textContent = count ? `共 ${count} 个格子` : '还没有格子';
  if (!count) {
    const empty = document.createElement('div');
    empty.className = 'grid-state';
    empty.style.gridColumn = '1 / -1';
    empty.textContent = '点击右上角「＋ 添加格子」开始布置你的橱窗。';
    list.append(empty);
  }
}

function refreshSlot(id) {
  const slot = list.querySelector(`.slot[data-id="${CSS.escape(id)}"]`);
  const cell = state.doc.cells.find((item) => item.id === id);
  if (!slot || !cell) return;
  const replacement = slotFor(cell);
  replacement.classList.add('is-refreshed');
  slot.replaceWith(replacement);
}

function moveCell(id, delta) {
  const index = state.doc.cells.findIndex((cell) => cell.id === id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= state.doc.cells.length) return;
  const [cell] = state.doc.cells.splice(index, 1);
  state.doc.cells.splice(target, 0, cell);
  markDirty();
  renderList();
}

function removeCell(id) {
  const index = state.doc.cells.findIndex((cell) => cell.id === id);
  if (index < 0) return;
  if (!confirm('确定删除这个格子？')) return;
  state.doc.cells.splice(index, 1);
  if (state.editingId === id) closeDrawer();
  markDirty();
  renderList();
}

function duplicateCell(id) {
  const index = state.doc.cells.findIndex((cell) => cell.id === id);
  if (index < 0) return;
  const copy = structuredClone(state.doc.cells[index]);
  copy.id = newId();
  state.doc.cells.splice(index + 1, 0, copy);
  markDirty();
  renderList();
}

function bindList() {
  list.addEventListener('click', (event) => {
    const button = event.target.closest('.slot__btn');
    if (!button) {
      if (event.target.closest('.slot__bar')) return;
      const slot = event.target.closest('.slot');
      if (slot) openDrawer(slot.dataset.id); // clicking the cell itself opens the editor
      return;
    }
    const id = button.closest('.slot').dataset.id;
    switch (button.dataset.act) {
      case 'edit':
        openDrawer(id);
        break;
      case 'dup':
        duplicateCell(id);
        break;
      case 'up':
        moveCell(id, -1);
        break;
      case 'down':
        moveCell(id, 1);
        break;
      case 'del':
        removeCell(id);
        break;
      default:
        break;
    }
  });

  // Reorder by dragging a cell; the DOM order becomes the data order.
  list.addEventListener('dragstart', (event) => {
    const slot = event.target.closest('.slot');
    if (!slot) return;
    state.dragId = slot.dataset.id;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', state.dragId);
    requestAnimationFrame(() => slot.classList.add('is-dragging'));
  });

  list.addEventListener('dragover', (event) => {
    if (!state.dragId) return;
    const dragged = list.querySelector(`.slot[data-id="${CSS.escape(state.dragId)}"]`);
    const target = event.target.closest('.slot');
    if (!dragged || !target || target === dragged) return;
    event.preventDefault();
    const rect = target.getBoundingClientRect();
    const isAfter = event.clientX - rect.left > rect.width / 2;
    target.parentNode.insertBefore(dragged, isAfter ? target.nextSibling : target);
  });

  list.addEventListener('dragend', () => {
    const dragged = list.querySelector('.slot.is-dragging');
    if (dragged) dragged.classList.remove('is-dragging');
    commitDragOrder();
  });

  list.addEventListener('drop', (event) => {
    event.preventDefault();
    commitDragOrder();
  });
}

function commitDragOrder() {
  if (!state.dragId) return;
  const order = [...list.querySelectorAll('.slot')].map((slot) => slot.dataset.id);
  const map = new Map(state.doc.cells.map((cell) => [cell.id, cell]));
  const reordered = order.map((id) => map.get(id)).filter(Boolean);
  const changed = reordered.some((cell, index) => cell.id !== state.doc.cells[index]?.id);
  state.dragId = null;
  if (!changed) return;
  state.doc.cells = reordered;
  markDirty();
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

    const shape = document.createElement('span');
    shape.className = 'size-option__shape';
    for (let row = 0; row < 2; row += 1) {
      for (let col = 0; col < 4; col += 1) {
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
      cell.size = key;
      syncSizeButtons();
      onEdited();
    });
    els.sizes.append(button);
  }
}

function syncSizeButtons() {
  const cell = currentCell();
  for (const button of els.sizes.querySelectorAll('.size-option')) {
    button.setAttribute('aria-pressed', String(button.dataset.size === cell?.size));
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
}

function onEdited() {
  applyForm();
  renderPreview();
  refreshSlot(state.editingId);
  markDirty();
}

function renderPreview() {
  const cell = currentCell();
  preview.replaceChildren();
  if (!cell) return;
  preview.append(createCell(cell));
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
      const result = await api(fileUrl(kind, file.name), {
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

const filesApi = (kind, name = '') =>
  `/api/files?kind=${encodeURIComponent(kind)}${name ? `&name=${encodeURIComponent(name)}` : ''}`;

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

/* -------------------------------------------------------------- save/export */

function markDirty() {
  state.dirty = true;
  $('dirty-flag').hidden = false;
}

async function save() {
  const button = $('btn-save');
  button.disabled = true;
  try {
    const saved = await api('/api/site', { method: 'PUT', body: state.doc });
    state.doc = absorbDoc(saved);
    state.dirty = false;
    $('dirty-flag').hidden = true;
    renderSite();
    renderList();
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
    renderSite();
    renderList();
    markDirty();
    toast('已导入，别忘了点击保存', 'ok');
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* -------------------------------------------------------------------- boot */

function bindToolbar() {
  $('btn-add').addEventListener('click', () => {
    const cell = defaultCell({ overlay: defaultOverlay() });
    state.doc.cells.push(cell);
    markDirty();
    renderList();
    openDrawer(cell.id);
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
      await api('/api/login', { method: 'POST', body: { password: $('login-password').value } });
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
  const doc = await api('/api/site');
  state.doc = absorbDoc(doc);
  state.dirty = false;
  $('dirty-flag').hidden = true;
  showApp();
  renderSite();
  renderList();
  refreshFilesIfVisible();
}

async function boot() {
  bindLogin();
  bindToolbar();
  bindList();
  bindEditor();
  bindSitePanel();
  bindFiles();

  window.addEventListener('beforeunload', (event) => {
    if (!state.dirty) return undefined;
    event.preventDefault();
    event.returnValue = '';
    return '';
  });

  try {
    const session = await api('/api/session');
    if (!session.configured) {
      $('login-hint').textContent =
        '服务端没有配置 ADMIN_PASSWORD 环境变量，管理功能已禁用。请在部署时设置密码后重启容器。';
      $('login-submit').disabled = true;
      $('login-password').disabled = true;
      showLogin();
      return;
    }
    if (session.authenticated) {
      await start();
    } else {
      showLogin();
    }
  } catch (err) {
    showLogin(`无法连接服务器：${err.message}`);
  }
}

boot();
