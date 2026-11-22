import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { checkpoint, reviewerPrompt } from '../src/checkpoint.mjs';
import { howtoSet, startSlice, moveSlice, stepAddTo, stepSetIn, screensAdd, readSlice } from '../src/slicestore.mjs';
import { readPrototype, draftManifest, confirmManifest, readManifest, screensBrief, MANIFEST } from '../src/prototype.mjs';
import { resumeBrief, briefText } from '../src/resume.mjs';

const G = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { cwd, encoding: 'utf8', stdio: 'pipe' });
const HTML = `<section id="list"><h1>Reading list</h1><input placeholder="Search books"><a href="#add">Add one</a><p data-buddy-zone="fixed">Prices include tax</p></section><section id="add"><h2>Add a book</h2><a href="#list">Back</a><a href="#">Help</a></section><section id="stats"><h1>Stats</h1><a href="#list">Back</a></section>`;
const NOW = new Date().toISOString().slice(0, 19) + 'Z';
const ok = () => ({ does_what_was_asked: true, weakens_or_hides_checks: false, unspecified_decisions: [], undeclared_divergences: [], details: 'fine' });
// A project with its prototype and confirmed manifest committed, and a change covering `screens` that is building.
function setup({ screens = ['list', 'add'] } = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-')); G(d, 'init', '-q', '-b', 'main'); fs.mkdirSync(path.join(d, 'docs/inputs/prototype'), { recursive: true });
  fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: 'x', scripts: { validate: 'node -e "0"' } })); fs.writeFileSync(path.join(d, 'docs/inputs/prototype/index.html'), HTML);
  fs.writeFileSync(path.join(d, MANIFEST), confirmManifest(draftManifest(readPrototype([{ name: 'index.html', html: HTML }]), { date: '2026-11-01' }), { all: true, date: '2026-11-01' }).text);
  G(d, 'add', 'package.json', 'docs/inputs'); G(d, 'commit', '-qm', 'base');
  const s = startSlice({ repo: d, title: 'List and add books', request: 'Let the reader list and add books', criteria: ['It works'], excludes: ['Nothing beyond the criteria above'] });
  if (screens.length) screensAdd(d, s.id, screens);
  stepAddTo(d, s.id, 'Build both screens'); moveSlice(d, s.id, 'ready'); moveSlice(d, s.id, 'building'); stepSetIn(d, s.id, '1', true); howtoSet(d, s.id, 'AC1', { steps: 'Open the list and add a book', expect: 'The book is in the list' });
  fs.writeFileSync(path.join(d, 'books.js'), 'export const books = [];\n'); fs.writeFileSync(path.join(d, 'books.test.js'), "import assert from 'node:assert';\nassert.equal(1, 1);\n");
  return { d, id: s.id };
}

test('Dev and the reviewer receive the same text for the screens a change covers, and the evidence says what the reviewer was given', () => {
  const { d, id } = setup(); const text = screensBrief(d, ['list', 'add']).text; let seen = '';
  const brief = briefText(resumeBrief(d, id, NOW)); assert.ok(brief.includes(text)); assert.match(brief, /Prototype screens you cover \(your experience contract.*declare every departure with `buddy slice divergence add`/);
  const r = checkpoint({ repo: d, slice: id, human: true, review: p => { seen = p; return ok(); } });
  assert.ok(seen.includes(text)); assert.match(seen, /## Prototype screens this change covers/); assert.match(seen, /## Departures declared by Dev\nnone declared/); assert.match(seen, /undeclared_divergences/);
  assert.match(text, /### Screen `list` — Reading list \(docs\/inputs\/prototype\/index\.html\)/); assert.match(text, /Goes to: add \(through "Add one"\)/); assert.match(text, /Fixed by the owner \(do not change without asking\): Prices include tax/);
  assert.match(text, /Fake or only an example: goes nowhere: link "Help"/); assert.match(text, /Manifest: `list` Reading list .* \[confirmed 2026-11-01\]/);
  const ev = r.evidence; assert.deepEqual(ev.inputs.screens, ['list', 'add']); assert.match(ev.inputs.prototype, /^[0-9a-f]{16}$/); assert.deepEqual(ev.inputs.manifest, [{ screen: 'list', origin: 'human' }, { screen: 'add', origin: 'human' }]); assert.equal(ev.inputs.departures_declared, 0);
});
test('a reviewer that finds an undeclared departure raises an exception', () => {
  const { d, id } = setup(); const r = checkpoint({ repo: d, slice: id, human: true, review: () => ({ ...ok(), undeclared_divergences: ['list: the search box was removed'] }) });
  assert.equal(r.decision, 'NEEDS_HUMAN'); assert.match(r.text, /independent reviewer: departs from the prototype without declaring it \(list: the search box was removed\)/);
});
test('declared departures are part of what the reviewer reads', () => {
  const p = reviewerPrompt('req', 'diff', { screens: 'SCREEN TEXT', divergences: [{ id: 'V1', kind: 'improvement', screen: 'list', prototype: 'has no sort', built: 'sorts by title', why: 'a long list is hard to scan' }] });
  assert.match(p, /- V1 \(improvement\) on `list`: the prototype has no sort; built: sorts by title; why: a long list is hard to scan/); assert.match(p, /SCREEN TEXT/);
});
test('a change that covers no screen gets the usual prompt and no inputs in the evidence', () => {
  assert.ok(!/Prototype screens/.test(reviewerPrompt('req', 'diff')));
  const { d, id } = setup({ screens: [] }); let seen = ''; const brief = briefText(resumeBrief(d, id, NOW)); const r = checkpoint({ repo: d, slice: id, human: true, review: p => { seen = p; return ok(); } });
  assert.ok(!/Prototype screens/.test(seen)); assert.equal(r.evidence.inputs, undefined); assert.ok(!/Prototype screens you cover/.test(brief));
});
test('if the prototype changed since the manifest was drafted, the checkpoint says so', () => {
  const { d, id } = setup(); fs.appendFileSync(path.join(d, 'docs/inputs/prototype/index.html'), '<p>a new paragraph</p>');
  const r = checkpoint({ repo: d, slice: id, human: true, review: ok }); assert.match(r.text, /the prototype changed since the manifest was drafted/); assert.equal(r.decision, 'NEEDS_HUMAN');
  void readSlice; void readManifest;
});

// fix-checks-from-field (R155, AC3; the owner chose on 2026-11-05, R170): a screen the reviewer knew was there and could not verify does not pass. It is an
// exception with what would let it be verified next time, and the owner may decide that nobody tries again: it still never reads as a pass.
import { acceptCard, unverifiedAccept, unverifiedUndo, moveSlice as mv, readSlice as rd } from '../src/slicestore.mjs';
test('a screen the reviewer could not compare does not pass: it is an exception that says how to verify it next time', () => {
  const { d, id } = setup(); let seen = '';
  const nv = [{ screen: 'add', why: 'the fragment does not show the form', how_to_verify: 'give the fragment of the whole page' }];
  const r = checkpoint({ repo: d, slice: id, human: true, review: p => { seen = p; return { ...ok(), not_verified: nv }; } });
  assert.match(seen, /"not_verified": \[\{"screen": "name of the screen", "why": "why you could not compare it", "how_to_verify": "what would let a reviewer verify it next time"\}\]/); assert.match(seen, /A screen you could not verify does not pass/);
  assert.equal(r.decision, 'NEEDS_HUMAN', r.text); assert.equal(r.evidence.checks.prototype_departures, 'not run');
  assert.match(r.evidence.reasons.join('|'), /could not verify 1 screen of the prototype, so it does not pass: add: the fragment does not show the form; to verify it next time: add: give the fragment of the whole page\. Keep trying, or leave it unverified with buddy slice unverified accept/);
  assert.match(r.text, /prototype departures not run \(1 screen not verified\)/); assert.doesNotMatch(r.text, /prototype departures passed/);
  assert.doesNotMatch(acceptCard(d, id), /Found by the checks, not exceptions by themselves[^]*not verified by the reviewer/);
});
test('a reviewer that writes the screen as a line is still understood', () => {
  const { d, id } = setup(); const r = checkpoint({ repo: d, slice: id, human: true, review: () => ({ ...ok(), not_verified: ['add: could not find it'] }) });
  assert.equal(r.decision, 'NEEDS_HUMAN'); assert.match(r.evidence.reasons.join('|'), /add: could not find it/); assert.doesNotMatch(r.evidence.reasons.join('|'), /to verify it next time/);
});
test('the owner can decide that nobody tries again: it is recorded, shown on the accept card, no longer an exception, and never a pass', () => {
  const { d, id } = setup(); const rv = () => ({ ...ok(), not_verified: [{ screen: 'add', why: 'no fragment', how_to_verify: 'give the fragment' }] });
  assert.throws(() => unverifiedAccept(d, id, 'add', { by: 'someone' }), /only the Product Owner/);
  assert.throws(() => unverifiedAccept(d, id, 'nope', { by: 'owner' }), /is not a screen this change covers; they are: /);
  const first = checkpoint({ repo: d, slice: id, human: true, review: rv }); assert.equal(first.decision, 'NEEDS_HUMAN');
  unverifiedAccept(d, id, 'Add', { by: 'owner', channel: 'chat', note: 'the page is only a sketch' });
  const u = rd(d, id).data.unverified; assert.equal(u.length, 1); assert.deepEqual([u[0].screen, u[0].by, u[0].channel, u[0].note], ['add', 'owner', 'chat', 'the page is only a sketch']);
  assert.match(acceptCard(d, id), /Screens you chose not to verify \(1\), still not a pass:\n  add, decided \d{4}-\d{2}-\d{2}: the page is only a sketch/);
  mv(d, id, 'rework'); mv(d, id, 'building');
  const second = checkpoint({ repo: d, slice: id, human: true, review: rv });
  assert.equal(second.decision, 'APPROVE', second.text); assert.equal(second.evidence.checks.prototype_departures, 'not run');
  assert.match(second.text, /prototype departures not run \(1 screen not verified, 1 left that way by the owner\)/);
  unverifiedUndo(d, id, 'add'); assert.equal(rd(d, id).data.unverified, undefined);
});
