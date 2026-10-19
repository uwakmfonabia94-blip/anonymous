import * as api from '../api.js';
import { timeAgo, renderAvatar, el, toast, sharePost, openSheet, closeSheet } from '../ui.js';

export async function mount(root) {
  root.innerHTML = '';
  const tpl = document.getElementById('tpl-feed-screen');
  const screen = tpl.content.firstElementChild.cloneNode(true);
  root.appendChild(screen);

  const feed     = screen.querySelector('[data-role="feed"]');
  const sentinel = screen.querySelector('[data-role="sentinel"]');

  const skeletonTpl = document.getElementById('tpl-skeleton-card');
  for (let i = 0; i < 3; i++) feed.appendChild(skeletonTpl.content.firstElementChild.cloneNode(true));

  let posts = [];
  try { posts = await api.listFeed({ limit: 20 }); }
  catch (err) {
    console.error(err);
    feed.innerHTML = '';
    feed.appendChild(el('p', { class: 'empty-state__text' }, 'Could not load feed.'));
    return;
  }

  feed.innerHTML = '';
  if (!posts.length) {
    feed.appendChild(document.getElementById('tpl-empty').content.firstElementChild.cloneNode(true));
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

  const renderCards = (list) => {
    const cardTpl = document.getElementById('tpl-post-card');
    for (const post of list) {
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
      voteBtn.querySelector('.post-card__count').textContent    = post.upvote_count;
      commentBtn.querySelector('.post-card__count').textContent = post.comment_count;
      if (myVotes.has(post.id)) voteBtn.classList.add('is-liked');

      let voting = false;
      voteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (voting) return;
        if (!api.isAuthed()) return window.__anon.openSignup();

        voting = true;
        const wasVoted = myVotes.has(post.id);
        voteBtn.classList.toggle('is-liked');
        const countEl = voteBtn.querySelector('.post-card__count');
        countEl.textContent = Number(countEl.textContent) + (wasVoted ? -1 : 1);
        try {
          await api.toggleVote(post.id, wasVoted);
          if (wasVoted) myVotes.delete(post.id); else myVotes.add(post.id);
        } catch {
          voteBtn.classList.toggle('is-liked');
          countEl.textContent = Number(countEl.textContent) + (wasVoted ? 1 : -1);
          toast('Vote failed.');
        } finally {
          voting = false;
        }
      });

      const goToPost = () => import('../router.js').then(r => r.navigate(`/p/${post.id}`));
      card.querySelector('[data-action="open"]').addEventListener('click', goToPost);
      card.querySelector('.post-card__body').addEventListener('click', goToPost);
      shareBtn.addEventListener('click', (e) => { e.stopPropagation(); sharePost(post); });

      card.querySelector('[data-action="more"]').addEventListener('click', (e) => {
        e.stopPropagation();
        openMoreMenu(post, card, myUid);
      });

      feed.appendChild(card);
    }
  };

  renderCards(posts);

  if (!api.isAuthed() && posts.length >= 5) {
    feed.appendChild(document.getElementById('tpl-soft-wall').content.firstElementChild.cloneNode(true));
  }

  let loading = false;
  let done = !api.isAuthed();

  const observer = new IntersectionObserver(async (entries) => {
    if (!entries[0].isIntersecting || loading || done) return;
    loading = true;
    try {
      const last = posts[posts.length - 1];
      const more = await api.listFeed({ limit: 20, before: last.created_at });
      if (!more.length) { done = true; return; }
      posts = posts.concat(more);
      renderCards(more);
    } catch {} finally { loading = false; }
  }, { rootMargin: '200px' });
  observer.observe(sentinel);

  return () => observer.disconnect();
}

function openMoreMenu(post, card, myUid) {
  const tpl = document.getElementById('tpl-more-sheet');
  const node = tpl.content.firstElementChild.cloneNode(true);

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
    openReport(post.id);
  });

  openSheet(node);
}

function openReport(postId) {
  const tpl = document.getElementById('tpl-report-sheet');
  const node = tpl.content.firstElementChild.cloneNode(true);
  node.querySelectorAll('[data-reason]').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await api.createReport({ postId, reason: btn.dataset.reason });
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