import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { prototypeFacts, fromReading, draftManifest, readManifest, addToManifest, manifestProblems, screensBrief, keyOfStatement, statementsOf, readingShape, MANIFEST, READING, SECTIONS } from '../src/prototype.mjs';
import { verify } from '../src/verify.mjs';

const BIN = fileURLToPath(new URL('../bin/buddy.mjs', import.meta.url));
// a prototype like map-lite's: one page, its views drawn by script into <main id="view"> from data-nav links
const MAP = `<!doctype html><html><body>
<nav><a href="#" data-nav="apps">Aplicaciones</a> <a href="#" data-nav="dashboard">Tablero</a> <a href="#" data-nav="people">Personas</a> <a href="#" data-nav="catalogs">Catálogos</a></nav>
<main id="view"></main>
<script>
function renderApps() { return '<h1>Aplicaciones</h1>'; }
const renderDashboard = () => '<h1>Tablero</h1>';
const views = { people: () => '<h1>Personas</h1>', catalogs: function () { return '<h1>Catálogos</h1>'; } };
document.querySelectorAll('[data-nav]').forEach(a => a.onclick = () => show(a.dataset.nav));
</script></body></html>`;
const READ = {
  screens: [
    { name: 'apps', title: 'Aplicaciones', file: 'Mockup.html', evidence: ['data-nav="apps"', 'function renderApps()'] },
    { name: 'dashboard', title: 'Tablero', file: 'Mockup.html', evidence: ['data-nav="dashboard"', 'const renderDashboard'] },
    { name: 'people', title: 'Personas', file: 'Mockup.html', evidence: ['data-nav="people"'] },
    { name: 'catalogs', title: 'Catálogos', file: 'Mockup.html', evidence: ['data-nav="catalogs"'] },
  ],
  flows: [{ from: 'apps', to: 'dashboard', via: 'Tablero', evidence: ['<a href="#" data-nav="dashboard">Tablero</a>'] }],
  fake: [{ screen: 'dashboard', text: 'the figures are sample data' }],
  notes: ['The menu switches views by script.'],
};
const files = [{ name: 'Mockup.html', html: MAP }];
const project = (reading = READ) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-')); fs.mkdirSync(path.join(d, 'docs/inputs/prototype'), { recursive: true }); fs.writeFileSync(path.join(d, 'docs/inputs/prototype/Mockup.html'), MAP); if (reading) fs.writeFileSync(path.join(d, READING), JSON.stringify(reading)); return d; };
const run = (d, ...a) => spawnSync(process.execPath, [BIN, 'prototype', ...a, '--repo', d], { encoding: 'utf8' });

test('facts list the data-nav links and the functions of the scripts, without deciding', () => {
  const f = prototypeFacts(files).files[0];
  assert.deepEqual(f.links.map(l => [l.text, l.href, l.data['data-nav']]), [['Aplicaciones', '#', 'apps'], ['Tablero', '#', 'dashboard'], ['Personas', '#', 'people'], ['Catálogos', '#', 'catalogs']]);
  assert.deepEqual(f.functions, ['renderApps', 'renderDashboard', 'people', 'catalogs']); assert.deepEqual(f.ids, ['view']); assert.equal(f.scripts, 1);
  const r = run(project(null), 'facts'); assert.equal(r.status, 0); assert.match(r.stdout, /Mockup\.html: 1 id\(s\), 4 link\(s\)/); assert.match(r.stdout, /link {3}"Tablero" href=# data-nav="dashboard"/); assert.match(r.stdout, /script functions: renderApps, renderDashboard/);
  assert.equal(JSON.parse(run(project(null), 'facts', '--json').stdout).files[0].links.length, 4);
});
test('a reading with four screens drafts four screens, each saying where it comes from', () => {
  const p = fromReading(READ, files); assert.deepEqual(p.problems, []);
  const d = project(); fs.writeFileSync(path.join(d, MANIFEST), draftManifest(p, { date: '2026-11-02' })); const m = readManifest(path.join(d, MANIFEST));
  assert.deepEqual(m.screens.map(s => s.name), ['apps', 'dashboard', 'people', 'catalogs']); assert.equal(m.data.reading, READING); assert.equal(m.data.fingerprint, prototypeFacts(files).fingerprint);
  assert.match(m.screens[1].text, /^`dashboard` Tablero \(Mockup\.html\) — from: data-nav="dashboard"; const renderDashboard$/);
  assert.ok(m.statements.some(s => s.section === SECTIONS.flows && s.text === '`apps` to `dashboard` through "Tablero"'));
  assert.ok(m.statements.some(s => s.section === SECTIONS.fake && s.text === '`dashboard`: the figures are sample data'));
  for (const x of statementsOf(p)) assert.equal(keyOfStatement(x.section, x.text), x.key, x.text);
  assert.deepEqual(manifestProblems(d).problems, []); assert.deepEqual(verify([path.join(d, 'docs')]).problems, []);
  const cli = run(d, 'draft', '--reading'); assert.equal(cli.status, 0); assert.match(cli.stdout, /from docs\/inputs\/prototype\/reading\.json: 4 screen\(s\)/); assert.equal(run(d, 'check').status, 0);
});
test('a screen or flow whose evidence is not in its file is marked on its line, and draft and check say so', () => {
  const bad = { ...READ, screens: [...READ.screens, { name: 'reports', title: 'Informes', file: 'Mockup.html', evidence: ['data-nav="reports"'] }, { name: 'help', title: 'Ayuda', file: 'Mockup.html' }], flows: [...READ.flows, { from: 'apps', to: 'people', via: 'Personas', evidence: ['nowhere at all'] }] };
  const d = project(bad); const r = run(d, 'draft', '--reading'); assert.equal(r.status, 0);
  assert.match(r.stdout, /3 line\(s\) not backed by the prototype/); assert.match(r.stdout, /screen `reports`: not found in Mockup\.html: "data-nav=\\?"reports\\?""/); assert.match(r.stdout, /screen `help`: no evidence given/);
  const m = readManifest(path.join(d, MANIFEST)); const line = n => m.statements.find(s => s.text.startsWith(n)).text;
  assert.match(line('`reports`'), /\(not backed by the prototype: not found in Mockup\.html: "data-nav="reports""\)$/); assert.match(line('`help`'), /\(not backed by the prototype: no evidence given\)$/); assert.match(line('`apps` to `people`'), /not backed by the prototype/);
  assert.doesNotMatch(line('`apps` Aplicaciones'), /not backed/);
  const ch = run(d, 'check'); assert.equal(ch.status, 1); assert.match(ch.stderr, /reading\.json: screen `reports`: not found in Mockup\.html/); assert.match(ch.stderr, /flow `apps` to `people`: not found/);
  fs.writeFileSync(path.join(d, READING), JSON.stringify(READ)); assert.equal(run(d, 'check').status, 1);   // the manifest still holds the marked lines until it is drafted again
  assert.equal(run(d, 'draft', '--reading').status, 0); assert.equal(run(d, 'check').status, 0);
  fs.rmSync(path.join(d, READING)); assert.match(run(d, 'check').stderr, /drafted from docs\/inputs\/prototype\/reading\.json, which is gone/);
});
test('a reading of the wrong shape is refused with clear messages', () => {
  assert.deepEqual(readingShape(READ), []);
  const errs = readingShape({ screens: [{ name: 'Tablero', title: '', file: 'x.html', evidence: 'data-nav' }, { name: 'a', title: 'A', file: 'x.html' }, { name: 'a', title: 'A', file: 'x.html' }], flows: [{ from: 'a', to: 'b', via: 'go' }], extra: 1 });
  for (const re of [/unknown key "extra"/, /screens\[0\]: "name" must be lowercase/, /screens\[0\]: "title"/, /screens\[0\]: "evidence" must be a list/, /screens\[2\]: two screens are named "a"/, /flows\[0\]: "to" must name a screen/]) assert.ok(errs.some(e => re.test(e)), String(re));
  assert.match(readingShape([])[0], /must be a JSON object/);
  const d = project({ screens: [] }); const r = run(d, 'draft', '--reading'); assert.equal(r.status, 1); assert.match(r.stderr, /"screens" must be a list with at least one item/); assert.ok(!fs.existsSync(path.join(d, MANIFEST)));
  const none = project(null); assert.match(run(none, 'draft', '--reading').stderr, /no reading yet/);
  fs.writeFileSync(path.join(none, READING), '{ not json'); assert.match(run(none, 'draft', '--reading').stderr, /is not valid JSON/);
});
test('the owner adds a screen the draft missed; it is confirmed, marked as theirs, and survives a new draft', () => {
  const d = project(); assert.equal(run(d, 'draft', '--reading').status, 0);
  const r = run(d, 'add', '--section', 'screens', '--text', '`settings` Ajustes (Mockup.html)'); assert.equal(r.status, 0, r.stderr);
  const today = new Date().toISOString().slice(0, 10); let m = readManifest(path.join(d, MANIFEST));
  const own = m.screens.find(s => s.name === 'settings'); assert.equal(own.origin, 'human'); assert.equal(own.date, today); assert.equal(own.text, '`settings` Ajustes (Mockup.html) (declared by the owner)');
  assert.equal(run(d, 'add', '--section', 'flows', '--text', '`settings` to `apps` through "Volver"').status, 0);
  assert.equal(run(d, 'draft', '--reading').status, 0); m = readManifest(path.join(d, MANIFEST));
  assert.deepEqual(m.screens.map(s => s.name), ['apps', 'dashboard', 'people', 'catalogs', 'settings']); assert.ok(!m.statements.some(s => s.section === SECTIONS.gone));
  assert.ok(m.statements.some(s => s.section === SECTIONS.flows && s.text === '`settings` to `apps` through "Volver" (declared by the owner)' && s.origin === 'human'));
  const plain = run(d, 'draft'); assert.equal(plain.status, 1); assert.match(plain.stderr, /refused: a draft comes only from Buddy's reading: write it first \(`prototype facts`, then docs\/inputs\/prototype\/reading\.json\), then `prototype draft --reading`/);
  assert.ok(readManifest(path.join(d, MANIFEST)).screens.some(s => s.name === 'settings'));       // the refusal leaves the manifest as it was
  assert.equal(run(d, 'scan').status, 2);       // the program no longer reads a prototype on its own
  assert.deepEqual(verify([path.join(d, 'docs')]).problems, []);
  assert.match(run(d, 'add', '--section', 'screens', '--text', 'Settings page').stderr, /a screen starts with its name in backticks/);
  assert.match(run(d, 'add', '--section', 'screens', '--text', '`settings` Again').stderr, /already has a screen `settings`/);
  assert.match(run(d, 'add', '--section', 'nope', '--text', 'x').stderr, /--section screens\|flows\|fake/);
  assert.throws(() => addToManifest('---\nx: 1\n---\n# M\n', { section: 'fake', statement: '' }), /the line is empty/);
  const fresh = addToManifest('---\nupdated: 2026-11-01\n---\n# M\n\n## Screens\n- `a` A (a.html) `assumed`\n', { section: 'fake', statement: '`a`: the logo', date: '2026-11-03' });
  assert.match(fresh.text, /## What is fake or only an example\n- `a`: the logo \(declared by the owner\) `human 2026-11-03`/);
});
test('the screens brief that Dev and the reviewer receive uses Buddy\'s reading when there is one', () => {
  const d = project(); assert.equal(run(d, 'draft', '--reading').status, 0);
  const b = screensBrief(d, ['dashboard', 'apps']); const t = b.text;
  assert.match(t, /### Screen `dashboard` — Tablero \(docs\/inputs\/prototype\/Mockup\.html\)/); assert.match(t, /Where it is in the prototype: data-nav="dashboard" \| const renderDashboard/);
  assert.match(t, /Comes from: apps \(through "Tablero"\)/); assert.match(t, /Fake or only an example: the figures are sample data/); assert.match(t, /Manifest: `dashboard` Tablero/);
  assert.match(t, /### Screen `apps` — Aplicaciones[\s\S]*Goes to: dashboard \(through "Tablero"\)/);
  fs.rmSync(path.join(d, READING)); const none = screensBrief(d, ['apps']).text; assert.match(none, /### Screen `apps` \(docs\/inputs\/prototype\/reading\.json is missing: write it/); assert.match(none, /Manifest: `apps` Aplicaciones/); assert.doesNotMatch(none, /Its HTML/);   // without a reading the brief still names the manifest and says so
});

// fix-checks-from-field (R155, AC3): with Buddy's reading, each screen's brief carries its fragment of the prototype's HTML, bounded.
import { fragmentOf, FRAGMENT_CAP } from '../src/prototype.mjs';
test('with a reading, each screen of the brief carries the HTML its evidence points at, so the reviewer can compare', () => {
  const d = project(); assert.equal(run(d, 'draft', '--reading').status, 0);
  const t = screensBrief(d, ['dashboard', 'people']).text;
  const people = t.slice(t.indexOf('### Screen `people`'));
  assert.match(people, /Its HTML in the prototype \(the element the reading points at\):\n```html\n<a href="#" data-nav="people">Personas<\/a>\n```/);
  const dashboard = t.slice(0, t.indexOf('### Screen `people`'));
  assert.match(dashboard, /the elements the reading points at/); assert.ok(dashboard.includes('<a href="#" data-nav="dashboard">Tablero</a>')); assert.ok(dashboard.includes('const renderDashboard = () =>'), 'the script that draws it');
  fs.rmSync(path.join(d, READING)); assert.doesNotMatch(screensBrief(d, ['mockup']).text, /Its HTML in the prototype/, 'without a reading, no HTML');
});
test('a fragment is the smallest element holding each evidence, whitespace squashed, and a long one is cut and says so', () => {
  const html = '<body>\n<section id="login">\n  <h1>Sign\n   in</h1><button>Go</button></section><p>other</p></body>';
  assert.deepEqual(fragmentOf(html, ['Sign in']), { html: '<h1>Sign\n   in</h1>', total: 19, cut: false });
  assert.equal(fragmentOf(html, ['<section id="login">', 'Go']).html, '<section id="login">\n  <h1>Sign\n   in</h1><button>Go</button></section>', 'the one inside another is left out');
  assert.equal(fragmentOf(html, ['not there']), null);
  const big = `<section id="big">${'<p>row</p>'.repeat(1000)}</section>`; const f = fragmentOf(big, ['id="big"'], { file: 'docs/inputs/prototype/big.html' });
  assert.equal(f.cut, true); assert.equal(f.total, big.length); assert.ok(f.html.startsWith(big.slice(0, FRAGMENT_CAP)));
  assert.ok(f.html.endsWith(`\n<!-- cut by Buddy: ${FRAGMENT_CAP} of ${big.length} characters shown; the whole screen is in docs/inputs/prototype/big.html -->`), f.html.slice(-200));
});
// A prototype that draws its screens from one script (a field pilot): the fragment is the function that draws the screen, not the script cut at its start.
test('evidence inside a script gives the named function that holds it, or the lines around it, never the start of the script', () => {
  const consts = `const DATA = [${'"row", '.repeat(800)}];\n`;
  const html = `<body><div id="app"></div><script>\n${consts}function renderLogin() {\n  const say = 'it\\'s } here';   // a } in a string\n  app.innerHTML = \`<main>\${user ? \`<p>{x}</p>\` : ''}<h1>Sign in</h1></main>\`;\n}\nfunction renderNoAccess() {\n  app.innerHTML = \`<h1>No access</h1>\`;\n}\n${consts}const loose = 1; app.innerHTML = '<p>Loose text</p>';\n${consts}</script></body>`;
  const f = fragmentOf(html, ['<h1>Sign in</h1>']);
  assert.equal(f.script, true); assert.ok(f.html.startsWith('function renderLogin() {') && f.html.endsWith('</main>`;\n}'), f.html);
  assert.equal(fragmentOf(html, ['<h1>No access</h1>']).html, 'function renderNoAccess() {\n  app.innerHTML = `<h1>No access</h1>`;\n}');
  const loose = fragmentOf(html, ['Loose text']); assert.ok(loose.html.includes("'<p>Loose text</p>'") && !loose.cut && loose.total <= FRAGMENT_CAP + 200, `${loose.total}`);
  const p = project(); fs.writeFileSync(path.join(p, 'docs/inputs/prototype/app.html'), html);
  fs.writeFileSync(path.join(p, READING), JSON.stringify({ screens: [{ name: 'login', title: 'Sign in', file: 'app.html', evidence: ['<h1>Sign in</h1>'] }] }));
  assert.match(screensBrief(p, ['login']).text, /Its code in the prototype \(the script that draws it: the function holding what the reading points at\):\n```js\nfunction renderLogin\(\) \{/);
});

// R268: the zones the owner fixed (data-buddy-zone="fixed") are still told to Dev and the reviewer, found around the evidence of each screen.
test('the brief names the zones the owner fixed in each screen, and the manifest lists them', () => {
  const html = '<section id="list"><h1>Reading list</h1><p data-buddy-zone="fixed">Prices include tax</p><p data-buddy-zone="illustrative">Sample</p></section><section id="add"><h2>Add a book</h2><p data-buddy-zone="fixed">Max 5 per day</p></section>';
  const d = project(); fs.writeFileSync(path.join(d, 'docs/inputs/prototype/shop.html'), html);
  fs.writeFileSync(path.join(d, READING), JSON.stringify({ screens: [{ name: 'list', title: 'Reading list', file: 'shop.html', evidence: ['<h1>Reading list</h1>'] }, { name: 'add', title: 'Add a book', file: 'shop.html', evidence: ['<h2>Add a book</h2>'] }] }));
  assert.equal(run(d, 'draft', '--reading').status, 0); const t = screensBrief(d, ['list', 'add']).text;
  const list = t.slice(0, t.indexOf('### Screen `add`')); const add = t.slice(t.indexOf('### Screen `add`'));
  assert.match(list, /Fixed by the owner \(do not change without asking\): Prices include tax\n/); assert.doesNotMatch(list, /Max 5/); assert.match(add, /Fixed by the owner \(do not change without asking\): Max 5 per day\n/);
  assert.ok(readManifest(path.join(d, MANIFEST)).statements.some(s => s.section === SECTIONS.fixed && s.text === '`list`: Prices include tax (fixed)'));
});
