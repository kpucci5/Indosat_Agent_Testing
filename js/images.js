// Screenshot upload/remove. Images are shrunk in the browser so they fit Vercel's 4.5 MB request limit.
import { UPLOAD_API, IMAGE_API, IMAGE_TYPES, MAX_IMAGE_EDGE } from './config.js';

const previews = new Map(); // Drive id → local object URL, so fresh uploads show instantly

export const isImage = (f) => IMAGE_TYPES.includes(f.type);
export const imageUrl = (id) => previews.get(id) || IMAGE_API + '?id=' + encodeURIComponent(id);

async function toBase64(blob) {
  const url = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result); r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
  return url.slice(url.indexOf(',') + 1);
}

// Big images become JPEG at most MAX_IMAGE_EDGE px on the long side; small ones go up as-is.
async function shrink(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bmp.width, bmp.height));
  if (scale === 1 && file.size < 1.5 * 1024 * 1024) { bmp.close(); return file; }
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
}

// → { id, name }
export async function uploadImage(file, { name, code }) {
  const blob = await shrink(file);
  const res = await fetch(UPLOAD_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, code, mimeType: blob.type || file.type, data: await toBase64(blob) }),
  });
  let data = null;
  try { data = await res.json(); } catch (e) {}
  if (!res.ok || !data || !data.ok) throw new Error((data && data.error) || 'Upload failed (' + res.status + ')');
  previews.set(data.file.id, URL.createObjectURL(blob));
  return data.file;
}

export function removeImage(id) {
  return fetch(UPLOAD_API + '?id=' + encodeURIComponent(id), { method: 'DELETE' }).catch(() => {});
}
