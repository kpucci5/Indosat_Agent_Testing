// GET    /api/cases                → case edits made in the tracker (override the files in cases/)
// POST   /api/cases { case, by }   → add or update one case
// DELETE /api/cases?code=…&by=…    → hide a case
import { loadCaseEdits, saveCaseEdit } from '../lib/sheet.js';
import { readBody, validName, validCode, validId, methodNotAllowed, sendError } from '../lib/http.js';

const text = (v, max) => String(v == null ? '' : v).slice(0, max);
const lines = (v, max) => (Array.isArray(v) ? v : []).map((s) => text(s, 1000).trim()).filter(Boolean).slice(0, max);

// Keeps only known fields, trimmed to sane sizes.
function clean(c) {
  if (!c || !validCode(c.code)) return null;
  const title = text(c.title, 200).trim();
  if (!title) return null;
  const pr = c.pr === null || c.pr === '' || c.pr === undefined ? null : Number(c.pr);
  return {
    code: c.code, title,
    area: text(c.area, 80).trim() || 'General',
    pr: Number.isInteger(pr) && pr >= 0 && pr <= 9 ? pr : null,
    level: text(c.level, 40).trim(), // levels are set per test set in cases/index.json
    owner: text(c.owner, 80).trim(), dev: text(c.dev, 120).trim(),
    steps: lines(c.steps, 50), expected: text(c.expected, 2000).trim(), notes: lines(c.notes, 50),
    attachments: (Array.isArray(c.attachments) ? c.attachments : []).slice(0, 20)
      .filter((a) => a && ((typeof a.src === 'string' && /^images\/[A-Za-z0-9_.-]+$/.test(a.src)) || validId(a.id)))
      .map((a) => ({ ...(a.src ? { src: a.src } : { id: a.id }), caption: text(a.caption, 200), ...(a.source ? { source: text(a.source, 80) } : {}) })),
  };
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') return res.status(200).json({ ok: true, cases: await loadCaseEdits() });
    if (req.method === 'POST') {
      let b;
      try { b = readBody(req); } catch (e) { return res.status(400).json({ ok: false, error: 'Bad JSON' }); }
      const c = clean(b.case);
      if (!c) return res.status(400).json({ ok: false, error: 'A case needs a valid ID (letters, numbers, - or _) and a title.' });
      if (!validName(b.by)) return res.status(400).json({ ok: false, error: 'Missing tester name' });
      await saveCaseEdit(c, b.by.trim());
      return res.status(200).json({ ok: true, case: c });
    }
    if (req.method === 'DELETE') {
      const code = String(req.query.code || ''), by = String(req.query.by || '');
      if (!validCode(code) || !validName(by)) return res.status(400).json({ ok: false, error: 'Invalid code or name' });
      await saveCaseEdit({ code, deleted: true }, by.trim());
      return res.status(200).json({ ok: true });
    }
    return methodNotAllowed(res, 'GET, POST, DELETE');
  } catch (e) {
    return sendError(res, e);
  }
}
