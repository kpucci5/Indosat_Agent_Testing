// Per-browser storage for the tester's name and their in-progress results.
// Every access is wrapped: private windows and blocked site data can make localStorage throw.
const NAME_KEY = 'ea-tracker:tester-v2';
// Before v2, opening a shared link saved the sender's name here, so it can't be trusted.
const OLD_NAME_KEY = 'ea-tracker:tester';
const RESYNC_KEY = 'ea-tracker:resync';
const resultsKey = (name) => 'ea-tracker:results:' + name.trim().toLowerCase();

function read(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
function write(key, val) { try { localStorage.setItem(key, val); } catch (e) {} }
function remove(key) { try { localStorage.removeItem(key); } catch (e) {} }

export function cleanName(name) { return String(name || '').replace(/\s+/g, ' ').trim().slice(0, 80); }

// True when this browser lets the page remember things (false in some private windows).
export function canRemember() {
  try { localStorage.setItem('ea-tracker:probe', '1'); localStorage.removeItem('ea-tracker:probe'); return true; } catch (e) { return false; }
}

// The name comes from this browser only. A ?tester= in the address is used just when the browser
// can't store anything, so a shared link never signs someone in as the person who sent it.
export function getTester() {
  if (canRemember()) return cleanName(read(NAME_KEY));
  return cleanName(new URLSearchParams(location.search).get('tester'));
}
export function setTester(name) { write(NAME_KEY, cleanName(name)); }
export function clearTester() { remove(NAME_KEY); }

// Results shape: { [caseCode]: { status: 'pass'|'fail'|'blocked', note: '', at: ISO } }
export function loadResults(name) {
  try { return JSON.parse(read(resultsKey(name)) || 'null'); } catch (e) { return null; }
}
export function saveResults(name, results) { write(resultsKey(name), JSON.stringify(results)); }

// Someone who tested through a shared link had their results saved under the sender's name.
// When they now enter their own name, move those results over (only if their own name has none yet)
// and flag them to be saved to the sheet under the right name.
export function adoptOldResults(name) {
  const old = cleanName(read(OLD_NAME_KEY));
  remove(OLD_NAME_KEY);
  if (!old || old.toLowerCase() === name.toLowerCase()) return;
  const oldResults = loadResults(old);
  if (!oldResults || !Object.keys(oldResults).length || loadResults(name)) return;
  saveResults(name, oldResults);
  remove(resultsKey(old));
  write(RESYNC_KEY, '1');
}

// True once after adoptOldResults moved results, so the tracker marks them as not yet submitted.
export function takeResyncFlag() {
  const flag = read(RESYNC_KEY) === '1';
  remove(RESYNC_KEY);
  return flag;
}

// Whether this tester has changes in this browser that haven't been submitted to the sheet.
const unsentKey = (name) => 'ea-tracker:unsent:' + name.trim().toLowerCase();
export function hasUnsent(name) { return read(unsentKey(name)) === '1'; }
export function setUnsent(name, on) { if (on) write(unsentKey(name), '1'); else remove(unsentKey(name)); }
