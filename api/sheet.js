// GET  /api/sheet?name=…  → this tester's saved results
// POST /api/sheet         → save this tester's results (their Results row + Details rows)
import { saveTester, loadTester } from '../lib/sheet.js';
import { readBody, validName, validCode, methodNotAllowed, sendError } from '../lib/http.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const name = String(req.query.name || '');
      if (!validName(name)) return res.status(400).json({ ok: false, error: 'Missing name' });
      return res.status(200).json({ ok: true, results: await loadTester(name.trim()) });
    }
    if (req.method === 'POST') {
      let body;
      try { body = readBody(req); } catch (e) { return res.status(400).json({ ok: false, error: 'Bad JSON' }); }
      const problem = validate(body);
      if (problem) return res.status(400).json({ ok: false, error: problem });
      await saveTester({ name: body.name.trim(), cases: body.cases, results: body.results, submitted: !!body.submitted });
      return res.status(200).json({ ok: true });
    }
    return methodNotAllowed(res, 'GET, POST');
  } catch (e) {
    return sendError(res, e);
  }
}

function validate(b) {
  if (!validName(b.name)) return 'Invalid name';
  if (!Array.isArray(b.cases) || b.cases.length > 500) return 'Invalid cases';
  if (b.cases.some((c) => !c || !validCode(c.code) || typeof c.title !== 'string')) return 'Invalid cases';
  if (!b.results || typeof b.results !== 'object' || Array.isArray(b.results)) return 'Invalid results';
  return null;
}
