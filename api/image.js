// GET /api/image?id=… → the screenshot itself, so thumbnails work without making Drive files public.
import { readImage } from '../lib/drive.js';
import { validId, methodNotAllowed, sendError } from '../lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, 'GET');
  const id = String(req.query.id || '');
  if (!validId(id)) return res.status(400).json({ ok: false, error: 'Invalid id' });
  try {
    const img = await readImage(id);
    res.setHeader('Content-Type', img.mimeType || 'application/octet-stream');
    // A Drive file id always points at the same bytes, so browsers and Vercel's CDN can keep it.
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return res.status(200).send(img.bytes);
  } catch (e) {
    return sendError(res, e);
  }
}
