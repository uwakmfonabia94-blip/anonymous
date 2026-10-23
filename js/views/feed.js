import * as api from '../api.js';
import { timeAgo, renderAvatar, el, toast, sharePost, haptic,
         formatReach, reachClass, openSheet, closeSheet } from '../ui.js';
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
const GUEST_LIMIT = 5;

function getViewedSet() {
  try { return new Set(JSON.parse(sessionStorage.getItem(VIEWED_KEY) || '[]')); }
  catch { return new Set(); }
}
function markViewed(postId) {
  const set = getViewedSet();
  set.add(postId);
  sessionStorage.setItem(VIEWED_KEY, JSON.stringify([...set]));
}

function getDailyPrompt() { return DAILY_PROMPTS[new Date().getDay()]; }

function classifyPost(post, myUid) {
  const classes = [];
  if (post.media && post.media.length > 0) {
    classes.push('post-card--photo');
  } else if (post.content) {
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

  const isGuest = !api.isAuthed();

  let viewerAlias = api.getCachedAlias();
  if (!viewerAlias && api.isAuthed()) viewerAlias = await api.ensureAliasCached().catch(() => null);
  const watermark = buildViewerWatermark(viewerAlias);

  const skeletonTpl = document.getElementById('tpl-skeleton-card');
  for (let i = 0; i < 3; i++) feed.appendChild(skeletonTpl.content.firstElementChild.cloneNode(true));

  let posts = [];
  try {
    posts = await api.listFeed({ limit: 20, offset: 0 });
  } catch (err) {
    console.error('[feed] load failed:', err);
    feed.innerHTML = '';
    feed.appendChild(el('p', { class: 'empty-state__text' }, 'Could not load feed. Pull down to retry.'));
    return;
  }

  // CRITICAL FIX: if a post was just created and isn't in the feed response
  // (race condition or ranking exclusion), fetch it and force it to the top.
  if (justPostedId && !posts.some(p => p.id === justPostedId)) {
    try {
      const myPost = await api.getPostFull(justPostedId);
      if (myPost) posts.unshift(myPost);
    } catch (err) {
      console.warn('[feed] could not fetch just-posted post:', err);
    }
  }

  feed.innerHTML = '';
  showRecapIfNeeded();
  const newPostsBar = mountNewPostsBar(screen);

  if (!posts.length) {
    feed.appendChild(document.getElementById('tpl-empty').content.firstElementChild.cloneNode(true));
    return () => clearInterval(newPostsBar.interval);
  }

  let myVotes = new Set();
  if (api.isAuthed()) {
    try {
      const v = await api.getMyVotes(posts.map(p => p.id));
      myVotes = new Set(v.map(r => r.post_id));
    } catch {}
  }
  const myUid = api.isAuthed() ? api.getSession()?.user_id : null;

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
        try {
          const newCount = await api.recordView(postId);
          if (typeof newCount === 'number' && newCount > 0) {
            const stats = card.querySelector('.post-card__stats');
            updateReachDisplay(stats, newCount, { animate: true });
          }
        } catch {}
      }, 1000);

      viewObserver.unobserve(card);
    });
  }, { threshold: 0.5 });

  const observeCard = (card) => viewObserver.observe(card);

  let renderedCount = 0;
  let landedElement = null;

  const appendPosts = (list) => {
    for (const post of list) {
      const card = renderPostCard(post, { myVotes, myUid, watermark });
      feed.appendChild(card);
      observeCard(card);
      renderedCount++;
      if (post.id === justPostedId) {
        card.classList.add('post-card--landed');
        landedElement = card;
        setTimeout(() => card.classList.remove('post-card--landed'), 1600);
      }
    }
  };

  // CRITICAL FIX: cap visible posts for guests
  const visiblePosts = isGuest ? posts.slice(0, GUEST_LIMIT) : posts;
  appendPosts(visiblePosts);

  if (landedElement) window.scrollTo({ top: 0, behavior: 'smooth' });

  // CRITICAL FIX: guest soft wall, and no more posts for guests
  if (isGuest) {
    feed.appendChild(document.getElementById('tpl-soft-wall').content.firstElementChild.cloneNode(true));
  }

  const reachTimer = startReachPolling(feed);

  // CRITICAL FIX: disable infinite scroll for guests
  let loading = false;
  let done = isGuest;
  const scrollObserver = new IntersectionObserver(async (entries) => {
    if (!entries[0].isIntersecting || loading || done) return;
    loading = true;
    try {
      const more = await api.listFeed({ limit: 20, offset: posts.length });
      if (!more.length) { done = true; return; }
      posts = posts.concat(more);
      if (api.isAuthed()) {
        try {
          const v = await api.getMyVotes(more.map(p => p.id));
          v.forEach(r => myVotes.add(r.post_id));
        } catch {}
      }
      appendPosts(more);
    } catch {} finally { loading = false; }
  }, { rootMargin: '200px' });
  if (!isGuest) scrollObserver.observe(sentinel);

  return () => {
    scrollObserver.disconnect();
    viewObserver.disconnect();
    clearInterval(newPostsBar.interval);
    clearInterval(reachTimer);
  };
}

function updateReachDisplay(stats, reach, { animate = false } = {}) {
  if (!stats) return;
  const wasZero = Number(stats.dataset.reach || 0) === 0;
  stats.hidden = reach === 0;
  stats.classList.remove('post-card__reach--quiet', 'post-card__reach--warm', 'post-card__reach--hot');
  const cls = reachClass(reach);
  if (cls) stats.classList.add(cls);
  const icon = stats.querySelector('.post-card__reach-icon use');
  if (icon) icon.setAttribute('href', reach >= 500 ? '#i-flame' : '#i-eye');
  const reachEl = stats.querySelector('.post-card__reach');
  if (reachEl) {
    reachEl.textContent = formatReach(reach);
    if (animate && !wasZero) bumpEl(reachEl, 'post-card__reach--bump');
  }
  stats.dataset.reach = String(reach);
}

function bumpEl(node, className) {
  if (!node) return;
  node.classList.remove(className);
  void node.offsetWidth;
  node.classList.add(className);
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

        const stats = card.querySelector('.post-card__stats');
        if (stats) {
          const current = Number(stats.dataset.reach || 0);
          if (c.view > current) updateReachDisplay(stats, c.view, { animate: true });
        }

        const voteBtn = card.querySelector('[data-action="vote"] .post-card__count');
        if (voteBtn) {
          const cur = Number(voteBtn.textContent || 0);
          if (c.upvote > cur) { voteBtn.textContent = c.upvote; bumpEl(voteBtn, 'count-bump'); }
        }

        const commentBtn = card.querySelector('[data-action="open"] .post-card__count');
        if (commentBtn) {
          const cur = Number(commentBtn.textContent || 0);
          if (c.comment > cur) { commentBtn.textContent = c.comment; bumpEl(commentBtn, 'count-bump'); }
        }
      }
    } catch {}
  }, 30000);
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

  const tpl = document.getElementById('tpl-photo-lightbox');
  const box = tpl.content.firstElementChild.cloneNode(true);
  box.id = 'photo-lightbox-root';

  const imgEl   = box.querySelector('.photo-lightbox__img');
  const wmEl    = box.querySelector('.photo-lightbox__watermark');
  const prevBtn = box.querySelector('[data-action="prev"]');
  const nextBtn = box.querySelector('[data-action="next"]');
  const closeBtn = box.querySelector('[data-action="close"]');

  let idx = startIndex || 0;

  function show() {
    const m = media[idx];
    imgEl.src = buildMediaUrl(m.path);
    wmEl.textContent = watermark;
    prevBtn.style.display = idx > 0 ? '' : 'none';
    nextBtn.style.display = idx < media.length - 1 ? '' : 'none';
  }

  prevBtn.addEventListener('click', (e) => { e.stopPropagation(); if (idx > 0) { idx--; show(); } });
  nextBtn.addEventListener('click', (e) => { e.stopPropagation(); if (idx < media.length - 1) { idx++; show(); } });
  closeBtn.addEventListener('click', (e) => { e.stopPropagation(); box.remove(); });
  box.addEventListener('click', (e) => { if (e.target === box) box.remove(); });

  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { box.remove(); document.removeEventListener('keydown', esc); }
  });

  document.body.appendChild(box);
  show();
}

function renderPostCard(post, { isHot = false, myVotes, myUid, watermark }) {
  const isPoll = post.type === 'poll';
  const tplId = isPoll ? 'tpl-poll-card' : (isHot ? 'tpl-hot-post' : 'tpl-post-card');
  const card = document.getElementById(tplId).content.firstElementChild.cloneNode(true);
  card.dataset.postId = post.id;

  classifyPost(post, myUid).forEach(c => card.classList.add(c));

  renderAvatar(card.querySelector('.avatar'), post.author_alias);
  card.querySelector('.post-card__alias').textContent = post.author_alias;
  card.querySelector('.post-card__time').textContent = timeAgo(post.created_at);

  if (post.category && post.category !== 'General') {
    card.querySelector('.post-card__category-dot').hidden = false;
    const cat = card.querySelector('.post-card__category');
    cat.hidden = false;
    cat.textContent = `#${post.category}`;
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

  const teaser = card.querySelector('.post-card__teaser');
  if (teaser && post.top_comment_text) {
    teaser.hidden = false;
    teaser.querySelector('.post-card__teaser__author').textContent =
      post.top_comment_alias ? `${post.top_comment_alias}:` : '';
    teaser.querySelector('.post-card__teaser__text').textContent =
      post.top_comment_text.length > 120 ? post.top_comment_text.slice(0, 117) + '…' : post.top_comment_text;
  }

  const stats = card.querySelector('.post-card__stats');
  updateReachDisplay(stats, post.view_count || 0);

  if (isPoll) renderPoll(card.querySelector('[data-role="poll"]'), post.poll_data, post, card);

  const voteBtn    = card.querySelector('[data-action="vote"]');
  const commentBtn = card.querySelector('[data-action="open"]');
  const shareBtn   = card.querySelector('[data-action="share"]');

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
      if (!getViewedSet().has(post.id)) { markViewed(post.id); api.recordView(post.id).catch(() => {}); }
    } catch {
      voteBtn.classList.toggle('is-liked');
      c.textContent = Number(c.textContent) + (wasVoted ? 1 : -1);
      toast('Vote failed.');
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
        if (!api.isAuthed()) return window.__anon.openSignup();
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
    if (!api.isAuthed()) return window.__anon.openSignup();
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

async function showRecapIfNeeded() {
  if (!api.isAuthed()) return;
  const lastVisit = localStorage.getItem('anon.lastVisit');
  const now = Date.now();
  if (lastVisit) {
    const gapHours = (now - Number(lastVisit)) / (1000 * 60 * 60);
    if (gapHours >= 4) {
      try {
        const recap = await api.myRecapSince(new Date(Number(lastVisit)).toISOString());
        const total = (recap.new_replies || 0) + (recap.new_upvotes || 0);
        if (total > 0 || (recap.new_posts || 0) > 5) setTimeout(() => presentRecapModal(recap), 600);
      } catch {}
    }
  }
  localStorage.setItem('anon.lastVisit', String(now));
}

function presentRecapModal(recap) {
  const node = document.getElementById('tpl-recap-modal').content.firstElementChild.cloneNode(true);
  node.querySelector('[data-role="replies"] .recap-item__count').textContent = recap.new_replies || 0;
  node.querySelector('[data-role="upvotes"] .recap-item__count').textContent = recap.new_upvotes || 0;
  node.querySelector('[data-role="posts"]   .recap-item__count').textContent = recap.new_posts   || 0;
  node.querySelector('[data-action="dismiss"]').addEventListener('click', () => {
    closeSheet();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  openSheet(node);
}

function mountNewPostsBar(screen) {
  const bar = document.getElementById('tpl-new-posts-bar').content.firstElementChild.cloneNode(true);
  bar.hidden = true;
  screen.insertBefore(bar, screen.querySelector('[data-role="feed"]'));
  const renderedAt = new Date().toISOString();
  const textEl = bar.querySelector('.new-posts-bar__text');
  bar.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    import('../router.js').then(r => r.render());
  });
  const interval = setInterval(async () => {
    if (document.hidden) return;
    try {
      const n = await api.countNewPostsSince(renderedAt);
      if (n > 0) {
        bar.hidden = false;
        textEl.textContent = `${n} new ${n === 1 ? 'post' : 'posts'}`;
      }
    } catch {}
  }, 60000);
  return { interval };
}