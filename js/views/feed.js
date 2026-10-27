import * as api from '../api.js';
import { timeAgo, el, toast, sharePost, haptic, openSheet, closeSheet } from '../ui.js';
import { buildMediaUrl, buildViewerWatermark } from '../media.js';

const DAILY_PROMPTS = {
  0: { label: 'Sunday', text: "What's the best thing that happened this week?" },
  1: { label: 'Confession Monday', text: "Say something you've never told anyone." },
  2: { label: 'Tuesday question', text: "What's the weirdest thing that happened today?" },
  3: { label: 'Rant Wednesday', text: "What's grinding your gears right now?" },
  4: { label: 'Thursday prompt', text: "Ask the campus a question you've been holding in." },
  5: { label: 'Confession Friday', text: "What's on your mind this weekend?" },
  6: { label: 'Saturday', text: "What's something small that made you smile today?" },
};

const VIEWED_KEY = 'anon.viewedPosts';
function getViewedSet() {
  try { return new Set(JSON.parse(sessionStorage.getItem(VIEWED_KEY) || '[]')); }
  catch { return new Set(); }
}
function markViewed(id) {
  const s = getViewedSet(); s.add(id);
  sessionStorage.setItem(VIEWED_KEY, JSON.stringify([...s]));
}

function getDailyPrompt() { return DAILY_PROMPTS[new Date().getDay()]; }

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
  const screen = document.getElementById('tpl-feed-screen').content.firstElementChild.cloneNode(true);
  root.appendChild(screen);

  const feed      = screen.querySelector('[data-role="feed"]');
  const sentinel  = screen.querySelector('[data-role="sentinel"]');
  const pinBanner = screen.querySelector('.pin-banner');

  const dailyPrompt = getDailyPrompt();
  if (pinBanner) {
    pinBanner.querySelector('.pin-banner__label').textContent = dailyPrompt.label;
    pinBanner.querySelector('.pin-banner__text').textContent = dailyPrompt.text;
  }

  const justPostedId = sessionStorage.getItem('anon.justPosted');
  sessionStorage.removeItem('anon.justPosted');

  let viewerAlias = api.getCachedAlias();
  if (!viewerAlias) viewerAlias = await api.ensureAliasCached().catch(() => null);
  const watermark = buildViewerWatermark(viewerAlias);

  const skeletonTpl = document.getElementById('tpl-skeleton-card');
  for (let i = 0; i < 3; i++) feed.appendChild(skeletonTpl.content.firstElementChild.cloneNode(true));

  let posts = [];
  try {
    posts = await api.listFeed({ limit: 20, offset: 0 });
  } catch (err) {
    console.error('[feed] load failed:', err);
    feed.innerHTML = '';
    feed.appendChild(el('p', { class: 'empty-state__text' }, 'Could not load feed.'));
    return;
  }

  if (justPostedId && !posts.some(p => p.id === justPostedId)) {
    try {
      const myPost = await api.getPostFull(justPostedId);
      if (myPost) posts.unshift(myPost);
    } catch {}
  }

  feed.innerHTML = '';

  if (!posts.length) {
    feed.appendChild(document.getElementById('tpl-empty').content.firstElementChild.cloneNode(true));
    return;
  }

  let myVotes = new Set();
  try {
    const v = await api.getMyVotes(posts.map(p => p.id));
    myVotes = new Set(v.map(r => r.post_id));
  } catch {}
  const myUid = api.getSession()?.user_id;

  const viewedSet = getViewedSet();
  const viewObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const card = entry.target;
      const postId = card.dataset.postId;
      if (!postId || viewedSet.has(postId)) return;
      setTimeout(async () => {
        if (!card.isConnected) return;
        if (viewedSet.has(postId)) return;
        viewedSet.add(postId);
        markViewed(postId);
        api.recordView(postId).catch(() => {});
      }, 1000);
      viewObserver.unobserve(card);
    });
  }, { threshold: 0.5 });

  const appendPosts = (list) => {
    for (const post of list) {
      const card = renderPostCard(post, { myVotes, myUid, watermark });
      feed.appendChild(card);
      viewObserver.observe(card);
    }
  };

  appendPosts(posts);

  const reachTimer = startReachPolling(feed);

  let loading = false;
  let done = false;
  const scrollObserver = new IntersectionObserver(async (entries) => {
    if (!entries[0].isIntersecting || loading || done) return;
    loading = true;
    try {
      const more = await api.listFeed({ limit: 20, offset: posts.length });
      if (!more.length) { done = true; return; }
      posts = posts.concat(more);
      try {
        const v = await api.getMyVotes(more.map(p => p.id));
        v.forEach(r => myVotes.add(r.post_id));
      } catch {}
      appendPosts(more);
    } catch {} finally { loading = false; }
  }, { rootMargin: '200px' });
  scrollObserver.observe(sentinel);

  return () => {
    scrollObserver.disconnect();
    viewObserver.disconnect();
    clearInterval(reachTimer);
  };
}

function startReachPolling(feed) {
  return setInterval(async () => {
    if (document.hidden) return;
    const cards = Array.from(feed.querySelectorAll('.post-card')).slice(0, 60);
    if (!cards.length) return;
    const ids = cards.map(c => c.dataset.postId).filter(Boolean);
    if (!ids.length) return;
    try {
      const counts = await api.getPostCounts(ids);
      for (const card of cards) {
        const c = counts[card.dataset.postId];
        if (!c) continue;
        const cc = card.querySelector('[data-action="open"] .post-card__count');
        if (cc && c.comment > 0) {
          const cur = Number(cc.textContent || 0);
          if (c.comment > cur) {
            cc.textContent = c.comment;
            cc.hidden = false;
            bumpEl(cc, 'count-bump');
          }
        }
      }
    } catch {}
  }, 30000);
}

function bumpEl(node, className) {
  if (!node) return;
  node.classList.remove(className);
  void node.offsetWidth;
  node.classList.add(className);
}

function renderMediaGrid(container, media, watermark, onOpen) {
  if (!container || !media || !media.length) { if (container) container.remove(); return; }
  container.innerHTML = '';
  container.classList.add('post-media');
  container.classList.add(media.length === 1 ? 'post-media--single' : 'post-media--double');
  const itemTpl = document.getElementById('tpl-post-media-item');
  media.slice(0, 2).forEach((m, i) => {
    const node = itemTpl.content.firstElementChild.cloneNode(true);
    const img = node.querySelector('.post-media__img');
    img.src = buildMediaUrl(m.path);
    img.loading = 'lazy';
    img.alt = `Photo ${i + 1}`;
    node.querySelector('.post-media__watermark').textContent = watermark;
    node.addEventListener('click', (e) => {
      e.stopPropagation();
      if (onOpen) onOpen(media, i);
    });
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

function renderPostCard(post, { myVotes, myUid, watermark }) {
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
    renderMediaGrid(mediaWrap, post.media, watermark, (m, i) => openLightbox(m, i, watermark));
  } else if (mediaWrap) {
    mediaWrap.remove();
  }

  if (isPoll) renderPoll(card.querySelector('[data-role="poll"]'), post.poll_data, post, card);

  const heatBtn    = card.querySelector('[data-action="heat"]');
  const commentBtn = card.querySelector('[data-action="open"]');
  const shareBtn   = card.querySelector('[data-action="share"]');
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
    voting = true;
    haptic(8);
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

  const goToPost = () => import('../router.js').then(r => r.navigate(`/p/${post.id}`));
  commentBtn.addEventListener('click', goToPost);
  if (bodyEl) bodyEl.addEventListener('click', goToPost);
  shareBtn.addEventListener('click', (e) => { e.stopPropagation(); sharePost(post); });

  const menu = card.querySelector('[data-action="more"]');
  if (menu) menu.addEventListener('click', (e) => {
    e.stopPropagation();
    openMoreMenu(post, card, myUid);
  });

  return card;
}

function renderPoll(box, data, post, card) {
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
          if (fresh) renderPoll(box, fresh, post, card);
        } catch { toast('Vote failed.'); }
      });
      box.appendChild(row);
    }
    const meta = el('div', { class: 'poll__meta' });
    meta.textContent = 'Tap to vote';
    box.appendChild(meta);
  }
}

function openMoreMenu(post, card, myUid) {
  const node = document.getElementById('tpl-more-sheet').content.firstElementChild.cloneNode(true);
  const isMine = myUid && myUid === post.author_id;
  const deleteBtn = node.querySelector('[data-action="delete"]');
  if (isMine) deleteBtn.hidden = false;

  deleteBtn.addEventListener('click', async () => {
    if (!confirm('Delete this post? This cannot be undone.')) return;
    try {
      await api.deletePost(post.id);
      closeSheet();
      card.remove();
      toast('Post deleted.');
    } catch { toast('Delete failed.'); }
  });
  node.querySelector('[data-action="share"]').addEventListener('click', () => { closeSheet(); sharePost(post); });
  node.querySelector('[data-action="cancel"]').addEventListener('click', closeSheet);
  node.querySelector('[data-action="report"]').addEventListener('click', () => {
    closeSheet();
    if (isMine) return toast("You can't report your own post.");
    openReport(post.id);
  });
  openSheet(node);
}

function openReport(postId) {
  const node = document.getElementById('tpl-report-sheet').content.firstElementChild.cloneNode(true);
  node.querySelectorAll('[data-reason]').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await api.createReport({ postId, reason: btn.dataset.reason });
        closeSheet(); toast('Report sent.');
      } catch { toast('Report failed.'); }
    });
  });
  node.querySelector('[data-action="cancel"]').addEventListener('click', closeSheet);
  openSheet(node);
}