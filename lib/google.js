// Calls Google APIs as the account that authorized scripts/get-google-token.mjs.
// Env vars (Vercel → Project → Settings → Environment Variables):
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET  from the Google Cloud OAuth client
//   GOOGLE_REFRESH_TOKEN                    printed by scripts/get-google-token.mjs
//   SHEET_ID                                from the sheet URL: docs.google.com/spreadsheets/d/<SHEET_ID>/edit
//   FOLDER_ID                               from the folder URL: drive.google.com/drive/folders/<FOLDER_ID>
export const REQUIRED_ENV = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN', 'SHEET_ID', 'FOLDER_ID'];
export const env = (k) => String(process.env[k] || '').trim();

export class GoogleError extends Error {
  constructor(message, status) { super(message); this.status = status || 502; }
}

let cached = null; // { token, exp } — reused while the function instance stays warm

async function accessToken() {
  const missing = REQUIRED_ENV.filter((k) => !env(k));
  if (missing.length) throw new GoogleError('Missing environment variables on the server: ' + missing.join(', '), 500);
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env('GOOGLE_CLIENT_ID'),
      client_secret: env('GOOGLE_CLIENT_SECRET'),
      refresh_token: env('GOOGLE_REFRESH_TOKEN'),
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new GoogleError(data.error === 'invalid_grant'
      ? 'Google sign-in for the server has expired or was revoked. Run scripts/get-google-token.mjs again and update GOOGLE_REFRESH_TOKEN.'
      : 'Could not sign in to Google (' + (data.error_description || data.error || res.status) + '). Check GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.', 500);
  }
  cached = { token: data.access_token, exp: Date.now() + (data.expires_in || 3600) * 1000 };
  return cached.token;
}

// google('GET', url) → parsed JSON. Pass { json } to send a JSON body, or { body, headers } for anything else.
// With { raw: true } the fetch Response is returned (for downloading file bytes).
export async function google(method, url, opts = {}) {
  const headers = { Authorization: 'Bearer ' + await accessToken(), ...(opts.headers || {}) };
  if (opts.json) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, { method, headers, body: opts.json ? JSON.stringify(opts.json) : opts.body });
  if (res.ok && opts.raw) return res;
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch (e) {}
  if (!res.ok) {
    const msg = (data.error && data.error.message) || ('Google API error ' + res.status);
    const hint = res.status === 404 ? ' Check SHEET_ID / FOLDER_ID.'
      : res.status === 403 ? ' Make sure the Google Sheets and Drive APIs are enabled and your account can edit the sheet and folder.' : '';
    throw new GoogleError(msg + hint, res.status === 404 ? 404 : 502);
  }
  return data;
}
