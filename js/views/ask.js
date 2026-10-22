import * as api from '../api.js';
import { el, toast, openSheet, closeSheet } from '../ui.js';

const ERR_MSGS = {
  'too_short': 'Message must be at least 100 characters.',
  'too_long': 'Message must be under 300 characters.',
  'invalid_shortcode': "That link doesn't work anymore.",
  'cannot_message_self': "You can't message yourself.",
  'blocked': 'Unable to send.',
  'sender_rate_limit': "You've sent 5 messages today. Try again tomorrow.",
  'recipient_rate_limit': "This person's inbox is full. Try again tomorrow.",
  'already_sent_recently': "You already messaged this person today.",
  'auth_required': 'You need to sign in first.'
};

export async function mount(root, params) {
  root.innerHTML = '';
  const screen = document.getElementById('tpl-ask-page').content.firstElementChild.cloneNode(true);
  root.appendChild(screen);

  const shortcode = params.shortcode;
  const titleEl   = screen.querySelector('.ask-page__title');
  const textarea  = screen.querySelector('[data-role="ask-textarea"]');
  const counter   = screen.querySelector('[data-role="ask-counter"]');
  const sendBtn   = screen.querySelector('[data-action="send-ask"]');
  const formEl    = screen.querySelector('.ask-page__form');
  const successEl = screen.querySelector('[data-role="ask-success"]');
  const remainingEl = screen.querySelector('[data-role="ask-remaining"]');

  screen.querySelector('[data-action="back"]').addEventListener('click', () => history.back());
  screen.querySelector('[data-action="join"]').addEventListener('click', () => window.__anon.openSignup());

  // Look up target
  let target = null;
  try {
    const rows = await api.getAskTarget(shortcode);
    target = rows?.[0] || null;
  } catch {}

  if (!target) {
    titleEl.textContent = 'This link is broken.';
    formEl.hidden = true;
    return () => {};
  }

  titleEl.textContent = `Send ${target.recipient_alias} an anonymous message`;

  // If authed, show remaining count
  if (api.isAuthed()) {
    try {
      const sent = await api.getMySendCountToday();
      const remaining = Math.max(0, 5 - (sent || 0));
      remainingEl.textContent = `You have ${remaining} message${remaining === 1 ? '' : 's'} left today.`;
    } catch {}
  }

  function updateState() {
    const len = textarea.value.trim().length;
    counter.textContent = len;
    sendBtn.disabled = len < 100 || len > 300;
  }
  textarea.addEventListener('input', updateState);
  updateState();

  // Check for pending message (from signup flow)
  const pendingRaw = sessionStorage.getItem('anon.pendingAsk');
  if (pendingRaw && api.isAuthed()) {
    try {
      const pending = JSON.parse(pendingRaw);
      if (pending.shortcode === shortcode) {
        sessionStorage.removeItem('anon.pendingAsk');
        await performSend(pending.content);
      }
    } catch {}
  }

  async function performSend(content) {
    sendBtn.disabled = true;
    const original = sendBtn.textContent;
    sendBtn.textContent = 'Sending…';
    try {
      await api.sendAnonymousMessage(shortcode, content);
      formEl.hidden = true;
      successEl.hidden = false;
      setTimeout(() => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }, 50);
    } catch (err) {
      const msg = String(err.message || err);
      const mapped = Object.keys(ERR_MSGS).find(k => msg.includes(k));
      toast(mapped ? ERR_MSGS[mapped] : 'Send failed.');
      sendBtn.disabled = false;
      sendBtn.textContent = original;
    }
  }

  sendBtn.addEventListener('click', async () => {
    const content = textarea.value.trim();
    if (content.length < 100) return toast(ERR_MSGS['too_short']);

    if (!api.isAuthed()) {
      sessionStorage.setItem('anon.pendingAsk', JSON.stringify({ shortcode, content }));
      window.__anon.openSignup();
      return;
    }

    await performSend(content);
  });

  return () => {};
}