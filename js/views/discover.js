import * as api from '../api.js';
import { timeAgo, renderAvatar, el, toast, sharePost, shareToWhatsApp, haptic,
         formatReach, reachClass } from '../ui.js';
import { navigate } from '../router.js';

export async function mount(root) {
  root.innerHTML = '';
  const screen = document.getElementById('tpl-discover').content.firstElementChild.cloneNode(true);
  root.appendChild(screen);

  const chips = screen.querySelectorAll('.chip');
  const feed  = screen.querySelector('[data-role="feed"]');
  let category = null;

  async function load() {
    feed.innerHTML = '';
    const skel = document.getElementById('tpl-skeleton-card');
    for (let i = 0; i < 3; i++) feed.appendChild(skel.content.firstElementChild.cloneNode(true));

    try {
      const posts = await api.listFeed({ limit: 30, category });
      feed.innerHTML = '';
      if (!posts.length) {
        feed.appendChild(el('p', { class: 'empty-state__text' }, 'Nothing here yet.'));
        return;
      }

      let myVotes = new Set();
      if (api.isAuthed()) {
        try {
          const v = await api.getMyVotes(posts.map(p => p.id));
          myVotes = new Set(v.map(r => r.post_id));
        } catch {}
      }
      const myUid = api.isAuthed() ? api.getSession()?.user_id : null;

      for (const post of posts) {
        feed.appendChild(renderCard(post, { myVotes, myUid }));
      }
    } catch (err) {
      console.error(err);
      feed.innerHTML = '';
      feed.appendChild(el('p', { class: 'empty-state__text' }, 'Could not load.'));
    }
  }

  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      chips.forEach(c => c.classList.remove('chip--active'));
      chip.classList.add('chip--active');
      category = chip.dataset.cat || null;
      load();
    });
  });

  await load();
  return () => {};
}

function renderCard(post, { myVotes, myUid }) {
  const isPoll = post.type === 'poll';
  const tplId = isPoll ? 'tpl-poll-card' : 'tpl-post-card';
  const card = document.getElementById(tplId).content.firstElementChild.cloneNode(true);
  card.dataset.postId = post.id;

  renderAvatar(card.querySelector('.avatar'), post.author_alias);
  card.querySelector('.post-card__alias').textContent = post.author_alias;
  card.querySelector('.post-card__time').textContent = timeAgo(post.created_at);
  if (post.category && post.category !== 'General') {
    card.querySelector('.post-card__category-dot').hidden = false;
    const cat = card.querySelector('.post-card__category');
    cat.hidden = false;
    cat.textContent = `#${post.category}`;
  }
  card.querySelector('.post-card__body').textContent = post.content;

  const teaser = card.querySelector('.post-card__teaser');
  if (teaser && post.top_comment_text) {
    teaser.hidden = false;
    teaser.querySelector('.post-card__teaser__author').textContent =
      post.top_comment_alias ? `${post.top_comment_alias}:` : '';
    teaser.querySelector('.post-card__teaser__text').textContent =
      post.top_comment_text.length > 120 ? post.top_comment_text.slice(0, 117) + '…' : post.top_comment_text;
  }

  const stats = card.querySelector('.post-card__stats');
  const reach = post.view_count || 0;
  if (stats && reach > 0) {
    stats.hidden = false;
    const cls = reachClass(reach);
    if (cls) stats.classList.add(cls);
    const reachIcon = stats.querySelector('.post-card__reach-icon use');
    if (reachIcon) {
      reachIcon.setAttribute('href', reach >= 500 ? '#i-flame' : '#i-eye');
    }
    const reachEl = stats.querySelector('.post-card__reach');
    if (reachEl) reachEl.textContent = formatReach(reach);
  }

  if (isPoll && post.poll_data) {
    renderPoll(card.querySelector('[data-role="poll"]'), post.poll_data, post);
  }

  const [voteBtn, commentBtn, shareBtn, waBtn] = card.querySelectorAll('.post-card__action');
  voteBtn.querySelector('.post-card__count').textContent = post.upvote_count ?? 0;
  commentBtn.querySelector('.post-card__count').textContent = post.comment_count ?? 0;
  if (myVotes?.has(post.id)) voteBtn.classList.add('is-liked');

  let voting = false;
  voteBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (voting) return;
    if (!api.isAuthed()) return window.__anon.openSignup();
    voting = true;
    haptic(6);
    const wasVoted = myVotes.has(post.id);
    voteBtn.classList.toggle('is-liked');
    const c = voteBtn.querySelector('.post-card__count');
    c.textContent = Number(c.textContent) + (wasVoted ? -1 : 1);
    try {
      await api.toggleVote(post.id, wasVoted);
      if (wasVoted) myVotes.delete(post.id); else myVotes.add(post.id);
    } catch {
      voteBtn.classList.toggle('is-liked');
      c.textContent = Number(c.textContent) + (wasVoted ? 1 : -1);
      toast('Vote failed.');
    } finally { voting = false; }
  });

  const go = () => navigate(`/p/${post.id}`);
  commentBtn.addEventListener('click', go);
  if (!isPoll) card.querySelector('.post-card__body').addEventListener('click', go);
  shareBtn.addEventListener('click', (e) => { e.stopPropagation(); sharePost(post); });
  if (waBtn) waBtn.addEventListener('click', (e) => { e.stopPropagation(); shareToWhatsApp(post); });

  return card;
}

function renderPoll(box, data, post) {
  if (!box || !data) return;
  box.innerHTML = '';
  const options = data.options || [];
  const total = data.total_votes || 0;
  const mine = data.my_option_id;
  const closed = data.closed;
  const showResults = !!mine || closed;

  if (showResults) {
    for (const opt of options) {
      const row = document.getElementById('tpl-poll-option-result').content.firstElementChild.cloneNode(true);
      const pct = total > 0 ? Math.round((opt.vote_count / total) * 100) : 0;
      row.querySelector('.poll-option__fill').style.width = `${pct}%`;
      row.querySelector('.poll-option__label').textContent = opt.label;
      row.querySelector('.poll-option__percent').textContent = `${pct}%`;
      if (opt.option_id === mine) row.classList.add('is-mine');
      box.appendChild(row);
    }
    const meta = el('div', { class: 'poll__meta' });
    meta.textContent = `${total} ${total === 1 ? 'vote' : 'votes'}${closed ? ' · closed' : ''}`;
    box.appendChild(meta);
  } else {
    for (const opt of options) {
      const row = document.getElementById('tpl-poll-option-vote').content.firstElementChild.cloneNode(true);
      row.querySelector('.poll-option__label').textContent = opt.label;
      row.addEventListener('click', async () => {
        if (!api.isAuthed()) return window.__anon.openSignup();
        try {
          await api.votePoll(post.id, opt.option_id);
          haptic(6);
          const fresh = await api.getPollResults(post.id);
          if (fresh) renderPoll(box, fresh, post);
        } catch { toast('Vote failed.'); }
      });
      box.appendChild(row);
    }
    const meta = el('div', { class: 'poll__meta' });
    meta.textContent = 'Tap to vote';
    box.appendChild(meta);
  }
}