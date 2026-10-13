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

function renderSite() {
  for (const input of document.querySelectorAll('[data-site]')) {
    const key = input.dataset.site;
    input.value = state.doc.site?.[key] ?? (key === 'accent' ? '#7e46b9' : '');
  }
}

function bindSitePanel() {
  for (const input of document.querySelectorAll('[data-site]')) {
    input.addEventListener('input', () => {
      const key = input.dataset.site;
      state.doc.site = state.doc.site || {};
      state.doc.site[key] = input.value;
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
  $('fs-solid').hidden = type !== 'solid';
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

function bindEditor() {
  buildSelects();
  buildSizeOptions();

  const live = [
    els.type, els.borderWidth, els.radius, els.image, els.fit, els.imageTitle,
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

  $('btn-upload').addEventListener('click', () => $('upload-file').click());
  $('upload-file').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const result = await api(`/api/uploads?name=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        raw: true,
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      els.image.value = result.url;
      onEdited();
      toast('图片已上传', 'ok');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  $('btn-clear-upload').addEventListener('click', () => {
    els.image.value = '';
    onEdited();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.editingId) closeDrawer();
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
    state.doc = saved;
    state.dirty = false;
    $('dirty-flag').hidden = true;
    renderSite();
    renderList();
    if (state.editingId) renderPreview();
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
  state.doc = doc;
  state.dirty = false;
  $('dirty-flag').hidden = true;
  showApp();
  renderSite();
  renderList();
}

async function boot() {
  bindLogin();
  bindToolbar();
  bindList();
  bindEditor();
  bindSitePanel();

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
