import * as api from '../api.js';
import { toast } from '../ui.js';
import { navigate } from '../router.js';

export async function mount(root) {
  if (!api.isAuthed()) { window.__anon.openSignup(); return () => {}; }

  root.innerHTML = '';
  const tpl = document.getElementById('tpl-compose');
  const screen = tpl.content.firstElementChild.cloneNode(true);
  root.appendChild(screen);

  const textarea  = screen.querySelector('[data-role="textarea"]');
  const counter   = screen.querySelector('[data-role="counter"]');
  const submit    = screen.querySelector('[data-action="submit"]');
  const close     = screen.querySelector('[data-action="close"]');
  const chips     = screen.querySelectorAll('.chip');
  const shareable = screen.querySelector('[data-role="shareable"]');

  let category = 'General';

  const updateState = () => {
    const len = textarea.value.trim().length;
    counter.textContent = len;
    submit.disabled = len === 0;
  };

  textarea.addEventListener('input', updateState);
  updateState();
  setTimeout(() => textarea.focus(), 50);

  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      chips.forEach(c => c.classList.remove('chip--active'));
      chip.classList.add('chip--active');
      category = chip.dataset.cat || 'General';
    });
  });

  close.addEventListener('click', () => history.back());

  submit.addEventListener('click', async () => {
    const content = textarea.value.trim();
    if (!content) return;
    submit.disabled = true;
    const original = submit.textContent;
    submit.textContent = 'Posting…';
    try {
      const post = await api.createPost({ content, category, shareable: shareable.checked });
      toast('Posted.');
      navigate('/', { replace: true });
      setTimeout(() => { if (post?.id) navigate(`/p/${post.id}`); }, 50);
    } catch {
      toast('Post failed.');
      submit.disabled = false;
      submit.textContent = original;
    }
  });

  return () => {};
}