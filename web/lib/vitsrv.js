/**
 * vitsrv —— 盒子应用的「虚拟后端」。
 *
 * 盒子应用就是嵌在盒子里的一个 HTML 页面（沙箱 iframe）。它想跟后端说话时，
 * **不直接连后端**，而是通过这个库：
 *
 *   <script src="/lib/vitsrv.js"></script>
 *   <script>
 *     const res = await vitsrv.get('/api/hello');
 *     console.log(await res.json());
 *   </script>
 *
 * vitsrv 加载后向父页面要「这个盒子的后端配置」（postMessage），然后按配置把请求
 * 交给两条完全不同的路，对应用来说长得一样：
 *
 *   · remote —— 一段真实的后端服务，配置里是 http(s)://ip:port；vitsrv 把请求
 *     原样 fetch 过去（要求对方允许跨域：沙箱页面的 Origin 是 null）。
 *   · inline —— 没有真实服务器，配置里是一段 JS 代码；vitsrv 把它编译成一个
 *     处理函数，请求直接在这个函数里完成（相当于「跑在页面里的后端」）。
 *   · none   —— 没挂后端，请求会被拒绝。
 *
 * 为什么不让应用自己连后端：应用不知道后端地址（由站主配置），换后端不用改应用；
 * inline 模式更是只有通过 vitsrv 才能跑到。
 *
 * 这个文件是**经典脚本**（不是 module）：外部页面用 <script src="…"> 直接引入，
 * 不需要 CORS 预检。挂到全局：window.vitsrv。
 */
(function (global) {
  'use strict';

  /** 配置协议版本，和父页面（web/js/shared.js 的 createFrame）约定好。 */
  const PROTOCOL = 1;
  /** 等父页面发配置的最长时间：正常情况是 iframe load 之后立刻就来。 */
  const READY_TIMEOUT = 8000;
  /** remote 模式单次请求的超时。 */
  const REQUEST_TIMEOUT = 15000;
  /** inline 模式里伪造的请求地址：处理函数只看 path，不看 host。 */
  const LOCAL_ORIGIN = 'https://vitsrv.local';
  const MODES = ['none', 'remote', 'inline'];

  const makeError = (message, code, cause) => {
    const error = new Error(message);
    error.code = code;
    if (cause) error.cause = cause;
    return error;
  };

  let backend = null; // { mode, url, code }
  let handler = null; // inline 模式编译出来的处理函数
  let configError = null; // 配置有问题（格式不对 / 代码编译失败）
  let settleReady;
  const ready = new Promise((resolve, reject) => {
    settleReady = { resolve, reject };
  });
  // 没人 await 它的时候，别在控制台刷 UnhandledRejection
  ready.catch(() => {});

  /* -------------------------------------------------------------- 配置 */

  /**
   * 父页面发来的配置。只认 window.parent 发来的（event.source），
   * 别的窗口能发消息但改不了我们的后端。
   */
  global.addEventListener('message', (event) => {
    if (event.source !== global.parent) return;
    const data = event.data;
    if (!data || typeof data !== 'object' || data.type !== 'vitsrv:config' || data.version !== PROTOCOL) return;
    acceptConfig(data.backend);
  });

  function acceptConfig(raw) {
    if (backend) return; // 只认第一份，后来的忽略
    const src = raw && typeof raw === 'object' ? raw : {};
    const mode = MODES.includes(src.mode) ? src.mode : 'none';
    backend = {
      mode,
      url: typeof src.url === 'string' ? src.url : '',
      code: typeof src.code === 'string' ? src.code : '',
    };

    if (mode === 'inline') {
      try {
        handler = compileHandler(backend.code);
      } catch (err) {
        configError = makeError(`内置后端的代码没能编译：${err.message}`, 'BAD_CONFIG', err);
        settleReady.reject(configError);
        return;
      }
    }
    settleReady.resolve({ mode });
  }

  /**
   * 配置里的代码是一段**要 return 处理函数**的脚本：
   *
   *   return async (req) => {
   *     if (new URL(req.url).pathname === '/hello') return Response.json({ hello: 'world' });
   *     return new Response('not found', { status: 404 });
   *   };
   *
   * 用 new Function 而不是 eval：代码跑在自己的作用域里，也拿不到闭包里的东西；
   * 把 vitsrv 本身传进去，处理函数里想再调 vitsrv 也可以。
   */
  function compileHandler(code) {
    if (!code.trim()) throw new Error('代码是空的');
    const factory = new Function('vitsrv', `'use strict';\n${code}`);
    const fn = factory(api);
    if (typeof fn !== 'function') {
      throw new Error('代码要 return 一个处理函数，例如：return async (req) => new Response("ok")');
    }
    return fn;
  }

  /* -------------------------------------------------------------- 请求 */

  /**
   * 发一次后端请求，返回一个标准的 Response（和 fetch 一样）。
   *
   * options:
   *   method  'GET'（默认）
   *   path    '/api/hello'（可以带查询串）
   *   query   { name: 'x' }（可选，和 path 里的合并）
   *   headers { …}
   *   body    string / FormData / URLSearchParams / 普通对象（自动转 JSON）
   */
  async function request(options = {}) {
    await ready; // 等配置；等不到就抛（见 READY_TIMEOUT）
    // 配置本身（含 url / code）留在闭包里，ready 只对外给 { mode }
    const method = String(options.method || 'GET').toUpperCase();
    const path = buildPath(options.path, options.query);
    const headers = new Headers(options.headers || {});
    let body = options.body;

    if (body != null && typeof body === 'object' && !(body instanceof FormData) && !(body instanceof URLSearchParams)
      && !(body instanceof Blob) && !(body instanceof ArrayBuffer)) {
      // 普通对象按 JSON 发，省得每个应用自己 JSON.stringify
      if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
      body = JSON.stringify(body);
    }
    // GET / HEAD 不允许带 body
    if (method === 'GET' || method === 'HEAD') body = undefined;

    if (backend.mode === 'remote') return remoteRequest(backend.url, { method, path, headers, body });
    if (backend.mode === 'inline') return inlineRequest({ method, path, headers, body });
    throw makeError('这个盒子没有挂载后端。', 'NO_BACKEND');
  }

  function buildPath(path, query) {
    let value = typeof path === 'string' && path ? path : '/';
    if (!value.startsWith('/')) value = `/${value}`;
    if (query && typeof query === 'object') {
      const params = new URLSearchParams();
      for (const [key, item] of Object.entries(query)) {
        if (item != null) params.append(key, String(item));
      }
      const extra = params.toString();
      if (extra) value += (value.includes('?') ? '&' : '?') + extra;
    }
    return value;
  }

  async function remoteRequest(base, { method, path, headers, body }) {
    const url = base.replace(/\/+$/, '') + path;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    try {
      return await fetch(url, {
        method,
        headers,
        body,
        signal: controller.signal,
        // 沙箱页面是不透明源，发不出凭据也用不上
        credentials: 'omit',
        mode: 'cors',
        cache: 'no-store',
      });
    } catch (err) {
      const reason = err && err.name === 'AbortError' ? `超时（${REQUEST_TIMEOUT / 1000} 秒）` : err.message;
      throw makeError(
        `请求后端失败：${reason}。后端要允许跨域（响应头 Access-Control-Allow-Origin: *）。`,
        'REMOTE_FAILED',
        err
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async function inlineRequest({ method, path, headers, body }) {
    if (!handler) throw makeError('内置后端没有就绪。', 'NO_BACKEND');
    const url = new URL(path, LOCAL_ORIGIN);
    let result;
    try {
      // 处理函数拿到的是标准 Request：req.method / req.url / await req.json()
      const request = new Request(url, { method, headers, body: body == null ? undefined : body });
      result = await handler(request);
    } catch (err) {
      console.error('[vitsrv] 内置后端抛错：', err);
      return new Response(JSON.stringify({ error: String((err && err.message) || err) }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return toResponse(result);
  }

  /** 处理函数可以返回 Response、{ status, headers, body }、对象或字符串。 */
  function toResponse(result) {
    if (result instanceof Response) return result;
    if (result == null) return new Response(null, { status: 204 });
    if (typeof result === 'object' && ('status' in result || 'body' in result || 'headers' in result)) {
      const body = result.body;
      const headers = new Headers(result.headers || {});
      if (body != null && typeof body === 'object' && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }
      return new Response(
        body == null ? null : typeof body === 'object' && !(body instanceof Blob) ? JSON.stringify(body) : body,
        { status: result.status || 200, headers }
      );
    }
    if (typeof result === 'object') {
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(String(result), { status: 200 });
  }

  /* -------------------------------------------------------------- 对外 */

  const withMethod = (method) => (path, bodyOrOptions, maybeOptions) => {
    // post/put 允许省略 body：vitsrv.post(path, options)
    const isOptionsOnly = bodyOrOptions && typeof bodyOrOptions === 'object'
      && !(bodyOrOptions instanceof FormData) && !(bodyOrOptions instanceof URLSearchParams)
      && ('headers' in bodyOrOptions || 'query' in bodyOrOptions) && maybeOptions === undefined;
    const options = isOptionsOnly ? { ...bodyOrOptions } : { ...(maybeOptions || {}) };
    return request({ ...options, method, path, body: isOptionsOnly ? undefined : bodyOrOptions });
  };

  const api = {
    /** 协议版本，应用可以用它判断库是不是新的。 */
    version: '1.0',

    /** 配置到手（或失败）就 resolve / reject；应用可以 await 它做启动逻辑。 */
    ready,

    /** 当前后端模式：'remote' / 'inline' / 'none'；还没拿到配置时是 null。 */
    mode: () => (backend ? backend.mode : null),

    request,

    get: withMethod('GET'),
    post: withMethod('POST'),
    put: withMethod('PUT'),
    del: withMethod('DELETE'),
    delete: withMethod('DELETE'),

    /** get + 解析 JSON；非 2xx 直接抛错（带 status / body）。 */
    async json(path, options = {}) {
      const response = await api.get(path, options);
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        const error = makeError(`后端返回 ${response.status}`, 'HTTP_ERROR');
        error.status = response.status;
        error.body = text;
        throw error;
      }
      return response.json();
    },
  };

  // 等不到配置（比如页面被单独打开、不是盒子应用）也要给个明确的结果
  setTimeout(() => {
    if (!backend && !configError) {
      configError = makeError(
        `没有收到盒子配置（等了 ${READY_TIMEOUT / 1000} 秒）。这个页面要作为盒子应用打开，才有后端可用。`,
        'NO_CONFIG'
      );
      settleReady.reject(configError);
    }
  }, READY_TIMEOUT);

  global.vitsrv = api;
})(window);
