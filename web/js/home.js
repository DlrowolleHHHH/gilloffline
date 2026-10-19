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
  withUserid,
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

/**
 * 子管理员的站右上角常驻一个「管理页」入口，点进去就是自己的 /admin?userid=…
 * （没登录会落在登录页，登录后直接进自己的页面）。
 * 站主的站不带 userid，就不显示：他本来就有主图和格子里的入口。
 */
function renderAdminEntry() {
  if (!currentUserid()) return;
  const entry = document.getElementById('admin-entry');
  entry.href = withUserid('/admin');
  entry.hidden = false;
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
  renderAdminEntry();
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

/* --------------------------------------------------- 嵌入页面的全屏展开 */

/**
 * 嵌入了页面的格子：点一下把页面全屏展开，从格子所在的位置放大出来（等比缩放，
 * 不把页面拉变形），关掉时缩回原处。
 *
 * iframe 是**打开时创建、关掉就移除**的：没点开的格子不加载页面（省流量，也免得几个
 * 页面在后台一起跑），关掉之后页面里的脚本和定时器也随 iframe 一起没了。
 */
/** 和 showcase.css 里那条 transition 的时长一致（关的时候等它演完再摘掉 iframe）。 */
const FULLSCREEN_MS = 460;
let fullscreen = null;
/** 关掉时要缩回哪儿（没记就淡出）。 */
let fullscreenFrom = '';

/**
 * 从格子的矩形算出起始变换：把整块全屏层缩到和格子**严丝合缝**、中心对齐。
 *
 * 横竖各自算缩放（而不是等比取宽度）：等比的话高度对不上 —— 视口和格子长宽比不一样，
 * 第一帧就会比格子高出一截，看着像「从一块更大的地方弹出来」，不是从格子里长出来的。
 * transform-origin 是中心，所以这一缩放就是「从格子中心往外扩」。
 */
function zoomFrom(rect) {
  if (!rect || !rect.width || !rect.height) return '';
  const dx = rect.left + rect.width / 2 - window.innerWidth / 2;
  const dy = rect.top + rect.height / 2 - window.innerHeight / 2;
  const sx = Math.max(0.02, Math.min(1, rect.width / window.innerWidth));
  const sy = Math.max(0.02, Math.min(1, rect.height / window.innerHeight));
  return `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`;
}

function closeFullscreen() {
  if (!fullscreen) return;
  const box = fullscreen;
  fullscreen = null; // 先置空：关到一半再点一次也不会出错
  if (!fullscreenFrom) {
    box.remove();
    document.body.classList.remove('is-fullscreen');
    return;
  }
  box.style.transform = fullscreenFrom;
  box.style.opacity = '0';
  fullscreenFrom = '';
  setTimeout(() => {
    box.remove(); // iframe 跟着走：页面里的脚本、定时器随之停止
    document.body.classList.remove('is-fullscreen');
  }, FULLSCREEN_MS);
}

/**
 * 全屏展开时这颗格子自己的设置：留白档位（上下% / 左右%）、页面圆角、留白色，
 * 都由 createCell 挂在 dataset 上。留白 '0/0'（默认）就是铺满整屏。
 */
function fullscreenOptions(cell) {
  const [v, h] = (cell.dataset.fsMargin || '0/0').split('/').map((n) => Number(n) || 0);
  let backend = null;
  try {
    backend = cell.dataset.vitsrv ? JSON.parse(cell.dataset.vitsrv) : null;
  } catch {
    backend = null;
  }
  return {
    margin: [v, h, v, h],
    radius: Number(cell.dataset.fsRadius ?? 14),
    color: cell.dataset.fsColor || '',
    backend,
  };
}

function openFullscreen(url, title, rect, options = {}) {
  closeFullscreen();
  const box = document.createElement('div');
  box.className = 'fullscreen';
  // 留白是百分比：上下按视口高度、左右按视口宽度算
  const [top, right, bottom, left] = options.margin || [0, 0, 0, 0];
  box.style.setProperty('--fs-top', `${top}%`);
  box.style.setProperty('--fs-right', `${right}%`);
  box.style.setProperty('--fs-bottom', `${bottom}%`);
  box.style.setProperty('--fs-left', `${left}%`);
  box.style.setProperty('--fs-radius', `${Number.isFinite(options.radius) ? options.radius : 14}px`);
  if (options.color) box.style.setProperty('--fs-color', options.color);
  // 留白交给这层普通的 div（inset 就能撑开）；iframe 在里面铺满 100%。
  // 不直接把 inset/calc 写在 iframe 上：它是替换元素，各浏览器的尺寸规则不一样，容易踩坑。
  const area = document.createElement('div');
  area.className = 'fullscreen__area';
  // 第三个参数是盒子应用的后端配置：createFrame 会在 load 之后发给里面的 vitsrv
  const frame = sharedCreateFrame(url, title, options.backend);
  frame.className = 'fullscreen__frame';
  frame.loading = 'eager'; // 这回是真要看它了
  area.append(frame);

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'fullscreen__close';
  close.title = '关闭（Esc）';
  close.setAttribute('aria-label', '关闭全屏');
  close.textContent = '✕';
  close.addEventListener('click', closeFullscreen);

  // 点留白（页面外面那圈）也能关掉 —— 有了边距以后那是块显眼的空地
  box.addEventListener('click', (event) => {
    if (event.target === box) closeFullscreen();
  });

  box.append(area, close);
  // 先摆成格子的大小和位置，下一帧再回到满屏 —— CSS 的 transition 负责补这一路
  fullscreenFrom = zoomFrom(rect);
  if (fullscreenFrom) {
    box.style.transform = fullscreenFrom;
    box.style.opacity = '0';
  }
  document.body.append(box);
  document.body.classList.add('is-fullscreen');
  fullscreen = box;
  if (fullscreenFrom) {
    requestAnimationFrame(() => {
      if (!fullscreen) return;
      box.style.transform = '';
      box.style.opacity = '';
    });
  }
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeFullscreen();
});

// 角标是 role="button"，键盘上也要能展开
grid.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const expand = event.target.closest('.cell__expand');
  const cell = expand && expand.closest('.cell');
  if (!cell || !cell.dataset.fullscreen) return;
  event.preventDefault();
  openFullscreen(cell.dataset.fullscreen, cell.querySelector('.cell__caption')?.textContent || '',
    cell.getBoundingClientRect(), fullscreenOptions(cell));
});

/*
 * 点击格子的几条路。桌面上靠 hover / click 分开，触屏没有 hover，只能靠「点几次」：
 *
 *   有悬浮详情   → 第一次点先把详情弹出来（相当于桌面上的悬浮），
 *                  再点一次才真的「进去」：跳链接或全屏展开嵌入的页面；
 *                  只有详情、没处可去的话，再点一次就是收起。
 *   没有详情     → 一点直接进去，和以前一样。
 *   放大角标     → 不管有没有详情、是不是触屏，点了就全屏展开（它是明确的按钮）。
 *   点空白处     → 收起所有详情。
 *
 * 鼠标端保持原样：hover 看详情，单击进去。
 */
const closeOpenCells = () =>
  document.querySelectorAll('.cell.is-open').forEach((other) => other.classList.remove('is-open'));

grid.addEventListener('click', (event) => {
  const cell = event.target.closest('.cell');
  if (!cell) {
    closeOpenCells(); // 点到卡片之间的空隙
    return;
  }
  // touch：没有 hover。用 pointer 能力判断，别用宽度 —— 横屏的手机照样没有 hover
  const touch = window.matchMedia('(hover: none)').matches;
  const fullscreen = cell.dataset.fullscreen || '';
  const badge = event.target.closest('.cell__expand');

  // 放大角标是明确的「全屏」按钮；鼠标点这种格子也直接展开（详情已经由 hover 看过了）
  if (fullscreen && (badge || !touch)) {
    event.preventDefault();
    closeOpenCells();
    // 不管点的是格子还是右下角的角标，都从整颗格子放大 —— 两条路的手感要一样
    openFullscreen(fullscreen, cell.querySelector('.cell__caption')?.textContent || '',
      cell.getBoundingClientRect(), fullscreenOptions(cell));
    return;
  }

  if (!touch) return; // 鼠标：链接交给浏览器跳转，详情由 hover 负责

  const isOpen = cell.classList.contains('is-open');
  if (cell.querySelector('.cell__overlay') && !isOpen) {
    // 先看详情。拦掉默认行为，免得顺手把链接点走了
    event.preventDefault();
    closeOpenCells();
    cell.classList.add('is-open');
    return;
  }
  if (fullscreen) {
    event.preventDefault();
    closeOpenCells();
    openFullscreen(fullscreen, cell.querySelector('.cell__caption')?.textContent || '',
      cell.getBoundingClientRect(), fullscreenOptions(cell));
    return;
  }
  if (cell.tagName === 'A') {
    // 有链接：这一次就交给浏览器（链接是新标签页打开的）。顺手把详情收掉 ——
    // 那个标签页关掉、切回来的时候，页面该是干净的，而不是面板还挂着。
    cell.classList.remove('is-open');
    return;
  }
  if (isOpen) cell.classList.remove('is-open'); // 只有详情：再点一次收起
});

/*
 * 从别的页面回来（后退，或者浏览器整页从 bfcache 里端回来）时，上一次点开的详情还在 DOM 上，
 * 有时那个格子还带着焦点 —— 看着就像「面板一直没关」。回来就该是一张干净的页面：
 * 关掉详情和全屏，顺手把焦点从格子上挪开（键盘的 :focus-visible 也会撑着面板）。
 */
window.addEventListener('pageshow', () => {
  closeOpenCells();
  closeFullscreen();
  const active = document.activeElement;
  if (active && active.closest && active.closest('.cell')) active.blur();
});

boot();
