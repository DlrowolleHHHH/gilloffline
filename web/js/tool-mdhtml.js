/**
 * MD → HTML: write Markdown in the browser, preview it with the site's look,
 * then download the self-contained page or save it into pages/.
 *
 * No dependency: the Markdown parser below covers headings, paragraphs,
 * emphasis, highlights (==text==), links, images, lists, blockquotes, fenced
 * code, tables and rules. Raw HTML in the source is escaped on purpose.
 */

import { toast, withUserid } from './shared.js';
import { download, saveToServer, stampedName } from './editor-io.js';

const $ = (id) => document.getElementById(id);

const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', " +
  "'Microsoft YaHei', 'Noto Sans SC', Roboto, Helvetica, Arial, sans-serif";
const HAND_STACK =
  '"Xingkai SC", "Kaiti SC", KaiTi, STKaiti, "Comic Sans MS", "Bradley Hand", cursive';
const MONO_STACK = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace";

const STYLE_LABELS = { annotation: '标注', handdrawn: '手绘风' };
const STYLE_HINTS = {
  annotation: '清爽的站内排版：荧光标注、批注框、强调色标题。',
  handdrawn: '手写风：楷体 / 手写字、波浪线、虚线框，像一页手写笔记。',
};

const SAMPLE = `# 我的页面

这是一段**正文**，支持 ==标注==、*斜体*、~~删除线~~、\`行内代码\` 和 [链接](https://github.com/)。

> 这里是一段批注：写点补充说明。

## 小标题

- 第一项
- 第二项
  - 嵌套项

1. 有序项一
2. 有序项二

~~~js
console.log('hello');
~~~

| 名称 | 说明 |
| --- | --- |
| 盒子 | 橱窗里的一格 |
`;

const state = {
  title: '我的页面',
  style: 'annotation',
  source: SAMPLE,
};

/* ------------------------------------------------------------------ escaping */

const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ESCAPE_MAP[char]);

/** Only keep URLs that can safely end up in href/src. */
function safeUrl(raw, image = false) {
  let url = String(raw || '').trim();
  if (url.startsWith('<') && url.endsWith('>')) url = url.slice(1, -1).trim();
  if (!url) return '';
  if (/^(?:https?:|mailto:)/i.test(url)) return url;
  if (/^(?:\/|#|\.{1,2}\/)/.test(url)) return url;
  if (image && /^data:image\/(?:png|jpe?g|gif|webp|avif|svg\+xml);base64,/i.test(url)) return url;
  return '';
}

/* -------------------------------------------------------------- inline markdown */

/** Bold / italic / strike / highlight. `==text==` is our annotation syntax. */
function emphasis(text) {
  return text
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
    .replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
    .replace(/==([^=\n]+)==/g, '<mark>$1</mark>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_([^_\n]+)_/g, '$1<em>$2</em>');
}

function renderInline(text) {
  const codes = [];
  const escapes = [];
  const images = [];
  const links = [];

  let value = String(text || '');
  // Backslash escapes first, so \* stays a literal star.
  value = value.replace(/\\([\\`*_{}\[\]()#+\-.!~=>|])/g, (_, char) => {
    escapes.push(char);
    return `\u0000e${escapes.length - 1}\u0000`;
  });
  // Code spans; their content is already escaped and must not be parsed again.
  value = value.replace(/(`+)([^`\n]*?)\1/g, (_, ticks, code) => {
    codes.push(`<code>${escapeHtml(code)}</code>`);
    return `\u0000c${codes.length - 1}\u0000`;
  });
  // Images before links (the leading ! is the difference).
  value = value.replace(
    /!\[([^\]]*)\]\(\s*(<[^>]+>|[^)\s]+)(?:\s+"([^"]*)")?\s*\)/g,
    (match, alt, rawUrl, title) => {
      const url = safeUrl(rawUrl, true);
      if (!url) return match;
      images.push({ alt, url, title });
      return `\u0000i${images.length - 1}\u0000`;
    }
  );
  value = value.replace(
    /\[([^\]]+)\]\(\s*(<[^>]+>|[^)\s]+)(?:\s+"([^"]*)")?\s*\)/g,
    (match, label, rawUrl, title) => {
      const url = safeUrl(rawUrl);
      if (!url) return match;
      links.push({ label, url, title });
      return `\u0000l${links.length - 1}\u0000`;
    }
  );

  // Escape the remaining prose, then apply inline styles.
  value = escapeHtml(value);
  value = emphasis(value);

  const restoreParts = (html) =>
    html
      .replace(/\u0000e(\d+)\u0000/g, (_, n) => escapeHtml(escapes[+n]))
      .replace(/\u0000c(\d+)\u0000/g, (_, n) => codes[+n]);

  value = restoreParts(value);
  value = value.replace(/\u0000i(\d+)\u0000/g, (_, n) => {
    const image = images[+n];
    const title = image.title ? ` title="${escapeHtml(image.title)}"` : '';
    const alt = image.alt.replace(/\u0000[ce]\d+\u0000/g, '');
    return `<img src="${escapeHtml(image.url)}" alt="${escapeHtml(alt)}"${title} loading="lazy">`;
  });
  value = value.replace(/\u0000l(\d+)\u0000/g, (_, n) => {
    const link = links[+n];
    const title = link.title ? ` title="${escapeHtml(link.title)}"` : '';
    const label = restoreParts(emphasis(escapeHtml(link.label)));
    return `<a href="${escapeHtml(link.url)}"${title} target="_blank" rel="noopener noreferrer">${label}</a>`;
  });
  return value;
}

/* --------------------------------------------------------------- block markdown */

const isFence = (line) => /^ {0,3}(```+|~~~+)\s*[\w+-]*\s*$/.test(line);
const isRule = (line) => /^ {0,3}((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})$/.test(line);
const isHeading = (line) => /^ {0,3}#{1,6}\s+/.test(line);
const isList = (line) => /^ {0,3}([-*+]|\d+\.)\s+/.test(line);
const isQuote = (line) => /^ {0,3}>/.test(line);
const leadingSpaces = (line) => (line.match(/^ */) || [''])[0].length;

function isTableStart(lines, index) {
  if (index + 1 >= lines.length) return false;
  if (!lines[index].includes('|')) return false;
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1]);
}

function isBlockStart(lines, index) {
  const line = lines[index];
  if (!line.trim()) return true;
  return (
    isFence(line) ||
    isHeading(line) ||
    isRule(line) ||
    isQuote(line) ||
    isList(line) ||
    isTableStart(lines, index)
  );
}

function renderParagraph(lines) {
  const text = lines.map((line) => line.replace(/ {2,}$/, '\u0000BR\u0000')).join('\n');
  return `<p>${renderInline(text).replace(/\u0000BR\u0000/g, '<br>').replace(/\n/g, ' ')}</p>`;
}

function parseList(lines, start, depth) {
  const first = lines[start].match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
  const baseIndent = first[1].length;
  const ordered = /^\d/.test(first[2]);
  const startNumber = ordered ? Number(first[2]) : 1;
  const items = [];
  let i = start;

  while (i < lines.length) {
    const match = lines[i].match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
    if (!match) break;
    const indent = match[1].length;
    if (indent !== baseIndent || /^\d/.test(match[2]) !== ordered) break;

    const content = [match[3]];
    i += 1;
    while (i < lines.length) {
      const next = lines[i];
      if (!next.trim()) {
        let j = i;
        while (j < lines.length && !lines[j].trim()) j += 1;
        if (j >= lines.length) {
          i = j;
          break;
        }
        const following = lines[j].match(/^(\s*)([-*+]|\d+\.)\s+/);
        if (following && following[1].length === baseIndent && /^\d/.test(following[2]) === ordered) {
          i = j; // a blank line between two items: keep the same list
          break;
        }
        if (following && following[1].length > baseIndent) {
          content.push('');
          i += 1;
          continue;
        }
        break;
      }
      const lead = leadingSpaces(next);
      if (lead > baseIndent) {
        content.push(next.slice(Math.min(lead, baseIndent + 2)));
        i += 1;
        continue;
      }
      if (isBlockStart(lines, i)) break;
      content.push(next);
      i += 1;
    }
    items.push(content);
  }

  const lis = items.map((content) => {
    const html = parseBlocks(content, depth + 1);
    const singleParagraph =
      html.startsWith('<p>') && html.endsWith('</p>') && !html.slice(3, -4).includes('<p>');
    return `<li>${singleParagraph ? html.slice(3, -4) : html}</li>`;
  });
  const tag = ordered ? 'ol' : 'ul';
  const startAttr = ordered && startNumber !== 1 ? ` start="${startNumber}"` : '';
  return { html: `<${tag}${startAttr}>\n${lis.join('\n')}\n</${tag}>`, next: i };
}

function splitTableRow(line) {
  let value = line.trim();
  if (value.startsWith('|')) value = value.slice(1);
  if (value.endsWith('|')) value = value.slice(0, -1);
  return value.split('|').map((cell) => cell.trim());
}

function parseTable(lines, start) {
  const header = splitTableRow(lines[start]);
  const align = splitTableRow(lines[start + 1]).map((cell) => {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    return left && right ? 'center' : right ? 'right' : left ? 'left' : '';
  });
  const rows = [];
  let i = start + 2;
  while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
    rows.push(splitTableRow(lines[i]));
    i += 1;
  }
  const alignAttr = (index) => (align[index] ? ` style="text-align:${align[index]}"` : '');
  const head = header
    .map((cell, index) => `<th${alignAttr(index)}>${renderInline(cell)}</th>`)
    .join('');
  const body = rows
    .map(
      (row) =>
        `<tr>${header
          .map((_, index) => `<td${alignAttr(index)}>${renderInline(row[index] || '')}</td>`)
          .join('')}</tr>`
    )
    .join('\n');
  return {
    html: `<table>\n<thead><tr>${head}</tr></thead>\n<tbody>\n${body}\n</tbody>\n</table>`,
    next: i,
  };
}

function parseBlocks(lines, depth = 0) {
  if (depth > 6) return `<p>${renderInline(lines.join(' '))}</p>`;
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }

    // fenced code
    const fence = line.match(/^ {0,3}(```+|~~~+)\s*([\w+-]*)\s*$/);
    if (fence) {
      const marker = fence[1];
      const lang = fence[2];
      const close = new RegExp(`^ {0,3}${marker[0]}{${marker.length},}\\s*$`);
      const code = [];
      i += 1;
      while (i < lines.length && !close.test(lines[i])) {
        code.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      const cls = lang ? ` class="language-${escapeHtml(lang)}"` : '';
      out.push(`<pre><code${cls}>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    // heading
    const heading = line.match(/^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      i += 1;
      continue;
    }

    // horizontal rule
    if (isRule(line)) {
      out.push('<hr>');
      i += 1;
      continue;
    }

    // blockquote (parsed recursively, so lists/code inside work too)
    if (isQuote(line)) {
      const inner = [];
      while (i < lines.length && isQuote(lines[i])) {
        inner.push(lines[i].replace(/^ {0,3}>\s?/, ''));
        i += 1;
      }
      out.push(`<blockquote>${parseBlocks(inner, depth + 1)}</blockquote>`);
      continue;
    }

    // list
    if (isList(line)) {
      const { html, next } = parseList(lines, i, depth);
      out.push(html);
      i = next;
      continue;
    }

    // table
    if (isTableStart(lines, i)) {
      const { html, next } = parseTable(lines, i);
      out.push(html);
      i = next;
      continue;
    }

    // paragraph
    const paragraph = [line];
    i += 1;
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines, i)) {
      paragraph.push(lines[i]);
      i += 1;
    }
    out.push(renderParagraph(paragraph));
  }

  return out.join('\n');
}

function renderMarkdown(source) {
  return parseBlocks(String(source || '').replace(/\r\n?/g, '\n').split('\n'));
}

/* ------------------------------------------------------------------- document */

const BASE_CSS = `
:root {
  color-scheme: dark;
  --accent: #7e46b9;
  --ink-900: #08070d;
  --ink-800: #0d0b14;
  --ink-700: #15121f;
  --ink-600: #1d1929;
  --line: #332b45;
  --text: #ece9f5;
  --text-dim: #a49cb8;
}
* { box-sizing: border-box; }
html { background: var(--ink-900); }
body {
  margin: 0;
  min-height: 100vh;
  background: var(--ink-800);
  background-image:
    radial-gradient(900px 520px at 10% -10%, color-mix(in srgb, var(--accent) 24%, transparent), transparent 70%),
    radial-gradient(700px 460px at 100% 5%, rgba(87, 191, 255, 0.1), transparent 65%);
  background-attachment: fixed;
  color: var(--text);
  font-family: ${FONT_STACK};
  font-size: 16px;
  line-height: 1.8;
  -webkit-font-smoothing: antialiased;
}
.md { width: min(820px, 100%); margin: 0 auto; padding: 56px 28px 72px; }
.md > :first-child { margin-top: 0; }
.md h1, .md h2, .md h3, .md h4, .md h5, .md h6 {
  margin: 1.6em 0 0.6em;
  color: #fff;
  font-weight: 700;
  line-height: 1.35;
}
.md h1 { font-size: 2.1em; letter-spacing: -0.01em; }
.md h2 { font-size: 1.55em; }
.md h3 { font-size: 1.22em; }
.md h4 { font-size: 1.08em; }
.md p { margin: 1em 0; }
.md a { color: #b997e6; text-decoration: underline; text-underline-offset: 3px; }
.md img { max-width: 100%; height: auto; border-radius: 10px; }
.md blockquote {
  margin: 1.4em 0;
  padding: 14px 18px;
  border-left: 3px solid var(--accent);
  border-radius: 0 10px 10px 0;
  background: color-mix(in srgb, var(--accent) 13%, transparent);
  color: #dcd6ea;
}
.md blockquote p { margin: 0.4em 0; }
.md code {
  padding: 0.15em 0.4em;
  border-radius: 5px;
  background: var(--ink-600);
  color: #e8d9ff;
  font-family: ${MONO_STACK};
  font-size: 0.9em;
}
.md pre {
  margin: 1.3em 0;
  padding: 16px;
  overflow: auto;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--ink-900);
}
.md pre code { padding: 0; background: none; color: var(--text); font-size: 0.88em; }
.md ul, .md ol { margin: 1em 0; padding-left: 1.6em; }
.md li { margin: 0.35em 0; }
.md li > p { margin: 0.2em 0; }
.md hr { margin: 2em 0; border: 0; border-top: 1px solid var(--line); }
.md table { width: 100%; border-collapse: collapse; margin: 1.4em 0; font-size: 0.95em; }
.md th, .md td { padding: 9px 12px; border: 1px solid var(--line); text-align: left; vertical-align: top; }
.md th { background: color-mix(in srgb, var(--accent) 18%, transparent); color: #fff; }
.md tr:nth-child(even) td { background: rgba(255, 255, 255, 0.02); }
.md mark { padding: 0.05em 0.2em; border-radius: 4px; }
.md del { opacity: 0.72; }
.md ::selection { background: color-mix(in srgb, var(--accent) 50%, transparent); }
@media (max-width: 640px) {
  .md { padding: 32px 18px 48px; }
  .md h1 { font-size: 1.75em; }
  .md h2 { font-size: 1.35em; }
}
`;

const ANNOTATION_CSS = `
body[data-style="annotation"] { font-family: ${FONT_STACK}; }
body[data-style="annotation"] .md h1 {
  padding-bottom: 0.35em;
  border-bottom: 1px solid var(--line);
}
body[data-style="annotation"] .md h2::before {
  content: "";
  display: inline-block;
  width: 0.45em;
  height: 0.9em;
  margin-right: 0.5em;
  border-radius: 3px;
  background: var(--accent);
  vertical-align: -0.05em;
}
body[data-style="annotation"] .md blockquote { position: relative; padding-left: 48px; }
body[data-style="annotation"] .md blockquote::before {
  content: "注";
  position: absolute;
  left: 14px;
  top: 13px;
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  background: var(--accent);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
}
body[data-style="annotation"] .md mark {
  background: #f3d36b;
  color: #241d0b;
  box-shadow: 0 0 0 1px rgba(243, 211, 107, 0.35);
}
`;

const HANDDRAWN_CSS = `
body[data-style="handdrawn"] {
  font-family: ${HAND_STACK};
  font-size: 17px;
  line-height: 1.95;
  background-image:
    radial-gradient(900px 520px at 10% -10%, color-mix(in srgb, var(--accent) 22%, transparent), transparent 70%),
    repeating-linear-gradient(transparent 0 31px, rgba(255, 255, 255, 0.018) 31px 32px);
}
body[data-style="handdrawn"] .md h1,
body[data-style="handdrawn"] .md h2,
body[data-style="handdrawn"] .md h3,
body[data-style="handdrawn"] .md h4 {
  font-family: ${HAND_STACK};
  font-weight: 600;
}
body[data-style="handdrawn"] .md h1 {
  font-size: 2.2em;
  text-decoration: underline wavy color-mix(in srgb, var(--accent) 75%, transparent);
  text-underline-offset: 0.17em;
  text-decoration-thickness: 2px;
}
body[data-style="handdrawn"] .md h2 {
  display: inline-block;
  padding-bottom: 0.08em;
  border-bottom: 2px dashed color-mix(in srgb, var(--accent) 65%, transparent);
}
body[data-style="handdrawn"] .md blockquote {
  border: 2px dashed #4a3d61;
  border-left: 2px dashed #4a3d61;
  border-radius: 14px 10px 16px 9px;
  background: rgba(255, 255, 255, 0.025);
  transform: rotate(-0.25deg);
}
body[data-style="handdrawn"] .md img {
  border: 5px solid #efe8d8;
  border-radius: 4px;
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.35);
  transform: rotate(-0.5deg);
}
body[data-style="handdrawn"] .md mark {
  background: linear-gradient(
    100deg,
    rgba(243, 211, 107, 0.12),
    rgba(243, 211, 107, 0.48) 42%,
    rgba(243, 211, 107, 0.16)
  );
  color: inherit;
}
body[data-style="handdrawn"] .md a {
  text-decoration: underline wavy;
  text-underline-offset: 4px;
}
body[data-style="handdrawn"] .md ul { list-style: none; padding-left: 1.4em; }
body[data-style="handdrawn"] .md ul > li::before {
  content: "✎";
  margin-right: 0.5em;
  color: var(--accent);
}
body[data-style="handdrawn"] .md code,
body[data-style="handdrawn"] .md pre {
  font-family: ${MONO_STACK};
}
body[data-style="handdrawn"] .md pre { border-style: dashed; }
body[data-style="handdrawn"] .md table,
body[data-style="handdrawn"] .md th,
body[data-style="handdrawn"] .md td {
  border-style: dashed;
}
body[data-style="handdrawn"] .md hr { border-top: 2px dashed #4a3d61; }
`;

function buildHtml() {
  const title = state.title.trim() || 'Markdown 页面';
  const style = state.style === 'handdrawn' ? 'handdrawn' : 'annotation';
  const styleCss = style === 'handdrawn' ? HANDDRAWN_CSS : ANNOTATION_CSS;
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${BASE_CSS}${styleCss}</style>
</head>
<body data-style="${style}">
<main class="md">
${renderMarkdown(state.source)}
</main>
</body>
</html>`;
}

/* ---------------------------------------------------------------------- UI */

let previewTimer = null;

function syncStyle() {
  for (const button of $('md-style').querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.style === state.style));
  }
  $('md-style-hint').textContent = STYLE_HINTS[state.style];
}

function renderPreview() {
  const html = buildHtml();
  $('md-preview').srcdoc = html;
  const kb = new Blob([html]).size / 1024;
  $('md-info').textContent = `${STYLE_LABELS[state.style]} · ${state.source.length} 字符 · HTML ${kb.toFixed(1)} KB`;
}

function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(renderPreview, 140);
}

function insertAtCursor(text) {
  const area = $('md-source');
  const start = area.selectionStart;
  const end = area.selectionEnd;
  const value = area.value;
  const before = value.slice(0, start);
  const after = value.slice(end);
  const prefix = before && !before.endsWith('\n') ? '\n' : '';
  const suffix = after && !after.startsWith('\n') ? '\n' : '';
  const inserted = `${prefix}${text}${suffix}`;
  area.value = `${before}${inserted}${after}`;
  const caret = before.length + prefix.length + text.length;
  area.selectionStart = caret;
  area.selectionEnd = caret;
  area.focus();
  state.source = area.value;
  renderPreview();
}

function wrapSelection(before, after) {
  const area = $('md-source');
  const start = area.selectionStart;
  const end = area.selectionEnd;
  const value = area.value;
  const selected = value.slice(start, end) || '标注文字';
  const inserted = `${before}${selected}${after}`;
  area.value = `${value.slice(0, start)}${inserted}${value.slice(end)}`;
  area.selectionStart = start + before.length;
  area.selectionEnd = start + before.length + selected.length;
  area.focus();
  state.source = area.value;
  renderPreview();
}

/* --------------------------------------------------------------- image picker */

const IMAGE_EXT = /\.(?:png|jpe?g|gif|webp|avif|svg|ico)$/i;

function imageEmpty(text) {
  const hint = document.createElement('span');
  hint.className = 'hint md-images__empty';
  hint.textContent = text;
  return hint;
}

async function loadImages() {
  const box = $('md-images');
  const hint = $('md-images-hint');
  const kind = $('md-image-kind').value;
  box.replaceChildren(imageEmpty('加载中…'));
  hint.textContent = '';
  try {
    const res = await fetch(withUserid(`/api/files?kind=${encodeURIComponent(kind)}`), {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error(
        res.status === 401
          ? '登录后才能浏览服务器图片；也可以直接在 Markdown 里写图片地址。'
          : `图片列表加载失败（${res.status}）。`
      );
    }
    const data = await res.json();
    const files = (data.files || []).filter((file) => IMAGE_EXT.test(file.name));
    box.replaceChildren();
    if (!files.length) {
      box.append(imageEmpty('这个目录里还没有图片。'));
      return;
    }
    for (const file of files) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'md-image';
      button.title = `${file.name}（点击插入）`;
      const img = document.createElement('img');
      img.src = file.url;
      img.alt = '';
      img.loading = 'lazy';
      const name = document.createElement('span');
      name.textContent = file.name;
      button.append(img, name);
      button.addEventListener('click', () => {
        const alt = file.name.replace(/\.[^.]+$/, '');
        insertAtCursor(`![${alt.replace(/[[\]]/g, '')}](${file.url})`);
        toast('已插入图片', 'ok');
      });
      box.append(button);
    }
    hint.textContent = `共 ${files.length} 张；点缩略图插入 Markdown 图片语法。`;
  } catch (err) {
    box.replaceChildren(imageEmpty('没有可用的图片列表。'));
    hint.textContent = err.message;
  }
}

/* ---------------------------------------------------------------------- save */

function fileName() {
  const typed = $('md-name').value.trim();
  const name = typed || stampedName('page', 'html');
  return /\.html?$/i.test(name) ? name : `${name}.html`;
}

function htmlBlob() {
  return new Blob([buildHtml()], { type: 'text/html;charset=utf-8' });
}

function bindActions() {
  $('md-download').addEventListener('click', () => {
    download(htmlBlob(), fileName());
  });

  $('md-save').addEventListener('click', async () => {
    const button = $('md-save');
    button.disabled = true;
    $('md-save-hint').textContent = '';
    try {
      const saved = await saveToServer(htmlBlob(), fileName(), 'pages');
      $('md-save-hint').textContent =
        `已存到 ${saved.url}（${Math.round(saved.size / 1024)} KB）。` +
        `在管理页把 ${saved.url} 填进「嵌入的 HTML」或「封面的 HTML」即可。`;
      toast('已存到服务器', 'ok');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      button.disabled = false;
    }
  });

  $('md-mark').addEventListener('click', () => wrapSelection('==', '=='));
  $('md-image-kind').addEventListener('change', loadImages);
  $('md-image-refresh').addEventListener('click', loadImages);
}

function bindForm() {
  $('md-title').addEventListener('input', (event) => {
    state.title = event.target.value;
    schedulePreview();
  });
  $('md-source').addEventListener('input', (event) => {
    state.source = event.target.value;
    schedulePreview();
  });
  for (const button of $('md-style').querySelectorAll('button')) {
    button.addEventListener('click', () => {
      state.style = button.dataset.style === 'handdrawn' ? 'handdrawn' : 'annotation';
      syncStyle();
      renderPreview();
    });
  }
}

export function init() {
  $('md-title').value = state.title;
  $('md-source').value = state.source;
  $('md-name').value = stampedName('page', 'html');
  syncStyle();
  bindForm();
  bindActions();
  renderPreview();
  loadImages();
}
