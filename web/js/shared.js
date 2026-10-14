/**
 * Cell vocabulary + DOM builder shared by the showcase page and the editor.
 */

export const SIZES = {
  '1x1': { w: 1, h: 1, label: '方形', note: '宽 1 × 高 1' },
  '2x2': { w: 2, h: 2, label: '大方形', note: '宽 2 × 高 2' },
  '1x2': { w: 2, h: 1, label: '矩形', note: '宽 2 × 高 1' },
  '1x4': { w: 4, h: 1, label: '长矩形', note: '宽 4 × 高 1' },
  '2x4': { w: 4, h: 2, label: '大矩形', note: '宽 4 × 高 2' },
};

export const SIZE_ORDER = ['1x1', '1x2', '1x4', '2x2', '2x4'];

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
    ...overrides,
  };
}

/**
 * Permissions handed to an embedded page. Scripts are allowed, but omitting
 * `allow-same-origin` leaves the frame on an opaque origin: it cannot read the
 * site's cookies or call its API, and it cannot reach the page around it.
 */
const FRAME_SANDBOX = 'allow-scripts allow-forms allow-popups allow-modals allow-downloads';

export function cellClasses(cell) {
  const size = SIZES[cell.size] || SIZES['1x1'];
  const classes = ['cell', `cell--${cell.type}`, `w${size.w}`, `h${size.h}`];
  if (size.w > 1) classes.push(`cell--w${size.w}`);
  return classes;
}

export function applyCellStyle(node, cell) {
  node.style.setProperty('--radius', `${cell.radius}px`);
  node.style.setProperty('--bw', `${cell.borderWidth}px`);
  node.style.setProperty('--border', cell.borderColor);
  node.style.setProperty('--caption-fg', cell.imageTitleColor);
  if (cell.type === 'solid') node.style.setProperty('--solid', cell.color);
}

/**
 * Build the DOM for one showcase cell. Everything is written with textContent,
 * never innerHTML, so stored values can never inject markup.
 */
export function createCell(cell) {
  const node = document.createElement(cell.link ? 'a' : 'article');
  node.className = cellClasses(cell).join(' ');
  node.dataset.id = cell.id;
  node.dataset.fit = cell.imageFit;
  applyCellStyle(node, cell);

  if (cell.link) {
    node.href = cell.link;
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
      const frame = document.createElement('iframe');
      frame.className = 'cell__frame';
      frame.src = cell.html;
      frame.loading = 'lazy';
      frame.title = cell.imageTitle || '嵌入的页面';
      frame.referrerPolicy = 'no-referrer';
      frame.setAttribute('sandbox', FRAME_SANDBOX);
      media.append(frame);
    } else {
      media.classList.add('cell__media--empty');
      const hint = document.createElement('span');
      hint.className = 'cell__hint';
      hint.textContent = '尚未嵌入页面';
      media.append(hint);
    }
    node.append(media);
  }

  // the caption under an image or an embedded page is the same always-on badge
  if ((cell.type === 'image' || cell.type === 'html') && cell.imageTitle) {
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

export async function fetchSite() {
  const res = await fetch('/api/site', { headers: { Accept: 'application/json' } });
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
