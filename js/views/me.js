import * as api from '../api.js';
import { renderAvatar, toast, openSheet, closeSheet } from '../ui.js';
import { navigate } from '../router.js';

export async function mount(root) {
  if (!api.isAuthed()) { window.__anon.openSignup(); return () => {}; }

  root.innerHTML = '';
  const screen = document.getElementById('tpl-me').content.firstElementChild.cloneNode(true);
  root.appendChild(screen);

  const aliasEl      = screen.querySelector('[data-role="alias"]');
  const sinceEl      = screen.querySelector('[data-role="since"]');
  const avatarEl     = screen.querySelector('[data-role="avatar"]');
  const renameBtn    = screen.querySelector('[data-role="rename"]');
  const notifState   = screen.querySelector('[data-role="notif-state"]');

  // ---- Parallel data fetch ----
  const [profile, weekly, best, goal, milestones] = await Promise.all([
    api.getProfile().catch(() => null),
    api.myStatsThisWeek().catch(() => null),
    api.myBestPost().catch(() => null),
    api.campusGoalProgress().catch(() => null),
    api.myMilestones().catch(() => []),
  ]);

  if (!profile) {
    toast('Could not load profile.');
    return () => {};
  }

  // ---- Identity ----
  aliasEl.textContent = profile.alias;
  renderAvatar(avatarEl, profile.alias, 'lg');
  const since = new Date(profile.created_at);
  sinceEl.textContent = `Anonymous since ${since.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}`;

  // ---- This week ----
  const weeklyEl = screen.querySelector('[data-role="weekly"]');
  if (weekly && (weekly.posts_this_week > 0 || weekly.likes_received_this_week > 0 || weekly.total_reach > 0)) {
    weeklyEl.hidden = false;
    screen.querySelector('[data-role="weekly-posts"]').textContent = weekly.posts_this_week || 0;
    screen.querySelector('[data-role="weekly-likes"]').textContent = weekly.likes_received_this_week || 0;
    screen.querySelector('[data-role="weekly-reach"]').textContent = formatNum(weekly.total_reach || 0);
  }

  // ---- Best post ----
  const bestEl = screen.querySelector('[data-role="best-post"]');
  if (best && best.id) {
    bestEl.hidden = false;
    const quote = best.content.length > 140 ? best.content.slice(0, 137) + '…' : best.content;
    screen.querySelector('[data-role="best-post-quote"]').textContent = `"${quote}"`;
    screen.querySelector('[data-role="best-post-likes"]').textContent = best.upvote_count || 0;
    screen.querySelector('[data-role="best-post-comments"]').textContent = best.comment_count || 0;
    screen.querySelector('[data-role="best-post-reach"]').textContent = formatNum(best.view_count || 0);
    screen.querySelector('[data-role="best-post-card"]').addEventListener('click', () => {
      navigate(`/p/${best.id}`);
    });
  }

  // ---- Campus goal ----
  const goalEl = screen.querySelector('[data-role="campus-goal"]');
  if (goal && goal.target) {
    goalEl.hidden = false;
    const joined = goal.joined || 0;
    const target = goal.target || 500;
    const pct = Math.min(100, Math.round((joined / target) * 100));
    screen.querySelector('[data-role="goal-joined"]').textContent = joined;
    screen.querySelector('[data-role="goal-target"]').textContent = target;
    screen.querySelector('[data-role="goal-fill"]').style.width = `${pct}%`;
  }
  screen.querySelector('[data-action="share-app"]').addEventListener('click', () => {
    const url = location.origin;
    const text = `Join me on Anonymous — anonymous campus feed. Use CAMPUS-ONE: ${url}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  });

  // ---- Milestones ----
  const milestonesEl = screen.querySelector('[data-role="milestones"]');
  const listEl       = screen.querySelector('[data-role="milestones-list"]');
  if (Array.isArray(milestones) && milestones.length) {
    milestonesEl.hidden = false;
    const tpl = document.getElementById('tpl-milestone-item');
    milestones.forEach(m => {
      const node = tpl.content.firstElementChild.cloneNode(true);
      node.querySelector('.milestone__label').textContent = m.label;
      if (m.achieved) {
        node.classList.add('is-achieved');
        node.querySelector('.milestone__progress').textContent = '';
      } else {
        node.querySelector('.milestone__progress').textContent = `${m.progress || 0}/${m.target}`;
      }
      listEl.appendChild(node);
    });
  }

  // ---- Rename ----
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

  // ---- Logout ----
  screen.querySelector('[data-action="logout"]').addEventListener('click', async () => {
    await api.signOut();
    window.__anon.updateAuthUI();
    navigate('/');
  });

  // ---- Delete ----
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

  // ---- Notifications ----
  if (!('Notification' in window) || !('serviceWorker' in navigator)) notifState.textContent = 'Unavailable';
  else if (Notification.permission === 'granted') notifState.textContent = 'On';
  else if (Notification.permission === 'denied') notifState.textContent = 'Blocked';
  else notifState.textContent = 'Off';

  screen.querySelector('[data-action="notifications"]').addEventListener('click', async () => {
    if (!('Notification' in window)) return toast('Notifications not supported.');
    if (Notification.permission === 'denied') return toast('Notifications blocked in browser settings.');
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { toast('Notifications declined.'); notifState.textContent = 'Off'; return; }
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array('YOUR_VAPID_PUBLIC_KEY'),
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

function formatNum(n) {
  if (n < 1000) return String(n);
  if (n < 10000) return (n / 1000).toFixed(1).replace('.0', '') + 'k';
  return Math.floor(n / 1000) + 'k';
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}