// Google Sheets layout:
//   "Results" tab: one row per tester, one column per test case. Each case cell holds
//     Pass / Fail / Blocked; the conversation ID and notes are attached as a cell note.
//   "Details" tab: one row per tester per case with status, conversation ID, notes and
//     clickable screenshot links. The hidden last column holds the result as JSON so the
//     tracker can reload it.
//   "Cases" tab: test cases added, edited or deleted from the tracker's editor. These
//     override the files in cases/ (matched by code). The hidden last column holds the case as JSON.
// Rows are updated in place or appended (never rewritten wholesale), so testers saving at
// the same moment can't overwrite each other.
import { google, env } from './google.js';

const RESULTS_TAB = 'Results';
const DETAILS_TAB = 'Details';
const FIXED_HEADERS = ['Name', 'Last updated', 'Submitted', 'Progress', 'Pass', 'Fail', 'Blocked', 'Untested'];
const DETAIL_HEADERS = ['Name', 'Case', 'Title', 'Status', 'Conversation ID', 'Notes', 'Screenshots', 'Updated', 'Data (do not edit)'];
const DATA_COL = DETAIL_HEADERS.length - 1;
// Added after the hidden data column so sheets started before it existed keep working.
const MOMENT_COL = DETAIL_HEADERS.length;
const MOMENTS = { magic: '😊 Magical moment', improve: '🙁 Could be improved' };
const CASES_TAB = 'Cases';
const CASE_HEADERS = ['Code', 'Title', 'Area', 'Priority', 'Level', 'Owner', 'Dev status', 'Status', 'Updated', 'Updated by', 'Data (do not edit)'];
const CASE_DATA_COL = CASE_HEADERS.length - 1;
const CASE_SEP = ' · '; // case headers look like "ONB-01 · Web onboarding is clear and working"
const LABELS = { pass: 'Pass', fail: 'Fail', blocked: 'Blocked' };
const COLORS = { pass: '#e7f0fb', fail: '#fcefe6', blocked: '#e9e9e9' };
const DATE_PATTERN = 'mmm d, yyyy h:mm am/pm';

const API = 'https://sheets.googleapis.com/v4/spreadsheets/';
const codeOf = (header) => String(header).split(CASE_SEP)[0].trim();
const keyOf = (name) => String(name || '').replace(/\s+/g, ' ').trim().toLowerCase();
const hasContent = (r) => !!r && (!!LABELS[r.status] || !!r.note || !!r.convo || !!MOMENTS[r.moment] || !!(r.images && r.images.length));

// ---------- cell builders (stringValue is always literal text, never a formula) ----------
const str = (s) => ({ userEnteredValue: { stringValue: String(s == null ? '' : s) } });
const num = (n) => ({ userEnteredValue: { numberValue: n } });
const bold = (s) => ({ ...str(s), userEnteredFormat: { textFormat: { bold: true }, wrapStrategy: 'WRAP' } });
const rgb = (hex) => ({ red: parseInt(hex.slice(1, 3), 16) / 255, green: parseInt(hex.slice(3, 5), 16) / 255, blue: parseInt(hex.slice(5, 7), 16) / 255 });

// Sheets stores dates as day serials in the spreadsheet's own time zone.
function dateCell(d, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(d).map((x) => [x.type, x.value]));
  const serial = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) / 86400000 + 25569;
  return { userEnteredValue: { numberValue: serial }, userEnteredFormat: { numberFormat: { type: 'DATE_TIME', pattern: DATE_PATTERN } } };
}

function linksCell(images) {
  if (!images || !images.length) return {};
  const labels = images.map((img, i) => 'Screenshot ' + (i + 1));
  const runs = [];
  let at = 0;
  images.forEach((img, i) => {
    runs.push({ startIndex: at, format: { link: { uri: 'https://drive.google.com/file/d/' + img.id + '/view' }, underline: true, foregroundColor: rgb('#1155cc') } });
    at += labels[i].length;
    if (i < images.length - 1) { runs.push({ startIndex: at, format: {} }); at += 2; }
  });
  return { userEnteredValue: { stringValue: labels.join(', ') }, textFormatRuns: runs };
}

function cellNote(r) {
  const parts = [];
  if (MOMENTS[r.moment]) parts.push(MOMENTS[r.moment]);
  if (r.convo) parts.push('Conversation ID: ' + r.convo);
  if (r.note) parts.push(r.note);
  if (r.images && r.images.length) parts.push(r.images.length + ' screenshot' + (r.images.length > 1 ? 's' : '') + ' — see Details tab');
  return parts.join('\n\n');
}

// ---------- request builders ----------
const range = (sheetId, row, col, rows = 1, cols = 1) =>
  ({ sheetId, startRowIndex: row, endRowIndex: row + rows, startColumnIndex: col, endColumnIndex: col + cols });
const updateCells = (sheetId, row, col, cells, fields) =>
  ({ updateCells: { range: range(sheetId, row, col, 1, cells.length), rows: [{ values: cells }], fields } });
const appendRows = (sheetId, rows, fields) =>
  ({ appendCells: { sheetId, rows: rows.map((values) => ({ values })), fields } });

// ---------- spreadsheet access ----------
const sheetUrl = (path = '') => API + encodeURIComponent(env('SHEET_ID')) + path;
const batch = (requests) => google('POST', sheetUrl(':batchUpdate'), { json: { requests } });

// Creates the two tabs (with headers) if they don't exist yet. Returns { tz, tabs: { title: properties } }.
async function openSpreadsheet() {
  const meta = await google('GET', sheetUrl('?fields=properties.timeZone,sheets.properties'));
  const tabs = {};
  meta.sheets.forEach((s) => { tabs[s.properties.title] = s.properties; });
  const missing = [RESULTS_TAB, DETAILS_TAB, CASES_TAB].filter((t) => !tabs[t]);
  if (missing.length) {
    const added = await batch(missing.map((title) => ({ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1, frozenColumnCount: 1 } } } })));
    added.replies.forEach((r) => { tabs[r.addSheet.properties.title] = r.addSheet.properties; });
    const init = [];
    if (missing.includes(RESULTS_TAB)) init.push(updateCells(tabs[RESULTS_TAB].sheetId, 0, 0, FIXED_HEADERS.map(bold), 'userEnteredValue,userEnteredFormat'));
    if (missing.includes(DETAILS_TAB)) {
      const id = tabs[DETAILS_TAB].sheetId;
      init.push(updateCells(id, 0, 0, DETAIL_HEADERS.concat(['Moment']).map(bold), 'userEnteredValue,userEnteredFormat'));
      init.push({ updateDimensionProperties: { range: { sheetId: id, dimension: 'COLUMNS', startIndex: 5, endIndex: 6 }, properties: { pixelSize: 320 }, fields: 'pixelSize' } });
      init.push({ updateDimensionProperties: { range: { sheetId: id, dimension: 'COLUMNS', startIndex: DATA_COL, endIndex: DATA_COL + 1 }, properties: { hiddenByUser: true }, fields: 'hiddenByUser' } });
    }
    if (missing.includes(CASES_TAB)) {
      const id = tabs[CASES_TAB].sheetId;
      init.push(updateCells(id, 0, 0, CASE_HEADERS.map(bold), 'userEnteredValue,userEnteredFormat'));
      init.push({ updateDimensionProperties: { range: { sheetId: id, dimension: 'COLUMNS', startIndex: CASE_DATA_COL, endIndex: CASE_DATA_COL + 1 }, properties: { hiddenByUser: true }, fields: 'hiddenByUser' } });
    }
    await batch(init);
  }
  return { tz: meta.properties.timeZone || 'UTC', tabs };
}

async function readTabs(...titles) {
  const q = new URLSearchParams();
  titles.forEach((t) => q.append('ranges', "'" + t + "'"));
  const data = await google('GET', sheetUrl('/values:batchGet?' + q));
  return titles.map((t, i) => data.valueRanges[i].values || []);
}

// ---------- public API ----------
export async function saveTester({ name, cases, results, submitted }) {
  const { tz, tabs } = await openSpreadsheet();
  const [resultRows, detailRows] = await readTabs(RESULTS_TAB, DETAILS_TAB);
  const grid = { results: resultRows, details: detailRows };
  const now = new Date();
  const requests = [];

  // Results tab: make sure every case has a column, then write this tester's row.
  const resId = tabs[RESULTS_TAB].sheetId;
  const headers = (grid.results[0] || []).slice();
  if (!headers.length) headers.push(...FIXED_HEADERS);
  const cols = {};
  headers.forEach((hd, i) => { if (i >= FIXED_HEADERS.length && hd) cols[codeOf(hd)] = i; });
  const headerWrites = [];
  cases.forEach((c) => {
    const label = c.code + CASE_SEP + c.title;
    if (cols[c.code] == null) { cols[c.code] = headers.length; headers.push(label); headerWrites.push([cols[c.code], label, true]); }
    else if (headers[cols[c.code]] !== label) { headers[cols[c.code]] = label; headerWrites.push([cols[c.code], label, false]); }
  });
  const colCount = tabs[RESULTS_TAB].gridProperties.columnCount;
  if (headers.length > colCount) requests.push({ appendDimension: { sheetId: resId, dimension: 'COLUMNS', length: headers.length - colCount } });
  headerWrites.forEach(([col, label, isNew]) => {
    requests.push(updateCells(resId, 0, col, [bold(label)], 'userEnteredValue,userEnteredFormat'));
    if (isNew) requests.push({ updateDimensionProperties: { range: { sheetId: resId, dimension: 'COLUMNS', startIndex: col, endIndex: col + 1 }, properties: { pixelSize: 160 }, fields: 'pixelSize' } });
  });

  const n = { pass: 0, fail: 0, blocked: 0 };
  const caseCell = {};
  cases.forEach((c) => {
    const r = results[c.code] || {};
    const status = LABELS[r.status] ? r.status : '';
    if (status) n[status]++;
    const note = cellNote(r);
    caseCell[c.code] = status
      ? { ...str(LABELS[status]), note: note || undefined, userEnteredFormat: { backgroundColor: rgb(COLORS[status]) } }
      : (note ? { note } : {});
  });
  const done = n.pass + n.fail + n.blocked;
  const progress = [str(done + ' / ' + cases.length), num(n.pass), num(n.fail), num(n.blocked), num(cases.length - done)];
  const CASE_FIELDS = 'userEnteredValue,note,userEnteredFormat.backgroundColor';
  const key = keyOf(name);
  const rowIdx = grid.results.findIndex((r, i) => i > 0 && keyOf(r[0]) === key);
  if (rowIdx === -1) {
    const row = Array.from({ length: headers.length }, () => ({}));
    row[0] = str(name); row[1] = dateCell(now, tz); row[2] = submitted ? dateCell(now, tz) : {};
    progress.forEach((cell, i) => { row[3 + i] = cell; });
    cases.forEach((c) => { row[cols[c.code]] = caseCell[c.code]; });
    requests.push(appendRows(resId, [row], 'userEnteredValue,note,userEnteredFormat'));
  } else {
    requests.push(updateCells(resId, rowIdx, 0, [str(name), dateCell(now, tz)], 'userEnteredValue,userEnteredFormat.numberFormat'));
    if (submitted) requests.push(updateCells(resId, rowIdx, 2, [dateCell(now, tz)], 'userEnteredValue,userEnteredFormat.numberFormat'));
    requests.push(updateCells(resId, rowIdx, 3, progress, 'userEnteredValue'));
    cases.forEach((c) => requests.push(updateCells(resId, rowIdx, cols[c.code], [caseCell[c.code]], CASE_FIELDS)));
  }

  // Details tab: one row per (tester, case). Existing rows are updated in place; new ones appended.
  const detId = tabs[DETAILS_TAB].sheetId;
  const DETAIL_FIELDS = 'userEnteredValue,textFormatRuns,userEnteredFormat.numberFormat';
  if ((grid.details[0] || []).length <= MOMENT_COL) requests.push(updateCells(detId, 0, MOMENT_COL, [bold('Moment')], 'userEnteredValue,userEnteredFormat'));
  const existing = {};
  grid.details.forEach((r, i) => { if (i > 0 && keyOf(r[0]) === key) existing[r[1]] = i; });
  const newRows = [];
  cases.forEach((c) => {
    const r = results[c.code];
    const at = r && r.at ? new Date(r.at) : now;
    const cells = hasContent(r)
      ? [str(name), str(c.code), str(c.title), str(LABELS[r.status] || ''), str(r.convo || ''), str(r.note || ''), linksCell(r.images), dateCell(at, tz), str(JSON.stringify(r)), str(MOMENTS[r.moment] || '')]
      : [str(name), str(c.code), str(c.title), {}, {}, {}, {}, {}, {}, {}]; // cleared result: keep the row, blank the rest
    if (existing[c.code] != null) requests.push(updateCells(detId, existing[c.code], 0, cells, DETAIL_FIELDS));
    else if (hasContent(r)) newRows.push(cells);
  });
  if (newRows.length) requests.push(appendRows(detId, newRows, DETAIL_FIELDS));

  if (requests.length) await batch(requests);
}

// This tester's results from the Details tab, or null if they have none.
export async function loadTester(name) {
  await openSpreadsheet();
  const [detailRows] = await readTabs(DETAILS_TAB);
  const key = keyOf(name);
  const results = {};
  detailRows.forEach((r, i) => {
    if (i === 0 || keyOf(r[0]) !== key || !r[DATA_COL]) return;
    try { results[r[1]] = JSON.parse(r[DATA_COL]); } catch (e) {}
  });
  return Object.keys(results).length ? results : null;
}

// ---------- Cases tab (edits made in the tracker) ----------
// → [{ code, ...case }] including { code, deleted: true } for deleted cases.
export async function loadCaseEdits() {
  await openSpreadsheet();
  const [rows] = await readTabs(CASES_TAB);
  const out = [];
  rows.forEach((r, i) => {
    if (i === 0 || !r[CASE_DATA_COL]) return;
    try { out.push(JSON.parse(r[CASE_DATA_COL])); } catch (e) {}
  });
  return out;
}

// Adds or replaces one case (matched by code). Pass { code, deleted: true } to hide a case.
export async function saveCaseEdit(c, by) {
  const { tz, tabs } = await openSpreadsheet();
  const [rows] = await readTabs(CASES_TAB);
  const id = tabs[CASES_TAB].sheetId;
  const cells = [str(c.code), str(c.title || ''), str(c.area || ''), str(c.pr == null ? '' : 'P' + c.pr), str(c.level || ''),
    str(c.owner || ''), str(c.dev || ''), str(c.deleted ? 'Deleted' : 'Active'), dateCell(new Date(), tz), str(by || ''), str(JSON.stringify(c))];
  const fields = 'userEnteredValue,userEnteredFormat.numberFormat';
  const at = rows.findIndex((r, i) => i > 0 && r[0] === c.code);
  await batch([at === -1 ? appendRows(id, [cells], fields) : updateCells(id, at, 0, cells, fields)]);
}
