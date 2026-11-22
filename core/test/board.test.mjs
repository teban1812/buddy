import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { startSlice, moveSlice, stepAddTo, stepSetIn, readSlice } from '../src/slicestore.mjs';
import { createBatch, writeBatchFile, assumeDefaults } from '../src/queue.mjs';
import { loadBoard, boardText, boardHtml, age } from '../src/board.mjs';

const BIN = fileURLToPath(new URL('../bin/board.mjs', import.meta.url));
const EXAMPLES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'design', 'examples');
const WORKSHOP = { skip: fs.existsSync(EXAMPLES) ? false : 'the design examples (docs/design/examples) are a workshop fixture, not in the public copy' };
const NOW = '2026-10-31T18:00:00Z';
// A fixed clock that advances by one hour per call, so every record gets a known timestamp. Names come from the titles.
function fixture() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bd-')); fs.mkdirSync(path.join(d, 'docs')); let min = 0;   // the clock starts at 08:00:30 and moves one minute per call, so every record is 9 h old at NOW
  const now = () => new Date(Date.UTC(2026, 9, 31, 8, min++, 30));
  const epic = startSlice({ repo: d, title: 'Reading list', request: 'r', now });
  const a = startSlice({ repo: d, title: 'Save books', request: 'r', criteria: ['Works'], excludes: ['Nothing beyond the criteria above'], inChange: epic.id, now });
  stepAddTo(d, a.id, 'Storage', { now }); stepAddTo(d, a.id, 'Screen', { now });
  for (const to of ['ready', 'building']) moveSlice(d, a.id, to, { now });
  stepSetIn(d, a.id, '1', true, { now });
  const b = startSlice({ repo: d, title: 'Remove a book', request: 'r', criteria: ['Works'], excludes: ['Nothing beyond the criteria above'], now });
  for (const to of ['ready', 'building', 'delivered']) moveSlice(d, b.id, to, { now });
  const c = startSlice({ repo: d, title: 'Export the list', request: 'r', now });
  const batch = createBatch({ slice: c.id, questions: [{ situation: 'Which format?', blocking: true, options: [{ label: 'CSV', cost: 'none' }, { label: 'JSON', cost: 'none' }] }, { situation: 'File name?', options: [{ label: 'list.csv', cost: 'none' }, { label: 'books.csv', cost: 'none' }] }] }, { date: '2026-10-31', rand: (() => { let n = 0; return () => 'f00' + n++; })() });
  assumeDefaults(batch); writeBatchFile(path.join(d, 'docs', 'questions.md'), batch);
  return { d, epic, a, b, c, batch };
}

test('age: whole units, no locale', () => {
  assert.equal(age('2026-10-31T17:30:00Z', NOW), '<1 h'); assert.equal(age('2026-10-31T13:00:00Z', NOW), '5 h'); assert.equal(age('2026-10-29T18:00:00Z', NOW), '2 d');
});
test('the board text matches the golden text byte for byte', () => {
  const { d, epic, a, b, c, batch } = fixture(); const text = boardText(loadBoard(d, NOW)); const QID = batch.questions[0].id;
  const golden = `BOARD  2026-10-31 18:00 UTC

Now: Save books [${a.id}] · step 2 of 2: Screen
Next: Export the list [${c.id}] · refining

Waiting for you (3)
  - try and accept: Remove a book [${b.id}]  · 9 h
  - answer: Which format? [${QID}] (for Export the list [${c.id}])  · 9 h
  - 1 assumed default(s) not confirmed

refining (2)
  ${epic.id}  feat     Reading list  · 9 h
  ${c.id}  feat     Export the list  · 9 h

building (1)
  ${a.id}  feat     Save books  <Reading list [${epic.id}]>  [1/2]  · 9 h  no Dev registered

delivered (1)
  ${b.id}  feat     Remove a book  · 9 h
`;
  assert.equal(text.replace(/ +\n/g, '\n'), golden.replace(/ +\n/g, '\n'));
});
test('same files and same clock give the same bytes; a later clock changes only the ages', () => {
  const { d } = fixture();
  assert.equal(boardText(loadBoard(d, NOW)), boardText(loadBoard(d, NOW))); assert.equal(boardHtml(loadBoard(d, NOW)), boardHtml(loadBoard(d, NOW)));
  const later = boardText(loadBoard(d, '2026-11-02T18:00:00Z')); assert.match(later, /2 d/); assert.notEqual(later, boardText(loadBoard(d, NOW)));
});
test('the board never writes: the records are unchanged after rendering', () => {
  const { d, a } = fixture(); const before = fs.readFileSync(readSlice(d, a.id).file, 'utf8'); boardText(loadBoard(d, NOW)); boardHtml(loadBoard(d, NOW));
  assert.equal(fs.readFileSync(readSlice(d, a.id).file, 'utf8'), before);
});
test('an empty repository says so, and a risk appetite nobody confirmed is waiting for you', WORKSHOP, () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bd-')); fs.mkdirSync(path.join(d, 'docs'));
  assert.match(boardText(loadBoard(d, NOW)), /^BOARD [^\n]+\n\nNow: nothing is being built\nNext: nothing queued\n\nNothing is waiting for you\.\n\n\(no slices\)/);
  fs.copyFileSync(path.join(EXAMPLES, 'context.md'), path.join(d, 'docs', 'context.md'));
  assert.match(boardText(loadBoard(d, NOW)), /risk appetite: 2 risk-appetite line\(s\) not confirmed/);
});
test('the page is self-contained, escapes content, and lists every state', () => {
  const { d } = fixture(); const html = boardHtml(loadBoard(d, NOW));
  assert.ok(!/(src|href)="https?:/.test(html)); assert.match(html, /prefers-color-scheme:dark/); assert.match(html, /Waiting for you \(3\)/);
  for (const st of ['refining', 'ready', 'building', 'blocked', 'delivered', 'rework', 'accepted', 'abandoned']) assert.match(html, new RegExp(`<h2>${st} `));
  const e = fs.mkdtempSync(path.join(os.tmpdir(), 'bd-')); fs.mkdirSync(path.join(e, 'docs')); startSlice({ repo: e, title: '<script>x</script>', request: 'r' });
  assert.ok(!boardHtml(loadBoard(e, NOW)).includes('<script>x'));
});
test('the CLI: text, --json, --out and a bad --now', () => {
  const { d } = fixture(); const run = (...x) => spawnSync(process.execPath, [BIN, '--repo', d, '--now', NOW, ...x], { encoding: 'utf8' });
  assert.match(run().stdout, /Waiting for you \(3\)/); assert.equal(JSON.parse(run('--json').stdout).waiting.length, 3);
  const out = path.join(d, 'board.html'); assert.equal(run('--out', out).status, 0); assert.ok(fs.statSync(out).size > 1000);
  assert.equal(spawnSync(process.execPath, [BIN, '--repo', d, '--now', 'yesterday'], { encoding: 'utf8' }).status, 2);
});
import { execFileSync } from 'node:child_process';
test('a branch is waiting to be merged when every slice on it is accepted and it is not in main yet (R62)', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-')); fs.mkdirSync(path.join(d, 'docs')); const G = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: d, encoding: 'utf8', stdio: 'pipe' });
  G('init', '-q', '-b', 'main'); fs.writeFileSync(path.join(d, 'a.txt'), '1'); G('add', '-A'); G('commit', '-qm', 'base'); G('checkout', '-qb', 'feat/list'); fs.writeFileSync(path.join(d, 'b.txt'), '2'); G('add', '-A'); G('commit', '-qm', 'work'); G('checkout', '-q', 'main');
  const accept = id => { for (const to of ['ready', 'building', 'delivered']) moveSlice(d, id, to); moveSlice(d, id, 'accepted', { by: 'owner' }); };
  const a = startSlice({ repo: d, title: 'One', request: 'r', criteria: ['x'], excludes: ['Nothing beyond the criteria above'], branch: 'feat/list' }); const b = startSlice({ repo: d, title: 'Two', request: 'r', criteria: ['x'], excludes: ['Nothing beyond the criteria above'], branch: 'feat/list' });
  const text = () => boardText(loadBoard(d, NOW));
  accept(a.id); assert.doesNotMatch(text(), /merge branch/);                                             // one slice of the branch is still open: not yet
  accept(b.id); assert.match(text(), /merge branch feat\/list into main: 2 slice\(s\) accepted/);
  const w = loadBoard(d, NOW).waiting; assert.deepEqual(w.map(x => x.kind), ['merge']);
  G('merge', '-q', '--no-ff', 'feat/list', '-m', 'merge'); assert.doesNotMatch(text(), /merge branch/);   // merged: no longer waiting
  G('branch', '-q', '-d', 'feat/list'); assert.doesNotMatch(text(), /merge branch/);                     // merged and deleted: nothing to say
  const e = startSlice({ repo: d, title: 'Three', request: 'r', criteria: ['x'], excludes: ['Nothing beyond the criteria above'], branch: 'feat/other' }); accept(e.id); assert.doesNotMatch(text(), /merge branch/);   // the branch does not exist here: the board does not guess
});
import { renderView, summaryText } from '../src/view.mjs';
import { loadStory } from '../src/story.mjs';
import { branchState } from '../src/proc.mjs';
test('each accepted slice says where its branch stands, read from git and never stored (R63)', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-')); fs.mkdirSync(path.join(d, 'docs')); const G = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: d, encoding: 'utf8', stdio: 'pipe' });
  G('init', '-q', '-b', 'main'); fs.writeFileSync(path.join(d, 'a.txt'), '1'); G('add', '-A'); G('commit', '-qm', 'base'); G('checkout', '-qb', 'feat/x'); fs.writeFileSync(path.join(d, 'b.txt'), '2'); G('add', '-A'); G('commit', '-qm', 'work'); G('checkout', '-q', 'main');
  const s = startSlice({ repo: d, title: 'On a branch', request: 'r', criteria: ['x'], excludes: ['Nothing beyond the criteria above'], branch: 'feat/x' }); const n = startSlice({ repo: d, title: 'No branch', request: 'r', criteria: ['x'], excludes: ['Nothing beyond the criteria above'] });
  for (const id of [s.id, n.id]) { for (const to of ['ready', 'building', 'delivered']) moveSlice(d, id, to); moveSlice(d, id, 'accepted', { by: 'owner' }); }
  const text = () => boardText(loadBoard(d, NOW)); const file = readSlice(d, s.id).file; const before = fs.readFileSync(file, 'utf8');
  assert.match(text(), new RegExp(`${s.id}  On a branch  · accepted, recorded only · waiting to merge into main`)); assert.match(text(), new RegExp(`${n.id}  No branch  · accepted, recorded only\\n`));
  G('merge', '-q', '--no-ff', 'feat/x', '-m', 'merge'); assert.match(text(), /On a branch  · accepted, recorded only · merged into main/);
  G('branch', '-q', '-d', 'feat/x'); assert.match(text(), /On a branch  · accepted, recorded only · branch not found here/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);                                               // nothing was written: the state is not stored
  assert.deepEqual(branchState(d, 'feat/x'), { state: 'unknown', trunk: 'main' }); assert.deepEqual(branchState(d, undefined), { state: 'none', trunk: null });
  const story = loadStory(path.join(d, 'docs'), { slice: s.id }); assert.match(summaryText(story, { merge: { state: 'merged', trunk: 'main' } }), /not signed\) · merged into main/);
  assert.match(renderView(story, { merge: { state: 'pending', trunk: 'main' } }), /waiting to merge into main/); assert.doesNotMatch(summaryText(story), /merged into/);
  G('checkout', '-qb', 'feat/x'); const v = spawnSync(process.execPath, [fileURLToPath(new URL('../bin/view.mjs', import.meta.url)), '--dir', path.join(d, 'docs'), '--slice', s.id, '--repo', d, '--text'], { encoding: 'utf8' });
  assert.match(v.stdout, /merged into main/);                                                          // the branch is back at main's tip: it counts as merged
});
test('the board asks git once per branch, not once per slice (every git call is a process)', { skip: process.platform === 'win32' && 'uses a shell wrapper around git' }, () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bg-')); fs.mkdirSync(path.join(d, 'docs')); const G = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { cwd: d, encoding: 'utf8', stdio: 'pipe' });
  G('init', '-q', '-b', 'main'); fs.writeFileSync(path.join(d, 'a.txt'), '1'); G('add', 'a.txt'); G('commit', '-qm', 'base'); G('branch', 'feat/x');
  for (let i = 0; i < 6; i++) { const s = startSlice({ repo: d, title: `Slice ${i}`, request: 'r', criteria: ['x'], excludes: ['Nothing beyond the criteria above'], branch: 'feat/x' }); for (const to of ['ready', 'building', 'delivered']) moveSlice(d, s.id, to); moveSlice(d, s.id, 'accepted', { by: 'owner' }); }
  const real = execFileSync('which', ['git'], { encoding: 'utf8' }).trim(); const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'spy-')); const log = path.join(bin, 'calls');
  fs.writeFileSync(path.join(bin, 'git'), `#!/bin/sh\necho "$@" >> "${log}"\nexec "${real}" "$@"\n`); fs.chmodSync(path.join(bin, 'git'), 0o755);
  const saved = process.env.PATH; process.env.PATH = `${bin}${path.delimiter}${saved}`;
  try { const b = loadBoard(d, NOW); assert.equal(b.slices.filter(s => s.status === 'accepted').length, 6); } finally { process.env.PATH = saved; }
  const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').length : 0;
  assert.ok(calls <= 5, `6 accepted slices on one branch took ${calls} git calls; it should be a handful, independent of the number of slices`);
});
import { pieceExceptions } from '../src/board.mjs';
// The owner accepts features, not pieces (R70, R83): a clean piece waits as delivered and asks nothing; an exception is listed in plain words.
test('a delivered piece with a clean checkpoint is not waiting for you; one with an exception is, with the exception; the whole change is listed once (R83)', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-')); fs.mkdirSync(path.join(d, 'docs')); let min = 0; const now = () => new Date(Date.UTC(2026, 9, 31, 8, min++, 30));
  const ch = startSlice({ repo: d, title: 'Reading list', request: 'r', now });
  const piece = t => startSlice({ repo: d, title: t, request: 'r', criteria: ['Works'], excludes: ['Nothing beyond the criteria above'], inChange: ch.id, now }).id;
  const a = piece('Save books'), b = piece('Remove a book'), c = piece('Sort books');
  const ev = (slice, when, reasons) => { const dir = path.join(path.dirname(readSlice(d, ch.id).file), 'evidence'); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, `evidence-${when}Z-run.json`), JSON.stringify({ when, slice, reasons })); };
  const deliver = id => { for (const to of ['ready', 'building', 'delivered']) moveSlice(d, id, to, { now }); };
  const waiting = () => loadBoard(d, NOW).waiting.filter(w => w.kind === 'accept').map(w => w.text);
  ev(a, '2026-10-31T090000', ['validate failed']); ev(a, '2026-10-31T100000', []); deliver(a);       // the latest round is clean: it asks nothing
  assert.deepEqual(waiting(), []);
  ev(b, '2026-10-31T110000', ['no tests added', 'validate failed']); deliver(b);
  assert.deepEqual(waiting(), [`look at: Remove a book [${b}], a piece of Reading list: no tests added; validate failed`]);   // c still open: the change is not listed yet
  deliver(c);                                                                                          // no evidence: nothing says it passed
  assert.deepEqual(waiting().sort(), [`look at: Remove a book [${b}], a piece of Reading list: no tests added; validate failed`, `look at: Sort books [${c}], a piece of Reading list: no checkpoint evidence was kept for it`, `try and accept: Reading list [${ch.id}]`].sort());
  assert.equal(loadBoard(d, NOW).waiting.find(x => x.text.startsWith('try and accept')).ref, ch.id);
  moveSlice(d, c, 'abandoned', { now }); assert.equal(loadBoard(d, NOW).waiting.filter(x => x.ref === ch.id).length, 1);   // abandoned counts as finished
  assert.match(boardText(loadBoard(d, NOW)), /try and accept: Reading list \[reading-list\]/);
});
import { startMilestone } from '../src/slicestore.mjs';
import { digest, digestText } from '../src/digest.mjs';
import { buildIndex } from '../src/index.mjs';
// Now and Next (design/17 §3): read from the records in the index, nothing stored; Next is the first change by rank, in the milestone being
// worked on, not delivered, accepted, abandoned or being built, even when it waits, saying for what (R144).
test('the board, its page, its JSON and the digest say what is being built now, with its step, and what comes next', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bn-')); fs.mkdirSync(path.join(d, 'docs')); let min = 0; const now = () => new Date(Date.UTC(2026, 9, 31, 8, min++, 30));
  const goal = { request: 'r', criteria: ['Works'], excludes: ['Nothing beyond the criteria above'], now };
  startMilestone({ repo: d, title: 'First release', name: 'mvp', ...goal }); startMilestone({ repo: d, title: 'Second release', name: 'later', ...goal });
  const later = startSlice({ repo: d, title: 'Print the list', milestone: 'later', ...goal }); moveSlice(d, later.id, 'ready', { now });   // first by rank, but not in the milestone being worked on
  const a = startSlice({ repo: d, title: 'Save books', milestone: 'mvp', ...goal }); for (const t of ['Storage', 'Screen', 'Tests']) stepAddTo(d, a.id, t, { now }); moveSlice(d, a.id, 'ready', { now });
  const b = startSlice({ repo: d, title: 'Sort books', milestone: 'mvp', dependsOn: [a.id], ...goal });
  const c = startSlice({ repo: d, title: 'Share books', milestone: 'mvp', ...goal });
  let board = loadBoard(d, NOW); assert.deepEqual(board.current, []); assert.equal(board.next.kind, 'milestone'); assert.equal(board.next.id, 'mvp');   // no go-ahead yet: none of its changes is Next (R147)
  assert.throws(() => moveSlice(d, a.id, 'building', { now }), /Save books \[save-books\] belongs to the milestone First release \[mvp\], which is refining: a milestone starts only with the owner's go-ahead, recorded by moving it to building \(buddy move mvp building\)/);
  for (const to of ['ready', 'building']) moveSlice(d, 'mvp', to, { now });                                 // the go-ahead
  board = loadBoard(d, NOW); assert.deepEqual(board.next, { id: a.id, title: 'Save books', status: 'ready', milestone: 'mvp', waits_for: [] });
  assert.match(boardText(board), /^BOARD [^\n]+\n\nNow: nothing is being built\nNext: Save books \[save-books\] · ready\n\nNothing is waiting/);
  moveSlice(d, a.id, 'building', { now }); stepSetIn(d, a.id, '1', true, { now }); board = loadBoard(d, NOW);
  assert.deepEqual(board.current, [{ id: a.id, title: 'Save books', change: null, step: { n: 2, total: 3, text: 'Screen' } }]);
  assert.equal(board.next.id, b.id); assert.deepEqual(board.next.waits_for, [{ id: a.id, title: 'Save books', status: 'building' }]);   // Sort books is next, and says it waits
  const text = boardText(board); assert.match(text, /\n\nNow: Save books \[save-books\] · step 2 of 3: Screen\nNext: Sort books \[sort-books\] · waits for Save books \[save-books\]\n\n/);
  assert.ok(text.indexOf('Now:') < text.indexOf('aiting for you'));
  const html = boardHtml(board); assert.match(html, /<h2>Now<\/h2><ul><li>Save books \[save-books\] · step 2 of 3: Screen<\/li><\/ul><h2>Next<\/h2><p>Sort books \[sort-books\] · waits for Save books \[save-books\]<\/p>/); assert.ok(html.indexOf('<h2>Now</h2>') < html.indexOf('aiting for you'));
  const run = spawnSync(process.execPath, [BIN, '--repo', d, '--now', NOW, '--json'], { encoding: 'utf8' }); const json = JSON.parse(run.stdout);
  assert.equal(json.current[0].step.text, 'Screen'); assert.equal(json.next.id, b.id);
  const dg = digestText(digest(d, NOW)); assert.match(dg, /^DIGEST [^\n]+\n\nNow: Save books \[save-books\] · step 2 of 3: Screen\nNext: Sort books \[sort-books\] · waits for Save books \[save-books\]\n\n/);
  moveSlice(d, c.id, 'ready', { now }); moveSlice(d, c.id, 'building', { now }); board = loadBoard(d, NOW);   // two at once: a list; Sort books still next, still waiting
  assert.match(boardText(board), /\n\nNow \(2\)\n  - Save books \[save-books\] · step 2 of 3: Screen\n  - Share books \[share-books\]\nNext: Sort books \[sort-books\] · waits for Save books \[save-books\]\n/);
  assert.match(digestText(digest(d, NOW)), /\nNow: Save books \[save-books\] · step 2 of 3: Screen \| Share books \[share-books\]\nNext: Sort books \[sort-books\] · waits for Save books \[save-books\]\n/);
  moveSlice(d, a.id, 'delivered', { now }); assert.match(boardText(loadBoard(d, NOW)), /\nNext: Sort books \[sort-books\] · refining\n/);   // delivered: no longer waited for (R115)
  moveSlice(d, b.id, 'ready', { now }); moveSlice(d, b.id, 'building', { now }); assert.match(boardText(loadBoard(d, NOW)), /\nNext: nothing queued\n/);   // nothing left in the milestone
  const x = buildIndex(d); assert.deepEqual(x.now.map(r => r.id).sort(), [b.id, c.id].sort()); assert.equal(x.next, null);   // computed once, in the index
  const files = fs.readdirSync(path.join(d, 'docs', 'buddy'), { recursive: true }).sort(); loadBoard(d, NOW); assert.deepEqual(fs.readdirSync(path.join(d, 'docs', 'buddy'), { recursive: true }).sort(), files);   // nothing new is stored
});
// A finished milestone (every change delivered, accepted or abandoned) with another one open: Next is that milestone, waiting for the
// owner's go-ahead (R147).
test('when the milestone being worked on is finished and another is open, Next names it and says it waits for the go-ahead', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-')); fs.mkdirSync(path.join(d, 'docs')); let min = 0; const now = () => new Date(Date.UTC(2026, 9, 31, 8, min++, 30));
  const goal = { request: 'r', criteria: ['Works'], excludes: ['Nothing beyond the criteria above'], now };
  startMilestone({ repo: d, title: 'First release', name: 'mvp', ...goal }); startMilestone({ repo: d, title: 'Second release', name: 'later', ...goal });
  startMilestone({ repo: d, title: 'Third release', name: 'last', ...goal });
  const a = startSlice({ repo: d, title: 'Save books', milestone: 'mvp', ...goal }); const b = startSlice({ repo: d, title: 'Sort books', milestone: 'mvp', ...goal });
  const old = startSlice({ repo: d, title: 'Old idea', milestone: 'mvp', ...goal }); moveSlice(d, old.id, 'abandoned', { now });
  startSlice({ repo: d, title: 'Print the list', milestone: 'later', ...goal }); startSlice({ repo: d, title: 'Export it', milestone: 'last', ...goal });
  const go = (id, to) => { for (const s of ['ready', 'building', 'delivered', 'accepted'].slice(0, ['ready', 'building', 'delivered', 'accepted'].indexOf(to) + 1)) moveSlice(d, id, s, { now, ...(s === 'accepted' ? { by: 'owner' } : {}) }); };
  for (const to of ['ready', 'building']) moveSlice(d, 'mvp', to, { now });                               // the owner's go-ahead for the first
  go(a.id, 'accepted'); go(b.id, 'building');
  assert.match(boardText(loadBoard(d, NOW)), /\nNext: nothing queued\n/);                                // still building in it: not finished
  moveSlice(d, b.id, 'delivered', { now }); const board = loadBoard(d, NOW);                            // delivered, accepted and abandoned: finished
  assert.deepEqual(board.next, { kind: 'milestone', id: 'later', title: 'Second release', status: 'refining', milestone: 'later', waits_for: [], go_ahead: true });
  const line = 'Next: milestone Second release [later] · waits for your go-ahead';
  assert.ok(boardText(board).includes(`\n${line}\n`)); assert.ok(digestText(digest(d, NOW)).includes(`\n${line}\n`));
  assert.ok(boardHtml(board).includes('<h2>Next</h2><p>milestone Second release [later] · waits for your go-ahead</p>'));
  const json = JSON.parse(spawnSync(process.execPath, [BIN, '--repo', d, '--now', NOW, '--json'], { encoding: 'utf8' }).stdout); assert.equal(json.next.kind, 'milestone'); assert.equal(json.next.go_ahead, true);
  assert.equal(buildIndex(d).next.id, 'later');                                                         // computed in the index
  // accepting the finished one changes nothing: the next one still waits, refining or ready, and none of its changes starts or is Next
  moveSlice(d, b.id, 'accepted', { now, by: 'owner' }); moveSlice(d, 'mvp', 'delivered', { now }); moveSlice(d, 'mvp', 'accepted', { now, by: 'owner' });
  const print = buildIndex(d).changes.find(r => r.title === 'Print the list'); moveSlice(d, print.id, 'ready', { now });
  assert.equal(buildIndex(d).next.id, 'later'); moveSlice(d, 'later', 'ready', { now }); assert.deepEqual([buildIndex(d).next.id, buildIndex(d).next.go_ahead], ['later', true]);
  assert.throws(() => moveSlice(d, print.id, 'building', { now }), /which is ready: a milestone starts only with the owner's go-ahead/);
  moveSlice(d, 'later', 'building', { now }); assert.match(boardText(loadBoard(d, NOW)), /\nNext: Print the list \[print-the-list\] · ready\n/);   // the go-ahead: its changes come next
  moveSlice(d, print.id, 'building', { now }); assert.match(boardText(loadBoard(d, NOW)), /\nNext: nothing queued\n/);
});
test('a finished milestone with no other open names nothing; one not planned yet is named; an empty one being worked on is not finished', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-')); fs.mkdirSync(path.join(d, 'docs')); let min = 0; const now = () => new Date(Date.UTC(2026, 9, 31, 8, min++, 30));
  const goal = { request: 'r', criteria: ['Works'], excludes: ['Nothing beyond the criteria above'], now };
  startMilestone({ repo: d, title: 'First release', name: 'mvp', ...goal }); startSlice({ repo: d, title: 'Loose fix', ...goal });
  assert.equal(buildIndex(d).next.id, 'mvp');                                                           // not started: it waits for the go-ahead; the backlog is not Next while it is open
  for (const to of ['ready', 'building']) moveSlice(d, 'mvp', to, { now }); assert.equal(buildIndex(d).next, null);   // started, nothing planned in it yet: not finished
  const a = startSlice({ repo: d, title: 'Save books', milestone: 'mvp', ...goal }); for (const s of ['ready', 'building', 'delivered']) moveSlice(d, a.id, s, { now });
  assert.equal(buildIndex(d).next, null); assert.match(boardText(loadBoard(d, NOW)), /\nNext: nothing queued\n/);
  startMilestone({ repo: d, title: 'Second release', name: 'later', ...goal });                        // later milestones are planned when they start
  assert.match(boardText(loadBoard(d, NOW)), /\nNext: milestone Second release \[later\] · waits for your go-ahead\n/);
});
test('a change with a piece being built is in Now, not in Next', () => {
  const { d, epic } = fixture(); const board = loadBoard(d, NOW);
  assert.equal(board.current[0].change, epic.id); assert.notEqual(board.next.id, epic.id);
});
test('the exceptions of a piece: the reasons of its latest checkpoint and the departures to decide; none when clean', () => {
  assert.deepEqual(pieceExceptions({ departures: 0 }, { reasons: [] }), []);
  assert.deepEqual(pieceExceptions({ departures: 2 }, { reasons: [] }), ['2 departures from the prototype to decide']);
  assert.deepEqual(pieceExceptions({ departures: 1 }, { reasons: ['validate failed'] }), ['validate failed', '1 departure from the prototype to decide']);
  assert.deepEqual(pieceExceptions({ departures: 0 }, null), ['no checkpoint evidence was kept for it']);
});
// show-unrun-checks-honestly (R76): a check that did not run is never shown as clean; the board lists it as waiting.
test('a delivered piece whose evidence has a check not run waits for the owner, saying which did not run', () => {
  const ev = { reasons: [], checks: { validate: 'passed', scan: 'passed', acceptance_guard: 'passed', reviewer: 'not run', prototype_departures: 'not applicable' } };
  assert.deepEqual(pieceExceptions({ departures: 0 }, ev), ['the reviewer did not run']);
  assert.deepEqual(pieceExceptions({ departures: 0 }, { ...ev, checks: { ...ev.checks, reviewer: 'passed' } }), []);
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bu-')); fs.mkdirSync(path.join(d, 'docs')); let min = 0; const now = () => new Date(Date.UTC(2026, 9, 31, 8, min++, 30));
  const ch = startSlice({ repo: d, title: 'Reading list', request: 'r', now });
  const a = startSlice({ repo: d, title: 'Save books', request: 'r', criteria: ['Works'], excludes: ['Nothing beyond the criteria above'], inChange: ch.id, now }).id;
  startSlice({ repo: d, title: 'Sort books', request: 'r', criteria: ['Works'], excludes: ['Nothing beyond the criteria above'], inChange: ch.id, now });
  const dir = path.join(path.dirname(readSlice(d, ch.id).file), 'evidence'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'evidence-2026-10-31T090000Z-run.json'), JSON.stringify({ when: '2026-10-31T09:00:00Z', slice: a, ...ev }));
  for (const to of ['ready', 'building', 'delivered']) moveSlice(d, a, to, { now });
  assert.deepEqual(loadBoard(d, NOW).waiting.filter(w => w.kind === 'accept').map(w => w.text), [`look at: Save books [${a}], a piece of Reading list: the reviewer did not run`]);
});
// A change built in pieces (R156): while some piece is building, delivered or accepted and some is still refining or ready, Next is its next
// piece by rank, with the change named, before any other change; with none of its pieces left, Next looks at the other changes again.
test('while a change is built in pieces, Next names its next piece and the change, before any other change', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-')); fs.mkdirSync(path.join(d, 'docs')); let min = 0; const now = () => new Date(Date.UTC(2026, 9, 31, 8, min++, 30));
  const goal = { request: 'r', criteria: ['Works'], excludes: ['Nothing beyond the criteria above'], now };
  const loose = startSlice({ repo: d, title: 'Loose fix', ...goal }); moveSlice(d, loose.id, 'ready', { now });   // first by rank
  const ch = startSlice({ repo: d, title: 'Reading list', ...goal });
  const a = startSlice({ repo: d, title: 'Save books', inChange: ch.id, ...goal }); const b = startSlice({ repo: d, title: 'Sort books', inChange: ch.id, ...goal });
  const c = startSlice({ repo: d, title: 'Share books', inChange: ch.id, ...goal }); moveSlice(d, c.id, 'ready', { now });
  assert.equal(buildIndex(d).next.id, loose.id);                                                        // no piece started yet: the change waits its turn
  for (const to of ['ready', 'building']) moveSlice(d, a.id, to, { now });
  let board = loadBoard(d, NOW); assert.deepEqual(board.next, { id: b.id, title: 'Sort books', status: 'refining', milestone: null, waits_for: [], change: { id: ch.id, title: 'Reading list' } });
  const line = 'Next: Sort books [sort-books], a piece of Reading list [reading-list] · refining';
  assert.ok(boardText(board).includes(`\n${line}\n`)); assert.ok(digestText(digest(d, NOW)).includes(`\n${line}\n`));
  assert.ok(boardHtml(board).includes('<h2>Next</h2><p>Sort books [sort-books], a piece of Reading list [reading-list] · refining</p>'));
  moveSlice(d, a.id, 'delivered', { now }); assert.equal(buildIndex(d).next.id, b.id);                // one delivered, none building: still its next piece
  for (const to of ['ready', 'building']) moveSlice(d, b.id, to, { now }); assert.match(boardText(loadBoard(d, NOW)), /\nNext: Share books \[share-books\], a piece of Reading list \[reading-list\] · ready\n/);
  moveSlice(d, c.id, 'building', { now }); assert.match(boardText(loadBoard(d, NOW)), /\nNext: Loose fix \[loose-fix\] · ready\n/);   // no piece left: the other changes
});
