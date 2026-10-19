# vitsrv —— 盒子应用的「虚拟后端」

**vitsrv** 是给**盒子应用**用的一层薄薄的请求库。盒子应用就是嵌在盒子里、点开后全屏展开的
那个 HTML 页面；它和普通网页的区别是：**它的后端不是写死在页面里的**，而是由站主在管理页给
这颗盒子配的 —— 可以是一台远程机器的 `IP:Port`，也可以是一段直接跑在页面里的 JS。

应用只需要认 `vitsrv` 一个接口，不用知道后端到底在哪、是怎么实现的。换后端不用改应用。

```
应用页面（沙箱 iframe）
   │   vitsrv.get('/api/notes')
   ▼
vitsrv ──► remote 模式：fetch  http(s)://ip:port/api/notes   （真实服务器）
       └─► inline 模式：调用配置里的 JS 处理函数             （跑在页面里的「后端」）
```

源码在 [`web/lib/vitsrv.js`](web/lib/vitsrv.js)，站点上的地址是 **`/lib/vitsrv.js`**。
它是**经典脚本**（不是 ES module）：用 `<script src="…">` 直接引入，跨域加载也不需要 CORS。

## 1. 应用怎么用

```html
<!doctype html>
<meta charset="utf-8">
<h1 id="title">笔记</h1>
<ul id="list"></ul>

<!-- 站点上的固定地址；页面如果放在 /pages/ 里，也可以写相对路径 ../lib/vitsrv.js -->
<script src="https://你的站点/lib/vitsrv.js"></script>
<script>
  async function render() {
    const notes = await vitsrv.json('/api/notes');   // 非 2xx 会抛错
    document.getElementById('list').textContent = notes.map((n) => n.text).join(' / ');
  }

  document.getElementById('title').onclick = async () => {
    await vitsrv.post('/api/notes', { text: 'hello' }); // 普通对象自动按 JSON 发
    render();
  };

  render().catch((err) => {
    // code: NO_CONFIG / NO_BACKEND / REMOTE_FAILED / BAD_CONFIG / HTTP_ERROR
    document.getElementById('list').textContent = err.message;
  });
</script>
```

页面**必须自己引入** `vitsrv.js` —— 站主给的只是后端配置，库不会凭空出现在页面里。

### API

| 调用 | 说明 |
| --- | --- |
| `vitsrv.request(options)` | 发一次请求，返回标准 `Response` |
| `vitsrv.get(path, [options])` | 同上，`method: 'GET'` |
| `vitsrv.post/put(path, [body], [options])` | `body` 是普通对象时自动 JSON，并补 `Content-Type: application/json` |
| `vitsrv.del(path, …)` / `vitsrv.delete(…)` | `DELETE` |
| `vitsrv.json(path, [options])` | `get` + 解析 JSON；非 2xx 直接抛错（`err.status` / `err.body`） |
| `vitsrv.ready` | Promise：拿到配置就 resolve（`{ mode }`），失败 reject |
| `vitsrv.mode()` | `'remote'` / `'inline'` / `'none'`；配置还没到时是 `null` |
| `vitsrv.version` | 协议版本（字符串 `'1.0'`） |

`request` 的 options：

```js
{
  method: 'GET',            // 默认 GET
  path: '/api/notes',       // 以 / 开头；不写也行，会自动补
  query: { page: 2 },       // 可选，拼到查询串上
  headers: { … },           // 普通对象或 Headers
  body: { … },              // 对象 → JSON；FormData / URLSearchParams / Blob 原样发
}
```

`GET` / `HEAD` 不发送 body（和 `fetch` 的规则一致）。

## 2. 配置是怎么到应用手里的

应用页面在沙箱 iframe 里（**不透明源**，读不到本站的 cookie，也调不了本站接口），
后端配置由**父页面**在 iframe `load` 之后用 `postMessage` 发进去：

```js
{ type: 'vitsrv:config', version: 1, backend: { mode, url, code } }
```

- 父页面在 iframe **每次 `load`** 之后都发（`none` 也发）；发送点在 `web/js/shared.js` 的
  `createFrame()`。格子的配置通过 `data-vitsrv` 从管理页一路带到 `openFullscreen()`，
  全屏展开时交给 `createFrame()`。
- `vitsrv` **只认 `event.source === window.parent`** 的消息，别的窗口发什么都没用。
- **只认第一份配置**，后来的忽略；iframe 导航到新页面时是新的一份库，会重新等配置。
- 8 秒没等到配置，`ready` 以 `code: 'NO_CONFIG'` 拒绝 —— 页面被单独打开（不是盒子应用）时
  会看到这个错误，而不是永远挂着。
- 配置协议版本对不上时直接忽略，不会用错格式的配置。

## 3. 三种后端模式

管理页 → 选一颗格子 →「嵌入的 HTML」→ **应用后端**。

### 3.1 `none`（默认）

没挂后端。`vitsrv.ready` 立刻以 `{ mode: 'none' }` resolve，`vitsrv.request()` 直接抛
`NO_BACKEND`，页面仍可正常展示。父页面照常投递 `mode: 'none'` 的配置 —— 这样应用不用等超时。

### 3.2 `remote`：一台真实的后端

配一个 `http(s)://IP:Port`（后面可以带路径前缀）。`vitsrv` 把请求原样 `fetch` 过去：

- `credentials: 'omit'`（沙箱页面也带不了凭据）、`mode: 'cors'`、`cache: 'no-store'`；
- 单次请求超时 **15 秒**，超时抛 `REMOTE_FAILED`；
- 后端必须允许跨域 —— 沙箱页面的源是 `null`，所以响应头要有
  `Access-Control-Allow-Origin: *`；
- 发 JSON 的 POST/PUT 会触发 CORS 预检，后端要能回 `OPTIONS`，并带上
  `Access-Control-Allow-Methods` / `Access-Control-Allow-Headers: Content-Type`；
- **站点是 HTTPS 时，后端也必须是 HTTPS**：浏览器会按 Mixed Content 拦掉 HTTPS 页面对
  `http://` 地址的请求（`http://localhost` 例外）。只支持 `http` / `https`，管理页里会校验。

一个够用的后端响应头（Node/Express 写法）：

```js
res.setHeader('Access-Control-Allow-Origin', '*');
res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
if (req.method === 'OPTIONS') return res.writeHead(204).end();
```

### 3.3 `inline`：一段跑在页面里的「后端」

不部署服务器，在管理页里直接写一段 JS。协议很简单：**整段代码要 `return` 一个处理函数**，
收到标准 `Request`，返回 `Response`（或下面几种等价形式）。

```js
// 管理页「内置后端代码」里写：
const notes = [];

return async (req) => {
  const { pathname } = new URL(req.url);

  if (pathname === '/api/notes' && req.method === 'GET') {
    return Response.json(notes);                       // 直接返回 Response
  }
  if (pathname === '/api/notes' && req.method === 'POST') {
    notes.push(await req.json());                      // req.json() 照常可用
    return { status: 201, body: { ok: true } };        // 或者 { status, headers, body }
  }
  return { status: 404, body: { error: 'not found' } };
};
```

处理函数可以返回：

| 返回值 | 结果 |
| --- | --- |
| `Response` | 原样使用 |
| `{ status, headers, body }` | `body` 是对象时自动 JSON（并补 `Content-Type`），`status` 默认 200 |
| 普通对象 / 数组 | 自动 JSON，200 |
| 字符串 | 200 文本 |
| `null` / `undefined` | 204 |

细节：

- `req.url` 的 origin 固定是 `https://vitsrv.local`，**只看 `pathname` / `search`**，别拿 host 做判断。
- `req.method`、`req.headers`、`await req.json()` / `.text()` 都是标准 `Request` 的行为。
- 处理函数抛异常时，`vitsrv` 返回 **500 + JSON**（`{ error: "..." }`），应用不会因此挂掉。
- 代码用 `new Function('vitsrv', code)` 编译，跑在**应用页面自己的沙箱里**：它碰不到本站，
  也读不到 cookie；`vitsrv` 本身作为参数传进去，处理函数里再调 `vitsrv` 也可以。
- 代码写错（没 `return` 函数、语法错误、空代码）时，`ready` 以 `BAD_CONFIG` 拒绝，
  应用里的请求都拿不到结果 —— 管理页保存前不会执行代码，写错了只能看应用控制台。
- 容量上限：**20000 字符**（服务端会截断）。数据只在页面生命周期内存在，刷新就没了；
  要持久化还是得用 `remote` 或页面自己的 `localStorage`。
- 内置后端是**公开的**：任何能打开这个盒子的人都能看到代码。别把密钥写进去。

## 4. 安全边界

- 应用页面一律跑在非 same-origin 的沙箱里（`allow-scripts` 等，**没有** `allow-same-origin`），
  这是 `createFrame()` 一条规矩；vitsrv 没有、也不能绕过它。
- 配置只从 `window.parent` 接收；应用页面无法自行改写后端地址。
- `remote` 是**浏览器直连**后端：后端看到的是用户自己的网络位置，`Origin: null`，没有本站的
  身份与凭据。后端如果要鉴权，得由应用自己携带（例如在请求头里带 token），并且注意 CORS
  响应头不能再是 `*`（带凭据的请求不允许通配源）。
- `inline` 代码和页面同权：它能做的事，页面本来也能做。它不构成额外的信任边界。

## 5. 数据与实现位置

| 位置 | 内容 |
| --- | --- |
| `cell.backend` | `{ mode: 'none' \| 'remote' \| 'inline', url, code }` |
| `server/store.js` | `normalizeBackend()`：mode 只认三个值，url 只收 `http(s)://…`，code 截到 20000 字 |
| `web/js/shared.js` | `createFrame(src, title, backend)` 在 `load` 时投递配置；`createCell` 把配置挂到 `data-vitsrv` |
| `web/js/home.js` | `fullscreenOptions()` 读 `data-vitsrv`，`openFullscreen()` 透传给 `createFrame` |
| `web/js/admin.js` + `web/admin.html` | 抽屉里的「应用后端」：模式 / 地址 / 代码 |
| `web/lib/vitsrv.js` | 这个库本身 |

`url` 和 `code` 在切换模式时都**保留**（和抽屉里「跳转链接 / 嵌入页面」的切换同一个套路），
切回去不用重填。`mode: 'none'` 时两者仍会存下来，只是不生效。

## 6. 已知限制

- **HTTPS 站点不能直连 HTTP 后端**（Mixed Content），远程后端需要 TLS 或反代。
- 远程后端要自己处理 CORS；本站不做代理 —— 加代理等于让站点替任意地址发请求（SSRF），
  真要做也应该只代理「管理页里配置过的地址」，那是另一件事。
- `inline` 代码没有模块、没有 `import`；它是单文件的一段脚本。
- 配置在 iframe 加载后投递一次；应用页面自己跳转到别的页面后，新页面要重新引库、重新等配置
  （父页面每次 `load` 都会发，所以正常导航也能拿到）。
