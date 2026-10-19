import * as api from '../api.js';
import { timeAgo, renderAvatar, el, toast, sharePost } from '../ui.js';
import { navigate } from '../router.js';

export async function mount(root) {
  root.innerHTML = '';
  const tpl = document.getElementById('tpl-discover');
  const screen = tpl.content.firstElementChild.cloneNode(true);
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

      const cardTpl = document.getElementById('tpl-post-card');
      for (const post of posts) {
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
          const c = voteBtn.querySelector('.post-card__count');
          c.textContent = Number(c.textContent) + (wasVoted ? -1 : 1);
          try {
            await api.toggleVote(post.id, wasVoted);
            if (wasVoted) myVotes.delete(post.id); else myVotes.add(post.id);
          } catch {
            voteBtn.classList.toggle('is-liked');
            c.textContent = Number(c.textContent) + (wasVoted ? 1 : -1);
            toast('Vote failed.');
          } finally {
            voting = false;
          }
        });

        const go = () => navigate(`/p/${post.id}`);
        card.querySelector('[data-action="open"]').addEventListener('click', go);
        card.querySelector('.post-card__body').addEventListener('click', go);
        shareBtn.addEventListener('click', (e) => { e.stopPropagation(); sharePost(post); });

        feed.appendChild(card);
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