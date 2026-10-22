import * as api from '../api.js';
import { timeAgo, renderAvatar, el, toast, sharePost, haptic,
         formatReach, reachClass, openSheet, closeSheet } from '../ui.js';
import { buildMediaUrl, buildViewerWatermark } from '../media.js';

export async function mount(root, params) {
  root.innerHTML = '';
  const screen = document.getElementById('tpl-post-detail').content.firstElementChild.cloneNode(true);
  root.appendChild(screen);

  const postBox    = screen.querySelector('[data-role="post"]');
  const commentsEl = screen.querySelector('[data-role="comments"]');
  const heading    = screen.querySelector('[data-role="comments-heading"]');
  const replyForm  = screen.querySelector('[data-role="reply-form"]');
  const replyInput = screen.querySelector('[data-role="reply-input"]');

  screen.querySelector('[data-action="back"]').addEventListener('click', () => history.back());
  postBox.innerHTML = '<p class="empty-state__text" style="padding:24px 0;">Loading…</p>';

  let viewerAlias = api.getCachedAlias();
  if (!viewerAlias && api.isAuthed()) viewerAlias = await api.ensureAliasCached().catch(() => null);
  const watermark = buildViewerWatermark(viewerAlias);

  let post;
  try { post = await api.getPostFull(params.id); }
  catch (err) {
    console.error('[post.js] getPostFull threw:', err);
    postBox.innerHTML = '';
    postBox.appendChild(el('p', { class: 'empty-state__text', style: 'padding:24px 0;color:var(--alert);' }, 'Could not load this post.'));
    return () => {};
  }

  postBox.innerHTML = '';
  if (!post) {
    postBox.appendChild(el('p', { class: 'empty-state__text', style: 'padding:24px 0;' }, 'Post not found. It may have been deleted.'));
    return () => {};
  }

  const built = buildPostCard(post, watermark);
  postBox.appendChild(built.card);

  api.recordView(post.id).then(newCount => {
    if (typeof newCount === 'number' && newCount > 0) {
      const stats = built.card.querySelector('.post-card__stats');
      updateReachDisplay(stats, newCount, { animate: true });
    }
  }).catch(() => {});

  const reachTimer = startPostPolling(built.card, post.id);

  let parentId = null;
  let renderedCount = 0;

  async function loadComments() {
    try {
      const comments = await api.listComments(post.id);
      if (comments.length === renderedCount && renderedCount > 0) return;
      renderedCount = comments.length;
      heading.textContent = `Comments (${comments.length})`;
      commentsEl.innerHTML = '';

      const byParent = new Map();
      const roots = [];
      for (const c of comments) {
        if (!c.parent_id) roots.push(c);
        else {
          if (!byParent.has(c.parent_id)) byParent.set(c.parent_id, []);
          byParent.get(c.parent_id).push(c);
        }
      }

      const commentTpl = document.getElementById('tpl-comment');
      const renderOne = (c) => {
        const node = commentTpl.content.firstElementChild.cloneNode(true);
        renderAvatar(node.querySelector('.avatar'), c.author_alias, 'sm');
        node.querySelector('.comment__alias').textContent = c.author_alias;
        node.querySelector('.comment__time').textContent = timeAgo(c.created_at);
        node.querySelector('.comment__body').textContent = c.content;
        node.querySelector('[data-action="reply"]').addEventListener('click', () => {
          if (!api.isAuthed()) return window.__anon.openSignup();
          parentId = c.id;
          replyInput.placeholder = `Replying to ${c.author_alias}…`;
          replyInput.focus();
        });
        const replies = byParent.get(c.id) || [];
        if (replies.length) {
          const container = node.querySelector('[data-role="replies"]');
          replies.forEach(r => container.appendChild(renderOne(r)));
        } else {
          const container = node.querySelector('[data-role="replies"]');
          if (container) container.remove();
        }
        return node;
      };

      roots.forEach(c => commentsEl.appendChild(renderOne(c)));
      if (!comments.length) {
        commentsEl.appendChild(el('p', { class: 'comments__empty' }, 'No comments yet. Be the first.'));
      }
    } catch (err) {
      console.error('[post.js] loadComments failed:', err);
    }
  }

  await loadComments();

  const liveTimer = setInterval(async () => {
    if (document.hidden) return;
    try {
      const comments = await api.listComments(post.id);
      if (comments.length > renderedCount) { await loadComments(); haptic(4); }
    } catch {}
  }, 15000);

  replyForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!api.isAuthed()) return window.__anon.openSignup();
    const content = replyInput.value.trim();
    if (!content) return;
    replyInput.disabled = true;
    replyInput.value = '';
    try {
      await api.createComment({ postId: post.id, parentId, content });
      parentId = null;
      replyInput.placeholder = 'Reply anonymously…';
      await loadComments();
      post.comment_count = (post.comment_count || 0) + 1;
      built.commentCountEl.textContent = post.comment_count;
      haptic(8);
    } catch {
      toast('Reply failed.');
      replyInput.value = content;
    } finally {
      replyInput.disabled = false;
    }
  });

  return () => { clearInterval(liveTimer); clearInterval(reachTimer); };
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

function startPostPolling(card, postId) {
  return setInterval(async () => {
    if (document.hidden) return;
    try {
      const counts = await api.getPostCounts([postId]);
      const c = counts[postId];
      if (!c) return;

      const stats = card.querySelector('.post-card__stats');
      if (stats) {
        const current = Number(stats.dataset.reach || 0);
        if (c.view > current) updateReachDisplay(stats, c.view, { animate: true });
      }

      const voteCount = card.querySelector('[data-action="vote"] .post-card__count');
      if (voteCount) {
        const cur = Number(voteCount.textContent || 0);
        if (c.upvote !== cur) { voteCount.textContent = c.upvote; if (c.upvote > cur) bumpEl(voteCount, 'count-bump'); }
      }

      const commentCount = card.querySelector('[data-action="open"] .post-card__count');
      if (commentCount) {
        const cur = Number(commentCount.textContent || 0);
        if (c.comment > cur) { commentCount.textContent = c.comment; bumpEl(commentCount, 'count-bump'); }
      }
    } catch {}
  }, 15000);
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
    img.src = buildMediaUrl(m.path);
    img.alt = `Photo ${i + 1}`;
    node.querySelector('.post-media__watermark').textContent = watermark;
    node.addEventListener('click', (e) => { e.stopPropagation(); openLightbox(media, i, watermark); });
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
    imgEl.src = buildMediaUrl(media[idx].path);
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

function buildPostCard(post, watermark) {
  const isPoll = post.type === 'poll';
  const tplId = isPoll ? 'tpl-poll-card' : 'tpl-post-card';
  const node = document.getElementById(tplId).content.firstElementChild.cloneNode(true);
  node.dataset.postId = post.id;

  renderAvatar(node.querySelector('.avatar'), post.author_alias);
  node.querySelector('.post-card__alias').textContent = post.author_alias;
  node.querySelector('.post-card__time').textContent = timeAgo(post.created_at);
  if (post.category && post.category !== 'General') {
    node.querySelector('.post-card__category-dot').hidden = false;
    const cat = node.querySelector('.post-card__category');
    cat.hidden = false;
    cat.textContent = `#${post.category}`;
  }

  const bodyEl = node.querySelector('.post-card__body');
  if (post.content) bodyEl.textContent = post.content;
  else bodyEl.remove();

  const mediaWrap = node.querySelector('[data-role="media"]');
  if (post.media && post.media.length && mediaWrap) {
    renderMediaGrid(mediaWrap, post.media, watermark);
  } else if (mediaWrap) {
    mediaWrap.remove();
  }

  const teaser = node.querySelector('.post-card__teaser');
  if (teaser) teaser.remove();

  const stats = node.querySelector('.post-card__stats');
  updateReachDisplay(stats, post.view_count || 0);

  if (isPoll) renderPoll(node.querySelector('[data-role="poll"]'), post.poll_data, post, node);

  const voteBtn = node.querySelector('[data-action="vote"]');
  const commentBtn = node.querySelector('[data-action="open"]');
  const shareBtn = node.querySelector('[data-action="share"]');
  const voteCount = voteBtn.querySelector('.post-card__count');
  const commentCount = commentBtn.querySelector('.post-card__count');
  voteCount.textContent = post.upvote_count ?? 0;
  commentCount.textContent = post.comment_count ?? 0;

  let voted = false;
  if (api.isAuthed()) {
    api.getMyVotes([post.id]).then(v => { voted = v.length > 0; if (voted) voteBtn.classList.add('is-liked'); }).catch(() => {});
  }

  let voting = false;
  voteBtn.addEventListener('click', async () => {
    if (voting) return;
    if (!api.isAuthed()) return window.__anon.openSignup();
    voting = true;
    haptic(6);
    const wasVoted = voted;
    voteBtn.classList.toggle('is-liked');
    voteCount.textContent = Number(voteCount.textContent) + (wasVoted ? -1 : 1);
    try {
      await api.toggleVote(post.id, wasVoted);
      voted = !wasVoted;
    } catch {
      voteBtn.classList.toggle('is-liked');
      voteCount.textContent = Number(voteCount.textContent) + (wasVoted ? 1 : -1);
      toast('Vote failed.');
    } finally { voting = false; }
  });

  shareBtn.addEventListener('click', () => sharePost(post));
  commentBtn.style.pointerEvents = 'none';

  const myUid = api.isAuthed() ? api.getSession()?.user_id : null;
  const isMine = myUid && myUid === post.author_id;
  const menu = node.querySelector('[data-action="more"]');
  if (menu) menu.addEventListener('click', () => {
    const sheet = document.getElementById('tpl-more-sheet').content.firstElementChild.cloneNode(true);
    const deleteBtn = sheet.querySelector('[data-action="delete"]');
    if (isMine) deleteBtn.hidden = false;
    deleteBtn.addEventListener('click', async () => {
      if (!confirm('Delete this post? This cannot be undone.')) return;
      try {
        await api.deletePost(post.id);
        closeSheet(); toast('Post deleted.'); history.back();
      } catch { toast('Delete failed.'); }
    });
    sheet.querySelector('[data-action="share"]').addEventListener('click', () => { closeSheet(); sharePost(post); });
    sheet.querySelector('[data-action="cancel"]').addEventListener('click', closeSheet);
    sheet.querySelector('[data-action="report"]').addEventListener('click', () => {
      closeSheet();
      if (!api.isAuthed()) return window.__anon.openSignup();
      if (isMine) return toast("You can't report your own post.");
      openReport(post.id);
    });
    openSheet(sheet);
  });

  return { card: node, commentCountEl: commentCount };
}

function renderPoll(box, data, post, card) {
  if (!box) return;
  box.innerHTML = '';
  if (!data) { box.appendChild(el('div', { class: 'poll--fallback' }, 'Loading poll options…')); return; }
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
      row.addEventListener('click', async () => {
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