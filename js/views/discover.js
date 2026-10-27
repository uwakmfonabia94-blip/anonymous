import * as api from '../api.js';
import { timeAgo, el, toast, sharePost, haptic } from '../ui.js';
import { buildMediaUrl, buildViewerWatermark } from '../media.js';
import { navigate } from '../router.js';

const VIEWED_KEY = 'anon.viewedPosts';
function getViewedSet() {
  try { return new Set(JSON.parse(sessionStorage.getItem(VIEWED_KEY) || '[]')); }
  catch { return new Set(); }
}
function markViewed(id) {
  const s = getViewedSet(); s.add(id);
  sessionStorage.setItem(VIEWED_KEY, JSON.stringify([...s]));
}

function classifyPost(post, myUid) {
  const classes = [];
  if (post.media && post.media.length > 0) classes.push('post-card--photo');
  else if (post.content) {
    const trimmed = post.content.trim();
    const isQuote = trimmed.length > 10 && (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
      (trimmed.startsWith('\u201C') && trimmed.endsWith('\u201D'))
    );
    if (isQuote) classes.push('post-card--quote');
    else if (trimmed.length > 200) classes.push('post-card--long');
    else if (trimmed.length < 100) classes.push('post-card--short');
  }
  if (myUid && myUid === post.author_id) classes.push('post-card--mine');
  return classes;
}

export async function mount(root) {
  root.innerHTML = '';
  const screen = document.getElementById('tpl-discover').content.firstElementChild.cloneNode(true);
  root.appendChild(screen);

  const chips = screen.querySelectorAll('.chip');
  const feed  = screen.querySelector('[data-role="feed"]');
  let category = null;

  let viewerAlias = api.getCachedAlias();
  if (!viewerAlias) viewerAlias = await api.ensureAliasCached().catch(() => null);
  const watermark = buildViewerWatermark(viewerAlias);

  async function load() {
    feed.innerHTML = '';
    const skel = document.getElementById('tpl-skeleton-card');
    for (let i = 0; i < 3; i++) feed.appendChild(skel.content.firstElementChild.cloneNode(true));

    try {
      const posts = await api.listFeed({ limit: 30, offset: 0, category });
      feed.innerHTML = '';
      if (!posts.length) { feed.appendChild(el('p', { class: 'empty-state__text' }, 'Nothing here yet.')); return; }

      let myVotes = new Set();
      try {
        const v = await api.getMyVotes(posts.map(p => p.id));
        myVotes = new Set(v.map(r => r.post_id));
      } catch {}
      const myUid = api.getSession()?.user_id;

      for (const post of posts) {
        feed.appendChild(renderCard(post, { myVotes, myUid, watermark }));
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

function renderMediaGrid(container, media, watermark) {
  if (!container || !media || !media.length) { if (container) container.remove(); return; }
  container.innerHTML = '';
  container.classList.add('post-media');
  container.classList.add(media.length === 1 ? 'post-media--single' : 'post-media--double');
  const itemTpl = document.getElementById('tpl-post-media-item');
  media.slice(0, 2).forEach((m, i) => {
    const node = itemTpl.content.firstElementChild.cloneNode(true);
    const img = node.querySelector('.post-media__img');
    img.src = buildMediaUrl(m.path); img.alt = `Photo ${i + 1}`;
    node.querySelector('.post-media__watermark').textContent = watermark;
    node.addEventListener('click', (e) => { e.stopPropagation(); openLightbox(media, i, watermark); });
    container.appendChild(node);
  });
}

function openLightbox(media, startIndex, watermark) {
  const existing = document.getElementById('photo-lightbox-root');
  if (existing) existing.remove();
  const box = document.getElementById('tpl-photo-lightbox').content.firstElementChild.cloneNode(true);
  box.id = 'photo-lightbox-root';
  const imgEl   = box.querySelector('.photo-lightbox__img');
  const wmEl    = box.querySelector('.photo-lightbox__watermark');
  const prevBtn = box.querySelector('[data-action="prev"]');
  const nextBtn = box.querySelector('[data-action="next"]');
  const closeBtn = box.querySelector('[data-action="close"]');
  let idx = startIndex || 0;
  function show() {
    imgEl.src = buildMediaUrl(media[idx].path);
    wmEl.textContent = watermark;
    prevBtn.style.display = idx > 0 ? '' : 'none';
    nextBtn.style.display = idx < media.length - 1 ? '' : 'none';
  }
  prevBtn.addEventListener('click', (e) => { e.stopPropagation(); if (idx > 0) { idx--; show(); } });
  nextBtn.addEventListener('click', (e) => { e.stopPropagation(); if (idx < media.length - 1) { idx++; show(); } });
  closeBtn.addEventListener('click', (e) => { e.stopPropagation(); box.remove(); });
  box.addEventListener('click', (e) => { if (e.target === box) box.remove(); });
  document.body.appendChild(box);
  show();
}

function renderCard(post, { myVotes, myUid, watermark }) {
  const isPoll = post.type === 'poll';
  const tplId = isPoll ? 'tpl-poll-card' : 'tpl-post-card';
  const card = document.getElementById(tplId).content.firstElementChild.cloneNode(true);
  card.dataset.postId = post.id;

  classifyPost(post, myUid).forEach(c => card.classList.add(c));

  card.querySelector('.post-card__alias').textContent = post.author_alias;
  card.querySelector('.post-card__time').textContent = timeAgo(post.created_at);
  if (post.category && post.category !== 'General') {
    const cat = card.querySelector('.post-card__category');
    if (cat) { cat.hidden = false; cat.textContent = `#${post.category}`; }
  }

  const bodyEl = card.querySelector('.post-card__body');
  if (post.content) bodyEl.textContent = post.content;
  else bodyEl.remove();

  const mediaWrap = card.querySelector('[data-role="media"]');
  if (post.media && post.media.length && mediaWrap) {
    renderMediaGrid(mediaWrap, post.media, watermark);
  } else if (mediaWrap) {
    mediaWrap.remove();
  }

  if (isPoll) renderPoll(card.querySelector('[data-role="poll"]'), post.poll_data, post);

  const heatBtn = card.querySelector('[data-action="heat"]');
  const commentBtn = card.querySelector('[data-action="open"]');
  const shareBtn = card.querySelector('[data-action="share"]');
  const commentCount = commentBtn.querySelector('.post-card__count');

  if (commentCount && post.comment_count > 0) {
    commentCount.textContent = post.comment_count;
    commentCount.hidden = false;
  }

  if (myVotes?.has(post.id)) heatBtn.classList.add('is-hot');

  let voting = false;
  heatBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (voting) return;
    if (!api.isAuthed()) return;
    voting = true; haptic(8);
    const wasVoted = myVotes.has(post.id);
    heatBtn.classList.toggle('is-hot');
    if (!wasVoted) {
      heatBtn.classList.remove('heat-bump');
      void heatBtn.offsetWidth;
      heatBtn.classList.add('heat-bump');
    }
    try {
      await api.toggleVote(post.id, wasVoted);
      if (wasVoted) myVotes.delete(post.id); else myVotes.add(post.id);
    } catch {
      heatBtn.classList.toggle('is-hot');
      toast('Failed.');
    } finally { voting = false; }
  });

  const go = () => navigate(`/p/${post.id}`);
  commentBtn.addEventListener('click', go);
  if (bodyEl) bodyEl.addEventListener('click', go);
  shareBtn.addEventListener('click', (e) => { e.stopPropagation(); sharePost(post); });

  return card;
}

function renderPoll(box, data, post) {
  if (!box) return;
  box.innerHTML = '';
  if (!data) { box.appendChild(el('div', { class: 'poll--fallback' }, 'Tap to view poll')); return; }
  const options = data.options || [];
  if (!options.length) { box.appendChild(el('div', { class: 'poll--empty' }, 'No options yet')); return; }
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
      row.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!api.isAuthed()) return;
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