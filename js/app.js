import * as router from './router.js';
import * as api from './api.js';
import { el, openSheet, closeSheet, toast } from './ui.js';

// ============================================================
// AUTH SHEETS
// ============================================================

export function openSignup() {
  const tpl = document.getElementById('tpl-signup-sheet');
  const node = tpl.content.firstElementChild.cloneNode(true);

  const form   = node.querySelector('[data-role="form"]');
  const alias  = node.querySelector('[data-role="alias"]');
  const email  = node.querySelector('[data-role="email"]');
  const pw     = node.querySelector('[data-role="password"]');
  const invite = node.querySelector('[data-role="invite"]');
  const agree  = node.querySelector('[data-role="agree"]');
  const submit = node.querySelector('[data-role="submit"]');
  const toggle = node.querySelector('[data-action="toggle-password"]');

  const prefilled = new URLSearchParams(location.search).get('invite');
  if (prefilled) invite.value = prefilled;

  agree.addEventListener('change', () => { submit.disabled = !agree.checked; });

  toggle.addEventListener('click', () => {
    const showing = pw.type === 'text';
    pw.type = showing ? 'password' : 'text';
    toggle.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
    toggle.querySelector('use').setAttribute('href', showing ? '#i-eye' : '#i-eye-off');
  });

  form.querySelector('[data-action="switch-login"]').addEventListener('click', (e) => {
    e.preventDefault();
    openLogin();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const wantedAlias = alias.value.trim();
    if (wantedAlias.length < 2 || wantedAlias.length > 24) {
      return toast('Alias must be 2–24 characters.');
    }

    submit.disabled = true;
    const original = submit.textContent;
    submit.textContent = 'Entering…';

    try {
      const inviteOk = await api.checkInviteCode(invite.value.trim());
      if (!inviteOk) {
        toast("That code didn't work.");
        submit.disabled = false; submit.textContent = original;
        return;
      }
      const aliasOk = await api.checkAliasAvailable(wantedAlias);
      if (!aliasOk) {
        toast('That alias is taken or reserved. Try another.');
        submit.disabled = false; submit.textContent = original;
        return;
      }

      await api.signUp({
        alias: wantedAlias,
        email: email.value.trim(),
        password: pw.value,
        inviteCode: invite.value.trim(),
        agreed: agree.checked,
      });
      closeSheet();
      toast(`You're in, ${wantedAlias}.`);
      updateAuthUI();
      refreshBadge();
      router.render();
    } catch (err) {
      const msg = String(err.message || err).toLowerCase();
      if (msg.includes('already')) toast('That email is already registered.');
      else if (msg.includes('invite')) toast("That code didn't work.");
      else if (msg.includes('alias')) toast('That alias is unavailable.');
      else toast('Signup failed. Try again.');
      submit.disabled = false; submit.textContent = original;
    }
  });

  openSheet(node);
  setTimeout(() => alias.focus(), 250);
}

export function openLogin() {
  const tpl = document.getElementById('tpl-login-sheet');
  const node = tpl.content.firstElementChild.cloneNode(true);

  const form   = node.querySelector('[data-role="form"]');
  const email  = node.querySelector('[data-role="email"]');
  const pw     = node.querySelector('[data-role="password"]');
  const submit = node.querySelector('[data-role="submit"]');
  const toggle = node.querySelector('[data-action="toggle-password"]');

  toggle.addEventListener('click', () => {
    const showing = pw.type === 'text';
    pw.type = showing ? 'password' : 'text';
    toggle.querySelector('use').setAttribute('href', showing ? '#i-eye' : '#i-eye-off');
  });

  form.querySelector('[data-action="switch-signup"]').addEventListener('click', (e) => {
    e.preventDefault();
    openSignup();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    submit.disabled = true;
    const original = submit.textContent;
    submit.textContent = 'Signing in…';
    try {
      await api.signIn({ email: email.value.trim(), password: pw.value });
      closeSheet();
      toast('Welcome back.');
      updateAuthUI();
      refreshBadge();
      router.render();
    } catch {
      toast('Incorrect email or password.');
      submit.disabled = false; submit.textContent = original;
    }
  });

  openSheet(node);
  setTimeout(() => email.focus(), 250);
}

// ============================================================
// UI STATE
// ============================================================

export function updateAuthUI() {
  const btn = document.getElementById('header-join');
  if (btn) btn.hidden = api.isAuthed();
}

async function refreshBadge() {
  const badge = document.getElementById('nav-badge');
  if (!api.isAuthed()) { if (badge) badge.hidden = true; return; }
  try {
    const n = await api.getUnreadCount();
    if (badge) {
      if (n > 0) {
        badge.textContent = n > 9 ? '9+' : n;
        badge.hidden = false;
      } else {
        badge.hidden = true;
      }
    }
  } catch {}
}

// ============================================================
// LANDING PAGE (guest gate)
// ============================================================

function renderLanding() {
  document.body.classList.add('on-landing');
  const root = document.getElementById('view-root');
  root.innerHTML = '';
  const tpl = document.getElementById('tpl-landing');
  if (!tpl) return;
  const screen = tpl.content.firstElementChild.cloneNode(true);
  root.appendChild(screen);
}

function guestGate() {
  if (api.isAuthed()) return false;

  const path = location.pathname;
  const pParam = new URLSearchParams(location.search).get('p');

  // Shared post link arriving via ?p=ID → rewrite to /p/ID, show the post
  if (pParam) {
    history.replaceState({}, '', `/p/${pParam}`);
    return false;
  }

  // Shared post URL — guest can read
  if (path.startsWith('/p/')) return false;

  // Public legal/FAQ pages — guest can read
  if (path === '/faq' || path === '/guidelines' || path === '/privacy') return false;

  // Everything else → landing
  renderLanding();
  return true;
}

// ============================================================
// GLOBAL CLICK DELEGATION
// ============================================================

document.addEventListener('click', (e) => {
  const join = e.target.closest('[data-action="join"]');
  if (join) { e.preventDefault(); openSignup(); return; }

  const login = e.target.closest('[data-action="login"]');
  if (login) { e.preventDefault(); openLogin(); return; }

  const compose = e.target.closest('[data-action="compose"]');
  if (compose) {
    e.preventDefault();
    if (!api.isAuthed()) return openSignup();
    router.navigate('/compose');
    return;
  }
});

// ============================================================
// ROUTES
// ============================================================

router.register('/',          async () => import('./views/feed.js'));
router.register('/p/:id',     async () => import('./views/post.js'));
router.register('/compose',   async () => import('./views/compose.js'));
router.register('/activity',  async () => import('./views/activity.js'));
router.register('/me',        async () => import('./views/me.js'));
router.register('/discover',  async () => import('./views/discover.js'));
router.register('/faq',       async () => import('./views/page.js'));

// ============================================================
// BOOT
// ============================================================

window.__anon = { openSignup, openLogin, updateAuthUI, refreshBadge };

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

router.setGuard(guestGate);
updateAuthUI();
router.init();

setInterval(refreshBadge, 60_000);
setTimeout(refreshBadge, 500);

// ============================================================
// COOKIE BANNER
// ============================================================

(function cookieBanner() {
  if (localStorage.getItem('anon.cookies_ok')) return;
  const banner = document.getElementById('cookie-banner');
  if (!banner) return;
  const btn = banner.querySelector('[data-action="accept-cookies"]');
  setTimeout(() => { banner.hidden = false; }, 1200);
  if (btn) {
    btn.addEventListener('click', () => {
      localStorage.setItem('anon.cookies_ok', '1');
      banner.hidden = true;
    });
  }
})();