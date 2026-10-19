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

/**
 * 瀑布子盒子的尺寸模版：宽度 1..3、高度 1..4。键仍然是「行×列」——
 * `2x1` = 宽 1 × 高 2 的竖条。和顶层的 SIZES 分开，免得把窄高尺寸
 * 塞进普通格子和创作工具的尺寸选择器里。
 */
export const WATERFALL_SIZES = {
  '1x1': { w: 1, h: 1, label: '方块', note: '宽 1 × 高 1' },
  '2x1': { w: 1, h: 2, label: '竖条', note: '宽 1 × 高 2' },
  '3x1': { w: 1, h: 3, label: '高竖条', note: '宽 1 × 高 3' },
  '4x1': { w: 1, h: 4, label: '长竖条', note: '宽 1 × 高 4' },
  '1x2': { w: 2, h: 1, label: '横条', note: '宽 2 × 高 1' },
  '2x2': { w: 2, h: 2, label: '方块', note: '宽 2 × 高 2' },
  '3x2': { w: 2, h: 3, label: '高块', note: '宽 2 × 高 3' },
  '4x2': { w: 2, h: 4, label: '长高块', note: '宽 2 × 高 4' },
  '1x3': { w: 3, h: 1, label: '宽横条', note: '宽 3 × 高 1' },
  '2x3': { w: 3, h: 2, label: '宽块', note: '宽 3 × 高 2' },
  '3x3': { w: 3, h: 3, label: '大方块', note: '宽 3 × 高 3' },
  '4x3': { w: 3, h: 4, label: '高大方块', note: '宽 3 × 高 4' },
};

export const WATERFALL_SIZE_ORDER = [
  '1x1', '2x1', '3x1', '4x1',
  '1x2', '2x2', '3x2', '4x2',
  '1x3', '2x3', '3x3', '4x3',
];

/** 尺寸模版的统一查表：顶层格子用 SIZES，瀑布子盒子还可能是 WATERFALL_SIZES。 */
export const sizeDef = (key) => SIZES[key] || WATERFALL_SIZES[key] || null;

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

/** 容器盒子的模式：轮播 / 瀑布。 */
export const CONTAINER_MODES = [
  { value: 'carousel', label: '轮播' },
  { value: 'waterfall', label: '瀑布' },
];

/** 瀑布的排布方式：Z 字（行优先）/ 最短列。 */
export const CONTAINER_RENDERS = [
  { value: 'z', label: 'Z 字顺序' },
  { value: 'shortest', label: '最短列' },
];

/** 瀑布可选列数。 */
export const CONTAINER_COLUMNS = [1, 2, 3];

/** 轮播方向 = 内容移动的方向（不是「从哪边进来」的悬浮详情 DIRECTIONS）。 */
export const CONTAINER_DIRECTIONS = [
  { value: 'left', label: '向左' },
  { value: 'right', label: '向右' },
  { value: 'up', label: '向上' },
  { value: 'down', label: '向下' },
];

/** 自动轮播的间隔（秒）。上限 / 默认值必须和 server/store.js 同步。 */
export const CONTAINER_INTERVAL = { min: 2, max: 60, fallback: 5 };
/** 一个容器最多放多少个盒子 —— 镜像 server/store.js 的 MAX_CONTAINER_ITEMS。 */
export const MAX_CONTAINER_ITEMS = 30;

/**
 * 瀑布内部虚拟棋盘的「格距」下限：列数 > 1 时，一格（含内边距）至少 96/3 = 32px。
 * 容器比这个还窄时内部横向滚动；单列时格距就是容器宽度，不做这个下限。
 */
export const WATERFALL_UNIT_MIN = 32;
/** 虚拟棋盘里每个子盒子四周留的缝（格距很小时会按比例缩小）。 */
export const WATERFALL_GAP = 6;
/** 默认 / 夹紧后的列数。 */
export const WATERFALL_DEFAULT_COLUMNS = 2;
export const clampWaterfallColumns = (value) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(3, Math.max(1, n)) : WATERFALL_DEFAULT_COLUMNS;
};

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

/** 全屏展开的预设档位：`上下% / 左右%`；`'0/0'` = 铺满。顺序就是界面上缩略图的顺序。 */
export const FS_MARGINS = ['0/0', '5/5', '5/10', '10/10', '10/15', '15/15', '20/20'];

/** 全屏展开的默认观感：铺满、圆角 14、深色留白。 */
export function defaultFullscreen() {
  return { margin: '0/0', radius: 14, color: '#08070d' };
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

/** 新建容器时的默认配置：轮播、向左、自动、5 秒、瀑布 2 列 Z 字、空列表。 */
export function defaultContainer() {
  return {
    mode: 'carousel',
    direction: 'left',
    autoplay: true,
    interval: CONTAINER_INTERVAL.fallback,
    columns: WATERFALL_DEFAULT_COLUMNS,
    render: 'z',
    items: [],
  };
}

/**
 * 防御性读取一个容器的配置。导入的 JSON / 手写文档还没经过服务端清洗，
 * 渲染层不能假设字段齐全；容器里的容器也在这里挡掉一层。
 */
export function containerSpec(cell) {
  const raw = cell && cell.container && typeof cell.container === 'object' ? cell.container : {};
  const items = Array.isArray(raw.items)
    ? raw.items.filter((item) => item && typeof item === 'object' && item.type !== 'container')
    : [];
  const direction = CONTAINER_DIRECTIONS.some((option) => option.value === raw.direction)
    ? raw.direction
    : 'left';
  const interval = Math.round(Number(raw.interval));
  return {
    mode: raw.mode === 'waterfall' ? 'waterfall' : 'carousel',
    direction,
    autoplay: raw.autoplay !== false,
    interval: Number.isFinite(interval)
      ? Math.min(CONTAINER_INTERVAL.max, Math.max(CONTAINER_INTERVAL.min, interval))
      : CONTAINER_INTERVAL.fallback,
    columns: clampWaterfallColumns(raw.columns),
    render: raw.render === 'shortest' ? 'shortest' : 'z',
    items: items.slice(0, MAX_CONTAINER_ITEMS),
  };
}

/**
 * 子盒子在瀑布里实际占的格数：宽度按容器列数裁，高度沿用尺寸模版。
 * 轮播不用这个（永远铺满），但保留同一个 reader 方便列表 / 预览显示。
 */
export function effectiveUnits(item, columns) {
  const { w, h } = cellUnits(item);
  return { w: Math.max(1, Math.min(w, clampWaterfallColumns(columns))), h: Math.max(1, h) };
}

/**
 * 容器里的子盒子：没有自己的 id / pos。轮播会忽略 size（永远铺满容器）；
 * 瀑布拿 size 模版占格（宽度渲染时裁到列数、高度原样用）。容器不能嵌套，
 * 这里也顺手把 type 兜回图片。
 */
export function childCell(overrides = {}) {
  const cell = defaultCell(overrides);
  delete cell.id;
  delete cell.pos;
  delete cell.container;
  cell.size = sizeDef(cell.size) ? cell.size : '1x1';
  if (cell.type === 'container') cell.type = 'image';
  return cell;
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
  const size = sizeDef((cell && cell.size) || '') || SIZES['1x1'];
  return { w: size.w, h: size.h };
}

/**
 * The placement classes describe the named size, which is what the flow layout
 * uses; a cell drawn freehand on a board carries a `pos` instead and gets its
 * real size from the board layout pass.
 */
export function cellClasses(cell) {
  const size = sizeDef(cell.size) || SIZES['1x1'];
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

/* ------------------------------------------------------------- carousel */

/** 一张幻灯片的过渡时长（和 showcase.css 里的 transition 一致）。 */
const CAROUSEL_SLIDE_MS = 480;
/** 轮播根节点 → 定时器的注册表：节点被替换后，下一拍自己退出。 */
const liveCarousels = new Set();
let carouselVisibilityBound = false;

/** 一块屏幕上的所有轮播共用一个 visibilitychange 监听，别每个实例挂一个。 */
function bindCarouselVisibility() {
  if (carouselVisibilityBound) return;
  carouselVisibilityBound = true;
  document.addEventListener('visibilitychange', () => {
    for (const sync of [...liveCarousels]) sync();
  });
}

/** 内容移动方向 → 下一张从哪一侧进入。left/up 从正方向（右/下）进入。 */
const CAROUSEL_AXIS = { left: 'X', right: 'X', up: 'Y', down: 'Y' };
const CAROUSEL_ENTER_SIGN = { left: 1, right: -1, up: 1, down: -1 };

function carouselTransform(direction, step) {
  const axis = CAROUSEL_AXIS[direction] || 'X';
  const sign = (CAROUSEL_ENTER_SIGN[direction] || 1) * (step > 0 ? 1 : -1);
  return axis === 'X'
    ? `translate3d(${sign * 100}%,0,0)`
    : `translate3d(0,${sign * 100}%,0)`;
}

/**
 * 轮播容器：幻灯片绝对叠放，切换时当前张按 direction 退出、下一张从反方向进入。
 *
 * 手动 = 两个箭头；自动 = 一个 setTimeout 链（不是 setInterval：每一拍都要重新判断
 * 悬停 / 焦点 / 页面可见 / 节点是否还在文档里）。节点被 board.refresh 或预览重建替换后，
 * 下一拍发现 isConnected 为 false，就把自己从注册表里摘掉。
 */
function createCarousel(cell, { autoplay = true } = {}) {
  const spec = containerSpec(cell);
  const root = document.createElement('div');
  root.className = 'carousel';
  root.dataset.direction = spec.direction;
  root.setAttribute('role', 'group');
  root.setAttribute('aria-roledescription', '轮播');

  if (!spec.items.length) {
    const empty = document.createElement('span');
    empty.className = 'carousel__empty';
    empty.textContent = '容器里还没有盒子';
    root.append(empty);
    return root;
  }

  const viewport = document.createElement('div');
  viewport.className = 'carousel__viewport';
  const slides = spec.items.map((item, index) => {
    const slide = document.createElement('div');
    slide.className = 'carousel__slide';
    slide.setAttribute('role', 'group');
    slide.setAttribute('aria-roledescription', '幻灯片');
    slide.setAttribute('aria-label', `${index + 1} / ${spec.items.length}`);
    /*
     * 轮播子盒子故意**不挂** data-child-index：它铺满整个容器，棋盘上点到哪儿
     * 都是子盒子。如果按子盒子处理，容器自己的编辑面板就永远打不开。轮播里要
     * 编辑子盒子，走容器面板里的子盒子列表；瀑布有空隙、子盒子边界清楚，才在
     * 棋盘上直接点子盒子打开它。
     */
    const child = createCell(item, { autoplay: false });
    slide.append(child);
    viewport.append(slide);
    return slide;
  });
  root.append(viewport);

  const count = document.createElement('span');
  count.className = 'carousel__count';
  count.hidden = slides.length < 2;
  root.append(count);

  let index = 0;
  let transition = null;
  let timer = null;
  let hovered = false;
  let focused = false;

  const arrow = (kind, label) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `carousel__arrow carousel__arrow--${kind}`;
    // 棋盘上的按下不该被当成拖动（board.js 会跳过 [data-no-drag]）
    button.dataset.noDrag = '';
    button.setAttribute('aria-label', label);
    const glyph = document.createElement('span');
    glyph.className = 'carousel__arrow-glyph';
    glyph.textContent = kind === 'prev' ? '‹' : '›';
    button.append(glyph);
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      go(kind === 'prev' ? -1 : 1);
      syncTimer();
    });
    return button;
  };

  if (slides.length > 1) root.append(arrow('prev', '上一张'), arrow('next', '下一张'));

  /** 只留当前张可见可点；其余 inert + aria-hidden，键盘和读屏也进不去。 */
  function applyState() {
    for (const [i, slide] of slides.entries()) {
      const active = i === index;
      slide.classList.toggle('is-current', active);
      slide.inert = !active;
      slide.setAttribute('aria-hidden', active ? 'false' : 'true');
    }
    count.textContent = `${index + 1} / ${slides.length}`;
  }

  /** 把正在进行的过渡直接落定（连续点击时先把上一段走完）。 */
  function settle() {
    if (transition) {
      clearTimeout(transition.timeout);
      transition.incoming.removeEventListener('transitionend', transition.onEnd);
      transition = null;
    }
    for (const slide of slides) {
      slide.classList.remove('is-entering', 'is-leaving');
      slide.style.transition = '';
      slide.style.transform = '';
    }
    applyState();
  }

  function go(step) {
    if (slides.length < 2) return;
    settle();
    const next = (index + step + slides.length) % slides.length;
    if (next === index) return;
    const incoming = slides[next];
    const outgoing = slides[index];
    index = next;

    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      applyState();
      return;
    }

    const enterFrom = carouselTransform(spec.direction, step);
    const leaveTo = carouselTransform(spec.direction, -step);
    incoming.classList.remove('is-leaving');
    incoming.classList.add('is-entering');
    outgoing.classList.remove('is-entering');
    outgoing.classList.add('is-leaving');

    // 先把两张都摆到起点（incoming 在入场侧、outgoing 在原位），强制一次 reflow，
    // 再恢复过渡并走向终点 —— 否则浏览器会把两次样式变更合批，动画根本不发生。
    incoming.style.transition = 'none';
    incoming.style.transform = enterFrom;
    outgoing.style.transition = 'none';
    outgoing.style.transform = 'none';
    void incoming.offsetWidth;

    incoming.style.transition = '';
    outgoing.style.transition = '';

    const token = {};
    const onEnd = (event) => {
      if (event.target !== incoming || event.propertyName !== 'transform') return;
      if (transition && transition.token === token) settle();
    };
    transition = {
      token,
      incoming,
      onEnd,
      timeout: setTimeout(() => {
        if (transition && transition.token === token) settle();
      }, CAROUSEL_SLIDE_MS + 120),
    };
    incoming.addEventListener('transitionend', onEnd);

    requestAnimationFrame(() => {
      if (!transition || transition.token !== token) return;
      incoming.style.transform = '';
      outgoing.style.transform = leaveTo;
    });
    count.textContent = `${index + 1} / ${slides.length}`;
  }

  function shouldPlay() {
    return autoplay && spec.autoplay && slides.length > 1 && !hovered && !focused && root.isConnected;
  }

  /**
   * 到点时真的能切吗？两件事不能放进 shouldPlay，否则计时链会断掉、再也醒不过来：
   *   - document.hidden：标签页在后台加载时初始就是 hidden，可能等不到 visibilitychange；
   *   - 触屏点开的详情（.is-open）关闭时没有任何事件。
   * 所以计时链照常跑，只在这一拍跳过；visible / 详情关掉之后下一拍照常走。
   */
  const canAdvance = () => !document.hidden && !root.querySelector('.cell.is-open');

  function syncTimer() {
    clearTimeout(timer);
    timer = null;
    if (!root.isConnected) {
      liveCarousels.delete(syncTimer);
      return;
    }
    if (!shouldPlay()) return;
    timer = setTimeout(() => {
      timer = null;
      if (!root.isConnected) {
        liveCarousels.delete(syncTimer);
        return;
      }
      if (shouldPlay() && canAdvance()) go(1);
      syncTimer();
    }, spec.interval * 1000);
  }

  applyState();
  if (autoplay && spec.autoplay && slides.length > 1) {
    // 触屏上 mouseenter 之后可能永远等不到 mouseleave，只用 hover 能力判断。
    // 焦点交给 shouldPlay；页面可见性和触屏详情在每一拍用 canAdvance 判断。
    if (typeof window.matchMedia === 'function' && window.matchMedia('(hover: hover)').matches) {
      root.addEventListener('mouseenter', () => {
        hovered = true;
        syncTimer();
      });
      root.addEventListener('mouseleave', () => {
        hovered = false;
        syncTimer();
      });
    }
    root.addEventListener('focusin', () => {
      focused = true;
      syncTimer();
    });
    root.addEventListener('focusout', (event) => {
      if (root.contains(event.relatedTarget)) return;
      focused = false;
      syncTimer();
    });
    liveCarousels.add(syncTimer);
    bindCarouselVisibility();
    // 此刻根节点还没被 append 到文档里（createCell 只是返回它），同步跑会被
    // isConnected 误判成「已销毁」。放到微任务里：调用方这一手 append 完再开始计时。
    queueMicrotask(syncTimer);
  }

  return root;
}

/* ------------------------------------------------------------ waterfall */

/** Z 字：直接复用棋盘的「行优先、找第一个放得下的空位」。 */
function packWaterfallZ(items, columns) {
  return packBoard(items, columns);
}

/**
 * 最短列：每个子盒子放到当前最矮的一列；宽度跨多列时，在连续列组里找
 * 顶面最低的位置。比 Z 字更紧凑，是经典瀑布流。
 */
function packWaterfallShortest(items, columns) {
  const heights = new Array(columns).fill(0);
  return items.map((item) => {
    const { w, h } = effectiveUnits(item, columns);
    let bestX = 0;
    let bestY = Infinity;
    for (let x = 0; x + w <= columns; x += 1) {
      let y = 0;
      for (let col = x; col < x + w; col += 1) y = Math.max(y, heights[col]);
      if (y < bestY) {
        bestY = y;
        bestX = x;
      }
    }
    for (let col = bestX; col < bestX + w; col += 1) heights[col] = bestY + h;
    return { ...item, pos: { x: bestX, y: bestY, w, h } };
  });
}

/**
 * 瀑布容器：内部是一块虚拟棋盘，子盒子按尺寸模版占格，超出容器高度就纵向滚动。
 *
 * 格距 unit 是「一格」的 pitch：列数 > 1 时至少 32px（96/3），容器更窄就横向滚动；
 * 单列时 unit = 容器宽度。子盒子在格子里再留一圈 gap，看起来才是一块块分开的盒子。
 * 位置在渲染时现算，不写进数据。
 */
function createWaterfall(spec) {
  const root = document.createElement('div');
  root.className = 'waterfall';
  root.dataset.render = spec.render;

  if (!spec.items.length) {
    const empty = document.createElement('span');
    empty.className = 'waterfall__empty';
    empty.textContent = '容器里还没有盒子';
    root.append(empty);
    return root;
  }

  const board = document.createElement('div');
  board.className = 'waterfall__board';
  root.append(board);

  const wrappers = spec.items.map((item) => {
    const wrap = document.createElement('div');
    wrap.className = 'waterfall__item';
    // 不在棋盘上按子盒子处理：点瀑布（包括里面的盒子）打开的是容器面板。
    // 子盒子从容器列表进入，和轮播保持一致。
    const child = createCell(item, { autoplay: false });
    wrap.append(child);
    board.append(wrap);
    return wrap;
  });

  const columns = clampWaterfallColumns(spec.columns);

  function layout() {
    const width = root.clientWidth;
    // 还没进文档 / 被隐藏：等 ResizeObserver 或下一次打开时再量
    if (!width) return;
    // 单列：整宽就是格距；多列：至少 32px，放不下就让内部横向滚动
    const unit = columns > 1 ? Math.max(WATERFALL_UNIT_MIN, width / columns) : width;
    const gap = Math.min(WATERFALL_GAP, unit * 0.2);
    const placed =
      spec.render === 'shortest'
        ? packWaterfallShortest(spec.items, columns)
        : packWaterfallZ(spec.items, columns);

    let rows = 0;
    for (const item of placed) rows = Math.max(rows, item.pos.y + item.pos.h);

    board.style.width = `${Math.max(width, columns * unit).toFixed(2)}px`;
    board.style.height = `${Math.max(1, rows * unit).toFixed(2)}px`;

    for (const [index, item] of placed.entries()) {
      const { x, y, w, h } = item.pos;
      const wrap = wrappers[index];
      // 把虚拟棋盘坐标也挂到 dataset 上，方便调试 / 测试
      wrap.dataset.x = String(x);
      wrap.dataset.y = String(y);
      wrap.dataset.w = String(w);
      wrap.dataset.h = String(h);
      wrap.style.left = `${(x * unit + gap / 2).toFixed(2)}px`;
      wrap.style.top = `${(y * unit + gap / 2).toFixed(2)}px`;
      wrap.style.width = `${Math.max(1, w * unit - gap).toFixed(2)}px`;
      wrap.style.height = `${Math.max(1, h * unit - gap).toFixed(2)}px`;
    }
  }

  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(() => {
      if (!root.isConnected) {
        observer.disconnect();
        return;
      }
      layout();
    });
    observer.observe(root);
  }
  // createCell 返回的节点此刻还没 append；微任务里通常已经进文档了。
  queueMicrotask(layout);
  return root;
}

/**
 * Build the DOM for one showcase cell. `options.autoplay = false` keeps previews
 * still while editing (the admin board passes it); the home page uses the data.
 */
export function createCell(cell, { autoplay = true } = {}) {
  const isContainer = cell.type === 'container';
  // 「跳转链接」和「嵌入的页面」互斥：两个地址都留着，由 clickMode 说哪个生效。
  // 容器不参与这两项（里面的子盒子链接不能形成嵌套 <a>）。
  const clickEmbed = !isContainer && cell.clickMode !== 'link' ? cell.embed || '' : '';
  const clickLink = !isContainer && cell.clickMode === 'link' ? cell.link || '' : '';
  const node = document.createElement(clickLink ? 'a' : 'article');
  node.className = cellClasses(cell).join(' ');
  // 子盒子没有 id —— 别把 undefined 写成字符串
  if (cell.id) node.dataset.id = cell.id;
  node.dataset.fit = cell.imageFit;
  // the layout pass needs the units; the classes alone are not readable back
  const units = sizeDef(cell.size);
  node.dataset.w = units ? units.w : 1;
  node.dataset.h = units ? units.h : 1;
  if (clickLink) node.draggable = false; // a native link drag fights the board
  applyCellStyle(node, cell);

  if (clickLink) {
    node.href = resolveLink(clickLink);
    node.target = '_blank';
    node.rel = 'noopener noreferrer';
  }

  // 容器：自己的链接 / 嵌入 / 角标 / 悬浮详情都不渲染，整块交给模式渲染器
  if (isContainer) {
    const spec = containerSpec(cell);
    node.append(
      spec.mode === 'waterfall' ? createWaterfall(spec) : createCarousel(cell, { autoplay })
    );
    return node;
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
    // 全屏展开的档位、圆角、留白色（主页 openFullscreen 读它们）
    const fs = { ...defaultFullscreen(), ...(cell.fullscreen || {}) };
    node.dataset.fsMargin = FS_MARGINS.includes(fs.margin) ? fs.margin : '0/0';
    node.dataset.fsRadius = String(Number(fs.radius) || 0);
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
