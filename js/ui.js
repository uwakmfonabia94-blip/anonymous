export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (v === true) node.setAttribute(k, '');
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function timeAgo(iso) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return 'now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

let toastTimer;
export function toast(message) {
  const root = document.getElementById('toast-root');
  root.innerHTML = '';
  const t = el('div', { class: 'toast' }, message);
  root.appendChild(t);
  requestAnimationFrame(() => t.classList.add('is-visible'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.classList.remove('is-visible');
    setTimeout(() => t.remove(), 200);
  }, 2600);
}

export function openSheet(content) {
  const root = document.getElementById('sheet-root');
  root.innerHTML = '';
  const scrim = el('div', { class: 'scrim', onclick: () => closeSheet() });
  const wrap = el('div', { class: 'sheet-wrap' }, scrim, content);
  root.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add('is-open'));
  document.body.style.overflow = 'hidden';
}

export function closeSheet() {
  const root = document.getElementById('sheet-root');
  const wrap = root.querySelector('.sheet-wrap');
  if (!wrap) return;
  wrap.classList.remove('is-open');
  document.body.style.overflow = '';
  setTimeout(() => { root.innerHTML = ''; }, 200);
}

const COLORS = ['violet', 'cyan', 'amber', 'rose', 'teal', 'indigo'];
const SHAPES = ['circle', 'triangle', 'diamond', 'square', 'pentagon', 'hexagon', 'star', 'moon'];

function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

export function avatarColor(alias) { return COLORS[hash(alias) % COLORS.length]; }
export function avatarShape(alias) { return SHAPES[Math.floor(hash(alias) / COLORS.length) % SHAPES.length]; }

export function renderAvatar(avatarEl, alias, size = 'md') {
  if (!avatarEl) return;
  avatarEl.className = 'avatar';
  if (size === 'sm') avatarEl.classList.add('avatar--sm');
  if (size === 'lg') avatarEl.classList.add('avatar--lg');
  avatarEl.classList.add(`avatar--${avatarColor(alias)}`);
  avatarEl.innerHTML = '';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'avatar__shape');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#sh-${avatarShape(alias)}`);
  svg.appendChild(use);
  avatarEl.appendChild(svg);
}

export async function sharePost(post) {
  const url = `${location.origin}/p/${post.id}`;
  if (navigator.share) {
    try { await navigator.share({ title: 'Anonymous', text: post.content, url }); return; }
    catch {}
  }
  try { await navigator.clipboard.writeText(url); toast('Link copied.'); }
  catch { toast('Share failed.'); }
}

export function haptic(ms = 8) {
  try { navigator.vibrate?.(ms); } catch {}
}

export function shareToWhatsApp(post) {
  const url = `${location.origin}/p/${post.id}`;
  const text = `${post.content}\n\n${url}`;
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  haptic(10);
}

export function formatReach(n) {
  if (n == null) return '0';
  if (n < 1000) return String(n);
  if (n < 10000) return (n / 1000).toFixed(1).replace('.0', '') + 'k';
  return Math.floor(n / 1000) + 'k';
}

// FIXED: never returns an empty string — every branch returns a valid class.
// Previously returned '' for 10-499, which crashed classList.add('').
export function reachClass(n) {
  if (n == null || n < 10) return 'post-card__reach--quiet';
  if (n < 500) return 'post-card__reach--warm';
  return 'post-card__reach--hot';
}