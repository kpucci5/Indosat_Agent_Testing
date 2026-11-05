// Name page: remembers who is testing, then opens the tracker.
import { $ } from './dom.js';
import { loadSuite, applySuite } from './cases.js';
import { cleanName, getTester, setTester, canRemember, adoptOldResults } from './store.js';

loadSuite().then((s) => applySuite(s, $), () => {});

const input = $('name');
input.value = getTester();
input.focus();

$('signin').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = cleanName(input.value);
  if (name.length < 2) { $('err').textContent = 'Enter your name so your results land on your own row.'; input.focus(); return; }
  setTester(name);
  adoptOldResults(name);
  // Keep the name out of the address so a copied link doesn't carry it to someone else.
  location.href = canRemember() ? 'tracker.html' : 'tracker.html?tester=' + encodeURIComponent(name);
});
