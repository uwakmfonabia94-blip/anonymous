import * as api from '../api.js';
import { timeAgo, toast, openSheet, closeSheet } from '../ui.js';
import { navigate } from '../router.js';

export async function mount(root) {
  root.innerHTML = '';
  const screen = document.getElementById('tpl-me').content.firstElementChild.cloneNode(true);
  root.appendChild(screen);

  const aliasEl    = screen.querySelector('[data-role="alias"]');
  const renameBtn  = screen.querySelector('[data-role="rename"]');
  const notifState = screen.querySelector('[data-role="notif-state"]');
  const postsList  = screen.querySelector('[data-role="my-posts-list"]');
  const postsEmpty = screen.querySelector('[data-role="my-posts-empty"]');

  const profile = await api.getProfile().catch(() => null);
  if (!profile) { toast('Could not load profile.'); return () => {}; }

  aliasEl.textContent = profile.alias;

  const myPosts = await api.listMyPosts().catch(() => []);
  if (myPosts.length) {
    postsList.hidden = false;
    postsEmpty.hidden = true;
    const tpl = document.getElementById('tpl-me-post-row');
    myPosts.forEach(p => {
      const row = tpl.content.firstElementChild.cloneNode(true);
      row.dataset.postId = p.id;
      row.querySelector('.me-post-row__content').textContent = p.content;
      row.querySelector('.me-post-row__time').textContent = timeAgo(p.created_at);
      row.querySelector('.me-post-row__reach').textContent = p.view_count || 0;
      row.addEventListener('click', () => navigate(`/p/${p.id}`));
      postsList.appendChild(row);
    });
  } else {
    postsList.hidden = true;
    postsEmpty.hidden = false;
  }

  renameBtn.addEventListener('click', () => {
    const node = document.getElementById('tpl-rename-sheet').content.firstElementChild.cloneNode(true);
    const form   = node.querySelector('[data-role="form"]');
    const input  = node.querySelector('[data-role="alias"]');
    const submit = node.querySelector('[data-role="submit"]');
    input.value = profile.alias;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const newAlias = input.value.trim();
      if (newAlias === profile.alias) return closeSheet();
      if (newAlias.length < 2 || newAlias.length > 24) return toast('Alias must be 2–24 characters.');
      submit.disabled = true;
      const original = submit.textContent;
      submit.textContent = 'Saving…';
      try {
        const ok = await api.checkAliasAvailable(newAlias);
        if (!ok) { toast('That alias is taken or reserved.'); submit.disabled = false; submit.textContent = original; return; }
        const saved = await api.updateAlias(newAlias);
        aliasEl.textContent = saved;
        profile.alias = saved;
        closeSheet();
        toast(`You're now ${saved}.`);
      } catch (err) {
        const msg = String(err.message || err).toLowerCase();
        if (msg.includes('alias_cooldown')) toast('You can change your alias once per day.');
        else toast('Rename failed.');
        submit.disabled = false;
        submit.textContent = original;
      }
    });
    openSheet(node);
    setTimeout(() => input.focus(), 250);
  });

  screen.querySelector('[data-action="logout"]').addEventListener('click', async () => {
    await api.signOut();
    window.__anon.updateAuthUI();
    navigate('/');
  });

  screen.querySelector('[data-action="delete"]').addEventListener('click', async () => {
    if (!confirm('Delete your account? Your email and profile will be removed, and your posts and replies will be shown as [deleted].')) return;
    if (!confirm('Are you absolutely sure? This cannot be undone.')) return;
    try {
      await api.deleteAccount();
      window.__anon.updateAuthUI();
      toast('Account deleted.');
      navigate('/');
    } catch { toast('Delete failed.'); }
  });

  if (!('Notification' in window) || !('serviceWorker' in navigator)) notifState.textContent = 'Unavailable';
  else if (Notification.permission === 'granted') notifState.textContent = 'On';
  else if (Notification.permission === 'denied') notifState.textContent = 'Blocked';
  else notifState.textContent = 'Off';

  screen.querySelector('[data-action="notifications"]').addEventListener('click', async () => {
    if (!('Notification' in window)) return toast('Notifications not supported.');
    if (Notification.permission === 'denied') return toast('Notifications blocked.');
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { notifState.textContent = 'Off'; return; }
    notifState.textContent = 'On';
    toast('Notifications on.');
  });

  return () => {};
}