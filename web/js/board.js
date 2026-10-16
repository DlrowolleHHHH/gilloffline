/**
 * The board: cells live on a fixed grid of units, and the pointer draws, moves
 * and resizes them.
 *
 * The rules are the same for all three gestures — a candidate rectangle has to
 * be at least 1×1, inside the board, and clear of every other cell. CSS grid
 * does not help here: explicitly placed items are happy to stack on top of each
 * other, so every drop is checked before it is applied, and the server checks
 * again before it is stored.
 *
 * Nothing is mutated until a gesture finishes: a drag moves a ghost, and only a
 * legal drop touches the document. That also keeps iframes and images from
 * reloading on every pointermove.
 */

import { createCell, rectFree, rectOf } from './shared.js';

/** The per-cell buttons, same glyphs as the old list had. */
const ACTIONS = [
  ['edit', '✎', '编辑'],
  ['dup', '⧉', '复制'],
  ['del', '✕', '删除'],
];

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

export function createBoard({ root, onEdit, onDuplicate, onRemove, onChange, onSelect }) {
  let cells = [];
  let columns = 12;
  let selectedId = null;
  let drag = null;
  let status = null;
  let onPlace = () => {};
  // a drag ends with a click event; do not let it double as a selection
  let justDragged = false;

  const ghost = document.createElement('div');
  ghost.className = 'board__ghost';
  ghost.hidden = true;

  /* ------------------------------------------------------------- geometry */

  /**
   * Pointer position → the grid unit under it. The pitch (cell + gap) and the
   * content-box inset are stashed on the element by the layout pass, so this
   * stays a few subtractions even while dragging — and it stays exact at every
   * zoom level, where being 7px out would be a good part of a cell.
   */
  function unitAt(event) {
    const box = root.getBoundingClientRect();
    const pitch = Number(root.dataset.pitch) || 60;
    const [insetX, insetY] = (root.dataset.inset || '0,0').split(',').map(Number);
    const x = Math.floor((event.clientX - box.left + root.scrollLeft - insetX) / pitch);
    const y = Math.floor((event.clientY - box.top + root.scrollTop - insetY) / pitch);
    return { x: clamp(x, 0, columns - 1), y: Math.max(0, y) };
  }

  /** Every placed cell as a flat rect, optionally leaving one out (the drag source). */
  const otherRects = (exceptId) => cells.filter((cell) => cell.id !== exceptId).map(rectOf).filter(Boolean);

  function legal(rect, exceptId) {
    return (
      rect.w >= 1 &&
      rect.h >= 1 &&
      rect.x >= 0 &&
      rect.y >= 0 &&
      rect.x + rect.w <= columns &&
      rectFree(otherRects(exceptId), rect)
    );
  }

  /** Two corners → a normalized rect, at least one unit in each direction. */
  function rectFrom(origin, corner) {
    const x = Math.min(origin.x, corner.x);
    const y = Math.min(origin.y, corner.y);
    return {
      x,
      y,
      w: Math.abs(corner.x - origin.x) + 1,
      h: Math.abs(corner.y - origin.y) + 1,
    };
  }

  function showGhost(rect, ok) {
    ghost.hidden = false;
    ghost.classList.toggle('is-bad', !ok);
    ghost.style.gridColumn = `${rect.x + 1} / span ${rect.w}`;
    ghost.style.gridRow = `${rect.y + 1} / span ${rect.h}`;
  }

  const hideGhost = () => {
    ghost.hidden = true;
    ghost.classList.remove('is-bad');
  };

  const say = (message) => {
    if (status) status.textContent = message;
  };

  /* ------------------------------------------------- 右下角方块是拖什么 */

  /**
   * 右下角那个方块拖起来做什么：`'resize'`（默认，改尺寸）或 `'move'`（挪整颗格子）。
   *
   * 触屏上没有 hover、指头又盖着格子，随手一按根本说不清是想干嘛。所以把「明确的一个
   * 抓取点」交给棋盘上方的开关来定：它要么改尺寸，要么挪位置。不进站点数据
   * （同「缩放」：一次打开的偏好，不是站点内容）。
   */
  let handleMode = 'resize';

  const handleTitle = () => (handleMode === 'move' ? '拖动挪位置' : '拖动改尺寸');

  /* --------------------------------------------------------------- pointer */

  /** 一次「移动」的初始状态：抓着格子里哪一格，拖起来就不跳。 */
  function moveInfo(cell, event) {
    const pos = cell.pos || { x: 0, y: 0 };
    const w = pos.w || 1;
    const h = pos.h || 1;
    const grab = unitAt(event);
    return {
      kind: 'move',
      id: cell.id,
      w,
      h,
      // where inside the cell the pointer grabbed it, so it does not jump
      offsetX: clamp(grab.x - pos.x, 0, Math.max(0, w - 1)),
      offsetY: clamp(grab.y - pos.y, 0, Math.max(0, h - 1)),
    };
  }

  function onPointerDown(event) {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    // the action buttons are buttons: a press there must not start a drag
    if (event.target.closest('.slot__bar')) return;

    const slot = event.target.closest('.slot');
    const handle = event.target.closest('.slot__handle');
    const cell = slot ? cells.find((item) => item.id === slot.dataset.id) : null;
    if (slot && !cell) return;

    if (handle && cell) {
      // 方块默认改尺寸；开关切到「位置」就改成拖整颗格子（抓的还是那个角，位置不跳）
      if (handleMode === 'move') startDrag(event, moveInfo(cell, event));
      else startDrag(event, { kind: 'resize', id: cell.id, origin: pointOf(cell.id) });
      return;
    }
    if (cell) {
      /*
       * 触屏上格子的本体只负责「轻点开编辑」：挪位置一律走右下角那个方块。
       * 指头按在格子中间既看不见落点、又说不准挪了多少格，而格子几乎占满屏幕 ——
       * 一按就拖还等于把翻页也一起吃了。本体不接管手势，`touch-action` 交还给浏览器。
       * 鼠标照旧：按在格子哪儿都能拖。
       */
      if (event.pointerType !== 'touch') startDrag(event, moveInfo(cell, event));
      return;
    }

    /*
     * 触屏上不在空白处画格子。空白处的 `touch-action` 是 `auto`（只有格子上是 none），
     * 浏览器会把这一手认成滚动、随即 pointercancel，手势本来就活不下来；就算按住不动，
     * 指头也画不准。触屏新建走棋盘上方的「＋ 添加格子」——落一颗 1×1 在最下面，再挑尺寸。
     * 鼠标照旧：在空白处拖出想要的大小。
     */
    if (event.pointerType === 'touch') return;

    startDrag(event, { kind: 'draw', origin: unitAt(event) });
  }

  const pointOf = (id) => {
    const cell = cells.find((item) => item.id === id);
    return cell && cell.pos ? { x: cell.pos.x, y: cell.pos.y } : { x: 0, y: 0 };
  };

  /**
   * The gesture's listeners live on the window, not on the board. A drag that
   * starts in the last row — the normal way to make the canvas grow — is outside
   * the board on its very first move, and a board-level listener would never
   * hear about it: the drag would die before it began.
   */
  function startDrag(event, info) {
    drag = { ...info, moved: false, captured: false, startUnit: unitAt(event) };
    hideGhost();
    if (info.kind !== 'draw') {
      const slot = root.querySelector(`.slot[data-id="${CSS.escape(info.id)}"]`);
      if (slot) slot.classList.add('is-dragging');
    }
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    event.preventDefault();
  }

  function stopListening() {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
  }

  function onPointerMove(event) {
    if (!drag) return;
    // Capture only once the pointer really moves. Capturing on pointerdown would
    // retarget the click that follows to the board, so clicking a cell (or one
    // of its buttons) would never reach it.
    if (!drag.captured) {
      drag.captured = true;
      try {
        root.setPointerCapture(event.pointerId);
      } catch {
        /* the pointer is already gone */
      }
      root.classList.add('is-dragging');
    }

    const unit = unitAt(event);
    if (unit.x !== drag.startUnit.x || unit.y !== drag.startUnit.y) drag.moved = true;

    let rect;
    if (drag.kind === 'draw') rect = rectFrom(drag.origin, unit);
    else if (drag.kind === 'move') rect = { x: unit.x - drag.offsetX, y: unit.y - drag.offsetY, w: drag.w, h: drag.h };
    else rect = { x: drag.origin.x, y: drag.origin.y, w: unit.x - drag.origin.x + 1, h: unit.y - drag.origin.y + 1 };
    drag.rect = rect;

    showGhost(rect, legal(rect, drag.id || null));
    if (rect.y + rect.h >= rows() - 1) growRows(rect.y + rect.h + 2);
  }

  function onPointerUp(event) {
    if (!drag) return;
    stopListening();
    const { kind, id, rect, moved, captured } = drag;
    if (captured) {
      try {
        root.releasePointerCapture(event.pointerId);
      } catch {
        /* already released */
      }
    }
    root.classList.remove('is-dragging');
    root.querySelectorAll('.slot.is-dragging').forEach((slot) => slot.classList.remove('is-dragging'));
    hideGhost();
    drag = null;
    // only a real drag should swallow the click that follows it — a plain click
    // on a cell has to reach the click handler and open the editor
    if (moved) {
      justDragged = true;
      setTimeout(() => {
        justDragged = false;
      }, 0);
    }

    if (!rect) return;
    if (!legal(rect, id || null)) {
      say(kind === 'draw' ? '这里放不下，换个位置再画。' : '那里已经有格子了。');
      return;
    }

    if (kind === 'draw') {
      // a plain click draws the smallest cell
      const box = moved ? rect : { ...rect, w: 1, h: 1 };
      onCreate(box);
      return;
    }
    const cell = cells.find((item) => item.id === id);
    if (!cell) return;
    if (cell.pos && cell.pos.x === rect.x && cell.pos.y === rect.y && cell.pos.w === rect.w && cell.pos.h === rect.h) {
      return; // nothing actually changed
    }
    say(`已放到第 ${rect.x + 1} 列、第 ${rect.y + 1} 行`);
    onPlace(id, { ...rect });
    onChange();
  }

  const onPointerCancel = () => {
    if (!drag) return;
    stopListening();
    drag = null;
    hideGhost();
    root.classList.remove('is-dragging');
    root.querySelectorAll('.slot.is-dragging').forEach((slot) => slot.classList.remove('is-dragging'));
  };

  /* ------------------------------------------------------------ rendering */

  function boardSlot(cell) {
    const slot = document.createElement('div');
    slot.className = 'slot board__slot';
    slot.dataset.id = cell.id;
    slot.dataset.w = cell.pos ? cell.pos.w : 1;
    slot.dataset.h = cell.pos ? cell.pos.h : 1;
    if (cell.id === selectedId) slot.classList.add('is-selected');

    const node = createCell(cell);
    node.querySelectorAll('img').forEach((img) => (img.draggable = false));
    slot.append(node);

    const bar = document.createElement('div');
    bar.className = 'slot__bar';
    for (const [act, glyph, title] of ACTIONS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `slot__btn${act === 'del' ? ' slot__btn--danger' : ''}`;
      button.dataset.act = act;
      button.title = title;
      button.setAttribute('aria-label', `${title}：${cell.imageTitle || cell.id}`);
      button.textContent = glyph;
      bar.append(button);
    }
    slot.append(bar);

    const handle = document.createElement('span');
    handle.className = 'slot__handle';
    handle.title = handleTitle();
    handle.setAttribute('aria-hidden', 'true');
    slot.append(handle);

    return slot;
  }

  // 0 until the first layout, so the first growRows always writes the height
  let currentRows = 0;

  const rows = () => currentRows;

  /**
   * The board is as tall as its content plus two empty rows to draw into —
   * every caller asks for `farthest + 2`. There is no row ceiling: drag a cell
   * down and the canvas follows. The height itself is CSS (`--board-h`), since
   * the lattice has to be exactly as tall as the tracks.
   */
  function growRows(wanted) {
    const next = Math.max(2, wanted);
    if (next === currentRows) return;
    currentRows = next;
    root.style.setProperty('--rows', String(next));
  }

  function render(nextCells, options = {}) {
    cells = nextCells;
    if (options.columns) columns = options.columns;
    selectedId = options.selectedId ?? selectedId;

    root.replaceChildren(ghost);
    for (const cell of cells) root.append(boardSlot(cell));

    const farthest = cells.reduce(
      (max, cell) => (cell.pos ? Math.max(max, cell.pos.y + cell.pos.h) : max),
      0
    );
    growRows(farthest + 2);
    return { columns };
  }

  /** Rebuild one cell's slot in place — its content changed, its position did not. */
  function refresh(cell) {
    const slot = root.querySelector(`.slot[data-id="${CSS.escape(cell.id)}"]`);
    if (!slot) return;
    const replacement = boardSlot(cell);
    replacement.classList.add('is-refreshed');
    if (cell.pos) {
      replacement.style.gridColumn = `${cell.pos.x + 1} / span ${cell.pos.w}`;
      replacement.style.gridRow = `${cell.pos.y + 1} / span ${cell.pos.h}`;
    }
    slot.replaceWith(replacement);
  }

  /** Re-place one cell without rebuilding the board (iframes would reload). */
  function patch(cell) {
    const internal = cells.find((item) => item.id === cell.id);
    if (internal) internal.pos = { ...cell.pos };
    const slot = root.querySelector(`.slot[data-id="${CSS.escape(cell.id)}"]`);
    if (!slot || !cell.pos) return;
    slot.dataset.w = cell.pos.w;
    slot.dataset.h = cell.pos.h;
    slot.style.gridColumn = `${cell.pos.x + 1} / span ${cell.pos.w}`;
    slot.style.gridRow = `${cell.pos.y + 1} / span ${cell.pos.h}`;
    const farthest = cells.reduce((max, item) => (item.pos ? Math.max(max, item.pos.y + item.pos.h) : max), 0);
    growRows(farthest + 2);
  }

  /* -------------------------------------------------------------- plumbing */

  let onCreate = () => {};

  function bind({ onDraw, onPlace: onPlaceCb } = {}) {
    onCreate = onDraw || (() => {});
    onPlace = onPlaceCb || (() => {});
    // only the start: from there the gesture follows the pointer on the window
    root.addEventListener('pointerdown', onPointerDown);
    /*
     * 这里**不能**监听 lostpointercapture 当作「取消」。
     *
     * 触摸指针天生带隐式捕获（指向最先收到 pointerdown 的元素），手势里那句
     * setPointerCapture 会把隐式捕获顶掉，浏览器随即发出 lostpointercapture ——
     * 于是一次正常的触摸拖拽会在第一次移动时就"被取消"，永远拖不动（鼠标没有这回事，
     * 所以本地用鼠标测不出来）。真正该中止手势的是 pointercancel（系统手势抢走指针之类），
     * 那个仍然听着。
     */

    // clicks: select, then the bar's buttons
    root.addEventListener('click', (event) => {
      if (event.target.closest('a')) event.preventDefault(); // a linked cell must not navigate
      const button = event.target.closest('.slot__btn');
      const slot = event.target.closest('.slot');
      if (button && slot) {
        event.preventDefault();
        event.stopPropagation();
        const id = slot.dataset.id;
        if (button.dataset.act === 'edit') onEdit(id);
        if (button.dataset.act === 'dup') onDuplicate(id);
        if (button.dataset.act === 'del') onRemove(id);
        return;
      }
      if (slot && !justDragged) {
        event.preventDefault();
        select(slot.dataset.id);
      }
    });

    root.addEventListener('dblclick', (event) => {
      const slot = event.target.closest('.slot');
      if (slot) onEdit(slot.dataset.id);
    });
  }

  function select(id) {
    selectedId = id;
    root.querySelectorAll('.slot').forEach((slot) => slot.classList.toggle('is-selected', slot.dataset.id === id));
    if (onSelect) onSelect(id);
  }

  /** Move the selected cell with the arrow keys (shift = resize). */
  function onKeyDown(event) {
    if (!selectedId) return;
    const cell = cells.find((item) => item.id === selectedId);
    if (!cell || !cell.pos) return;
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!step) return;
    event.preventDefault();
    const rect = { ...cell.pos };
    if (event.shiftKey) {
      rect.w = Math.max(1, rect.w + step[0]);
      rect.h = Math.max(1, rect.h + step[1]);
    } else {
      rect.x += step[0];
      rect.y += step[1];
    }
    if (!legal(rect, cell.id)) {
      say('那边放不下。');
      return;
    }
    patch({ ...cell, pos: rect });
    onPlace(cell.id, rect);
    onChange();
    say(`第 ${rect.x + 1} 列、第 ${rect.y + 1} 行 · ${rect.w}×${rect.h}`);
  }

  return {
    bind,
    render,
    patch,
    refresh,
    select,
    onKeyDown,
    setStatus: (node) => {
      status = node;
    },
    /** Extra room to the right so a drag to the edge is still visible. */
    setColumns: (value) => {
      columns = value;
    },
    /**
     * 右下角方块拖起来做什么：`'resize'`（默认）或 `'move'`。
     * 管理页棋盘的「尺寸 / 位置」开关调它；顺手把方块上的提示也换掉。
     */
    setHandleMode: (mode) => {
      handleMode = mode === 'move' ? 'move' : 'resize';
      root.querySelectorAll('.slot__handle').forEach((node) => (node.title = handleTitle()));
    },
  };
}
