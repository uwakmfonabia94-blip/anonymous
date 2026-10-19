import * as api from '../api.js';
import { renderAvatar, toast, openSheet, closeSheet } from '../ui.js';
import { navigate } from '../router.js';

export async function mount(root) {
  if (!api.isAuthed()) { window.__anon.openSignup(); return () => {}; }

  root.innerHTML = '';
  const tpl = document.getElementById('tpl-me');
  const screen = tpl.content.firstElementChild.cloneNode(true);
  root.appendChild(screen);

  const aliasEl      = screen.querySelector('[data-role="alias"]');
  const sinceEl      = screen.querySelector('[data-role="since"]');
  const avatarEl     = screen.querySelector('[data-role="avatar"]');
  const renameBtn    = screen.querySelector('[data-role="rename"]');
  const postCount    = screen.querySelector('[data-role="post-count"]');
  const commentCount = screen.querySelector('[data-role="comment-count"]');
  const notifState   = screen.querySelector('[data-role="notif-state"]');

  let profile;
  try { profile = await api.getProfile(); }
  catch { toast('Could not load profile.'); return () => {}; }
  if (!profile) return () => {};

  aliasEl.textContent = profile.alias;
  renderAvatar(avatarEl, profile.alias, 'lg');

  const since = new Date(profile.created_at);
  sinceEl.textContent = `Anonymous since ${since.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}`;

  api.countMyPosts().then(n => postCount.textContent = n).catch(() => {});
  api.countMyComments().then(n => commentCount.textContent = n).catch(() => {});

  // ----- Change name -----
  renameBtn.addEventListener('click', () => {
    const tpl = document.getElementById('tpl-rename-sheet');
    const node = tpl.content.firstElementChild.cloneNode(true);
    const form   = node.querySelector('[data-role="form"]');
    const input  = node.querySelector('[data-role="alias"]');
    const submit = node.querySelector('[data-role="submit"]');

    input.value = profile.alias;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const newAlias = input.value.trim();
      if (newAlias === profile.alias) return closeSheet();
      if (newAlias.length < 2 || newAlias.length > 24) return toast('Name must be 2–24 characters.');

      submit.disabled = true;
      const original = submit.textContent;
      submit.textContent = 'Saving…';
      try {
        const ok = await api.checkAliasAvailable(newAlias);
        if (!ok) {
          toast('That name is taken or reserved.');
          submit.disabled = false; submit.textContent = original;
          return;
        }
        const saved = await api.updateAlias(newAlias);
        aliasEl.textContent = saved;
        renderAvatar(avatarEl, saved, 'lg');
        profile.alias = saved;
        closeSheet();
        toast(`You're now ${saved}.`);
      } catch (err) {
        const msg = String(err.message || err).toLowerCase();
        if (msg.includes('alias_cooldown')) toast('You can change your name once per day.');
        else if (msg.includes('duplicate')) toast('That name is taken.');
        else if (msg.includes('reserved')) toast('That name is reserved.');
        else toast('Rename failed.');
        submit.disabled = false;
        submit.textContent = original;
      }
    });

    openSheet(node);
    setTimeout(() => input.focus(), 250);
  });

  // ----- Log out -----
  screen.querySelector('[data-action="logout"]').addEventListener('click', async () => {
    await api.signOut();
    window.__anon.updateAuthUI();
    navigate('/');
  });

  // ----- Delete account -----
  screen.querySelector('[data-action="delete"]').addEventListener('click', async () => {
    if (!confirm('Delete your account? Your email and profile will be removed, and your posts and replies will be shown as [deleted].')) return;
    if (!confirm('Are you absolutely sure? This cannot be undone.')) return;
    try {
      await api.deleteAccount();
      window.__anon.updateAuthUI();
      toast('Account deleted.');
      navigate('/');
    } catch (err) {
      console.error(err);
      toast('Delete failed. Try again.');
    }
  });

  // ----- Stats clicks -----
  screen.querySelector('[data-action="my-posts"]').addEventListener('click', () => toast('Your posts are shown on the feed.'));
  screen.querySelector('[data-action="my-replies"]').addEventListener('click', () => toast('Your replies are shown on their posts.'));

  // ----- Notifications -----
  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    notifState.textContent = 'Unavailable';
  } else if (Notification.permission === 'granted') {
    notifState.textContent = 'On';
  } else if (Notification.permission === 'denied') {
    notifState.textContent = 'Blocked';
  } else {
    notifState.textContent = 'Off';
  }

  screen.querySelector('[data-action="notifications"]').addEventListener('click', async () => {
    if (!('Notification' in window)) return toast('Notifications not supported.');
    if (Notification.permission === 'denied') return toast('Notifications blocked in browser settings.');

    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { toast('Notifications declined.'); notifState.textContent = 'Off'; return; }

    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array('sb_publishable_Xx5XhDyo6bDZ1Edahrw3Ug_T86ChpUW'),
      });
      await api.savePushSubscription(sub.toJSON());
      notifState.textContent = 'On';
      toast('Notifications on.');
    } catch (err) {
      console.error(err);
      notifState.textContent = 'Off';
      toast('Could not enable notifications.');
    }
  });

  return () => {};
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}