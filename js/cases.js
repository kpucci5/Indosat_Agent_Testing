// Loads test cases from cases/index.json and the per-area files it lists, then applies
// edits made in the tracker (stored in the sheet's Cases tab, served by /api/cases).
import { CASES_INDEX, CASES_API } from './config.js';

export function prLabel(pr) { return (pr === null || pr === undefined || pr === '') ? 'P –' : 'P' + pr; }
export function prNum(pr) { return (pr === null || pr === undefined || pr === '') ? 99 : Number(pr); }

const BASE = CASES_INDEX.replace(/[^/]*$/, '');

async function getJSON(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error('Could not load ' + url + ' (' + res.status + ')');
  return res.json();
}

async function api(url, opts) {
  const res = await fetch(url, opts);
  let data = null;
  try { data = await res.json(); } catch (e) {}
  if (!res.ok || !data || !data.ok) throw new Error((data && data.error) || 'Request failed (' + res.status + ')');
  return data;
}

// Reference screenshots: { src: 'images/…' } ships with the case files; { id } is a Drive file.
export function attachmentUrl(a, imageUrl) { return a.src ? BASE + a.src : imageUrl(a.id); }

function normalize(c, area) { return { steps: [], notes: [], attachments: [], ...c, area: c.area || area || 'General' }; }

// The suite's header text from cases/index.json → { tabTitle, eyebrow, title, lede, summaryTitle }.
export async function loadSuite() {
  return (await getJSON(CASES_INDEX)).suite || {};
}

// Fills the browser tab name and page header from the suite. `lede` is skipped where the page has its own.
export function applySuite(suite, $) {
  if (suite.tabTitle || suite.title) document.title = suite.tabTitle || suite.title;
  if (suite.title) $('suite-title').textContent = suite.title;
  if (suite.eyebrow) $('suite-eyebrow').textContent = suite.eyebrow;
  const lede = $('suite-lede');
  if (lede && suite.lede) lede.textContent = suite.lede;
}

// Returns { suite, areas, cases, editsError }. Each case's `code` is its unique ID and its sheet column.
export async function loadCases() {
  const [index, edits] = await Promise.all([
    getJSON(CASES_INDEX),
    api(CASES_API).then((d) => d.cases, (e) => e),
  ]);
  const lists = await Promise.all(index.areas.map((a) => getJSON(BASE + a.file)));

  const areas = index.areas.map((a) => a.name);
  const byCode = new Map();
  index.areas.forEach((a, i) => {
    lists[i].forEach((c) => {
      if (!c.code || !c.title) { console.warn('[cases] A case in ' + a.file + ' is missing a code or title.'); return; }
      if (byCode.has(c.code)) { console.warn('[cases] Case code ' + c.code + ' is used more than once.'); return; }
      byCode.set(c.code, normalize(c, a.name));
    });
  });

  const editsError = edits instanceof Error ? edits : null;
  if (!editsError) applyEdits(byCode, edits, areas);
  return { suite: index.suite || {}, areas, cases: [...byCode.values()], editsError };
}

export function applyEdits(byCode, edits, areas) {
  edits.forEach((e) => {
    if (e.deleted) { byCode.delete(e.code); return; }
    const c = normalize(e);
    byCode.set(c.code, { ...c, edited: true });
    if (!areas.includes(c.area)) areas.push(c.area);
  });
}

export async function saveCase(c, by) {
  const data = await api(CASES_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ case: c, by }) });
  return normalize(data.case);
}

export function deleteCase(code, by) {
  return api(CASES_API + '?' + new URLSearchParams({ code, by }), { method: 'DELETE' });
}
