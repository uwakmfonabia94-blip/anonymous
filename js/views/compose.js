import * as api from '../api.js';
import { toast } from '../ui.js';
import { navigate } from '../router.js';

const PROMPTS = [
  "What's on your mind?",
  "Confess something.",
  "Unpopular opinion:",
  "Rate something on campus:",
  "Ask the campus a question.",
  "What's the weirdest thing that happened today?",
  "Say the thing nobody's saying.",
  "One thing everyone should know about this campus:",
  "Tell us something true.",
];

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

  // Prefer spice prompt if user came from a spice card
  const suggestedPrompt = sessionStorage.getItem('anon.composePrompt');
  sessionStorage.removeItem('anon.composePrompt');
  textarea.placeholder = suggestedPrompt || PROMPTS[Math.floor(Math.random() * PROMPTS.length)];

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
      if (post?.id) {
        sessionStorage.setItem('anon.justPosted', post.id);
      }
      toast('Posted.');
      navigate('/', { replace: true });
    } catch {
      toast('Post failed.');
      submit.disabled = false;
      submit.textContent = original;
    }
  });

  return () => {};
}