// POST   /api/upload  { name, code, mimeType, data(base64) } → { file: { id, name } }
// DELETE /api/upload?id=…                                  → moves the screenshot to Drive trash
import { uploadImage, trashImage } from '../lib/drive.js';
import { readBody, validName, validCode, validId, methodNotAllowed, sendError } from '../lib/http.js';

// Vercel caps request bodies at 4.5 MB; the browser shrinks images well under this before sending.
const MAX_BASE64 = 4 * 1024 * 1024;

export default async function handler(req, res) {
  try {
    if (req.method === 'POST') {
      let b;
      try { b = readBody(req); } catch (e) { return res.status(400).json({ ok: false, error: 'Bad JSON' }); }
      if (!validName(b.name) || !validCode(b.code)) return res.status(400).json({ ok: false, error: 'Invalid name or case' });
      if (!/^image\/(png|jpeg|gif|webp)$/.test(b.mimeType || '')) return res.status(400).json({ ok: false, error: 'Unsupported image type' });
      if (typeof b.data !== 'string' || !b.data || b.data.length > MAX_BASE64) return res.status(413).json({ ok: false, error: 'Image is too large' });
      const file = await uploadImage({ name: b.name, code: b.code, mimeType: b.mimeType, data: b.data });
      return res.status(200).json({ ok: true, file: { id: file.id, name: file.name } });
    }
    if (req.method === 'DELETE') {
      const id = String(req.query.id || '');
      if (!validId(id)) return res.status(400).json({ ok: false, error: 'Invalid id' });
      await trashImage(id);
      return res.status(200).json({ ok: true });
    }
    return methodNotAllowed(res, 'POST, DELETE');
  } catch (e) {
    return sendError(res, e);
  }
}
