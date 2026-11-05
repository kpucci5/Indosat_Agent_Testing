#!/usr/bin/env node
// One-time: signs you in to Google and prints the GOOGLE_REFRESH_TOKEN for Vercel.
//
//   node scripts/get-google-token.mjs <GOOGLE_CLIENT_ID> <GOOGLE_CLIENT_SECRET>
//
// Uses a "Desktop app" OAuth client; Google sends you back to this script on 127.0.0.1.
import http from 'node:http';
import { exec } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const [clientId, clientSecret] = process.argv.slice(2).map((s) => (s || '').trim());
if (!clientId || !clientSecret) {
  console.error('Usage: node scripts/get-google-token.mjs <GOOGLE_CLIENT_ID> <GOOGLE_CLIENT_SECRET>');
  process.exit(1);
}

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'];
const state = randomBytes(16).toString('hex');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname !== '/') { res.writeHead(404).end(); return; }
  const fail = (msg) => { res.writeHead(400, { 'Content-Type': 'text/plain' }).end(msg); console.error('\n' + msg); server.close(); process.exitCode = 1; };
  if (url.searchParams.get('state') !== state) return fail('State mismatch — start the script again.');
  if (url.searchParams.get('error')) return fail('Google returned: ' + url.searchParams.get('error'));

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: url.searchParams.get('code'), client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
  });
  const data = await tokenRes.json();
  if (!tokenRes.ok || !data.refresh_token) return fail('Could not get a refresh token: ' + JSON.stringify(data));

  res.writeHead(200, { 'Content-Type': 'text/plain' }).end('Done — go back to the terminal. You can close this tab.');
  console.log('\nSigned in. Add this to Vercel as GOOGLE_REFRESH_TOKEN:\n\n' + data.refresh_token + '\n');
  server.close();
});

let redirectUri;
server.listen(0, '127.0.0.1', () => {
  redirectUri = 'http://127.0.0.1:' + server.address().port;
  const auth = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: SCOPES.join(' '),
    access_type: 'offline', prompt: 'consent', state,
  });
  console.log('Opening Google sign-in. If nothing opens, paste this into your browser:\n\n' + auth + '\n');
  exec((process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open') + ' "' + auth + '"');
});
