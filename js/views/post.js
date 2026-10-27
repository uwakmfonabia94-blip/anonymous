import * as api from '../api.js';
import { timeAgo, el, toast, sharePost, haptic, openSheet, closeSheet } from '../ui.js';
import { buildMediaUrl, buildViewerWatermark } from '../media.js';

const GUEST_COMMENT_LIMIT = 5;

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

  const isGuest = !api.isAuthed();
  let viewerAlias = api.getCachedAlias();
  if (!viewerAlias && !isGuest) viewerAlias = await api.ensureAliasCached().catch(() => null);
  const watermark = buildViewerWatermark(viewerAlias);

  let post;
  try { post = await api.getPostFull(params.id); }
  catch (err) {
    postBox.innerHTML = '';
    postBox.appendChild(el('p', { class: 'empty-state__text', style: 'padding:24px 0;' }, 'Could not load this post.'));
    return () => {};
  }
  postBox.innerHTML = '';
  if (!post) {
    postBox.appendChild(el('p', { class: 'empty-state__text', style: 'padding:24px 0;' }, 'Post not found.'));
    return () => {};
  }

  const card = buildPostCard(post, watermark);
  postBox.appendChild(card.card);

  if (!isGuest) {
    api.recordView(post.id).catch(() => {});
  }

  const pollTimer = isGuest ? null : startPostPolling(card.card, post.id);

  let parentId = null;
  let renderedCount = 0;

  async function loadComments() {
    try {
      const comments = await api.listComments(post.id);
      if (comments.length === renderedCount && renderedCount > 0) return;
      renderedCount = comments.length;
      heading.textContent = `Comments (${comments.length})`;
      commentsEl.innerHTML = '';

      // Build id → comment map
      const byId = new Map(comments.map(c => [c.id, c]));

      // Walk up to find the top-level root for any comment
      function rootOf(c) {
        let cur = c;
        const seen = new Set();
        while (cur.parent_id && !seen.has(cur.id)) {
          seen.add(cur.id);
          const p = byId.get(cur.parent_id);
          if (!p) return cur;
          cur = p;
        }
        return cur;
      }

      // Bucket every comment under its root, regardless of depth
      const byParent = new Map();
      const roots = [];
      for (const c of comments) {
        const root = rootOf(c);
        if (root.id === c.id) {
          roots.push(c);
        } else {
          if (!byParent.has(root.id)) byParent.set(root.id, []);
          byParent.get(root.id).push(c);
        }
      }

      const visibleRoots = isGuest ? roots.slice(0, GUEST_COMMENT_LIMIT) : roots;

      const commentTpl = document.getElementById('tpl-comment');
      const renderOne = (c) => {
        const node = commentTpl.content.firstElementChild.cloneNode(true);
        node.dataset.commentId = c.id;

        const isDeleted = c.is_deleted || c.content === '[deleted]';
        const isMine = !isGuest && api.getSession()?.user_id === c.author_id;

        node.querySelector('.comment__body').textContent = isDeleted ? '[deleted]' : c.content;
        if (isDeleted) node.classList.add('is-deleted');
        node.querySelector('.comment__alias').textContent = isDeleted ? '—' : c.author_alias;
        node.querySelector('.comment__time').textContent = timeAgo(c.created_at);

        const replyBtn = node.querySelector('[data-action="reply"]');
        if (isDeleted) replyBtn.remove();
        else replyBtn.addEventListener('click', () => {
          if (isGuest) return window.__anon.openSignup();
          parentId = c.id;
          replyInput.placeholder = `Replying to ${c.author_alias}…`;
          replyInput.focus();
        });

        const moreBtn = node.querySelector('[data-action="comment-more"]');
        if (moreBtn) {
          if (isGuest || !isMine) moreBtn.remove();
          else moreBtn.addEventListener('click', () => openCommentMenu(c, reloadComments));
        }

        const replies = byParent.get(c.id) || [];
        const container = node.querySelector('[data-role="replies"]');
        if (replies.length) {
          replies.forEach(r => container.appendChild(renderOne(r)));
        } else if (container) {
          container.remove();
        }

        return node;
      };

      visibleRoots.forEach(c => commentsEl.appendChild(renderOne(c)));

      if (!comments.length) {
        commentsEl.appendChild(el('p', { class: 'comments__empty' }, 'No comments yet.'));
      } else if (isGuest && roots.length > GUEST_COMMENT_LIMIT) {
        const wall = el('div', { class: 'comments__guest-wall' });
        wall.appendChild(el('p', {}, 'Sign up to see all comments and reply.'));
        const btn = el('button', { class: 'btn btn--primary btn--block', type: 'button' }, 'Enter Anonymous');
        btn.addEventListener('click', () => window.__anon.openSignup());
        wall.appendChild(btn);
        commentsEl.appendChild(wall);
      }
    } catch (err) {
      console.error('[post.js] loadComments failed:', err);
    }
  }

  async function reloadComments() {
    renderedCount = 0;
    await loadComments();
  }

  await loadComments();

  if (isGuest) {
    replyForm.innerHTML = '';
    const wall = el('div', { class: 'reply-bar__guest' });
    const btn = el('button', { class: 'btn btn--primary btn--block', type: 'button' }, 'Sign up to reply');
    btn.addEventListener('click', () => window.__anon.openSignup());
    wall.appendChild(btn);
    replyForm.appendChild(wall);
    return () => { if (pollTimer) clearInterval(pollTimer); };
  }

  const liveTimer = setInterval(async () => {
    if (document.hidden) return;
    try {
      const comments = await api.listComments(post.id);
      if (comments.length > renderedCount) { await loadComments(); haptic(4); }
    } catch {}
  }, 15000);

  replyForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const content = replyInput.value.trim();
    if (!content) return;
    replyInput.disabled = true;
    replyInput.value = '';
    try {
      await api.createComment({ postId: post.id, parentId, content });
      parentId = null;
      replyInput.placeholder = 'Reply anonymously…';
      await reloadComments();
      post.comment_count = (post.comment_count || 0) + 1;
      const cc = card.commentCountEl;
      if (cc) { cc.textContent = post.comment_count; cc.hidden = false; }
      haptic(8);
    } catch {
      toast('Reply failed.');
      replyInput.value = content;
    } finally {
      replyInput.disabled = false;
    }
  });

  return () => {
    clearInterval(liveTimer);
    if (pollTimer) clearInterval(pollTimer);
  };
}

function startPostPolling(card, postId) {
  return setInterval(async () => {
    if (document.hidden) return;
    try {
      const counts = await api.getPostCounts([postId]);
      const c = counts[postId];
      if (!c) return;
      const cc = card.querySelector('[data-action="open"] .post-card__count');
      if (cc && c.comment > 0) {
        const cur = Number(cc.textContent || 0);
        if (c.comment > cur) {
          cc.textContent = c.comment;
          cc.hidden = false;
        }
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

function buildPostCard(post, watermark) {
  const isPoll = post.type === 'poll';
  const tplId = isPoll ? 'tpl-poll-card' : 'tpl-post-card';
  const node = document.getElementById(tplId).content.firstElementChild.cloneNode(true);
  node.dataset.postId = post.id;

  node.querySelector('.post-card__alias').textContent = post.author_alias;
  node.querySelector('.post-card__time').textContent = timeAgo(post.created_at);
  if (post.category && post.category !== 'General') {
    const cat = node.querySelector('.post-card__category');
    if (cat) { cat.hidden = false; cat.textContent = `#${post.category}`; }
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

  if (isPoll) renderPoll(node.querySelector('[data-role="poll"]'), post.poll_data, post, node);

  const heatBtn = node.querySelector('[data-action="heat"]');
  const commentBtn = node.querySelector('[data-action="open"]');
  const shareBtn = node.querySelector('[data-action="share"]');
  const commentCount = commentBtn.querySelector('.post-card__count');

  if (commentCount && post.comment_count > 0) {
    commentCount.textContent = post.comment_count;
    commentCount.hidden = false;
  }

  commentBtn.style.pointerEvents = 'none';

  let voted = false;
  if (api.isAuthed()) {
    api.getMyVotes([post.id]).then(v => {
      voted = v.length > 0;
      if (voted) heatBtn.classList.add('is-hot');
    }).catch(() => {});
  }

  let voting = false;
  heatBtn.addEventListener('click', async () => {
    if (voting) return;
    if (!api.isAuthed()) return window.__anon.openSignup();
    voting = true;
    haptic(8);
    const wasVoted = voted;
    heatBtn.classList.toggle('is-hot');
    if (!wasVoted) {
      heatBtn.classList.remove('heat-bump');
      void heatBtn.offsetWidth;
      heatBtn.classList.add('heat-bump');
    }
    try {
      await api.toggleVote(post.id, wasVoted);
      voted = !wasVoted;
    } catch {
      heatBtn.classList.toggle('is-hot');
      toast('Failed.');
    } finally { voting = false; }
  });

  shareBtn.addEventListener('click', () => sharePost(post));

  const myUid = api.getSession()?.user_id;
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
  if (!data) { box.appendChild(el('div', { class: 'poll--fallback' }, 'Loading…')); return; }
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

function openCommentMenu(comment, onDelete) {
  const tpl = document.getElementById('tpl-comment-more-sheet');
  if (!tpl) return;
  const node = tpl.content.firstElementChild.cloneNode(true);

  node.querySelector('[data-action="delete-comment"]')?.addEventListener('click', async () => {
    if (!confirm('Delete this comment? Replies to it will stay visible.')) return;
    try {
      await api.softDeleteComment(comment.id);
      closeSheet();
      toast('Comment deleted.');
      onDelete();
    } catch { toast('Delete failed.'); }
  });

  node.querySelector('[data-action="cancel"]').addEventListener('click', closeSheet);
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