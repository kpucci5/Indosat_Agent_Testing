// Request validation and error responses shared by the api/ functions.
export const validName = (n) => typeof n === 'string' && n.trim().length > 0 && n.length <= 80;
export const validCode = (c) => typeof c === 'string' && /^[A-Za-z0-9_.-]{1,40}$/.test(c);
export const validId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{10,200}$/.test(id);

export function readBody(req) {
  return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
}

export function methodNotAllowed(res, allow) {
  res.setHeader('Allow', allow);
  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}

export function sendError(res, e) {
  console.error(e);
  return res.status(e.status || 500).json({ ok: false, error: e.message || 'Server error' });
}
