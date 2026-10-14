/**
 * The creation tools page: the tool rail, the session indicator, and the login
 * modal the tools borrow when a save runs into an expired session.
 */

import { toast } from './shared.js';
import { fetchSession, login, setLoginPrompt } from './editor-io.js';
import * as textpng from './tool-textpng.js';
import * as pngsvg from './tool-pngsvg.js';

const TOOLS = ['textpng', 'pngsvg'];
const $ = (id) => document.getElementById(id);

/* ---------------------------------------------------------------- tool rail */

function showTool(name) {
  const active = TOOLS.includes(name) ? name : TOOLS[0];
  for (const tool of TOOLS) $(`pane-${tool}`).hidden = tool !== active;
  for (const button of document.querySelectorAll('.tool')) {
    button.setAttribute('aria-selected', String(button.dataset.tool === active));
  }
  if (location.hash.slice(1) !== active) history.replaceState(null, '', `#${active}`);
}

function bindTools() {
  for (const button of document.querySelectorAll('.tool')) {
    button.addEventListener('click', () => showTool(button.dataset.tool));
  }
  showTool(location.hash.slice(1));
}

/* ------------------------------------------------------------------ session */

async function refreshSession() {
  const session = await fetchSession();
  const label = $('session-state');
  if (!session.configured) label.textContent = '服务端没配 ADMIN_PASSWORD，存不了文件';
  else if (session.authenticated) label.textContent = '已登录';
  else label.textContent = '未登录（存文件时会要密码）';
  return session;
}

/* -------------------------------------------------------------- login modal */

const modal = $('login-modal');
const scrim = $('login-scrim');
const password = $('login-password');

function openModal(message) {
  $('login-hint').textContent =
    message || '用部署时设置的 ADMIN_PASSWORD 登录，和管理页同一个密码。';
  modal.hidden = false;
  scrim.hidden = false;
  password.focus();
}

function closeModal() {
  modal.hidden = true;
  scrim.hidden = true;
  password.value = '';
}

/**
 * Resolves true once logged in, false if the user backed out. editor-io uses it
 * as the "session expired" detour around a save.
 */
function askPassword(message) {
  return new Promise((resolve) => {
    const okButton = $('login-ok');
    openModal(message);

    const done = (ok) => {
      okButton.removeEventListener('click', submit);
      $('login-cancel').removeEventListener('click', cancel);
      scrim.removeEventListener('click', cancel);
      password.removeEventListener('keydown', onKey);
      closeModal();
      resolve(ok);
    };

    const cancel = () => done(false);
    const onKey = (event) => {
      if (event.key === 'Enter') submit();
      if (event.key === 'Escape') cancel();
    };
    async function submit() {
      okButton.disabled = true;
      try {
        await login(password.value);
        toast('已登录', 'ok');
        refreshSession();
        done(true);
      } catch (err) {
        $('login-hint').textContent = err.message;
      } finally {
        okButton.disabled = false;
      }
    }

    okButton.addEventListener('click', submit);
    $('login-cancel').addEventListener('click', cancel);
    scrim.addEventListener('click', cancel);
    password.addEventListener('keydown', onKey);
  });
}

/* --------------------------------------------------------------------- boot */

function boot() {
  setLoginPrompt(askPassword);
  bindTools();
  textpng.init();
  pngsvg.init();
  refreshSession();
  // a save that just worked is the freshest word on whether we are logged in
  window.addEventListener('gill:saved', refreshSession);
}

boot();
