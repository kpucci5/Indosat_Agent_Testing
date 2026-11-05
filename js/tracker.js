// Tracker page: shows every test case, records this tester's results, and syncs them to the sheet.
import { LEVELS, STATUSES, LABEL, CONVO_REQUIRED_FOR } from './config.js';
import { $, h, svgChev, fmtTime, fillSelect } from './dom.js';
import { loadCases, applySuite, saveCase, deleteCase, attachmentUrl, prNum } from './cases.js';
import { getTester, canRemember, clearTester, loadResults, saveResults, takeResyncFlag, hasUnsent, setUnsent } from './store.js';
import { fetchResults, createSync } from './sheets.js';
import { isImage, imageUrl, uploadImage, removeImage } from './images.js';

const S = {
  name: getTester(),
  suite: {}, areas: [], cases: [], results: {}, loaded: false, open: new Set(), confirmReset: false,
  uploading: {}, // case code → number of screenshots still uploading
  ferr: {},      // case code → error shown in that case's panel
  f: { q: '', area: 'All', level: 'All', result: 'All', owner: 'All' },
};
// No name in this browser yet (e.g. someone opened a shared link): ask for it first.
if (!S.name) location.replace('index.html');
// Drop any old ?tester= from the address so copying this page's link never shares a name.
if (canRemember() && location.search.includes('tester=')) history.replaceState(null, '', location.pathname);

const levels = () => (S.suite.levels && S.suite.levels.length ? S.suite.levels : LEVELS);
// Case IDs like 1.2 sort before 1.10.
const byCode = (x, y) => x.code.localeCompare(y.code, undefined, { numeric: true });
const resultOf = (c) => S.results[c.code] || {};
const statusOf = (c) => resultOf(c).status || 'untested';
const noteOf = (c) => resultOf(c).note || '';
const convoOf = (c) => resultOf(c).convo || '';
const imagesOf = (c) => resultOf(c).images || [];
const convoRequired = (c) => CONVO_REQUIRED_FOR.includes(statusOf(c));
const missingConvo = (c) => convoRequired(c) && !convoOf(c).trim();
function setNotice(msg) { const n = $('notice'); n.textContent = msg || ''; n.hidden = !msg; }

// ---------- results + saving ----------
// Results autosave to the sheet shortly after each change. Submit saves right away and stamps the
// "Submitted" column so you can see who has finished. Everything is also kept in this browser.
const sync = createSync(
  () => ({ name: S.name, cases: S.cases.map((c) => ({ code: c.code, title: c.title })), results: S.results }),
  renderSyncStatus);

function renderSyncStatus(state, detail = {}) {
  const el = $('sync-status');
  if (state === 'pending') el.textContent = 'Unsaved changes…';
  else if (state === 'saving') el.textContent = detail.submitted ? 'Submitting to the Google Sheet…' : 'Saving to the Google Sheet…';
  else if (state === 'saved') {
    setUnsent(S.name, false);
    el.textContent = (detail.submitted ? 'Submitted' : 'All changes saved to the Google Sheet') + ' · ' + fmtTime(detail.at);
    setNotice('');
  } else if (state === 'error') {
    el.textContent = 'Not saved to the sheet yet — your results are kept in this browser.';
    setNotice('Could not save to the Google Sheet (' + detail.message + '). Click Submit to try again.');
  }
}

function markUnsent() { setUnsent(S.name, true); sync.schedule(); }

function setResult(c, patch) {
  const cur = S.results[c.code] || { status: 'untested', note: '', convo: '', images: [] };
  const next = { ...cur, ...patch, at: new Date().toISOString() };
  const empty = next.status === 'untested' && !next.note && !next.convo && !next.moment && !(next.images && next.images.length);
  if (empty) delete S.results[c.code];
  else S.results[c.code] = next;
  saveResults(S.name, S.results);
  markUnsent();
}

// ---------- screenshots ----------
async function addImages(c, files) {
  const picked = [...(files || [])].filter(isImage);
  if (!picked.length) { S.ferr[c.code] = 'Add a PNG, JPG, GIF or WebP image.'; renderList(); return; }
  S.ferr[c.code] = '';
  for (const file of picked) {
    S.uploading[c.code] = (S.uploading[c.code] || 0) + 1; renderList();
    try {
      const img = await uploadImage(file, { name: S.name, code: c.code });
      setResult(c, { images: imagesOf(c).concat([{ id: img.id, name: img.name }]) });
    } catch (e) {
      S.ferr[c.code] = 'Could not upload ' + (file.name || 'the image') + ' (' + e.message + '). Try again.';
    }
    S.uploading[c.code]--;
    renderAll();
  }
}

function deleteImage(c, img) {
  setResult(c, { images: imagesOf(c).filter((x) => x.id !== img.id) });
  removeImage(img.id);
  renderAll();
}

function openLightbox(url) { $('lb-img').src = url; $('lb').showModal(); }
$('lb-close').addEventListener('click', () => $('lb').close());

function thumb(c, img, i, removable) {
  const t = h('button', { type: 'button', class: 'thumb', 'aria-label': 'Open screenshot ' + (i + 1) + ' for ' + c.code, onclick: () => openLightbox(imageUrl(img.id)) },
    h('img', { src: imageUrl(img.id), alt: '', loading: 'lazy' }));
  if (removable) t.append(h('span', { role: 'button', tabindex: '0', class: 'rm', 'aria-label': 'Remove screenshot ' + (i + 1),
    onclick: (e) => { e.stopPropagation(); deleteImage(c, img); },
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); deleteImage(c, img); } } }, '×'));
  return t;
}

const imgCount = (c) => (c.attachments || []).length + imagesOf(c).length;

// Screenshots attached to the case itself, with captions (and an optional `source`, e.g. "priorities doc").
function referenceShots(c) {
  const docs = c.attachments || [];
  if (!docs.length) return null;
  return h('div', { style: 'display:flex;flex-direction:column;gap:8px' },
    h('span', { class: 'lbl', text: 'Screenshots (' + docs.length + ')' }),
    h('div', { class: 'thumbs' }, docs.map((a) => {
      const url = attachmentUrl(a, imageUrl);
      return h('figure', { style: 'margin:0;display:flex;flex-direction:column;gap:4px;width:132px' },
        h('button', { type: 'button', class: 'thumb', style: 'width:132px;height:100px', 'aria-label': 'Open: ' + (a.caption || 'reference screenshot'), onclick: () => openLightbox(url) },
          h('img', { src: url, alt: '', loading: 'lazy' })),
        h('figcaption', { class: 'hint', text: (a.caption || 'Screenshot') + (a.source ? ' · from ' + a.source : '') }));
    })));
}

// Paste an image while focus is anywhere inside an open case.
document.addEventListener('paste', (e) => {
  const d = document.activeElement && document.activeElement.closest ? document.activeElement.closest('.detail') : null;
  if (!d || !e.clipboardData) return;
  const files = [...(e.clipboardData.files || [])].filter(isImage);
  if (!files.length) return;
  e.preventDefault();
  const c = S.cases.find((x) => x.code === d.getAttribute('data-case'));
  if (c) addImages(c, files);
});

// ---------- filters ----------
function renderFilters() {
  fillSelect($('f-area'), ['All'].concat(S.areas), S.f.area);
  fillSelect($('f-level'), ['All'].concat(levels()), S.f.level);
  fillSelect($('f-result'), [{ v: 'All', t: 'All' }].concat(STATUSES.map((s) => ({ v: s, t: LABEL[s] }))), S.f.result);
  const owners = [...new Set(S.cases.map((c) => (c.owner || '').trim()).filter((o) => o && o !== '—'))].sort();
  fillSelect($('f-owner'), ['All'].concat(owners), S.f.owner);
}
['area', 'level', 'result', 'owner'].forEach((k) => {
  $('f-' + k).addEventListener('change', (e) => { S.f[k] = e.target.value; renderList(); });
});
$('f-q').addEventListener('input', (e) => { S.f.q = e.target.value; renderList(); });

function matches(c) {
  const f = S.f;
  if (f.area !== 'All' && c.area !== f.area) return false;
  if (f.level !== 'All' && c.level !== f.level) return false;
  if (f.result !== 'All' && statusOf(c) !== f.result) return false;
  if (f.owner !== 'All' && (c.owner || '').trim() !== f.owner) return false;
  const q = f.q.trim().toLowerCase();
  if (q) {
    const hay = [c.code, c.title, c.owner, c.dev, c.area, c.expected, c.notes.join(' '), noteOf(c), convoOf(c)].join(' ').toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

// ---------- summary ----------
function counts() {
  const n = { total: S.cases.length, pass: 0, fail: 0, blocked: 0, untested: 0, must: 0, mustPass: 0 };
  S.cases.forEach((c) => {
    const s = statusOf(c); n[s]++;
    if (c.level === levels()[0]) { n.must++; if (s === 'pass') n.mustPass++; }
  });
  return n;
}

function renderSummary(n) {
  const tiles = [['Cases', n.total], ['Passed', n.pass], ['Failed', n.fail], ['Blocked', n.blocked], ['Untested', n.untested]];
  $('summary').replaceChildren(...tiles.map((t) =>
    h('div', { class: 'tile' + (t[2] ? ' key' : '') }, h('span', { class: 'k', text: t[0] }), h('span', { class: 'v', text: String(t[1]) }))));
  const pct = (x) => n.total ? (x / n.total * 100) : 0;
  $('bar').replaceChildren(
    h('span', { style: 'width:' + pct(n.pass) + '%;background:var(--pass)' }),
    h('span', { style: 'width:' + pct(n.fail) + '%;background:var(--fail)' }),
    h('span', { style: 'width:' + pct(n.blocked) + '%;background:var(--blocked)' }));
  $('bar').setAttribute('aria-label', n.pass + ' passed, ' + n.fail + ' failed, ' + n.blocked + ' blocked, ' + n.untested + ' untested');
  const done = n.pass + n.fail + n.blocked;
  $('progress').textContent = done + ' of ' + n.total + ' run (' + Math.round(pct(done)) + '%)';
}

// ---------- list ----------
function captureFocus() {
  const a = document.activeElement;
  if (!a || !a.id || !$('list').contains(a)) return null;
  return { id: a.id, start: a.selectionStart, end: a.selectionEnd };
}
function restoreFocus(f) {
  if (!f) return;
  const el = $(f.id); if (!el) return;
  el.focus();
  try { if (f.start != null) el.setSelectionRange(f.start, f.end); } catch (e) {}
}

function statusButtons(c, cls, label) {
  const st = statusOf(c);
  return h('div', { class: cls, role: 'group', 'aria-label': label },
    ['pass', 'fail', 'blocked'].map((s) => h('button', {
      type: 'button', class: s, 'aria-pressed': String(st === s),
      onclick: () => {
        const next = st === s ? 'untested' : s;
        setResult(c, { status: next });
        // A failure needs a conversation ID: open the case and put the cursor there.
        if (CONVO_REQUIRED_FOR.includes(next) && !convoOf(c).trim()) S.open.add(c.code);
        renderAll();
        if (missingConvo(c)) { const el = $('cv-' + c.code); if (el) el.focus(); }
      },
    }, LABEL[s])));
}

function caseRow(c) {
  const id = c.code, st = statusOf(c), open = S.open.has(id);
  const row = h('div', { class: 'row' },
    h('button', { type: 'button', class: 'toggle', 'aria-expanded': String(open), 'aria-controls': 'd-' + id,
      onclick: () => { if (S.open.has(id)) S.open.delete(id); else S.open.add(id); renderList(); } },
      svgChev(), h('span', { class: 'code', text: c.code }), h('span', { class: 'title', text: c.title })),
    h('div', { class: 'meta' },
      c.owner && c.owner !== '—' ? h('span', { class: 'owner', text: c.owner }) : null,
      imgCount(c) ? h('span', { class: 'owner', text: imgCount(c) + ' img' }) : null,
      h('span', { class: 'req', id: 'flag-' + id, style: 'font-size:13px', hidden: !missingConvo(c), text: 'Needs conversation ID' })),
    h('span', { class: 'pill ' + st, text: LABEL[st] }),
    statusButtons(c, 'quick', 'Quick result for ' + c.code));
  const wrap = h('div', { class: 'case' + (open ? ' open' : '') }, row);
  if (open) wrap.append(caseDetail(c));
  return wrap;
}

function caseDetail(c) {
  const id = c.code, r = S.results[id];
  const left = h('section', null,
    h('div', { class: 'facts' },
      h('span', null, 'Area: ', h('b', { text: c.area || '—' })),
      h('span', null, 'Owner: ', h('b', { text: c.owner || '—' })),
      h('span', null, 'Dev status: ', h('b', { text: c.dev || '—' }))),
    h('span', { class: 'lbl', text: 'Steps' }),
    c.steps.length ? h('ol', null, c.steps.map((s) => h('li', { text: s }))) : h('span', { class: 'hint', text: 'No steps listed for this case.' }),
    h('span', { class: 'lbl', text: 'Expected' }),
    h('div', { class: 'box', text: c.expected || '—' }),
    c.notes.length ? h('div', { class: 'dash' }, h('div', { class: 'lbl', text: 'Known issues / context', style: 'margin-bottom:6px' }),
      h('ul', null, c.notes.map((s) => h('li', { text: s })))) : null,
    referenceShots(c),
    h('div', { class: 'rowbtns' }, h('button', { type: 'button', class: 'btn ghost', onclick: () => openEditor(c) }, 'Edit case')));

  const cvId = 'cv-' + id, needConvo = convoRequired(c);
  const cv = h('input', { id: cvId, type: 'text', autocomplete: 'off', spellcheck: 'false', placeholder: 'Paste the conversation ID',
    class: missingConvo(c) ? 'bad' : null, 'aria-required': String(needConvo),
    oninput: (e) => {
      setResult(c, { convo: e.target.value });
      // Update in place; a full re-render here would steal focus while typing.
      e.target.classList.toggle('bad', missingConvo(c));
      $('flag-' + id).hidden = !missingConvo(c);
    } });
  cv.value = convoOf(c);

  const noteId = 'n-' + id;
  const ta = h('textarea', { id: noteId, rows: '4', placeholder: 'What happened — build, device, carrier, exact reply…',
    oninput: (e) => setResult(c, { note: e.target.value }) });
  ta.value = noteOf(c);

  const busy = S.uploading[id] || 0;
  const fileIn = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp', multiple: true, hidden: true,
    onchange: (e) => { const fs = [...e.target.files]; e.target.value = ''; addImages(c, fs); } });
  const shots = imagesOf(c);
  const drop = h('div', { class: 'drop',
      ondragover: (e) => { e.preventDefault(); e.currentTarget.classList.add('over'); },
      ondragleave: (e) => { e.currentTarget.classList.remove('over'); },
      ondrop: (e) => { e.preventDefault(); e.currentTarget.classList.remove('over'); addImages(c, e.dataTransfer.files); } },
    h('div', { class: 'pick' },
      h('button', { type: 'button', class: 'btn ghost', onclick: () => fileIn.click() }, 'Upload screenshot'),
      h('span', { text: 'or drop / paste an image here' })),
    fileIn,
    (shots.length || busy) ? h('div', { class: 'thumbs' },
      shots.map((img, i) => thumb(c, img, i, true)),
      Array.from({ length: busy }, () => h('div', { class: 'thumb busy', role: 'status', text: 'Uploading…' }))) : null);

  const right = h('section', null,
    h('span', { class: 'lbl', text: 'Your result' }),
    statusButtons(c, 'seg', 'Result for ' + c.code),
    h('div', { class: 'field' },
      h('label', { for: cvId }, 'Conversation ID', needConvo
        ? h('span', { class: 'req', text: ' · required for Fail' })
        : h('span', { style: 'text-transform:none;font-weight:400', text: ' (optional)' })),
      cv),
    h('div', { class: 'field' }, h('label', { for: noteId, text: 'Observed' }), ta),
    h('div', { class: 'field' }, h('span', { class: 'lbl', text: 'Screenshots' }), drop),
    S.ferr[id] ? h('div', { class: 'ferr', role: 'alert', text: S.ferr[id] }) : null,
    h('span', { class: 'hint', text: r && r.at ? 'Last changed ' + fmtTime(r.at) + ' · saves automatically' : 'Saves automatically.' }));
  return h('div', { class: 'detail', id: 'd-' + id, 'data-case': id }, left, right);
}

function renderList() {
  const focus = captureFocus();
  const list = $('list');
  if (!S.loaded) { list.replaceChildren(h('div', { class: 'empty', text: 'Loading test cases…' })); return; }
  const shown = S.cases.filter(matches);
  $('count').textContent = 'Showing ' + shown.length + ' of ' + S.cases.length + ' cases';
  if (!S.cases.length) {
    list.replaceChildren(h('div', { class: 'empty' }, h('p', { style: 'margin:0 0 12px', text: 'No test cases yet. Add the first one to start tracking.' }),
      h('button', { type: 'button', class: 'btn solid', onclick: () => openEditor(null) }, 'Add test case')));
    return;
  }
  if (!shown.length) { list.replaceChildren(h('div', { class: 'empty', text: 'No cases match these filters.' })); return; }
  const groups = S.areas.map((a) => {
    const items = shown.filter((c) => c.area === a)
      .sort((x, y) => prNum(x.pr) - prNum(y.pr) || byCode(x, y));
    if (!items.length) return null;
    const total = S.cases.filter((c) => c.area === a).length;
    return h('section', { class: 'group' }, h('h2', null, a, h('small', { text: items.length + ' of ' + total + ' cases' })), items.map(caseRow));
  });
  list.replaceChildren(h('div', { style: 'display:flex;flex-direction:column;gap:32px' }, groups));
  restoreFocus(focus);
}

function renderExport(n) {
  const lines = [(S.suite.summaryTitle || S.suite.title || 'Test run') + ' — test run by ' + S.name + ' (' + new Date().toLocaleDateString() + ')',
    'Pass ' + n.pass + ' · Fail ' + n.fail + ' · Blocked ' + n.blocked + ' · Untested ' + n.untested, ''];
  ['fail', 'blocked', 'pass', 'untested'].forEach((s) => {
    const xs = S.cases.filter((c) => statusOf(c) === s);
    if (!xs.length) return;
    lines.push(LABEL[s].toUpperCase() + ' (' + xs.length + ')');
    xs.sort((a, b) => prNum(a.pr) - prNum(b.pr)).forEach((c) => {
      const note = noteOf(c) ? ' — ' + noteOf(c).replace(/\s+/g, ' ') : '';
      const convo = convoOf(c) ? ' (convo ' + convoOf(c).trim() + ')' : '';
      const k = imagesOf(c).length;
      const shots = k ? ' [' + k + ' screenshot' + (k > 1 ? 's' : '') + ']' : '';
      lines.push('- ' + c.code + ' ' + c.title + convo + note + shots);
    });
    lines.push('');
  });
  $('export').value = lines.join('\n');
}

function renderAll() {
  const n = counts();
  renderSummary(n);
  renderFilters();
  renderList();
  renderExport(n);
}

// ---------- footer controls ----------
$('submit-btn').addEventListener('click', () => {
  if (Object.values(S.uploading).some(Boolean)) { setNotice('Wait for screenshots to finish uploading, then submit.'); return; }
  const missing = S.cases.filter(missingConvo);
  if (missing.length) {
    missing.forEach((c) => S.open.add(c.code));
    S.f = { q: '', area: 'All', level: 'All', result: 'All', owner: 'All' }; $('f-q').value = '';
    renderAll();
    setNotice('Add the conversation ID for every failure so dev can trace it: ' + missing.map((c) => c.code).join(', ') + '.');
    const el = $('cv-' + missing[0].code); if (el) { el.focus(); el.scrollIntoView({ block: 'center' }); }
    return;
  }
  sync.submit();
});

$('copy-btn').addEventListener('click', () => {
  const text = $('export').value, btn = $('copy-btn');
  const done = () => { btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = 'Copy results summary'; }, 1800); };
  const fallback = () => { const d = document.querySelector('details.export'); d.open = true; $('export').focus(); $('export').select(); btn.textContent = 'Press Ctrl/Cmd+C to copy'; };
  try { navigator.clipboard.writeText(text).then(done, fallback); } catch (e) { fallback(); }
});

$('reset-btn').addEventListener('click', () => {
  const btn = $('reset-btn');
  if (!S.confirmReset) {
    S.confirmReset = true; btn.textContent = 'Click again to clear all';
    setTimeout(() => { S.confirmReset = false; btn.textContent = 'Clear my results'; }, 5000);
    return;
  }
  S.confirmReset = false; btn.textContent = 'Clear my results';
  Object.values(S.results).forEach((r) => (r.images || []).forEach((img) => removeImage(img.id)));
  S.results = {};
  saveResults(S.name, S.results);
  markUnsent();
  renderAll();
});

// ---------- case editor (edits are saved to the sheet's Cases tab for everyone) ----------
const editor = { c: null, confirmDelete: false };
const toLines = (v) => v.split('\n').map((s) => s.trim()).filter(Boolean);
fillSelect($('e-pr'), [{ v: '', t: 'None' }].concat([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => ({ v: String(i), t: 'P' + i }))), '');

function openEditor(c) {
  editor.c = c; editor.confirmDelete = false;
  $('dlg-title').textContent = c ? 'Edit ' + c.code : 'Add test case';
  $('area-list').replaceChildren(...S.areas.map((a) => h('option', { value: a })));
  $('e-code').value = c ? c.code : '';
  // The ID is the case's column in the sheet, so it can't change once a case exists.
  $('e-code').disabled = !!c;
  $('e-area').value = c ? c.area : (S.f.area !== 'All' ? S.f.area : (S.areas[0] || 'General'));
  $('e-pr').value = c && c.pr !== null && c.pr !== undefined ? String(c.pr) : '';
  const lv = levels();
  fillSelect($('e-level'), c && c.level && !lv.includes(c.level) ? lv.concat([c.level]) : lv, c && c.level ? c.level : lv[0]);
  $('e-owner').value = c ? (c.owner || '') : '';
  $('e-dev').value = c ? (c.dev || '') : 'Open';
  $('e-title').value = c ? c.title : '';
  $('e-steps').value = c ? c.steps.join('\n') : '';
  $('e-expected').value = c ? (c.expected || '') : '';
  $('e-notes').value = c ? c.notes.join('\n') : '';
  $('e-err').textContent = '';
  $('e-delete').hidden = !c; $('e-delete').textContent = 'Delete case';
  $('e-save').disabled = false;
  $('dlg').showModal();
  (c ? $('e-title') : $('e-code')).focus();
}

$('add-btn').addEventListener('click', () => openEditor(null));
$('e-cancel').addEventListener('click', () => $('dlg').close());

$('e-save').addEventListener('click', async () => {
  const err = (msg, el) => { $('e-err').textContent = msg; if (el) el.focus(); };
  const code = $('e-code').value.trim(), title = $('e-title').value.trim();
  if (!editor.c) {
    if (!/^[A-Za-z0-9_.-]{1,20}$/.test(code)) return err('Give the case an ID using letters, numbers, . - or _ (e.g. 1.15 or EA-14).', $('e-code'));
    if (S.cases.some((x) => x.code.toLowerCase() === code.toLowerCase())) return err(code + ' is already used. Pick another ID.', $('e-code'));
  }
  if (!title) return err('Add a title so testers know what this case covers.', $('e-title'));
  const pr = $('e-pr').value;
  const body = {
    code: editor.c ? editor.c.code : code, title, area: $('e-area').value.trim() || 'General',
    pr: pr === '' ? null : Number(pr), level: $('e-level').value, owner: $('e-owner').value.trim(), dev: $('e-dev').value.trim(),
    steps: toLines($('e-steps').value), expected: $('e-expected').value.trim(), notes: toLines($('e-notes').value),
    attachments: editor.c ? editor.c.attachments : [],
  };
  $('e-save').disabled = true; $('e-err').textContent = '';
  try {
    const saved = await saveCase(body, S.name);
    const i = S.cases.findIndex((x) => x.code === saved.code);
    if (i === -1) S.cases.push(saved); else S.cases[i] = saved;
    if (!S.areas.includes(saved.area)) S.areas.push(saved.area);
    S.open.add(saved.code);
    $('dlg').close();
    renderAll();
  } catch (e) {
    $('e-save').disabled = false;
    err('Could not save the case (' + e.message + ').');
  }
});

$('e-delete').addEventListener('click', async () => {
  if (!editor.c) return;
  if (!editor.confirmDelete) { editor.confirmDelete = true; $('e-delete').textContent = 'Click again to delete'; return; }
  try {
    await deleteCase(editor.c.code, S.name);
    S.cases = S.cases.filter((x) => x.code !== editor.c.code);
    S.open.delete(editor.c.code);
    $('dlg').close();
    renderAll();
  } catch (e) { $('e-err').textContent = 'Could not delete (' + e.message + '). Try again.'; }
});


// Send a pending autosave if the tab is hidden or closed.
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') sync.flush(); });

// ---------- boot ----------
$('who').replaceChildren(h('span', null, 'Testing as ', h('b', { text: S.name }), ' · ',
  h('a', { href: 'index.html', onclick: () => clearTester() }, 'Switch tester')));

(async () => {
  try {
    const data = await loadCases();
    S.suite = data.suite; S.areas = data.areas; S.cases = data.cases;
    applySuite(S.suite, $);
    if (data.editsError) setNotice('Could not load case edits from the Google Sheet (' + data.editsError.message + '). Showing the default cases.');
  } catch (e) {
    S.loaded = true; renderAll();
    setNotice('Could not load the test cases. ' + e.message);
    return;
  }

  // Prefer what's in this browser; otherwise pick up an existing row from the sheet (e.g. a new laptop).
  const local = loadResults(S.name);
  if (local) S.results = local;
  else {
    try { S.results = (await fetchResults(S.name)) || {}; saveResults(S.name, S.results); }
    catch (e) { setNotice('Could not reach the Google Sheet to load earlier results (' + e.message + '). New results will still save in this browser.'); }
  }
  S.loaded = true;
  renderAll();
  // Send anything that didn't reach the sheet last time (tab closed mid-save, offline), or results
  // that just moved over from a shared-link session.
  if (takeResyncFlag() && Object.keys(S.results).length) setUnsent(S.name, true);
  if (hasUnsent(S.name)) sync.schedule();
})();
