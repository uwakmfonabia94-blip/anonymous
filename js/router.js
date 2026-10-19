const routes = new Map();
let currentCleanup = null;

export function register(path, loader) {
  const keys = [];
  const re = path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; });
  routes.set(path, { loader, re: new RegExp(`^${re}$`), keys });
}

function match(path) {
  for (const { loader, re, keys } of routes.values()) {
    const m = path.match(re);
    if (m) {
      const params = {};
      keys.forEach((k, i) => params[k] = decodeURIComponent(m[i + 1]));
      return { loader, params };
    }
  }
  return null;
}

export async function navigate(path, { replace = false } = {}) {
  if (path === location.pathname + location.search) return;
  if (replace) history.replaceState({}, '', path);
  else history.pushState({}, '', path);
  await render();
}

export async function render() {
  const path = location.pathname;
  const m = match(path);
  if (currentCleanup) { try { currentCleanup(); } catch {} currentCleanup = null; }

  const root = document.getElementById('view-root');
  if (!m) { location.replace('/'); return; }

  document.body.classList.toggle('on-compose', path === '/compose');
  document.querySelectorAll('.bottom-nav__item').forEach(el => el.classList.remove('is-active'));
  const routeName = path === '/' ? 'home' : path.split('/')[1];
  const activeItem = document.querySelector(`.bottom-nav__item[data-route="${routeName}"]`);
  if (activeItem) activeItem.classList.add('is-active');

  try {
    const mod = await m.loader();
    currentCleanup = await mod.mount(root, m.params);
  } catch (err) {
    console.error('mount failed', err);
    root.innerHTML = '<p style="padding:24px;color:#F59E0B">Something went wrong.</p>';
  }
}

export function init() {
  window.addEventListener('popstate', render);
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href || !href.startsWith('/') || href.startsWith('//')) return;
    if (a.target === '_blank') return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    // let real HTML pages (guidelines/privacy) load normally
    if (href === '/guidelines' || href === '/privacy' || href === '/faq' && false) return;
    e.preventDefault();
    navigate(href);
  });
  render();
}