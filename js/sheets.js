// Talks to /api/sheet (a Vercel function that writes to the Google Sheet).
import { SHEET_API, AUTOSAVE_DELAY_MS } from './config.js';

async function call(url, opts) {
  const res = await fetch(url, opts);
  let data = null;
  try { data = await res.json(); } catch (e) {}
  if (!res.ok || !data || !data.ok) throw new Error((data && data.error) || 'Request failed (' + res.status + ')');
  return data;
}

// The tester's existing row, as { [caseCode]: { status, note } }, or null if they have none yet.
export async function fetchResults(name) {
  const data = await call(SHEET_API + '?name=' + encodeURIComponent(name));
  return data.results || null;
}

// Writes the tester's results to the sheet, one request at a time.
//   schedule() — autosave shortly after the tester stops clicking
//   submit()   — save now and stamp the "Submitted" column
//   flush()    — send a pending autosave right away (e.g. when the tab is hidden)
// getPayload() returns { name, cases, results }; onStatus(state, detail) gets
// 'pending' | 'saving' | 'saved' | 'error'.
export function createSync(getPayload, onStatus) {
  let timer = null, inFlight = null, again = false, submitNext = false;

  async function run() {
    clearTimeout(timer); timer = null;
    if (inFlight) { again = true; return inFlight; }
    const submitted = submitNext; submitNext = false;
    onStatus('saving', { submitted });
    inFlight = call(SHEET_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...getPayload(), submitted }),
    }).then(() => onStatus('saved', { at: new Date().toISOString(), submitted }),
      (e) => { if (submitted) submitNext = true; onStatus('error', { message: e.message, submitted }); });
    await inFlight;
    inFlight = null;
    if (again) { again = false; return run(); }
  }

  return {
    schedule() { onStatus('pending'); clearTimeout(timer); timer = setTimeout(run, AUTOSAVE_DELAY_MS); },
    submit() { submitNext = true; return run(); },
    flush() { if (timer) return run(); },
  };
}
