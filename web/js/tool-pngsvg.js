/**
 * PNG → SVG.
 *
 * Two modes:
 *   trace  — flat colour regions become real vector paths. The pixel grid gives
 *            a set of edges between "this colour" and "not this colour"; linking
 *            those edges end to end yields closed contours, which become <path>
 *            elements. Holes (the counter of an "o") are separate contours and
 *            `fill-rule="evenodd"` empties them out.
 *   embed  — the original pixels, base64'd into an <image>, for pictures where
 *            tracing would only make a mess.
 *
 * Tracing is meant for flat artwork: text images, logos, icons. A photo has
 * thousands of colours and comes out as a poster.
 */

import { toast } from './shared.js';
import { download, previewUrl, saveToServer, stampedName } from './editor-io.js';

const state = {
  file: null,
  image: null, // decoded <img>
  raster: null, // { width, height, imageData } at the chosen scale
  sourceUrl: null,
  result: null, // { blob, stats, name }
  resultUrl: null,
};

const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------------ colours */

const rgbKey = (r, g, b) => (r << 16) | (g << 8) | b;

function nearestIndex(palette, r, g, b) {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < palette.length; i += 1) {
    const [pr, pg, pb] = palette[i];
    const dist = (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

/** k-means over a sample of the pixels — good enough for flattening artwork. */
function kmeans(samples, k) {
  let centers = [];
  for (let i = 0; i < k; i += 1) {
    centers.push(samples[Math.floor(((i + 0.5) * samples.length) / k)].slice());
  }
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const sums = Array.from({ length: k }, () => [0, 0, 0, 0]);
    for (const sample of samples) {
      const index = nearestIndex(centers, sample[0], sample[1], sample[2]);
      sums[index][0] += sample[0];
      sums[index][1] += sample[1];
      sums[index][2] += sample[2];
      sums[index][3] += 1;
    }
    centers = centers.map((center, index) =>
      sums[index][3]
        ? [sums[index][0] / sums[index][3], sums[index][1] / sums[index][3], sums[index][2] / sums[index][3]]
        : center
    );
  }
  return centers.map((center) => [Math.round(center[0]), Math.round(center[1]), Math.round(center[2]), 255]);
}

/**
 * Pixel → colour id. Exact colours when the image has few enough of them (flat
 * artwork stays pixel-perfect); otherwise k-means down to `maxColors`.
 * `maxColors = 0` means "keep every colour as it is".
 */
function quantize(pixels, width, height, maxColors) {
  const total = width * height;
  const counts = new Map();
  const samples = [];
  const step = Math.max(1, Math.floor(total / 20000));

  for (let i = 0; i < total; i += 1) {
    const p = i * 4;
    if (pixels[p + 3] < 128) continue; // treat anything half-transparent as empty
    const key = rgbKey(pixels[p], pixels[p + 1], pixels[p + 2]);
    counts.set(key, (counts.get(key) || 0) + 1);
    if (i % step === 0) samples.push([pixels[p], pixels[p + 1], pixels[p + 2]]);
  }

  const merged = maxColors > 0 && counts.size > maxColors;
  const palette = merged
    ? kmeans(samples, maxColors)
    : [...counts.keys()].map((key) => [(key >> 16) & 255, (key >> 8) & 255, key & 255, 255]);

  const index = new Int16Array(total).fill(-1);
  const pixelCounts = new Array(palette.length).fill(0);
  const cache = new Map();
  for (let i = 0; i < total; i += 1) {
    const p = i * 4;
    if (pixels[p + 3] < 128) continue;
    const key = rgbKey(pixels[p], pixels[p + 1], pixels[p + 2]);
    let id = cache.get(key);
    if (id === undefined) {
      id = nearestIndex(palette, pixels[p], pixels[p + 1], pixels[p + 2]);
      cache.set(key, id);
    }
    index[i] = id;
    pixelCounts[id] += 1;
  }

  return { index, palette, pixelCounts, distinct: counts.size, merged };
}

/* ------------------------------------------------------------------ tracing */

const DIRS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
]; // 上 右 下 左

function link(edges, from, to) {
  const list = edges.get(from);
  if (list) list.push(to);
  else edges.set(from, [to]);
}

/**
 * Every inside pixel contributes the sides that face a different colour (the
 * outside counts as a different colour). Each side is a directed edge on the
 * pixel-corner grid: walking them gives clockwise contours around the colour.
 */
function collectEdges(index, width, height) {
  const stride = width + 1;
  const at = (x, y) => (x < 0 || y < 0 || x >= width || y >= height ? -1 : index[y * width + x]);
  const perColor = new Map();

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const colorId = index[y * width + x];
      if (colorId < 0) continue;

      let edges = perColor.get(colorId);
      if (!edges) {
        edges = new Map();
        perColor.set(colorId, edges);
      }

      const topLeft = y * stride + x;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + stride;
      const bottomRight = bottomLeft + 1;

      // all four go the same way round the pixel (top → right → bottom → left),
      // so the sides link up into closed contours instead of loose chains
      if (at(x, y - 1) !== colorId) link(edges, topLeft, topRight);
      if (at(x + 1, y) !== colorId) link(edges, topRight, bottomRight);
      if (at(x, y + 1) !== colorId) link(edges, bottomRight, bottomLeft);
      if (at(x - 1, y) !== colorId) link(edges, bottomLeft, topLeft);
    }
  }
  return perColor;
}

function directionOf(from, to, stride) {
  const fx = from % stride;
  const fy = (from - fx) / stride;
  const tx = to % stride;
  const ty = (to - tx) / stride;
  if (ty < fy) return 0;
  if (tx > fx) return 1;
  if (ty > fy) return 2;
  return 3;
}

/**
 * Pick the next edge at a corner. Corners usually have exactly one; when two
 * same-coloured pixels meet diagonally there are two, and taking the sharpest
 * right turn (relative to where we came from) keeps the two shapes apart
 * instead of braiding them into one contour.
 */
function takeNext(edges, prev, current, stride) {
  const outs = edges.get(current);
  if (!outs || !outs.length) return null;
  if (outs.length === 1) return outs.pop();

  const incoming = prev === null ? null : directionOf(prev, current, stride);
  const order =
    incoming === null
      ? [1, 0, 3, 2]
      : [(incoming + 1) % 4, incoming, (incoming + 3) % 4, (incoming + 2) % 4];

  for (const dir of order) {
    const at = outs.findIndex((to) => directionOf(current, to, stride) === dir);
    if (at >= 0) return outs.splice(at, 1)[0];
  }
  return outs.pop();
}

/** Walk the edge set until it is used up; every walk is one closed contour. */
function contoursOf(edges, stride) {
  const contours = [];
  while (edges.size) {
    const start = edges.keys().next().value;
    const points = [start];
    let prev = null;
    let current = start;

    for (;;) {
      const next = takeNext(edges, prev, current, stride);
      if (!edges.get(current) || !edges.get(current).length) edges.delete(current);
      if (next === null) break;
      if (next === start) break; // closed
      points.push(next);
      prev = current;
      current = next;
    }
    if (edges.get(start) && !edges.get(start).length) edges.delete(start);
    if (points.length >= 4) contours.push(points);
  }
  return contours;
}

function toPoints(keys, stride) {
  return keys.map((key) => {
    const x = key % stride;
    return [x, (key - x) / stride];
  });
}

/** Start the contour at its top-left corner — a point the simplifier must keep. */
function rotateToCorner(points) {
  let best = 0;
  for (let i = 1; i < points.length; i += 1) {
    const [x, y] = points[i];
    const [bx, by] = points[best];
    if (y < by || (y === by && x < bx)) best = i;
  }
  return points.slice(best).concat(points.slice(0, best));
}

/** Douglas–Peucker on an open polyline: the two ends stay, the rest is thinned. */
function simplifyOpen(points, tolerance) {
  if (points.length < 3) return points;

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    if (last - first < 2) continue;

    const [x1, y1] = points[first];
    const [x2, y2] = points[last];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.hypot(dx, dy) || 1;

    let farthest = -1;
    let farthestDist = 0;
    for (let i = first + 1; i < last; i += 1) {
      const [px, py] = points[i];
      const dist = Math.abs(dy * (px - x1) - dx * (py - y1)) / length;
      if (dist > farthestDist) {
        farthestDist = dist;
        farthest = i;
      }
    }
    if (farthestDist > tolerance && farthest > 0) {
      keep[farthest] = 1;
      stack.push([first, farthest], [farthest, last]);
    }
  }
  return points.filter((_, index) => keep[index]);
}

/**
 * A closed contour, simplified. It has to be cut in two first: with the first
 * point repeated at the end the simplifier's baseline has zero length, every
 * point counts as "on the line", and the whole contour would collapse. Cutting
 * at the point farthest from the start gives both halves a real baseline.
 *
 * Returns the ring with its first point repeated at the end.
 */
function simplifyPath(points, tolerance) {
  if (tolerance <= 0 || points.length < 4) return points.concat([points[0]]);

  const [x0, y0] = points[0];
  let cut = 1;
  let cutDist = -1;
  for (let i = 1; i < points.length; i += 1) {
    const dx = points[i][0] - x0;
    const dy = points[i][1] - y0;
    const dist = dx * dx + dy * dy;
    if (dist > cutDist) {
      cutDist = dist;
      cut = i;
    }
  }

  const head = simplifyOpen(points.slice(0, cut + 1), tolerance);
  const tail = simplifyOpen(points.slice(cut).concat([points[0]]), tolerance);
  return head.concat(tail.slice(1));
}

function polygonArea(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum / 2);
}

const hex = (r, g, b) => `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;

export function traceToSvg(imageData, width, height, { maxColors, simplify }) {
  const { index, palette, pixelCounts, distinct, merged } = quantize(imageData.data, width, height, maxColors);
  const perColor = collectEdges(index, width, height);
  const stride = width + 1;

  const order = [...perColor.keys()].sort((a, b) => pixelCounts[b] - pixelCounts[a]);
  const parts = [];
  let shapes = 0;
  let nodes = 0;
  let skipped = 0;

  for (const colorId of order) {
    const paths = [];
    for (const contour of contoursOf(perColor.get(colorId), stride)) {
      const points = simplifyPath(rotateToCorner(toPoints(contour, stride)), simplify).slice(0, -1);
      if (points.length < 3 || polygonArea(points) < 2) {
        skipped += 1;
        continue;
      }
      paths.push(`M${points.map(([x, y]) => `${x} ${y}`).join('L')}Z`);
      nodes += points.length;
    }
    if (!paths.length) continue;

    shapes += paths.length;
    const [r, g, b, a] = palette[colorId];
    const opacity = a < 255 ? ` fill-opacity="${(a / 255).toFixed(3)}"` : '';
    parts.push(`<path fill="${hex(r, g, b)}"${opacity} fill-rule="evenodd" d="${paths.join('')}"/>`);
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${parts.join('')}</svg>`;
  return { svg, stats: { width, height, colors: palette.length, distinct, merged, shapes, nodes, skipped } };
}

function embedToSvg(dataUrl, width, height) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><image href="${dataUrl}" width="${width}" height="${height}"/></svg>`;
}

/* -------------------------------------------------------------------- input */

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}

function decode(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('这个文件浏览器解不开，换一张试试'));
    };
    image.src = url;
  });
}

function rasterize(image, maxEdge) {
  let width = image.naturalWidth;
  let height = image.naturalHeight;
  if (maxEdge > 0 && Math.max(width, height) > maxEdge) {
    const scale = maxEdge / Math.max(width, height);
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, width, height);
  return { width, height, imageData: ctx.getImageData(0, 0, width, height) };
}

async function accept(file) {
  if (!file || !file.type.startsWith('image/')) {
    toast('请选一张图片', 'error');
    return;
  }
  state.file = file;
  try {
    state.image = await decode(file);
  } catch (err) {
    toast(err.message, 'error');
    return;
  }

  if (state.sourceUrl) URL.revokeObjectURL(state.sourceUrl);
  state.sourceUrl = URL.createObjectURL(file);
  $('pv-orig').src = state.sourceUrl;

  const { naturalWidth: w, naturalHeight: h } = state.image;
  $('pv-source').textContent = `${file.name} · ${w} × ${h} px · ${(file.size / 1024).toFixed(1)} KB`;
  $('pv-name').value = file.name.replace(/\.[^.]+$/, '') + '.svg';
  $('pv-run').disabled = false;
  resetResult();
}

function resetResult() {
  state.result = null;
  $('pv-download').disabled = true;
  $('pv-save').disabled = true;
  $('pv-result').removeAttribute('src');
  $('pv-stats').textContent = '';
  if (state.resultUrl) {
    URL.revokeObjectURL(state.resultUrl);
    state.resultUrl = null;
  }
}

/* ---------------------------------------------------------------------- run */

function traceOptions() {
  return {
    maxColors: Number($('pv-colors').value),
    simplify: Number($('pv-simplify').value),
  };
}

async function run() {
  if (!state.file) return;
  const button = $('pv-run');
  button.disabled = true;
  $('pv-stats').textContent = '转换中…';
  // let the label paint before the (synchronous) tracing pass
  await new Promise((resolve) => setTimeout(resolve, 20));

  const started = performance.now();
  try {
    let svg;
    let stats;
    if ($('pv-mode').value === 'embed') {
      const dataUrl = await readAsDataUrl(state.file);
      const { naturalWidth: w, naturalHeight: h } = state.image;
      svg = embedToSvg(dataUrl, w, h);
      stats = { width: w, height: h, embedded: true };
    } else {
      const maxEdge = Number($('pv-scale').value);
      const raster = rasterize(state.image, maxEdge);
      const traced = traceToSvg(raster.imageData, raster.width, raster.height, traceOptions());
      svg = traced.svg;
      stats = traced.stats;
    }

    const blob = new Blob([svg], { type: 'image/svg+xml' });
    resetResult(); // drops the previous result and frees its preview URL
    state.result = { blob };
    state.resultUrl = URL.createObjectURL(blob);
    $('pv-result').src = state.resultUrl;
    $('pv-download').disabled = false;
    $('pv-save').disabled = false;

    const ms = Math.round(performance.now() - started);
    $('pv-stats').textContent = stats.embedded
      ? `直接嵌入：${stats.width} × ${stats.height} px · SVG ${(blob.size / 1024).toFixed(1)} KB · ${ms} ms`
      : `描摹：${stats.width} × ${stats.height} px · ${stats.colors} 色` +
        `${stats.merged ? `（原图 ${stats.distinct} 色，已归并）` : ''} · ` +
        `${stats.shapes} 条轮廓 · ${stats.nodes} 个节点 · SVG ${(blob.size / 1024).toFixed(1)} KB · ${ms} ms`;
  } catch (err) {
    $('pv-stats').textContent = '';
    toast(err.message, 'error');
  } finally {
    button.disabled = false;
  }
}

/* -------------------------------------------------------------------- wiring */

function extensionName() {
  const typed = $('pv-name').value.trim();
  if (!typed) return stampedName('image', 'svg');
  return /\.svg$/i.test(typed) ? typed : `${typed}.svg`;
}

function bind() {
  $('pv-pick').addEventListener('click', () => $('pv-file').click());
  $('pv-file').addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) accept(file);
  });

  const drop = $('pv-drop');
  for (const type of ['dragenter', 'dragover']) {
    drop.addEventListener(type, (event) => {
      event.preventDefault();
      drop.classList.add('is-over');
    });
  }
  for (const type of ['dragleave', 'drop']) {
    drop.addEventListener(type, (event) => {
      event.preventDefault();
      drop.classList.remove('is-over');
    });
  }
  drop.addEventListener('drop', (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (file) accept(file);
  });

  $('pv-mode').addEventListener('change', () => {
    $('pv-trace-options').hidden = $('pv-mode').value !== 'trace';
    resetResult();
  });
  $('pv-simplify').addEventListener('input', () => {
    $('pv-simplify-value').textContent = $('pv-simplify').value;
  });

  $('pv-run').addEventListener('click', run);

  $('pv-download').addEventListener('click', () => {
    if (state.result) download(state.result.blob, extensionName());
  });

  $('pv-save').addEventListener('click', async () => {
    if (!state.result) return;
    const button = $('pv-save');
    button.disabled = true;
    try {
      const saved = await saveToServer(state.result.blob, extensionName(), $('pv-kind').value);
      $('pv-stats').textContent = `已存到 ${saved.url}（${(saved.size / 1024).toFixed(1)} KB）`;
      toast('已存到服务器', 'ok');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      button.disabled = false;
    }
  });
}

export function init() {
  $('pv-simplify-value').textContent = $('pv-simplify').value;
  bind();
}
