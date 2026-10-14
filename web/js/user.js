/**
 * /user — log in, or register with an invite code.
 *
 * Both paths end the same way: the server hands back the session's subject (a
 * userid, or 'admin' for the site owner) and we walk straight into that account.
 */

const $ = (id) => document.getElementById(id);

async function post(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error || `请求失败（${res.status}）`);
  return payload;
}

const homeFor = (subject) => (subject === 'admin' ? '/admin' : `/?userid=${encodeURIComponent(subject)}`);

/* ------------------------------------------------------------------- views */

function showTab(tab) {
  for (const button of document.querySelectorAll('.auth-tabs button')) {
    button.setAttribute('aria-selected', String(button.dataset.tab === tab));
  }
  $('login-form').hidden = tab !== 'login';
  $('register-form').hidden = tab !== 'register';
  $(tab === 'login' ? 'login-username' : 'reg-username').focus();
}

function showError(id, message) {
  const node = $(id);
  node.textContent = message;
  node.hidden = !message;
}

async function showWelcome(session) {
  $('auth-card').hidden = true;
  $('welcome-card').hidden = false;
  const owner = session.subject === 'admin';
  $('welcome-title').textContent = owner ? '你是站主' : `${session.username}，已经登录`;
  $('welcome-note').textContent = owner
    ? '站主的账号管的是整站：自己的橱窗、用户、邀请码。'
    : '你的橱窗、管理页和创作工具都只操作你自己的数据。';
  const enter = $('welcome-enter');
  enter.href = homeFor(session.subject);
  enter.textContent = owner ? '进入管理页' : '进入我的橱窗';
}

/* ----------------------------------------------------------------- actions */

function bindLogin() {
  $('login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = $('login-submit');
    button.disabled = true;
    showError('login-error', '');
    try {
      const session = await post('/api/login', {
        username: $('login-username').value.trim(),
        password: $('login-password').value,
      });
      location.href = homeFor(session.subject);
    } catch (err) {
      showError('login-error', err.message);
      button.disabled = false;
    }
  });
}

function bindRegister() {
  $('register-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = $('reg-submit');
    button.disabled = true;
    showError('reg-error', '');
    try {
      const session = await post('/api/register', {
        username: $('reg-username').value.trim(),
        password: $('reg-password').value,
        invite: $('reg-invite').value.trim(),
      });
      location.href = homeFor(session.subject);
    } catch (err) {
      showError('reg-error', err.message);
      button.disabled = false;
    }
  });
}

function bindTabs() {
  for (const button of document.querySelectorAll('.auth-tabs button')) {
    button.addEventListener('click', () => showTab(button.dataset.tab));
  }
}

function bindLogout() {
  $('welcome-logout').addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    location.reload();
  });
}

async function boot() {
  bindTabs();
  bindLogin();
  bindRegister();
  bindLogout();
  showTab('login');

  try {
    const res = await fetch('/api/session', { credentials: 'same-origin' });
    const session = await res.json();
    if (session.authenticated) showWelcome(session);
    else $('login-username').focus();
  } catch {
    /* offline: the forms still work, they will surface their own errors */
  }
}

boot();
