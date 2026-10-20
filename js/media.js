import { SUPABASE_URL } from './config.js';

const MAX_WIDTH = 1200;
const QUALITY = 0.8;
const SOFT_LIMIT = 500 * 1024; // 500KB — retry at lower quality if exceeded
const HARD_INPUT_LIMIT = 10 * 1024 * 1024; // 10MB raw input cap
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export function validateFile(file) {
  if (!file) return 'No file';
  if (!ALLOWED_TYPES.includes(file.type)) return 'Only JPG, PNG, or WebP.';
  if (file.size > HARD_INPUT_LIMIT) return 'Image too large (max 10MB).';
  return null;
}

export function compressImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, MAX_WIDTH / img.width);
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);

      canvas.toBlob(blob => {
        if (!blob) return reject(new Error('compression_failed'));

        if (blob.size > SOFT_LIMIT) {
          // retry at lower quality
          canvas.toBlob(blob2 => {
            if (!blob2) return reject(new Error('compression_failed'));
            resolve({ blob: blob2, width: w, height: h });
          }, 'image/jpeg', 0.6);
        } else {
          resolve({ blob, width: w, height: h });
        }
      }, 'image/jpeg', QUALITY);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('load_failed'));
    };
    img.src = url;
  });
}

export function buildMediaUrl(path) {
  return `${SUPABASE_URL}/storage/v1/object/public/post-media/${path}`;
}

export function buildViewerWatermark(alias) {
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const tag = alias || 'Guest';
  return `${tag} · ${date}`;
}