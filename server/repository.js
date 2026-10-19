'use strict';

/**
 * 盒子仓库：所有用户共享的一份盒子清单。
 *
 * 每个条目就是一颗格子（去掉 id / pos —— 那是「摆在哪」的事，不是盒子本身），
 * 外加标签 label、可选描述 info、分享者和时间。**按 label 归类**：一个 label 对应
 * 多个盒子，仓库不单独维护「标签表」，归类是读的时候现分的。
 *
 * 存在数据目录下的 repository.json，和站点数据一起走；写入走临时文件 + rename，
 * 和 site.json 一样不会写出半个文件。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const store = require('./store');

const FILE = path.join(store.DATA_DIR, 'repository.json');

/** 上限都是防跑飞的：标签 1–40 字，描述最多 400 字，仓库最多 1000 个盒子。 */
const MAX_LABEL = 40;
const MAX_INFO = 400;
const MAX_BOXES = 1000;
const MAX_NAME = 40;

const fail = (message, status = 400) => Object.assign(new Error(message), { status });

const clampText = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

function readDoc() {
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return { boxes: Array.isArray(parsed.boxes) ? parsed.boxes : [] };
  } catch {
    return { boxes: [] };
  }
}

/** Newest first — the share dialog picks labels off the top, the admin list too. */
const list = () => readDoc().boxes.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

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
  const doc = readDoc();
  if (doc.boxes.length >= MAX_BOXES) throw fail('盒子仓库满了，先清理一些再分享。', 409);
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
  doc.boxes.push(box);
  store.writeJsonAtomic(FILE, doc);
  return box;
}

const canTouch = (box, actor) => actor === 'admin' || box.sharer === actor;

/** 改标签 / 描述：分享者本人或站主。 */
function update(id, patch, actor) {
  const doc = readDoc();
  const box = doc.boxes.find((item) => item.id === id);
  if (!box) throw fail('没有这个盒子。', 404);
  if (!canTouch(box, actor)) throw fail('只能改自己分享的盒子。', 403);

  if (patch.label !== undefined) {
    const label = clampText(patch.label, MAX_LABEL);
    if (!label) throw fail('标签不能为空。');
    box.label = label;
  }
  if (patch.info !== undefined) box.info = clampText(patch.info, MAX_INFO);

  store.writeJsonAtomic(FILE, doc);
  return box;
}

/** 删一个盒子：分享者本人或站主。 */
function remove(id, actor) {
  const doc = readDoc();
  const index = doc.boxes.findIndex((item) => item.id === id);
  if (index < 0) throw fail('没有这个盒子。', 404);
  const box = doc.boxes[index];
  if (!canTouch(box, actor)) throw fail('只能删自己分享的盒子。', 403);
  doc.boxes.splice(index, 1);
  store.writeJsonAtomic(FILE, doc);
  return box;
}

module.exports = { FILE, MAX_LABEL, MAX_INFO, list, add, update, remove };
