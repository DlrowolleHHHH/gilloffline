/**
 * TXT → PNG: solid background, solid text, sized to the showcase cells.
 *
 * Everything is drawn on one canvas at the export resolution and shown scaled
 * down, so the preview is exactly what gets exported. Fonts come from the
 * machine running the browser — there is no webfont download — so the same
 * stack renders differently on a different computer.
 */

import { SIZES, SIZE_ORDER, toast } from './shared.js';
import { download, saveToServer, stampedName } from './editor-io.js';

const FONTS = [
  {
    group: '无衬线',
    list: [
      ['系统默认', 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'],
      ['苹方 / 黑体', '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif'],
      ['思源黑体', '"Noto Sans SC", "Source Han Sans SC", "PingFang SC", sans-serif'],
      ['Arial', 'Arial, Helvetica, sans-serif'],
      ['Helvetica', 'Helvetica, "Helvetica Neue", Arial, sans-serif'],
      ['Impact', 'Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif'],
    ],
  },
  {
    group: '衬线',
    list: [
      ['宋体 / 思源宋体', '"Songti SC", "Noto Serif SC", SimSun, STSong, serif'],
      ['楷体', '"Kaiti SC", KaiTi, STKaiti, "Songti SC", serif'],
      ['Georgia', 'Georgia, "Times New Roman", serif'],
      ['Times', '"Times New Roman", Times, serif'],
    ],
  },
  {
    group: '等宽',
    list: [['等宽', 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Courier New", monospace']],
  },
  {
    group: '圆体 / 手写',
    list: [
      ['圆体', '"Yuanti SC", "Hiragino Maru Gothic ProN", "Arial Rounded MT Bold", "Microsoft YaHei", sans-serif'],
      ['手写', '"Xingkai SC", "Bradley Hand", "Comic Sans MS", cursive'],
    ],
  },
];

/** Flat list; the select's value is the index into this. */
const FLAT = FONTS.flatMap((group) => group.list);

const state = {
  text: '橱窗',
  size: '1x1',
  cell: 256,
  fontIndex: 0,
  fontSize: 96,
  lineHeight: 1.25,
  autoFit: true,
  bold: true,
  italic: false,
  align: 'center',
  color: '#ffffff',
  bg: '#7e46b9',
  transparent: false,
};

const $ = (id) => document.getElementById(id);
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

let canvas = null;
let ctx = null;

/* ------------------------------------------------------------------- drawing */

const textLines = () => (state.text || '').split('\n');

const fontString = (size) =>
  `${state.italic ? 'italic ' : ''}${state.bold ? '700' : '400'} ${size}px ${FLAT[state.fontIndex][1]}`;

function dimensions() {
  const units = SIZES[state.size] || SIZES['1x1'];
  return { width: units.w * state.cell, height: units.h * state.cell };
}

function measure(lines, size) {
  ctx.font = fontString(size);
  let width = 0;
  for (const line of lines) width = Math.max(width, ctx.measureText(line || ' ').width);
  return { width, height: lines.length * size * state.lineHeight };
}

/** Largest font size at which the whole text still fits the inner box. */
function fitSize(lines, boxWidth, boxHeight) {
  let lo = 6;
  let hi = Math.max(8, Math.round(boxHeight));
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    const box = measure(lines, mid);
    if (box.width <= boxWidth && box.height <= boxHeight) lo = mid;
    else hi = mid;
  }
  return Math.min(lo, 600);
}

function render() {
  const { width, height } = dimensions();
  canvas.width = width;
  canvas.height = height;

  if (state.transparent) ctx.clearRect(0, 0, width, height);
  else {
    ctx.fillStyle = state.bg;
    ctx.fillRect(0, 0, width, height);
  }

  const lines = textLines();
  const pad = Math.max(8, Math.round(Math.min(width, height) * 0.08));
  const size = state.autoFit
    ? fitSize(lines, width - pad * 2, height - pad * 2)
    : Math.min(600, Math.max(6, state.fontSize));

  ctx.font = fontString(size);
  ctx.fillStyle = state.color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = state.align;

  const lineHeight = size * state.lineHeight;
  const x = state.align === 'left' ? pad : state.align === 'right' ? width - pad : width / 2;
  let y = height / 2 - (lineHeight * lines.length) / 2 + lineHeight / 2;
  for (const line of lines) {
    ctx.fillText(line || ' ', x, y);
    y += lineHeight;
  }

  $('tp-info').textContent = `画布 ${width} × ${height} px · 字号 ${Math.round(size)} · ${lines.length} 行`;
  $('tp-dims').textContent = `${width} × ${height} px`;
  $('tp-fontsize').value = state.autoFit ? Math.round(size) : state.fontSize;
}

/* ------------------------------------------------------------------ controls */

function buildFontSelect() {
  const select = $('tp-font');
  select.replaceChildren();
  let index = 0;
  for (const group of FONTS) {
    const optgroup = document.createElement('optgroup');
    optgroup.label = group.group;
    for (const [label] of group.list) {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = label;
      optgroup.append(option);
      index += 1;
    }
    select.append(optgroup);
  }
  select.value = '0';
}

function buildSizePicker() {
  const picker = $('tp-sizes');
  picker.replaceChildren();
  for (const key of SIZE_ORDER) {
    const units = SIZES[key];
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'size-option';
    button.dataset.size = key;
    button.setAttribute('aria-pressed', 'false');

    const label = document.createElement('strong');
    label.textContent = units.label;
    const note = document.createElement('span');
    note.textContent = `${units.w} × ${units.h} 格`;
    button.append(label, note);

    button.addEventListener('click', () => {
      state.size = key;
      syncSizePicker();
      render();
    });
    picker.append(button);
  }
  syncSizePicker();
}

function syncSizePicker() {
  for (const button of $('tp-sizes').querySelectorAll('.size-option')) {
    button.setAttribute('aria-pressed', String(button.dataset.size === state.size));
  }
}

function buildAlign() {
  const seg = $('tp-align');
  seg.replaceChildren();
  for (const [value, glyph, title] of [
    ['left', '⇤', '左对齐'],
    ['center', '↔', '居中'],
    ['right', '⇥', '右对齐'],
  ]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.align = value;
    button.textContent = glyph;
    button.title = title;
    button.setAttribute('aria-label', title);
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => {
      state.align = value;
      syncAlign();
      render();
    });
    seg.append(button);
  }
  syncAlign();
}

function syncAlign() {
  for (const button of $('tp-align').querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.align === state.align));
  }
}

/** Colour inputs keep an 8-digit-free hex in the picker and the raw text beside it. */
function bindColor(pickerId, textId, key) {
  const picker = $(pickerId);
  const text = $(textId);
  picker.value = state[key];
  text.value = state[key];

  picker.addEventListener('input', () => {
    text.value = picker.value;
    state[key] = picker.value;
    render();
  });
  text.addEventListener('input', () => {
    if (!HEX.test(text.value.trim())) return;
    picker.value = text.value.trim();
    state[key] = text.value.trim();
    render();
  });
}

function fileName() {
  const typed = $('tp-name').value.trim();
  const name = typed || stampedName('text', 'png');
  return /\.png$/i.test(name) ? name : `${name}.png`;
}

async function toBlob() {
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'));
}

function bindActions() {
  $('tp-download').addEventListener('click', async () => {
    const blob = await toBlob();
    if (!blob) return toast('导出失败', 'error');
    download(blob, fileName());
  });

  $('tp-save').addEventListener('click', async () => {
    const button = $('tp-save');
    button.disabled = true;
    try {
      const blob = await toBlob();
      if (!blob) throw new Error('导出失败');
      const saved = await saveToServer(blob, fileName(), $('tp-kind').value);
      $('tp-save-hint').textContent = `已存到 ${saved.url}（${Math.round(saved.size / 1024)} KB）`;
      toast('已存到服务器', 'ok');
    } catch (err) {
      $('tp-save-hint').textContent = '';
      toast(err.message, 'error');
    } finally {
      button.disabled = false;
    }
  });
}

function bindForm() {
  $('tp-text').addEventListener('input', (event) => {
    state.text = event.target.value;
    render();
  });
  $('tp-cell').addEventListener('change', (event) => {
    state.cell = Number(event.target.value) || 256;
    render();
  });
  $('tp-font').addEventListener('change', (event) => {
    state.fontIndex = Number(event.target.value) || 0;
    render();
  });
  $('tp-fontsize').addEventListener('input', (event) => {
    state.fontSize = Number(event.target.value) || 96;
    if (state.autoFit) {
      state.autoFit = false;
      $('tp-autofit').checked = false;
    }
    render();
  });
  $('tp-lineheight').addEventListener('input', (event) => {
    state.lineHeight = Math.min(3, Math.max(0.8, Number(event.target.value) || 1.25));
    render();
  });
  $('tp-autofit').addEventListener('change', (event) => {
    state.autoFit = event.target.checked;
    render();
  });
  $('tp-bold').addEventListener('change', (event) => {
    state.bold = event.target.checked;
    render();
  });
  $('tp-italic').addEventListener('change', (event) => {
    state.italic = event.target.checked;
    render();
  });
  $('tp-transparent').addEventListener('change', (event) => {
    state.transparent = event.target.checked;
    render();
  });
}

export function init() {
  canvas = $('tp-canvas');
  ctx = canvas.getContext('2d');

  $('tp-text').value = state.text;
  $('tp-cell').value = String(state.cell);
  $('tp-fontsize').value = String(state.fontSize);
  $('tp-lineheight').value = String(state.lineHeight);
  $('tp-autofit').checked = state.autoFit;
  $('tp-bold').checked = state.bold;
  $('tp-italic').checked = state.italic;
  $('tp-transparent').checked = state.transparent;
  $('tp-name').value = stampedName('text', 'png');

  buildFontSelect();
  buildSizePicker();
  buildAlign();
  bindColor('tp-color', 'tp-color-text', 'color');
  bindColor('tp-bg', 'tp-bg-text', 'bg');
  bindForm();
  bindActions();
  render();
}
