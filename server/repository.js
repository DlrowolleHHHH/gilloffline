'use strict';

/**
 * 盒子仓库：所有用户共享的一份盒子清单。
 *
 * 每个条目就是一颗格子（去掉 id / pos —— 那是「摆在哪」的事，不是盒子本身），
 * 外加标签 label、可选描述 info、分享者和时间。**按 label 归类**：一个 label 对应
 * 多个盒子，仓库不单独维护「标签表」，归类是读的时候现分的。
 *
 * 存在账号库（gilloffline.db）的 `boxes` 表里，而不是一个 JSON 文件：仓库会被反复
 * 读、按 label 分组、按时间排序，这些都有索引；盒子多起来也不用整份读进内存。
 * 早先那一版用过 `repository.json`：第一次打开时如果发现这个文件，会把它导进表里，
 * 再把文件改名成 `.imported` 留作备份。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const store = require('./store');
const db = require('./db');

const LEGACY_FILE = path.join(store.DATA_DIR, 'repository.json');

/** 上限都是防跑飞的：标签 1–40 字，描述最多 400 字，仓库最多 1000 个盒子。 */
const MAX_LABEL = 40;
const MAX_INFO = 400;
const MAX_BOXES = 1000;
const MAX_NAME = 40;

const fail = (message, status = 400) => Object.assign(new Error(message), { status });

const clampText = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/** 表里的一行 → 盒子对象（cell 是 JSON 文本）。坏数据不让它把整个仓库带崩。 */
function toBox(row) {
  if (!row) return undefined;
  let cell = {};
  try {
    cell = JSON.parse(row.cell);
  } catch {
    cell = {};
  }
  return {
    id: row.id,
    label: row.label,
    info: row.info,
    sharer: row.sharer,
    sharerName: row.sharer_name,
    createdAt: row.created_at,
    cell,
  };
}

/* ---------------------------------------------------------------- 旧文件迁移 */

let ready = false;

/** The pre-SQLite repository, imported once and then renamed like the other legacy files. */
function importLegacy() {
  if (ready) return;
  ready = true;
  if (!fs.existsSync(LEGACY_FILE)) return;
  try {
    const parsed = JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf8'));
    const boxes = Array.isArray(parsed.boxes) ? parsed.boxes : [];
    const insert = db.sql(
      `INSERT OR IGNORE INTO boxes (id, label, info, sharer, sharer_name, created_at, cell)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const box of boxes) {
      if (!box || typeof box.id !== 'string') continue;
      insert.run(
        box.id,
        clampText(box.label, MAX_LABEL) || '未命名',
        clampText(box.info, MAX_INFO),
        String(box.sharer || 'admin'),
        clampText(box.sharerName, MAX_NAME) || '匿名',
        Number(box.createdAt) || Date.now(),
        JSON.stringify(box.cell || {})
      );
    }
    fs.renameSync(LEGACY_FILE, `${LEGACY_FILE}.imported`);
    console.log('[repository] imported %d box(es) from repository.json', boxes.length);
  } catch (err) {
    console.warn('[repository] could not import repository.json (%s)', err.message);
  }
}

/* -------------------------------------------------------------------- 读写 */

/** Newest first — the share dialog picks labels off the top, the admin list too. */
function list() {
  importLegacy();
  return db.sql('SELECT * FROM boxes ORDER BY created_at DESC').all().map(toBox);
}

const findRow = (id) => db.sql('SELECT * FROM boxes WHERE id = ?').get(id);

/** 某个分享者自己的盒子（「我分享的盒子」面板用）。 */
function listBy(sharer) {
  importLegacy();
  return db.sql('SELECT * FROM boxes WHERE sharer = ? ORDER BY created_at DESC').all(sharer).map(toBox);
}

/**
 * 分享进来的格子先过一遍站点的清洗：越界的尺寸、写坏的颜色、坏 URL 都在这里
 * 退回默认值，仓库里不会存进一颗「站点存不下」的盒子。
 */
function normalizeCell(raw) {
  const cell = store.normalizeCell(raw && typeof raw === 'object' ? raw : {}, { layout: 'flow' });
  delete cell.id;
  delete cell.pos;
  return cell;
}

function add({ label, info, cell, sharer, sharerName }) {
  importLegacy();
  const count = db.sql('SELECT COUNT(*) AS total FROM boxes').get().total;
  if (count >= MAX_BOXES) throw fail('盒子仓库满了，先清理一些再分享。', 409);
  const name = clampText(label, MAX_LABEL);
  if (!name) throw fail('标签不能为空。');

  const box = {
    id: `bx_${crypto.randomBytes(8).toString('hex')}`,
    label: name,
    info: clampText(info, MAX_INFO),
    sharer,
    sharerName: clampText(sharerName, MAX_NAME) || '匿名',
    createdAt: Date.now(),
    cell: normalizeCell(cell),
  };
  db.sql(
    `INSERT INTO boxes (id, label, info, sharer, sharer_name, created_at, cell)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(box.id, box.label, box.info, box.sharer, box.sharerName, box.createdAt, JSON.stringify(box.cell));
  return box;
}

const canTouch = (box, actor) => actor === 'admin' || box.sharer === actor;

/** 改标签 / 描述：分享者本人或站主。 */
function update(id, patch, actor) {
  importLegacy();
  const box = toBox(findRow(id));
  if (!box) throw fail('没有这个盒子。', 404);
  if (!canTouch(box, actor)) throw fail('只能改自己分享的盒子。', 403);

  const label = patch.label !== undefined ? clampText(patch.label, MAX_LABEL) : box.label;
  if (!label) throw fail('标签不能为空。');
  const info = patch.info !== undefined ? clampText(patch.info, MAX_INFO) : box.info;

  db.sql('UPDATE boxes SET label = ?, info = ? WHERE id = ?').run(label, info, id);
  return { ...box, label, info };
}

/** 删一个盒子：分享者本人或站主。 */
function remove(id, actor) {
  importLegacy();
  const box = toBox(findRow(id));
  if (!box) throw fail('没有这个盒子。', 404);
  if (!canTouch(box, actor)) throw fail('只能删自己分享的盒子。', 403);
  db.sql('DELETE FROM boxes WHERE id = ?').run(id);
  return box;
}

module.exports = { MAX_LABEL, MAX_INFO, list, listBy, add, update, remove };
