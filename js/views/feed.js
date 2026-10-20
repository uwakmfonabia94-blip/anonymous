import * as api from '../api.js';
import { timeAgo, renderAvatar, el, toast, sharePost, shareToWhatsApp, haptic,
         formatReach, reachClass, openSheet, closeSheet } from '../ui.js';

const SPICE_PROMPTS = [
  { badge: 'Question of the day', text: "What's the worst advice you've ever gotten?" },
  { badge: 'Campus prompt',       text: "Post about a professor who deserves an award." },
  { badge: 'Unpopular opinion?',  text: "Say the thing nobody on campus is saying." },
  { badge: 'Confession prompt',   text: "Something you've never told anyone." },
  { badge: 'Rate it',             text: "Rate the dining hall. Be honest." },
  { badge: 'Suggested topic',     text: "What's the most overrated place on campus?" },
];

export async function mount(root) {
  root.innerHTML = '';
  const screen = document.getElementById('tpl-feed-screen').content.firstElementChild.cloneNode(true);
  root.appendChild(screen);

  const feed     = screen.querySelector('[data-role="feed"]');
  const sentinel = screen.querySelector('[data-role="sentinel"]');

  const justPostedId = sessionStorage.getItem('anon.justPosted');
  sessionStorage.removeItem('anon.justPosted');

  const skeletonTpl = document.getElementById('tpl-skeleton-card');
  for (let i = 0; i < 3; i++) feed.appendChild(skeletonTpl.content.firstElementChild.cloneNode(true));

  let posts = [];
  let hotPost = null;
  try {
    const [fetched, hot] = await Promise.all([
      api.listFeed({ limit: 20 }),
      api.getHotPost().catch(() => null),
    ]);
    posts = fetched;
    hotPost = hot;
  } catch (err) {
    console.error('[feed] load failed:', err);
    feed.innerHTML = '';
    feed.appendChild(el('p', { class: 'empty-state__text' }, 'Could not load feed. Pull down to retry.'));
    return;
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

  if (hotPost && hotPost.id) {
    feed.appendChild(renderPostCard(hotPost, { isHot: true, myVotes, myUid }));
  }

  let lastSectionGroup = null;
  let renderedCount = 0;
  let landedElement = null;

  const renderSection = (group) => {
    if (group === lastSectionGroup) return;
    lastSectionGroup = group;
    const labels = { now: 'Just now', today: 'Today', yesterday: 'Yesterday', earlier: 'Earlier' };
    const node = document.getElementById('tpl-section-header').content.firstElementChild.cloneNode(true);
    node.textContent = labels[group];
    feed.appendChild(node);
  };

  const appendPosts = (list) => {
    for (const post of list) {
      renderSection(sectionFor(post.created_at));
      const card = renderPostCard(post, { myVotes, myUid });
      feed.appendChild(card);
      renderedCount++;
      if (post.id === justPostedId) {
        card.classList.add('post-card--landed');
        landedElement = card;
        setTimeout(() => card.classList.remove('post-card--landed'), 1600);
      }
      if (renderedCount % 10 === 0) {
        feed.appendChild(renderSpiceCard(renderedCount));
      }
    }
  };

  appendPosts(posts);
  if (landedElement) window.scrollTo({ top: 0, behavior: 'smooth' });

  if (!api.isAuthed() && posts.length >= 5) {
    feed.appendChild(document.getElementById('tpl-soft-wall').content.firstElementChild.cloneNode(true));
  }

  const reachTimer = startReachPolling(feed);

  let loading = false;
  let done = false;
  const observer = new IntersectionObserver(async (entries) => {
    if (!entries[0].isIntersecting || loading || done) return;
    loading = true;
    try {
      const last = posts[posts.length - 1];
      const more = await api.listFeed({ limit: 20, before: last.created_at });
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
  observer.observe(sentinel);

  return () => {
    observer.disconnect();
    clearInterval(newPostsBar.interval);
    clearInterval(reachTimer);
  };
}

function sectionFor(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  const hours = (now - d) / (1000 * 60 * 60);
  if (hours < 1) return 'now';
  if (d.toDateString() === now.toDateString()) return 'today';
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'yesterday';
  return 'earlier';
}

function renderSpiceCard(triggerAt) {
  const prompt = SPICE_PROMPTS[Math.floor(triggerAt / 10 - 1) % SPICE_PROMPTS.length];
  const card = document.getElementById('tpl-spice-card').content.firstElementChild.cloneNode(true);
  card.querySelector('.spice-card__badge-text').textContent = prompt.badge;
  card.querySelector('.spice-card__text').textContent = prompt.text;
  card.querySelector('.spice-card__cta').addEventListener('click', () => {
    sessionStorage.setItem('anon.composePrompt', prompt.text);
    import('../router.js').then(r => r.navigate('/compose'));
  });
  return card;
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
          const current = Number(voteBtn.textContent || 0);
          if (c.upvote > current) {
            voteBtn.textContent = c.upvote;
            bumpEl(voteBtn, 'count-bump');
          }
        }

        const commentBtn = card.querySelector('[data-action="open"] .post-card__count');
        if (commentBtn) {
          const current = Number(commentBtn.textContent || 0);
          if (c.comment > current) {
            commentBtn.textContent = c.comment;
            bumpEl(commentBtn, 'count-bump');
          }
        }
      }
    } catch {}
  }, 30000);
}

function renderPostCard(post, { isHot = false, myVotes, myUid }) {
  const isPoll = post.type === 'poll';
  const tplId = isPoll ? 'tpl-poll-card' : (isHot ? 'tpl-hot-post' : 'tpl-post-card');
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
  updateReachDisplay(stats, post.view_count || 0);

  if (isPoll) {
    renderPoll(card.querySelector('[data-role="poll"]'), post.poll_data, post, card);
  }

  const voteBtn    = card.querySelector('[data-action="vote"]');
  const commentBtn = card.querySelector('[data-action="open"]');
  const shareBtn   = card.querySelector('[data-action="share"]');
  const waBtn      = card.querySelector('[data-action="share-whatsapp"]');

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

  const goToPost = () => import('../router.js').then(r => r.navigate(`/p/${post.id}`));
  commentBtn.addEventListener('click', goToPost);
  card.querySelector('.post-card__body').addEventListener('click', goToPost);
  shareBtn.addEventListener('click', (e) => { e.stopPropagation(); sharePost(post); });
  waBtn.addEventListener('click', (e) => { e.stopPropagation(); shareToWhatsApp(post); });

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

  if (!data) {
    box.appendChild(el('div', { class: 'poll--fallback' }, 'Tap to view poll'));
    return;
  }

  const options = data.options || [];
  if (!options.length) {
    box.appendChild(el('div', { class: 'poll--empty' }, 'No options yet'));
    return;
  }

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
        } catch {
          toast('Vote failed.');
        }
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