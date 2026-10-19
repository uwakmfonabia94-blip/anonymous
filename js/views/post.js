import * as api from '../api.js';
import { timeAgo, renderAvatar, el, toast, sharePost, openSheet, closeSheet } from '../ui.js';

export async function mount(root, params) {
  root.innerHTML = '';
  const tpl = document.getElementById('tpl-post-detail');
  const screen = tpl.content.firstElementChild.cloneNode(true);
  root.appendChild(screen);

  const postBox    = screen.querySelector('[data-role="post"]');
  const commentsEl = screen.querySelector('[data-role="comments"]');
  const heading    = screen.querySelector('[data-role="comments-heading"]');
  const replyForm  = screen.querySelector('[data-role="reply-form"]');
  const replyInput = screen.querySelector('[data-role="reply-input"]');

  screen.querySelector('[data-action="back"]').addEventListener('click', () => history.back());

  // Show loading state
  postBox.innerHTML = '<p class="empty-state__text" style="padding:24px 0;">Loading…</p>';

  let post;
  try {
    post = await api.getPostFull(params.id);
  } catch (err) {
    console.error('[post.js] getPostFull threw:', err);
    postBox.innerHTML = '';
    postBox.appendChild(el('p', { class: 'empty-state__text', style: 'padding:24px 0;color:var(--alert);' },
      'Could not load this post. Check the console for details.'));
    return () => {};
  }

  postBox.innerHTML = '';

  if (!post) {
    postBox.appendChild(el('p', { class: 'empty-state__text', style: 'padding:24px 0;' },
      'Post not found. It may have been deleted.'));
    return () => {};
  }

  // ---- Build post card ----
  const cardTpl = document.getElementById('tpl-post-card');
  const card = cardTpl.content.firstElementChild.cloneNode(true);
  card.dataset.postId = post.id;

  renderAvatar(card.querySelector('.avatar'), post.author_alias);
  card.querySelector('.post-card__alias').textContent = post.author_alias;
  card.querySelector('.post-card__time').textContent  = timeAgo(post.created_at);

  if (post.category && post.category !== 'General') {
    card.querySelector('.post-card__category-dot').hidden = false;
    const cat = card.querySelector('.post-card__category');
    cat.hidden = false;
    cat.textContent = `#${post.category}`;
  }

  card.querySelector('.post-card__body').textContent = post.content;

  const [voteBtn, commentBtn, shareBtn] = card.querySelectorAll('.post-card__action');
  voteBtn.querySelector('.post-card__count').textContent    = post.upvote_count ?? 0;
  commentBtn.querySelector('.post-card__count').textContent = post.comment_count ?? 0;

  let voted = false;
  if (api.isAuthed()) {
    try {
      const v = await api.getMyVotes([post.id]);
      voted = v.length > 0;
      if (voted) voteBtn.classList.add('is-liked');
    } catch {}
  }

  let voting = false;
  voteBtn.addEventListener('click', async () => {
    if (voting) return;
    if (!api.isAuthed()) return window.__anon.openSignup();
    voting = true;
    const wasVoted = voted;
    voteBtn.classList.toggle('is-liked');
    const c = voteBtn.querySelector('.post-card__count');
    c.textContent = Number(c.textContent) + (wasVoted ? -1 : 1);
    try {
      await api.toggleVote(post.id, wasVoted);
      voted = !wasVoted;
    } catch {
      voteBtn.classList.toggle('is-liked');
      c.textContent = Number(c.textContent) + (wasVoted ? 1 : -1);
      toast('Vote failed.');
    } finally {
      voting = false;
    }
  });

  shareBtn.addEventListener('click', () => sharePost(post));
  card.querySelector('[data-action="open"]').style.pointerEvents = 'none';

  const myUid  = api.isAuthed() ? api.getSession()?.user_id : null;
  const isMine = myUid && myUid === post.author_id;

  card.querySelector('[data-action="more"]').addEventListener('click', () => {
    const moreTpl = document.getElementById('tpl-more-sheet');
    const node = moreTpl.content.firstElementChild.cloneNode(true);

    const deleteBtn = node.querySelector('[data-action="delete"]');
    if (isMine) deleteBtn.hidden = false;

    deleteBtn.addEventListener('click', async () => {
      if (!confirm('Delete this post? This cannot be undone.')) return;
      try {
        await api.deletePost(post.id);
        closeSheet();
        toast('Post deleted.');
        history.back();
      } catch {
        toast('Delete failed.');
      }
    });

    node.querySelector('[data-action="share"]').addEventListener('click', () => {
      closeSheet();
      sharePost(post);
    });
    node.querySelector('[data-action="cancel"]').addEventListener('click', closeSheet);
    node.querySelector('[data-action="report"]').addEventListener('click', () => {
      closeSheet();
      if (!api.isAuthed()) return window.__anon.openSignup();
      if (isMine) return toast("You can't report your own post.");
      openReportSheet(post.id, null);
    });

    openSheet(node);
  });

  postBox.appendChild(card);

  // ---- Comments ----
  let parentId = null;

  async function loadComments() {
    try {
      const comments = await api.listComments(post.id);
      heading.textContent = `Comments (${comments.length})`;
      commentsEl.innerHTML = '';

      const byParent = new Map();
      const rootComments = [];
      for (const c of comments) {
        if (!c.parent_id) rootComments.push(c);
        else {
          if (!byParent.has(c.parent_id)) byParent.set(c.parent_id, []);
          byParent.get(c.parent_id).push(c);
        }
      }

      const commentTpl = document.getElementById('tpl-comment');

      const renderOne = (c, isReply = false) => {
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
          replies.forEach(r => container.appendChild(renderOne(r, true)));
        } else {
          const container = node.querySelector('[data-role="replies"]');
          if (container) container.remove();
        }

        return node;
      };

      rootComments.forEach(c => commentsEl.appendChild(renderOne(c)));

      if (!comments.length) {
        commentsEl.appendChild(el('p', { class: 'comments__empty' }, 'No comments yet. Be the first.'));
      }
    } catch (err) {
      console.error('[post.js] loadComments failed:', err);
      toast('Could not load comments.');
    }
  }

  await loadComments();

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
      commentBtn.querySelector('.post-card__count').textContent = post.comment_count;
    } catch (err) {
      console.error('[post.js] createComment failed:', err);
      toast('Reply failed.');
      replyInput.value = content;
    } finally {
      replyInput.disabled = false;
    }
  });

  return () => {};
}

function openReportSheet(postId, commentId) {
  const tpl = document.getElementById('tpl-report-sheet');
  const node = tpl.content.firstElementChild.cloneNode(true);

  node.querySelectorAll('[data-reason]').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await api.createReport({ postId, commentId, reason: btn.dataset.reason });
        closeSheet();
        toast('Report sent.');
      } catch {
        toast('Report failed.');
      }
    });
  });

  node.querySelector('[data-action="cancel"]').addEventListener('click', closeSheet);
  openSheet(node);
}