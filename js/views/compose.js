import * as api from '../api.js';
import { compressImage, validateFile } from '../media.js';
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
  "Tell us something true.",
];

const MAX_PHOTOS = 2;

export async function mount(root) {
  if (!api.isAuthed()) { window.__anon.openSignup(); return () => {}; }

  root.innerHTML = '';
  const screen = document.getElementById('tpl-compose').content.firstElementChild.cloneNode(true);
  root.appendChild(screen);

  const textMode     = screen.querySelector('[data-role="text-mode"]');
  const pollMode     = screen.querySelector('[data-role="poll-mode"]');
  const textarea     = screen.querySelector('[data-role="textarea"]');
  const questionEl   = screen.querySelector('[data-role="question"]');
  const counter      = screen.querySelector('[data-role="counter"]');
  const qCounter     = screen.querySelector('[data-role="q-counter"]');
  const optionsBox   = screen.querySelector('[data-role="options"]');
  const addBtn       = screen.querySelector('[data-action="add-option"]');
  const submit       = screen.querySelector('[data-action="submit"]');
  const close        = screen.querySelector('[data-action="close"]');
  const tabs         = screen.querySelectorAll('.compose__tab');
  const chips        = screen.querySelectorAll('.chip');
  const shareableEl  = screen.querySelector('[data-role="shareable-wrap"]');
  const pickerSlot   = screen.querySelector('[data-role="photo-picker-slot"]');

  // ---- Photo picker ----
  const pickerTpl = document.getElementById('tpl-photo-picker');
  const picker = pickerTpl.content.firstElementChild.cloneNode(true);
  pickerSlot.appendChild(picker);

  const pickPhotoBtn = picker.querySelector('[data-action="pick-photo"]');
  const fileInput    = picker.querySelector('[data-role="file-input"]');
  const previews     = picker.querySelector('[data-role="previews"]');
  const photoCount   = picker.querySelector('[data-role="photo-count"]');

  let photos = []; // [{ file, previewUrl }]

  function renderPreviews() {
    previews.innerHTML = '';
    const tpl = document.getElementById('tpl-photo-preview');
    photos.forEach((p, i) => {
      const node = tpl.content.firstElementChild.cloneNode(true);
      node.querySelector('.photo-preview__img').src = p.previewUrl;
      node.querySelector('[data-action="remove-photo"]').addEventListener('click', () => {
        URL.revokeObjectURL(p.previewUrl);
        photos.splice(i, 1);
        renderPreviews();
        updateState();
      });
      previews.appendChild(node);
    });
    photoCount.textContent = `${photos.length}/${MAX_PHOTOS}`;
    pickPhotoBtn.disabled = photos.length >= MAX_PHOTOS;
  }

  pickPhotoBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async () => {
    const files = Array.from(fileInput.files || []);
    fileInput.value = '';
    if (!files.length) return;

    for (const file of files) {
      if (photos.length >= MAX_PHOTOS) {
        toast(`Max ${MAX_PHOTOS} photos.`);
        break;
      }
      const err = validateFile(file);
      if (err) { toast(err); continue; }
      photos.push({ file, previewUrl: URL.createObjectURL(file) });
    }
    renderPreviews();
    updateState();
  });

  // ---- Poll option editor ----
  let mode = 'text';
  let category = 'General';
  let options = [];

  const suggestedPrompt = sessionStorage.getItem('anon.composePrompt');
  sessionStorage.removeItem('anon.composePrompt');
  textarea.placeholder = suggestedPrompt || PROMPTS[Math.floor(Math.random() * PROMPTS.length)];

  function addOptionRow(value = '') {
    if (options.length >= 4) return;
    const row = document.getElementById('tpl-poll-option-input').content.firstElementChild.cloneNode(true);
    const input = row.querySelector('.poll-editor__input');
    const removeBtn = row.querySelector('.poll-editor__remove');
    input.value = value;
    input.placeholder = `Option ${options.length + 1}`;
    input.addEventListener('input', updateState);
    removeBtn.addEventListener('click', () => {
      if (options.length <= 2) return;
      row.remove();
      options = options.filter(o => o.row !== row);
      renumber();
      updateState();
    });
    optionsBox.appendChild(row);
    options.push({ row, input, removeBtn });
    renumber();
  }

  function renumber() {
    options.forEach((o, i) => { o.input.placeholder = `Option ${i + 1}`; });
    options.forEach(o => { o.removeBtn.disabled = options.length <= 2; });
    addBtn.disabled = options.length >= 4;
  }

  function updateState() {
    if (mode === 'text') {
      const len = textarea.value.trim().length;
      counter.textContent = len;
      const hasContent = len > 0;
      const hasPhotos = photos.length > 0;
      submit.disabled = !(hasContent || hasPhotos) || photos.length > MAX_PHOTOS;
    } else {
      const qLen = questionEl.value.trim().length;
      qCounter.textContent = qLen;
      const filled = options.filter(o => o.input.value.trim().length > 0).length;
      submit.disabled = !(qLen > 0 && filled >= 2 && filled === options.length);
    }
  }

  textarea.addEventListener('input', updateState);
  questionEl.addEventListener('input', updateState);
  addBtn.addEventListener('click', () => addOptionRow());

  addOptionRow();
  addOptionRow();
  updateState();

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('is-active'));
      tab.classList.add('is-active');
      mode = tab.dataset.mode;
      textMode.hidden = mode !== 'text';
      pollMode.hidden = mode !== 'poll';
      shareableEl.style.display = mode === 'poll' ? 'none' : '';
      updateState();
    });
  });

  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      chips.forEach(c => c.classList.remove('chip--active'));
      chip.classList.add('chip--active');
      category = chip.dataset.cat || 'General';
    });
  });

  close.addEventListener('click', () => {
    photos.forEach(p => URL.revokeObjectURL(p.previewUrl));
    history.back();
  });

  // ---- Submit ----
  submit.addEventListener('click', async () => {
    submit.disabled = true;
    const original = submit.textContent;
    submit.textContent = 'Posting…';

    try {
      if (mode === 'text') {
        const content = textarea.value.trim();
        const hasPhotos = photos.length > 0;
        if (!content && !hasPhotos) throw new Error('empty');

        // Force shareable: false if photos present (no image previews in OG)
        const shareable = hasPhotos ? false : screen.querySelector('[data-role="shareable"]').checked;

        const post = await api.createPost({ content, category, shareable });
        if (!post?.id) throw new Error('no_post_id');

        if (hasPhotos) {
          await uploadPhotos(post.id);
        }

        sessionStorage.setItem('anon.justPosted', post.id);
      } else {
        const question = questionEl.value.trim();
        const opts = options.map(o => o.input.value.trim()).filter(Boolean);
        if (question.length < 1 || opts.length < 2 || opts.length > 4) throw new Error('invalid');
        const postId = await api.createPoll({ question, options: opts, category });
        if (postId) sessionStorage.setItem('anon.justPosted', postId);
      }

      photos.forEach(p => URL.revokeObjectURL(p.previewUrl));
      toast('Posted.');
      navigate('/', { replace: true });
    } catch (err) {
      console.error('[compose] submit failed:', err);
      toast(err.message === 'upload_failed' ? 'Photo upload failed.' : 'Post failed.');
      submit.disabled = false;
      submit.textContent = original;
    }
  });

  // ---- Photo upload pipeline ----
  async function uploadPhotos(postId) {
    const uid = api.getSession()?.user_id;
    if (!uid) throw new Error('auth_required');

    const uploaded = [];
    try {
      for (let i = 0; i < photos.length; i++) {
        submit.textContent = `Uploading ${i + 1}/${photos.length}…`;
        const { blob, width, height } = await compressImage(photos[i].file);
        const path = `${uid}/${postId}/${i}.jpg`;
        await api.uploadMediaBlob(blob, path);
        uploaded.push(path);
        await api.insertPostMedia({ postId, path, width, height, position: i });
      }
    } catch (err) {
      // Clean up: storage blobs, then the post (cascade deletes post_media rows)
      for (const p of uploaded) await api.deleteMediaBlob(p);
      await api.deletePost(postId).catch(() => {});
      throw new Error('upload_failed');
    }
  }

  setTimeout(() => (mode === 'text' ? textarea : questionEl).focus(), 50);

  return () => {
    photos.forEach(p => URL.revokeObjectURL(p.previewUrl));
  };
}