# 棋盘与格子布局 · 实现笔记

这份文档写给**要改这块代码的人（或 agent）**，讲的是实现契约和踩过的坑。
用户视角的用法在 [README.md](README.md)，这里不重复。

一句话概括：格子有两种排布方式——`flow`（有序列表，CSS 排）和 `board`（每个格子有坐标，
棋盘上拖拽摆放）。棋盘那套的难点全在**几何**：格子尺寸、格线、指针坐标三者必须永远对得上，
任何一处算错都会表现成「拖不动」「对不齐」「点不到」这种看起来像玄学的问题。

## 1. 文件地图

| 文件 | 负责 |
| --- | --- |
| `server/store.js` | 数据模型、清洗（sanitize）、**不重叠修复**（保存时的最后防线） |
| `web/js/shared.js` | 几何与布局核心：`applyGridLayout`、`packBoard`、`repairBoard`、`firstFreeSpot`、碰撞判断 |
| `web/js/board.js` | 棋盘的交互与渲染：拖拽手势、网格吸附、ghost 预览、行数增长 |
| `web/js/admin.js` | 管理页把两者接起来：工具条（列数/间隔/缩放）、抽屉、脏标记 |
| `web/js/home.js` | 主页：套用 `site` 设置（强调色、间隔、布局）并渲染 |
| `web/css/admin.css` | `.admin-board`（棋盘容器）与 `.admin-board::before`（格线） |
| `data/site.json` | 提交进仓库的种子数据，运行时只读（首次部署时复制到数据目录） |

## 2. 数据模型

```jsonc
{
  "site": {
    "columns": 12,        // 0 = 自动（仅 flow 有意义）；棋盘必须有真实列数，3..12
    "layout": "board",    // 'flow' | 'board'；字段缺失 = flow（老文档）
    "gap": "m",           // 's' | 'm' | 'l' → 8 / 16 / 28 px，默认 'm'
    "responsive": false,  // 窄屏重排开关；缺省 = 关（窄屏整体缩小 + 横滚）
    "padWidth": 1024,     // 视口 < 它 → pad 档
    "phoneWidth": 640,    // 视口 < 它 → 手机档
    "padColumns": 4,      // 该档重排成几列；0 = 这一档不重排（保持棋盘原样）
    "phoneColumns": 2
    ...
  },
  "cells": [
    { "id": "c00000000001", "size": "3x6", "pos": { "x": 0, "y": 0, "w": 6, "h": 3 }, ... }
  ]
}
```

- **`pos` 是棋盘中位置的唯一真相**：`{x, y, w, h}`，全部 0 基、单位是「格」，四个键要么都有要么都没有
  （半个矩形等于把格子丢到没人指定的地方）。
- **`size` 是 flow 的尺寸来源**，是预设关键字。注意它的键序是**「行×列」**：`3x6` = 宽 6 × 高 3
  （`SIZE_UNITS` 在 `server/store.js`，`SIZES` 在两边各有一份，必须同步）。字符串解析它是坑，别做。
  两者**互不派生**：棋盘用 `pos`，flow 用 `size`；`cellUnits()` 已经处理好（有 `pos` 就用 `pos`）。
- `pos` 在 flow 文档里也会被保留（`normalizeCell` 两种布局都存）：来回切换布局不能丢摆位。
- **封面 与 嵌入是两个字段**（别再把它们混起来）：`html` 是「封面的 HTML」，只在 `type: 'html'`
  的「网页封面」上用，直接铺在格子上渲染；`embed` 是「嵌入的 HTML」，三种类型都能有。
  有 `embed` 时 `createCell` 会把地址挂到 `dataset.fullscreen` 上并渲染那个放大角标 ——
  主页据此把**嵌入的页面**全屏展开（展开的永远不是封面）。`htmlCover` 那条老字段只在
  `normalizeCell` 里做过渡映射（老数据 = 网页当嵌入页面、封面退成纯色），别再引回来。
- 沙箱 iframe 只在 `createFrame()`（`web/js/shared.js`）里创建一处，**不要**在别处手写 iframe：
  那条规则是「一律非 same-origin 沙箱」，加了 `allow-same-origin` 等于把本站的登录状态交给页面。
  全屏展开用的也是它。
- `responsive` 那五个键**只对 board 有意义**：flow 本来就会跟着窗口重排，用不到分档
  （`repackColumns()` 对 flow 直接返回 0）。**`padColumns` / `phoneColumns` 的 0 是合法值**
  （这一档不重排），读的时候不能用 `||`。阈值是「设备」概念，判据是
  `documentElement.clientWidth`（和媒体查询同一个量），不是容器宽。
- 上限：`MAX_CELLS 200`、`MAX_COLS 12`、`MAX_CELL_UNITS 12`（单个格子的宽/高）、
  `MIN_BOARD_COLS 3`、`DEFAULT_BOARD_COLS 12`、`MAX_ROWS 1000`（防跑飞，不是设计上限）。

### 向后兼容（红线）

**没有 `layout` / `pos` 的文档必须渲染得和以前一模一样。** 线上站点、各子管理员的站点都属于这一类。
第一次在棋盘上动手时才做快照：`packBoard()` 按当前列数把 flow 排布固化成坐标
（`firstFreeSpot` 是行优先扫描，和 CSS `grid-auto-flow: row dense` 同序，所以快照出来就是屏幕上的样子），
同时把 `site.layout` 改成 `board` 并标记未保存。

## 3. 几何契约（最容易改坏的地方）

一次布局 = `applyGridLayout(grid, columns, { layout, cells, minCell, scale })`，
它把结果写进元素，之后所有人都读这些值，**不要再各算一份**：

| 输出 | 含义 |
| --- | --- |
| `--cell-size` | 一个格子的边长（px，已含缩放） |
| `--gap` | 格间空隙（px，**已乘缩放**） |
| `--cols` | 列数 |
| `--board-w` / `--board-h` | 轨道（tracks）的宽 / 高 —— 格线就画这么大 |
| `--board-x` / `--board-y` | 格线起点，相对 **padding box**（= padding + 居中偏移） |
| `--rows` | 行数（**由 `board.js` 的 `growRows` 写**，`--board-h` 由它算出） |
| `dataset.pitch` | 一格 + 一缝 = 指针吸附的刻度 |
| `dataset.inset` | 轨道起点相对 **border box** 的偏移（边框 + padding + 居中） |

棋盘分支的核心算式：

```js
const zoomGap = gap * scale;                                  // --gap（显示用）
const size = Math.max(minCell, (width - (cols - 1) * gap) / cols) * scale;
const tracks = cols * size + (cols - 1) * zoomGap;            // --board-w
const centered = Math.max(0, (clientWidth - padX - padRight - tracks) / 2);
dataset.pitch = size + zoomGap;
dataset.inset = `${clientLeft + padX + centered},${clientTop + padY}`;
```

不变量，改代码时逐条检查：

1. **`fit` 必须用未缩放的 gap 量，再整体乘 `scale`。** 否则 50% 不是一半（gap 一变，等分结果也变，
   缩放会跟着漂）。`50% / 100% → pitch 56.92 / 113.83` 这种精确比例就是靠这条。
2. **`dataset.pitch` 必须是渲染出来的 pitch**（`size + 显示用 gap`），`board.js` 的 `unitAt` 拿它做除法。
3. **`dataset.inset` 必须等于轨道起点。** 只要给轨道加了偏移（padding、居中），这里就要同步加，
   否则指针坐标整体偏移——缩得越小偏得越明显。
4. **`.admin-board` 必须 `box-sizing: content-box`。** `min-height: var(--board-h)` 量的是轨道高度；
   默认的 `border-box` 会把 14px 的内边距和边框算进去，元素就比自己的格线矮 14px，
   最后那两行「留着作画」的空白实际落在元素**外面**，指针按下去打的是页面而不是棋盘。
5. **格线是 `::before`，不是元素背景。** 尺寸 = 轨道，位置 = 轨道起点，随内容一起滚动
   （元素背景做不到：它会铺满整个面板，缩小后到处都是格线，看不出棋盘到哪儿为止；
   以前靠 `background-attachment: local` 让背景跟滚，现在伪元素天然就是滚动容器的子元素）。
6. **格线是每个格子周期的「起点」画一条**，所以每列的左边、每行的上边都有线，
   但**最后一列的右边、最后一行的下边**落在周期中间——需要额外两层整尺寸渐变收边，
   否则缩小后棋盘是缺口的三条边。
7. **行数永远 = 最底行 + 2**（`growRows(farthest + 2)`），客户端不设上限，往下拖就长；
   删掉底部的格子会缩回去。多出来的两行只是空白画布，不写进 `data/site.json`。
8. **居中要 `justify-content: safe center`**：普通 `center` 在内容比面板宽时会把最左边几列推出视野、滚不回来。

## 4. 交互契约（`web/js/board.js`）

三种手势（画新的 / 移动 / 右下角改尺寸）共用同一条合法性判断：

```js
legal(rect, exceptId) = 宽高 ≥ 1 && 在列范围内 && 不压到别的格子
```

- **触屏和鼠标是同一套手势**：按住拖动 = 移动，轻点 = 打开编辑，区别只在指头有没有移动
  （`drag.moved` 只认「跨了格子」，所以小于一格的抖动不会真的挪动格子，那次点击仍算轻点）。
  触摸指针带隐式捕获，**别**在 pointerdown 就 setPointerCapture，也**别**把 lostpointercapture
  当取消（见坑表）——这两条都只在真机上才暴露。
- **触屏拖拽延时（`setHoldDelay(ms)`）**：`0` = 按下去就进拖拽（默认），大于 0 时按住够时间才进，
  按住期间指头移动超过 12px 就取消（那是在滑页面）。它由管理页工具条的输入框喂进来，
  **不进 `site.json`**（同「缩放」：一次打开的偏好）。定时器到点时先喊 `onArm()`（管理页拿它浮
  「进入拖拽」），再走 `startDrag` —— 也就是说**手势的两条路（立刻 / 延时后）汇合在同一个 `startDrag`**，
  别在延时分支里另写一套。
- **触屏不画格子**：`onPointerDown` 走到最后一个分支（空白处 → `kind: 'draw'`）之前，
  `pointerType === 'touch'` 直接 return。空白处的 `touch-action` 是 `auto`（只有 `.board__slot`
  是 `none`），浏览器会把这一手认成滚动并 `pointercancel`，不 return 也只是白搭；
  触屏新建走「＋ 添加格子」（落 1×1 在最下面，抽屉里给尺寸模版）。
  对应的提示是棋盘上方的 `.board-touch-hint`，只在 `(hover: none)` 下显示。
- **手势结束前不改文档**：拖动只移动 ghost，落点合法才 touch 数据。
  否则每一帧都会重建格子，内嵌 iframe 和图片会不停重载。
- **监听在 window 上，不在棋盘上。** pointerdown 挂在棋盘（`root`），但一旦开始手势，
  `pointermove/pointerup/pointercancel` 挂到 window，结束再摘掉。
  原因：在最后一行往外拖是「让画布长高」的正常操作，而这一步**第一次移动就已经出了棋盘**，
  挂在棋盘上的监听根本收不到，手势会当场夭折。
- **懒捕获**：第一次 `pointermove` 时才 `setPointerCapture`。pointerdown 就捕获的话，
  浏览器会把随后的 `click` 重定向到捕获元素（棋盘本身），格子和它上面的 ✏/⧉/✕ 按钮就永远点不到。
- 拖动结束后用一个 tick 的 `justDragged` 吃掉随后的 click（否则变成一次选中）。
- `unitAt(event)`：`floor((clientX - rect.left + scrollLeft - insetX) / pitch)`；
  x 夹到 `0..cols-1`，y 只保证 ≥ 0（**不设上限**，往下画就是要越界）。
- **按钮条必须裁在格子里**（`.slot__bar { max-height: calc(100% - 10px); overflow: hidden }`）。
  按钮是固定 22px，缩小后比格子还大，会溢出到下面的空行——`opacity: 0` 看不见，
  但照样参与命中测试，把空行里的按下吃掉，于是「新格子怎么都画不出来」。
- 管理页的缩放**只影响棋盘视图**，不写进 `site.json`（它是一次打开的偏好，不是站点数据）。
- **窄屏重排是渲染时派生的，不落数据。** `repackColumns(site, width)` 返回该档的列数（0 = 不重排），
  调用点把它交给 `packBoard(cells, N)` 重新紧密排一遍，再走同一套棋盘渲染 —— `cell.pos` 一个字节不动，
  服务端不用新增校验，老文档也不用迁移。两条硬约束：
  1. **它只对 `layout: 'board'` 有意义**，函数自己会挡住 flow 文档。不是因为 flow 不需要重排，
     而是因为 `applyGridLayout` 的 board 分支把 `columns` 当**棋盘列数**用 —— 把档位列数喂错地方，
     整块棋盘会被压扁。这条短路就是为此存在的，别绕过它。
  2. **重排只改 grid placement，不重建 DOM**（`replaceChildren` 会让内嵌 iframe 重新加载）。
     跨档切换要保证格子节点还是同一批。
- 阈值是**边界线**，不改变棋盘本身的宽度要求：12 列棋盘要 ~1380px 才放得下，所以 pad 阈值填 1024 时，
  1024–1379px 之间仍是棋盘原样、仍会横滚。这是「电脑端保持构图」的代价，不是 bug。
- **抽屉顶部的预览画的是「这个格子」，不是「这个格子所在的页面」。** 它总是把格子摆在一张
  「正好 `min(w, 列数)` 列宽」的棋盘上（`pos` 临时改成 `{0,0,w,h}`），再整体缩放到抽屉里装得下。
  直接套用真实布局是两个方向都会错的：棋盘文档是 12 列 × 96px = 1460px 挤进 390px 的抽屉、
  格子还停在自己的列上（看起来一片空白）；flow 文档则是宽格子直接撑出框（8 列 × 62px = 566px）。
  间隔按「一格的百分之多少」给（`PREVIEW_REFERENCE` 是主页上的一格宽度），
  并且这个比例是**在铺满尺寸上算的**——布局过程会除掉它再乘 `scale`，两者正好抵消。

## 5. 服务端防线（`server/store.js`）

CSS grid 对显式定位的元素**完全不防重叠**，会心安理得地叠在一起，所以防线有两道：
客户端每次落子前检查，服务端保存时再走一遍。`PUT /api/site`、导入、手改 JSON 都要过 `normalizeDoc`：

- `normalizePos`：四个键都有才认，`w/h` 夹到 `1..min(cols, 12)`，`x/y` 夹进棋盘（`y` 上限 `MAX_ROWS`）。
- `resolveBoard`：按序扫描，位置合法且不撞就保留；越界或撞车的挪到 `firstFreeSpot`，
  打一行 `[store] board repaired: <id> moved to x,y` 日志。**绝不丢格子，且是确定性的**（同样的输入同样的输出）。

改这里时的底线：服务端的结果必须能直接渲染，且再存一次不会再被改动（幂等）。

## 6. 怎么测（无头 Chrome + CDP）

这块全是可以量化的几何，别靠肉眼。本地起服务 + 无头 Chrome，用 CDP 驱动真实界面：

```bash
DATA_DIR=/tmp/gilltz/data PORT=3999 ADMIN_PASSWORD=testpw node server/index.js &
"Google Chrome" --headless=new --remote-debugging-port=9333 --user-data-dir=/tmp/gilltz/profile \
  --window-size=1400,1700 about:blank &
```

几个必须知道的套路和陷阱：

- **每次都开新标签页**：让 DevTools 会话异常结束（进程被杀）会把这个 page target 永久卡住，
  之后 `Runtime.enable` 再也不回消息。用 `PUT /json/new?<url>` 开新的，旧的顺手关掉。
- **自动接受 `confirm()`**：`Page.javascriptDialogOpening` → `Page.handleJavaScriptDialog {accept:true}`，
  否则删格子这类操作会把渲染进程挂死（不是超时，是永远不动）。
- **对着格子中心点，不要对着边缘**：`inset + (unit + 0.5) * pitch`，和页面自己算的一致。
- **窗口要够高**：棋盘往下长，目标行可能在视口外，`elementFromPoint` 会返回 null，
  表现成「按下没反应」，其实是测试的问题。`--window-size` 的高度要放够，或者先 `scrollIntoView`。
- **像素级校验用 `Page.captureScreenshot` 的 `clip` + `scale`**（放大 6 倍看 1px 的线最实在）。
  `getComputedStyle(el, '::before').height/width` 能拿到伪元素的实际尺寸；
  但 `getPropertyValue('--board-h')` 返回的是 `calc(...)` 原文，**不是长度**，别拿去 parseFloat。
- `node --check` 不认 ESM：把 `web/js/*.js` 复制成 `.mjs` 再检查。

值得每次回归的断言：

1. 缩放各档 pitch 与 100% 成正比（`0.5 → 恰好一半`），`--board-w` 同步缩小。
2. 任意缩放下拖动都能吸附到预期坐标（画 3×3 落在 (x,y) 就是 (x,y)）。
3. 行数 = 最低行 + 2；从最后一行继续往外画，画布跟着长；删掉最深的格子会缩回。
4. 格线起点与轨道起点重合（偏差 0）；格线随横向滚动与格子一起动。
5. 保存后 `data/site.json` 里的 `pos` 与界面一致，`resolveBoard` 没有改动任何格子（无 `board repaired` 日志）。
6. 老的 flow 文档（无 `layout`/`pos`）主页渲染不变：间隔 16px、格子尺寸与列数同以前。
7. 窄屏重排：`responsive` 缺省时各宽度**逐像素**和改动前一致（先存指纹再比对）；
   打开后各档 `--cols` 分别是棋盘列数 / pad / 手机，重排的那几档**一律不横向溢出**，
   位置与 `packBoard(cells, N)` 逐格相同，且跨档切换不刷新页面、格子还是同一批 DOM 节点。

## 7. 踩过的坑（症状 → 原因）

| 症状 | 原因 |
| --- | --- |
| 点格子、点 ✏/⧉/✕ 没反应 | pointerdown 就 `setPointerCapture`，随后的 click 被重定向到棋盘 |
| 横向滚动后格子和格线对不上 | 格线画在元素背景上，默认不随内容滚动（曾靠 `background-attachment: local`，现改为伪元素） |
| 列数能调到比最宽的格子还小 | 缺下限：`boardCols()` 取 `max(3, 最宽格子, 设置值)`，选项也要禁用 |
| 抽屉预览永远空白 | `renderPreview` 调了不存在的 `layoutMode()`，一开抽屉就抛异常 |
| 手机上详情面板点不掉 | `.cell:hover` 也能打开详情，而触屏会把点过的元素**一直当成 :hover**（粘住）—— JS 摘掉 `.is-open` 也没用。所有 hover 打开的规则都要放进 `@media (hover: hover)` |
| 预览里看不到格子 / 一片空白 | 预览画的是整块棋盘（12 列 × 96px = 1460px），格子还停在自己的列上，早出框了 |
| 预览里宽格子撑出抽屉 | 同上，flow 版：宽格子按 62px 一格算，8 列 = 566px 撑爆 353px 的框 |
| 指针位置整体偏 7px | `unitAt` 没减棋盘的边框 + 内边距（缩小后 7px 就是小半格） |
| 往下画格子永远失败 | 手势监听挂在棋盘上，第一次移动已经出了棋盘 |
| 缩小后棋盘是缺边的矩形 | 格线只在周期起点画，最后一列的右边、最后一行的下边没有线 |
| 15% 时最后两行点不到 | `min-height` 被 `border-box` 吃掉 14px，元素比格线矮 |
| 缩小后空行里按不动 | 固定 22px 的按钮条溢出格子，隐形但吃掉了点击 |
| 缩放比例不精确（50% 不是一半） | 用缩放后的 gap 去等分，基准跟着漂 |

## 8. 改这块代码之前的检查表

- [ ] 老文档（无 `layout`/`pos`）的渲染路径没被碰到？
- [ ] `dataset.pitch` / `dataset.inset` 与实际渲染一致（任何偏移都要同步进去）？
- [ ] `.admin-board` 还是 `content-box` + `safe center` + `min-height: var(--board-h)`？
- [ ] 格线的尺寸与起点还是轨道本身（`--board-w/h/x/y`）？收边那两层还在？
- [ ] 行数还是「最低行 + 2」，且没有引入上限？
- [ ] 服务端仍然会修复重叠/越界，且绝不丢格子？
- [ ] 窄屏重排还是渲染时派生的（没写数据、没重建 DOM），且档位列数没被喂给 flow？
- [ ] `padColumns` / `phoneColumns` 的 0（不重排）在读的时候活下来了？
- [ ] 上面第 6 节那七条断言都跑过？
