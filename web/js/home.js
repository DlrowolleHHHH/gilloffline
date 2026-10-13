import { createCell, fetchSite } from './shared.js';

const grid = document.getElementById('grid');

function renderEmpty() {
  const state = document.createElement('div');
  state.className = 'grid-state';
  state.style.gridColumn = '1 / -1';

  const logo = document.createElement('img');
  logo.className = 'grid-state__logo';
  logo.src = '/assets/logo.svg';
  logo.alt = '';

  const text = document.createElement('p');
  text.textContent = '橱窗还是空的，';

  const link = document.createElement('a');
  link.href = '/admin';
  link.textContent = '去管理页添加第一个格子';

  text.append(link);
  state.append(logo, text);
  grid.append(state);
}

function applySite(site) {
  document.title = site.title || 'Gill Offline';
  document.documentElement.style.setProperty('--accent', site.accent || '#7e46b9');

  const subtitle = document.getElementById('subtitle');
  subtitle.textContent = site.subtitle || '';
  subtitle.hidden = !site.subtitle;

  const footer = document.getElementById('footer-text');
  footer.textContent = site.footer || `© ${new Date().getFullYear()} ${site.title || 'Gill Offline'}`;
}

async function boot() {
  try {
    const doc = await fetchSite();
    applySite(doc.site || {});
    grid.replaceChildren();
    if (!doc.cells || doc.cells.length === 0) {
      renderEmpty();
      return;
    }
    grid.append(...doc.cells.map(createCell));
  } catch (err) {
    grid.replaceChildren();
    const state = document.createElement('div');
    state.className = 'grid-state';
    state.style.gridColumn = '1 / -1';
    state.textContent = `内容加载失败：${err.message}`;
    grid.append(state);
  }
}

// Touch devices have no hover: tap a cell once to open its detail panel.
grid.addEventListener('click', (event) => {
  const cell = event.target.closest('.cell');
  if (!cell || !cell.querySelector('.cell__overlay')) return;
  if (window.matchMedia('(hover: none)').matches) {
    if (!cell.classList.contains('is-open')) {
      event.preventDefault();
      document.querySelectorAll('.cell.is-open').forEach((other) => other.classList.remove('is-open'));
      cell.classList.add('is-open');
    }
  }
});

boot();
