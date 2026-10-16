import {
  applyGridLayout,
  assetUrl,
  createCell,
  createFrame as sharedCreateFrame,
  currentUserid,
  fetchSite,
  gapPx,
  numberSetting,
  packBoard,
  repackColumns,
} from './shared.js';

const grid = document.getElementById('grid');

function renderEmpty() {
  const state = document.createElement('div');
  state.className = 'grid-state';
  state.style.gridColumn = '1 / -1';

  const logo = document.createElement('img');
  logo.className = 'grid-state__logo';
  logo.src = assetUrl('logo.svg');
  logo.alt = '';

  const text = document.createElement('p');
  text.textContent = '橱窗还在布置中，过阵子再来看看。';

  state.append(logo, text);
  grid.append(state);
}

/** Where the filing number points when the admin has not stored a link. */
const ICP_LINK_DEFAULT = 'https://beian.miit.gov.cn/#/Integrated/index';

/** The centre slot is the ICP filing number, linked out to the filing system. */
function renderIcp(site) {
  const center = document.getElementById('footer-center');
  const icp = site.icp || '';
  if (!icp) {
    center.replaceChildren();
    return;
  }

  const link = document.createElement('a');
  link.className = 'site-footer__link';
  link.href = site.icpLink || ICP_LINK_DEFAULT;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = icp;
  center.replaceChildren(link);
}

function applySite(site) {
  document.title = site.title || 'Gill Offline';
  document.documentElement.style.setProperty('--accent', site.accent || '#7e46b9');
  // the cell spacing setting (s / m / l) is the grid's --gap
  grid.style.setProperty('--gap', `${gapPx(site.gap)}px`);

  // the title bar is opt-in: it only shows once the site settings switch it on
  const subtitle = document.getElementById('subtitle');
  const subtitleText = site.subtitleEnabled ? site.subtitle || '' : '';
  subtitle.textContent = subtitleText;
  subtitle.hidden = !subtitleText;

  // footer: three independent slots, each left empty when it has no text
  document.getElementById('footer-left').textContent = site.footerLeft || '';
  renderIcp(site);
  document.getElementById('footer-right').textContent = site.footerRight || '';
}

/** On a sub-admin's page the chrome shows their own images, not the owner's. */
function applyOwnAssets() {
  if (!currentUserid()) return;
  document.querySelector('.brand__title').src = assetUrl('title.png');
  document.querySelector('.site-footer__logo').src = assetUrl('logo.svg');
  const icon = document.querySelector('link[rel="icon"]');
  if (icon) icon.href = assetUrl('logo.svg');
}

/** The site's layout settings, and the pass that applies them. */
let site = {};
let siteLayout = 'flow';
let siteCells = [];

/**
 * 窄屏重排：棋盘文档在 pad / 手机上按 cells 顺序紧密重排成 N 列，桌面端保持构图。
 * 重排只改喂给布局的坐标、不动文档，而且不重建 DOM —— 版面变了内嵌页面也不会重载。
 * 关掉响应式（或某一档填 0）时 cols = 0，走原来的路：棋盘整体缩小、必要时横向滚动。
 */
const layout = () => {
  const cols = repackColumns(site);
  applyGridLayout(grid, cols || numberSetting(site.columns, 0), {
    layout: siteLayout,
    cells: cols ? packBoard(siteCells, cols) : siteCells,
  });
};

async function boot() {
  applyOwnAssets();
  window.addEventListener('resize', layout);
  try {
    const doc = await fetchSite();
    applySite(doc.site || {});
    site = doc.site || {};
    siteLayout = site.layout === 'board' ? 'board' : 'flow';
    siteCells = doc.cells || [];
    grid.replaceChildren();
    if (!siteCells.length) {
      renderEmpty();
    } else {
      grid.append(...siteCells.map(createCell));
    }
    layout();
  } catch (err) {
    grid.replaceChildren();
    const state = document.createElement('div');
    state.className = 'grid-state';
    state.style.gridColumn = '1 / -1';
    state.textContent = `内容加载失败：${err.message}`;
    grid.append(state);
  }
}

/* ------------------------------------------------------- 封面格子的全屏展开 */

/**
 * 封面模式的 HTML 格子：格子上只有一块封面，点开才把页面全屏展开。
 *
 * iframe 是**打开时创建、关掉就移除**的：没点开的格子不加载页面（省流量，也免得
 * 几个页面在后台一起跑），关掉之后页面里的脚本和定时器也随 iframe 一起没了。
 */
let fullscreen = null;

function closeFullscreen() {
  if (!fullscreen) return;
  fullscreen.remove(); // iframe 跟着走：页面里的脚本、定时器随之停止
  fullscreen = null;
  document.body.classList.remove('is-fullscreen');
}

function openFullscreen(url, title) {
  closeFullscreen();
  const box = document.createElement('div');
  box.className = 'fullscreen';
  const frame = sharedCreateFrame(url, title);
  frame.className = 'fullscreen__frame';
  frame.loading = 'eager'; // 这回是真要看它了

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'fullscreen__close';
  close.title = '关闭（Esc）';
  close.setAttribute('aria-label', '关闭全屏');
  close.textContent = '✕';
  close.addEventListener('click', closeFullscreen);

  box.append(frame, close);
  document.body.append(box);
  document.body.classList.add('is-fullscreen');
  fullscreen = box;
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeFullscreen();
});

// Touch devices have no hover: tap a cell once to open its detail panel.
grid.addEventListener('click', (event) => {
  const cell = event.target.closest('.cell');
  if (!cell) return;
  // 封面格子：点一下展开全屏。格子可能同时是 <a>（配了链接），先拦下跳转。
  if (cell.dataset.fullscreen) {
    event.preventDefault();
    openFullscreen(cell.dataset.fullscreen, cell.querySelector('.cell__caption')?.textContent || '');
    return;
  }
  if (!cell.querySelector('.cell__overlay')) return;
  if (window.matchMedia('(hover: none)').matches) {
    if (!cell.classList.contains('is-open')) {
      event.preventDefault();
      document.querySelectorAll('.cell.is-open').forEach((other) => other.classList.remove('is-open'));
      cell.classList.add('is-open');
    }
  }
});

boot();
