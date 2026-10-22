import * as api from '../api.js';
import { timeAgo, el, toast, openSheet, closeSheet } from '../ui.js';

const ERR_MSGS = {
  'unauthorized': 'You need to sign in first.',
  'no_profile': 'Complete your profile first.',
  'invalid_reason': 'Pick a reason.'
};

export async function mount(root) {
  root.innerHTML = '';
  if (!api.isAuthed()) {
    window.__anon.openSignup();
    return () => {};
  }

  const screen = document.getElementById('tpl-messages-screen').content.firstElementChild.cloneNode(true);
  root.appendChild(screen);

  const listEl   = screen.querySelector('[data-role="messages-list"]');
  const emptyEl  = screen.querySelector('[data-role="empty-messages"]');
  const urlEl    = screen.querySelector('[data-role="ask-url"]');
  const unreadEl = screen.querySelector('[data-role="unread-badge"]');

  // ---- Ask link ----
  let askLink = null;
  try {
    const rows = await api.getMyAskLink();
    askLink = rows?.[0] || null;
  } catch {}

  const askUrl = askLink ? `${location.origin}/ask/${askLink.shortcode}` : '';
  urlEl.textContent = askUrl.replace(/^https?:\/\//, '');

  screen.querySelector('[data-action="copy-ask"]').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(askUrl); toast('Link copied.'); }
    catch { toast('Copy failed.'); }
  });

  screen.querySelector('[data-action="share-ask"]').addEventListener('click', async () => {
    if (!askUrl) return;
    const blob = await generateAskCard(askUrl);
    await shareImage(blob, 'Send me anonymous messages on Anonymous');
  });

  // ---- Load messages ----
  let messages = [];
  try {
    messages = await api.listMyMessages();
  } catch (err) {
    console.error('[messages] load failed:', err);
  }

  const unread = messages.filter(m => !m.is_read).length;
  if (unread > 0) {
    unreadEl.hidden = false;
    unreadEl.textContent = `${unread} unread`;
  }

  if (!messages.length) {
    emptyEl.hidden = false;
    return () => {};
  }

  // Mark all as read (user is viewing them)
  for (const m of messages) {
    if (!m.is_read) api.markMessageRead(m.id).catch(() => {});
  }

  // ---- Render messages ----
  const itemTpl = document.getElementById('tpl-message-item');
  for (const msg of messages) {
    const node = itemTpl.content.firstElementChild.cloneNode(true);
    node.dataset.messageId = msg.id;

    node.querySelector('.message-item__content').textContent = msg.content;
    node.querySelector('.message-item__time').textContent = timeAgo(msg.created_at);
    if (!msg.is_read) node.querySelector('.message-item__unread-dot').hidden = false;

    node.querySelector('[data-action="reply-public"]').addEventListener('click', () => {
      openReplyPublicSheet(msg);
    });

    node.querySelector('[data-action="share-story"]').addEventListener('click', () => {
      openShareStorySheet(msg);
    });

    node.querySelector('[data-action="message-more"]').addEventListener('click', () => {
      openMoreSheet(msg, node);
    });

    listEl.appendChild(node);
  }

  return () => {};
}

// ---------- MORE MENU ----------

function openMoreSheet(msg, node) {
  const tpl = document.getElementById('tpl-message-more-sheet');
  const sheet = tpl.content.firstElementChild.cloneNode(true);

  sheet.querySelector('[data-action="report-message"]').addEventListener('click', () => {
    closeSheet();
    openReportSheet(msg);
  });

  sheet.querySelector('[data-action="block-sender"]').addEventListener('click', async () => {
    if (!confirm('Block this sender? You will not receive messages from them again. They will never know.')) return;
    try {
      await api.blockMessageSender(msg.id);
      closeSheet();
      toast('Sender blocked.');
      node.remove();
    } catch (err) {
      toast('Block failed.');
    }
  });

  sheet.querySelector('[data-action="delete-message"]').addEventListener('click', async () => {
    try {
      await api.deleteMyMessage(msg.id);
      closeSheet();
      toast('Message deleted.');
      node.remove();
    } catch (err) {
      toast('Delete failed.');
    }
  });

  sheet.querySelector('[data-action="cancel"]').addEventListener('click', closeSheet);
  openSheet(sheet);
}

// ---------- REPORT ----------

function openReportSheet(msg) {
  const tpl = document.getElementById('tpl-report-sheet');
  const sheet = tpl.content.firstElementChild.cloneNode(true);

  sheet.querySelectorAll('[data-reason]').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await api.reportMessage(msg.id, btn.dataset.reason);
        closeSheet();
        toast('Report sent.');
      } catch {
        toast('Report failed.');
      }
    });
  });
  sheet.querySelector('[data-action="cancel"]').addEventListener('click', closeSheet);
  openSheet(sheet);
}

// ---------- REPLY PUBLICLY ----------

function openReplyPublicSheet(msg) {
  const tpl = document.getElementById('tpl-reply-compose');
  const node = tpl.content.firstElementChild.cloneNode(true);

  node.querySelector('[data-role="reply-quote"]').textContent = msg.content;

  const form = node.querySelector('[data-role="reply-compose-form"]');
  const textarea = node.querySelector('[data-role="reply-textarea"]');
  const submit = node.querySelector('[data-role="reply-submit"]');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const reply = textarea.value.trim();
    if (!reply) return;
    submit.disabled = true;
    submit.textContent = 'Posting…';
    try {
      await api.replyPubliclyToMessage(msg.id, reply);
      closeSheet();
      toast('Posted to the feed.');
      import('../router.js').then(r => r.navigate('/'));
    } catch (err) {
      toast('Post failed.');
      submit.disabled = false;
      submit.textContent = 'Post anonymously';
    }
  });

  openSheet(node);
  setTimeout(() => textarea.focus(), 250);
}

// ---------- SHARE STORY ----------

function openShareStorySheet(msg) {
  const tpl = document.getElementById('tpl-share-story-sheet');
  const sheet = tpl.content.firstElementChild.cloneNode(true);

  sheet.querySelector('[data-role="story-text"]').textContent = `"${msg.content}"`;

  sheet.querySelector('[data-action="share-story-confirm"]').addEventListener('click', async () => {
    try {
      const blob = await generateStoryCard(msg.content);
      await shareImage(blob, 'An anonymous message I got on Anonymous');
      closeSheet();
    } catch (err) {
      toast('Share failed.');
    }
  });

  sheet.querySelector('[data-action="cancel"]').addEventListener('click', closeSheet);
  openSheet(sheet);
}

// ---------- IMAGE GENERATION ----------

async function generateStoryCard(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1080;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#100E0C';
  ctx.fillRect(0, 0, 1080, 1080);

  const gradient = ctx.createRadialGradient(540, 200, 0, 540, 200, 450);
  gradient.addColorStop(0, 'rgba(245,158,11,0.18)');
  gradient.addColorStop(1, 'rgba(245,158,11,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1080, 1080);

  ctx.fillStyle = '#F59E0B';
  ctx.font = 'bold 32px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('ANONYMOUS MESSAGE I GOT', 540, 200);

  ctx.fillStyle = '#F5EFE6';
  ctx.font = '46px system-ui, -apple-system, sans-serif';
  wrapText(ctx, `"${text}"`, 540, 340, 880, 66);

  ctx.fillStyle = 'rgba(255,240,220,0.55)';
  ctx.font = '28px system-ui, -apple-system, sans-serif';
  ctx.fillText('— sent on Anonymous', 540, 950);

  return new Promise(resolve => canvas.toBlob(b => resolve(b), 'image/png', 0.92));
}

async function generateAskCard(url) {
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1080;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#100E0C';
  ctx.fillRect(0, 0, 1080, 1080);

  const gradient = ctx.createRadialGradient(540, 300, 0, 540, 300, 500);
  gradient.addColorStop(0, 'rgba(245,158,11,0.20)');
  gradient.addColorStop(1, 'rgba(245,158,11,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1080, 1080);

  ctx.fillStyle = '#F59E0B';
  ctx.font = 'bold 40px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('SEND ME', 540, 380);
  ctx.fillText('ANONYMOUS MESSAGES', 540, 440);

  ctx.fillStyle = '#F5EFE6';
  ctx.font = '36px system-ui, -apple-system, sans-serif';
  ctx.fillText(url.replace(/^https?:\/\//, ''), 540, 600);

  ctx.fillStyle = 'rgba(255,240,220,0.55)';
  ctx.font = '26px system-ui, -apple-system, sans-serif';
  ctx.fillText('— Anonymous', 540, 950);

  return new Promise(resolve => canvas.toBlob(b => resolve(b), 'image/png', 0.92));
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(' ');
  let line = '';
  let currentY = y;

  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + ' ';
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && n > 0) {
      ctx.fillText(line.trim(), x, currentY);
      line = words[n] + ' ';
      currentY += lineHeight;
      if (currentY > 850) {
        ctx.fillText('...', x, currentY);
        return;
      }
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line.trim(), x, currentY);
}

async function shareImage(blob, text) {
  if (!blob) throw new Error('no_blob');
  const file = new File([blob], 'anonymous.png', { type: 'image/png' });
  if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], text }); return; } catch {}
  }
  // Fallback: download
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'anonymous.png';
  a.click();
  URL.revokeObjectURL(url);
}