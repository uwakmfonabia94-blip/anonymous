import * as api from '../api.js';
import { timeAgo, el } from '../ui.js';
import { navigate } from '../router.js';

export async function mount(root) {
  if (!api.isAuthed()) { window.__anon.openSignup(); return () => {}; }

  root.innerHTML = '';
  const tpl = document.getElementById('tpl-activity');
  const screen = tpl.content.firstElementChild.cloneNode(true);
  root.appendChild(screen);

  const list = screen.querySelector('[data-role="list"]');

  let items = [];
  try {
    items = await api.listActivity();
  } catch (err) {
    console.error(err);
    list.appendChild(el('p', { class: 'empty-state__text' }, 'Could not load activity.'));
    return () => {};
  }

  if (!items.length) {
    list.appendChild(el('p', { class: 'empty-state__text' }, 'Nothing yet. Post something to get replies.'));
    return () => {};
  }

  const postIds = [...new Set(items.map(i => i.post_id).filter(Boolean))];
  let postMap = {};
  if (postIds.length) {
    try {
      const posts = await api.authFetch(`/rest/v1/posts?id=in.(${postIds.map(id => `"${id}"`).join(',')})&select=id,content`);
      postMap = Object.fromEntries(posts.map(p => [p.id, p]));
    } catch {}
  }

  const itemTpl = document.getElementById('tpl-activity-item');
  for (const a of items) {
    const node = itemTpl.content.firstElementChild.cloneNode(true);
    if (!a.seen) node.classList.add('is-unread');

    const iconUse = node.querySelector('.activity-item__icon use');
    if (a.type === 'upvote') iconUse.setAttribute('href', '#i-heart');
    else if (a.type === 'reply') iconUse.setAttribute('href', '#i-message');

    const titleEl = node.querySelector('.activity-item__title');
    const excerptEl = node.querySelector('.activity-item__excerpt');
    const timeEl = node.querySelector('.activity-item__time');

    if (a.type === 'comment') titleEl.textContent = 'Someone replied to your post';
    else if (a.type === 'reply') titleEl.textContent = 'Someone replied to your comment';
    else if (a.type === 'upvote') titleEl.textContent = 'Someone upvoted your post';

    const p = postMap[a.post_id];
    if (p?.content) excerptEl.textContent = `"${p.content.slice(0, 40)}${p.content.length > 40 ? '…' : ''}"`;
    else excerptEl.remove();

    timeEl.textContent = timeAgo(a.created_at);

    node.addEventListener('click', () => {
      if (a.post_id) navigate(`/p/${a.post_id}`);
    });

    list.appendChild(node);
  }

  api.markActivitySeen().then(() => window.__anon.refreshBadge()).catch(() => {});

  return () => {};
}