import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { draftManifest, readManifest, confirmManifest, manifestProblems, keyOfStatement, statementsOf, MANIFEST, SECTIONS } from '../src/prototype.mjs';
import { verify } from '../src/verify.mjs';
import { draftOf, writeReading } from './_reading.helper.mjs';

const BIN = fileURLToPath(new URL('../bin/buddy.mjs', import.meta.url));
const LIST = `<nav><a href="#list">Books</a> <a href="#add">Add a book</a></nav>
<section id="list"><h1>Reading list</h1><input placeholder="Search books" name="q"><button>Add a book</button><a href="#add">Add one</a></section>
<section id="add"><h2>Add a book</h2><form><label for="t">Title</label><input id="t" name="title"><button type="submit">Save</button></form><a href="#list">Back to the list</a> <a href="#">Help</a></section>`;
const project = html => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-')); fs.mkdirSync(path.join(d, 'docs/inputs/prototype'), { recursive: true }); fs.writeFileSync(path.join(d, 'docs/inputs/prototype/index.html'), html); writeReading(d, html); return d; };
const read = draftOf;
const run = (d, ...a) => spawnSync(process.execPath, [BIN, 'prototype', ...a, '--repo', d], { encoding: 'utf8' });

test('the draft has every line assumed, a section per kind of statement, and verifies', () => {
  const text = draftManifest(read(LIST), { date: '2026-11-01' });
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-')); fs.mkdirSync(path.join(d, 'docs/inputs/prototype'), { recursive: true }); fs.writeFileSync(path.join(d, MANIFEST), text);
  const m = readManifest(path.join(d, MANIFEST));
  assert.deepEqual(m.screens.map(s => [s.name, s.origin]), [['list', 'assumed'], ['add', 'assumed']]);
  assert.ok(m.statements.every(s => s.origin === 'assumed')); assert.deepEqual([...new Set(m.statements.map(s => s.section))], [SECTIONS.screens, SECTIONS.flows, SECTIONS.fake]);
  assert.match(m.statements[0].text, /^`list` Reading list \(index\.html\) — from: <h1>Reading list<\/h1>$/);
  assert.deepEqual(verify([path.join(d, 'docs')]).problems, []);
});
test('keyOfStatement matches what statementsOf writes, for every kind of statement', () => {
  const p = { ...read(`<section id="x"><h1>X</h1><p data-buddy-zone="fixed">Legal text</p><a href="#">Nowhere</a><a href="#y">go</a></section><section id="y"><h1>Y</h1><a href="#x">back</a></section>`), notes: ['The menu switches views by script.'] };
  const stmts = statementsOf(p); assert.ok(stmts.length >= 6);
  for (const s of stmts) assert.equal(keyOfStatement(s.section, s.text), s.key, s.text);
  assert.deepEqual([...new Set(stmts.map(s => s.section))], [SECTIONS.screens, SECTIONS.flows, SECTIONS.fake, SECTIONS.fixed, SECTIONS.notes]);
});
test('confirm: all, a line, or a line with a correction; a confirmed line is not touched again', () => {
  const text = draftManifest(read(LIST), { date: '2026-11-01' }); const line = n => text.replace(/\r\n/g, '\n').split('\n').findIndex(l => l.includes(n)); void line;
  const stmts = readManifestFrom(text); const first = stmts[0].line;
  const one = confirmManifest(text, { lines: [first], date: '2026-11-02' }); assert.deepEqual(one.changed, [first]); assert.match(one.text, /^updated: 2026-11-02$/m);
  const m1 = readManifestFrom(one.text); assert.equal(m1[0].origin, 'human'); assert.equal(m1[0].date, '2026-11-02'); assert.equal(m1[1].origin, 'assumed');
  const again = confirmManifest(one.text, { lines: [first], date: '2026-11-09' }); assert.deepEqual(again.changed, []); assert.equal(readManifestFrom(again.text)[0].date, '2026-11-02');   // the first confirmation stands
  const fixed = confirmManifest(one.text, { corrections: { [m1[1].line]: '`add` Add a book, with title and author' }, date: '2026-11-03' }); assert.match(fixed.text, /`add` Add a book, with title and author `human 2026-11-03`/);
  const all = confirmManifest(text, { all: true, date: '2026-11-04' }); assert.ok(readManifestFrom(all.text).every(s => s.origin === 'human'));
  assert.throws(() => confirmManifest(text, { lines: [1] }), /line 1 is not a statement/);
});
function readManifestFrom(text) { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-')); const f = path.join(d, 'm.md'); fs.writeFileSync(f, text); return readManifest(f).statements; }

test('when the prototype changes, what you confirmed is kept, what disappeared is moved and said, what was assumed is rewritten', () => {
  const d = project(LIST); const first = draftManifest(draftOf(LIST), { date: '2026-11-01' });
  const confirmed = confirmManifest(first, { all: true, date: '2026-11-01' }).text;
  const changed = LIST.replace('Add a book</button>', 'Add a book now</button>').replace(/<section id="add">[\s\S]*<\/section>/, '<section id="add"><h2>Add a book</h2><a href="#list">Back to the list</a></section><section id="stats"><h1>Stats</h1><a href="#list">Back</a></section><a href="#stats">Stats</a>');
  const next = draftManifest(draftOf(changed), { existing: confirmed, date: '2026-11-05' });
  fs.writeFileSync(path.join(d, MANIFEST), next); const m = readManifest(path.join(d, MANIFEST)); const by = n => m.statements.find(s => s.text.startsWith(n));
  assert.equal(by('`list`').origin, 'human'); assert.match(by('`list`').text, /from: <h1>Reading list<\/h1>/);        // the confirmed text is kept byte for byte
  assert.equal(by('`stats`').origin, 'assumed');                                                              // new: to confirm
  const gone = m.statements.filter(s => s.section === SECTIONS.gone); assert.ok(gone.length >= 1); assert.ok(gone.every(s => s.origin === 'human' && /was under:/.test(s.text)));  // the form's flows or fake lines that vanished are shown, not dropped
  assert.deepEqual(verify([path.join(d, 'docs')]).problems, []);
  const again = draftManifest(draftOf(changed), { existing: next, date: '2026-11-06' });      // drafting again does not pile up the notes
  fs.writeFileSync(path.join(d, MANIFEST), again); assert.deepEqual(readManifest(path.join(d, MANIFEST)).statements.filter(s => s.section === SECTIONS.gone).map(s => (s.text.match(/was under/g) || []).length), gone.map(() => 1));
});
test('check: no manifest, an untagged line, a changed prototype, and the gate on unconfirmed screens', () => {
  const d = project(LIST); assert.equal(manifestProblems(d).exists, false);
  assert.equal(run(d, 'draft', '--reading').status, 0); const f = path.join(d, MANIFEST);
  assert.deepEqual(manifestProblems(d).problems, []); assert.equal(manifestProblems(d).unconfirmed.length, 2);
  assert.equal(run(d, 'check').status, 0); const gated = run(d, 'check', '--require-confirmed'); assert.equal(gated.status, 1); assert.match(gated.stderr, /2 screen\(s\) not confirmed/);
  assert.equal(run(d, 'confirm', '--all').status, 0); assert.equal(run(d, 'check', '--require-confirmed').status, 0);
  fs.writeFileSync(path.join(d, 'docs/inputs/prototype/index.html'), LIST + '<p>new</p>'); const ch = run(d, 'check'); assert.equal(ch.status, 1); assert.match(ch.stderr, /the prototype changed since the manifest was drafted/);
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8') + '- a line with no tag\n'); assert.match(manifestProblems(d).problems.join('\n'), /no origin tag/);
  assert.ok(verify([path.join(d, 'docs')]).problems.some(p => /no origin tag/.test(p.message)));
});
test('the CLI end to end: facts, draft, card, confirm a line with a correction, screens', () => {
  const d = project(LIST); const facts = run(d, 'facts'); assert.equal(facts.status, 0); assert.match(facts.stdout, /index\.html: 3 id\(s\)/); assert.ok(!fs.existsSync(path.join(d, MANIFEST)));   // facts writes nothing
  const draft = run(d, 'draft', '--reading', '--title', 'The shop'); assert.equal(draft.status, 0); assert.match(draft.stdout, /wrote docs\/inputs\/prototype\/manifest\.md from .*: 2 screen\(s\)/); assert.match(draft.stdout, /Reply "ok" to confirm all/);
  const stmts = readManifestFrom(fs.readFileSync(path.join(d, MANIFEST), 'utf8')); const line = stmts.find(s => s.text.startsWith('`add`')).line;
  assert.equal(run(d, 'confirm', '--line', String(line), '--text', '`add` Add a book with its title').status, 0);
  assert.match(run(d, 'screens').stdout, /list +not confirmed\nadd +confirmed \d{4}-\d{2}-\d{2}/); assert.match(run(d, 'card').stdout, /\[confirmed \d{4}-\d{2}-\d{2}\]/);
  const none = run(fs.mkdtempSync(path.join(os.tmpdir(), 'pm-')), 'facts'); assert.equal(none.status, 1); assert.match(none.stderr, /no HTML found in docs\/inputs\/prototype/);
  assert.equal(run(d, 'confirm').status, 1); assert.equal(run(d, 'nonsense').status, 2);
});
