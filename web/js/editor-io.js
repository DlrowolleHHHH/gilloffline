/**
 * The plumbing both creation tools share: handing a file to the browser, and
 * putting a file into one of the server's data directories — including the
 * "session expired, log in first" detour.
 */

/** Hand a blob to the browser as a download. */
export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** A URL for showing the blob in the page (and a way to free it again). */
export function previewUrl(blob) {
  const url = URL.createObjectURL(blob);
  return { url, release: () => URL.revokeObjectURL(url) };
}

export async function fetchSession() {
  try {
    const res = await fetch('/api/session', { credentials: 'same-origin' });
    return res.ok ? res.json() : { configured: false, authenticated: false };
  } catch {
    return { configured: false, authenticated: false };
  }
}

export async function login(password) {
  const res = await fetch('/api/login', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error || `登录失败（${res.status}）`);
}

/** editor.js installs its modal here, so the tools carry no UI plumbing. */
let askLogin = null;
export function setLoginPrompt(fn) {
  askLogin = fn;
}

async function post(blob, name, kind) {
  const res = await fetch(`/api/files?kind=${encodeURIComponent(kind)}&name=${encodeURIComponent(name)}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': blob.type || 'application/octet-stream' },
    body: blob,
  });
  const payload = await res.json().catch(() => ({}));
  if (res.status === 401) {
    throw Object.assign(new Error(payload.error || '需要先登录'), { needLogin: true });
  }
  if (!res.ok) throw new Error(payload.error || `保存失败（${res.status}）`);
  window.dispatchEvent(new CustomEvent('gill:saved', { detail: payload }));
  return payload; // { url, name, size }
}

/**
 * Upload a blob into `uploads` or `assets`. Same name overwrites, so re-saving
 * is how a file gets updated. An expired session triggers one login attempt.
 */
export async function saveToServer(blob, name, kind) {
  try {
    return await post(blob, name, kind);
  } catch (err) {
    if (!err.needLogin || !askLogin) throw err;
    const ok = await askLogin(err.message);
    if (!ok) throw new Error('没有登录，已取消保存');
    return post(blob, name, kind);
  }
}

/** `text-20261014-1530` — a stable, ASCII-safe default file name. */
export function stampedName(prefix, extension) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `${prefix}-${stamp}.${extension}`;
}
