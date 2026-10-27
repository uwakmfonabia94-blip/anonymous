import * as api from '../api.js';
import { timeAgo, el, toast, haptic } from '../ui.js';
import { navigate } from '../router.js';

export async function mount(root) {
  root.innerHTML = '';
  const screen = document.getElementById('tpl-activity').content.firstElementChild.cloneNode(true);
  root.appendChild(screen);

  const listEl = screen.querySelector('[data-role="list"]');
  const markReadBar = screen.querySelector('[data-role="mark-read-bar"]');

  let allItems = [];
  let unreadCount = 0;

  try {
    allItems = await api.activityFeed();
  } catch (err) {
    console.error('[activity] load failed:', err);
    listEl.appendChild(el('p', { class: 'activity-empty' }, 'Could not load activity.'));
    return () => {};
  }

  const items = allItems.filter(a => a.type === 'comment' || a.type === 'reply');

  unreadCount = items.filter(a => !a.seen).length;
  updateMarkReadBar();

  if (!items.length) {
    listEl.appendChild(el('p', { class: 'activity-empty' }, 'Nothing yet. Speak and someone may reply.'));
    markReadBar.hidden = true;
    return () => {};
  }

  function updateMarkReadBar() {
    if (unreadCount > 0) {
      markReadBar.hidden = false;
      markReadBar.querySelector('[data-role="unread-count"]').textContent = unreadCount;
    } else {
      markReadBar.hidden = true;
    }
  }

  function dayGroup(dateStr) {
    const d = new Date(dateStr);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diffDays = Math.round((today - target) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return 'This week';
    return 'Earlier';
  }

  const itemTpl = document.getElementById('tpl-activity-item');
  let lastDay = null;

  for (const a of items) {
    const group = dayGroup(a.created_at);
    if (group !== lastDay) {
      lastDay = group;
      const header = document.createElement('li');
      header.className = 'activity-day-header';
      header.textContent = group;
      listEl.appendChild(header);
    }

    const node = itemTpl.content.firstElementChild.cloneNode(true);
    if (!a.seen) node.classList.add('is-unread');

    const titleEl = node.querySelector('.activity-item__title');
    const excerptEl = node.querySelector('.activity-item__excerpt');
    const timeEl = node.querySelector('.activity-item__time');
    const replyBtn = node.querySelector('[data-action="reply-back"]');

    titleEl.textContent = a.type === 'reply' ? 'Someone replied to your comment' : 'Someone replied to your post';
    if (a.reply_text) {
      const cut = a.reply_text.length > 100 ? a.reply_text.slice(0, 97) + '…' : a.reply_text;
      excerptEl.textContent = `"${cut}"`;
    } else if (a.post_excerpt) {
      const cut = a.post_excerpt.length >= 60 ? a.post_excerpt + '…' : a.post_excerpt;
      excerptEl.textContent = `on "${cut}"`;
    }
    timeEl.textContent = timeAgo(a.created_at);

    if (a.comment_id && a.post_id) {
      replyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openReplyBox(node, a);
      });
    } else {
      replyBtn.remove();
    }

    node.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="reply-back"]')) return;
      if (e.target.closest('.activity-reply-box')) return;
      if (a.post_id) navigate(`/p/${a.post_id}`);
    });

    listEl.appendChild(node);
  }

  markReadBar.querySelector('[data-action="mark-read"]').addEventListener('click', async () => {
    try {
      await api.markActivitySeen();
      items.forEach(a => { a.seen = true; });
      unreadCount = 0;
      updateMarkReadBar();
      document.querySelectorAll('.activity-item.is-unread').forEach(n => n.classList.remove('is-unread'));
      window.__anon.refreshBadge();
      toast('All caught up.');
    } catch {
      toast('Failed.');
    }
  });

  return () => {};
}

function openReplyBox(parentNode, activity) {
  if (parentNode.querySelector('.activity-reply-box')) return;

  const box = document.createElement('div');
  box.className = 'activity-reply-box';
  box.innerHTML = `
    <input class="activity-reply-box__input" type="text" placeholder="Reply…" maxlength="300">
    <button class="activity-reply-box__send btn btn--primary btn--icon" type="button" aria-label="Send">
      <svg class="icon icon--20"><use href="#i-arrow-left"/></svg>
    </button>
  `;

  const input = box.querySelector('input');
  const send = box.querySelector('button');

  send.addEventListener('click', async (e) => {
    e.stopPropagation();
    const content = input.value.trim();
    if (!content) return;
    send.disabled = true;
    input.disabled = true;
    try {
      await api.createComment({
        postId: activity.post_id,
        parentId: activity.comment_id,
        content,
      });
      haptic(8);
      toast('Reply sent.');
      box.remove();
    } catch {
      toast('Reply failed.');
      send.disabled = false;
      input.disabled = false;
    }
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); send.click(); }
  });

  parentNode.appendChild(box);
  setTimeout(() => input.focus(), 100);
}