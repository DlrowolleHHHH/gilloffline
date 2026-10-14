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
   * Pointer position → the grid unit under it. The pitch (cell + gap) is stashed
   * on the element by the layout pass, so this stays a couple of subtractions
   * even while dragging. The board is left-aligned, so the origin is its corner.
   */
  function unitAt(event) {
    const box = root.getBoundingClientRect();
    const pitch = Number(root.dataset.pitch) || 60;
    const x = Math.floor((event.clientX - box.left + root.scrollLeft) / pitch);
    const y = Math.floor((event.clientY - box.top + root.scrollTop) / pitch);
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

  /* --------------------------------------------------------------- pointer */

  function onPointerDown(event) {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    const slot = event.target.closest('.slot');
    const handle = event.target.closest('.slot__handle');

    if (handle && slot) {
      startDrag(event, { kind: 'resize', id: slot.dataset.id, origin: pointOf(slot.dataset.id) });
      return;
    }
    if (slot) {
      const cell = cells.find((item) => item.id === slot.dataset.id);
      if (!cell) return;
      const pos = cell.pos || { x: 0, y: 0 };
      const grab = unitAt(event);
      startDrag(event, {
        kind: 'move',
        id: cell.id,
        w: pos.w || 1,
        h: pos.h || 1,
        // where inside the cell the pointer grabbed it, so it does not jump
        offsetX: clamp(grab.x - pos.x, 0, Math.max(0, (pos.w || 1) - 1)),
        offsetY: clamp(grab.y - pos.y, 0, Math.max(0, (pos.h || 1) - 1)),
      });
      return;
    }
    if (event.target.closest('.slot__bar')) return;

    startDrag(event, { kind: 'draw', origin: unitAt(event) });
  }

  const pointOf = (id) => {
    const cell = cells.find((item) => item.id === id);
    return cell && cell.pos ? { x: cell.pos.x, y: cell.pos.y } : { x: 0, y: 0 };
  };

  function startDrag(event, info) {
    drag = { ...info, moved: false, startUnit: unitAt(event) };
    hideGhost();
    if (info.kind !== 'draw') {
      const slot = root.querySelector(`.slot[data-id="${CSS.escape(info.id)}"]`);
      if (slot) slot.classList.add('is-dragging');
    }
    root.setPointerCapture(event.pointerId);
    root.classList.add('is-dragging');
    event.preventDefault();
  }

  function onPointerMove(event) {
    if (!drag) return;
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
    const { kind, id, rect, moved } = drag;
    root.releasePointerCapture?.(event.pointerId);
    root.classList.remove('is-dragging');
    root.querySelectorAll('.slot.is-dragging').forEach((slot) => slot.classList.remove('is-dragging'));
    hideGhost();
    drag = null;
    justDragged = true;
    setTimeout(() => {
      justDragged = false;
    }, 0);

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
    handle.title = '拖动改尺寸';
    handle.setAttribute('aria-hidden', 'true');
    slot.append(handle);

    return slot;
  }

  // 0 until the first layout, so the first growRows always writes the height
  let currentRows = 0;

  const rows = () => currentRows;

  /** Always leave a couple of empty rows below the content to draw into. */
  function growRows(wanted) {
    const next = Math.max(6, wanted);
    if (next === currentRows) return;
    currentRows = next;
    root.style.minHeight = `calc(${next} * var(--cell-size, 48px) + ${next - 1} * var(--gap, 6px))`;
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
    root.addEventListener('pointerdown', onPointerDown);
    root.addEventListener('pointermove', onPointerMove);
    root.addEventListener('pointerup', onPointerUp);
    root.addEventListener('pointercancel', onPointerCancel);
    root.addEventListener('lostpointercapture', onPointerCancel);

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
  };
}
