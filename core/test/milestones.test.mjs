import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';
import { startSlice, startMilestone, moveChangeTo, listSlices, listMilestones, changesOf, readSlice, moveSlice, stepAddTo, renameSlice, changeDirOf } from '../src/slicestore.mjs';
import { verify } from '../src/verify.mjs';
import { createBatch, writeBatchFile } from '../src/queue.mjs';
import { loadBoard, boardText, boardHtml } from '../src/board.mjs';
import { digest } from '../src/digest.mjs';
import { migrate } from '../src/migrate.mjs';
import { canonicalText } from '../src/slice.mjs';

// Milestones and the backlog (R118): docs/buddy/milestones/<date>-<name>/milestone.md with its changes in changes/, docs/buddy/backlog/
// for the changes of no milestone, and docs/buddy/changes/ read as the backlog until `buddy migrate` moves it.
const BUDDY = fileURLToPath(new URL('../bin/buddy.mjs', import.meta.url));
const NOW = '2026-10-31T18:00:00Z';
const repo = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-')); fs.mkdirSync(path.join(d, 'docs')); return d; };
let tick = 0; const clock = () => () => new Date(Date.UTC(2026, 9, 31, 12, 0, tick++));
const goal = { criteria: ['Works'], excludes: ['Nothing beyond the criteria above'] };
const mvp = (d, extra = {}) => startMilestone({ repo: d, title: 'First release', name: 'mvp', request: 'The smallest useful list', ...goal, now: clock(), ...extra });
const change = (d, title, extra = {}) => startSlice({ repo: d, title, request: 'r', ...goal, now: clock(), ...extra });
const problems = d => verify([path.join(d, 'docs')], { canonical: true }).problems.map(p => `${path.relative(d, p.file).split(path.sep).join('/')}: ${p.where}: ${p.message}`);
const rel = (d, f) => path.relative(d, f).split(path.sep).join('/');
const run = (d, ...a) => spawnSync(process.execPath, [BUDDY, ...a, '--repo', d], { encoding: 'utf8' });

test('a milestone is a folder with milestone.md; a change opened in it goes to its changes/, the others to the backlog', () => {
  const d = repo(); const m = mvp(d);
  assert.equal(rel(d, m.file), 'docs/buddy/milestones/2026-10-31-mvp/milestone.md'); assert.equal(m.data.kind, 'milestone'); assert.equal(m.data.status, 'refining');
  const a = change(d, 'Save books', { milestone: 'mvp' }); const b = change(d, 'Loose fix', { kind: 'fix' }); const s = change(d, 'Storage', { inChange: a.id });
  assert.equal(rel(d, a.file), 'docs/buddy/milestones/2026-10-31-mvp/changes/2026-10-31-save-books/change.md'); assert.equal(a.milestone, 'mvp');
  assert.equal(rel(d, b.file), 'docs/buddy/backlog/2026-10-31-loose-fix/change.md'); assert.equal(b.milestone, null);
  assert.equal(rel(d, s.file), 'docs/buddy/milestones/2026-10-31-mvp/changes/2026-10-31-save-books/storage.md'); assert.equal(s.milestone, 'mvp');
  assert.deepEqual(problems(d), []);
  assert.deepEqual(listMilestones(d).map(x => x.data.id), ['mvp']); assert.deepEqual(listSlices(d).map(x => [x.data.id, x.milestone]), [['save-books', 'mvp'], ['loose-fix', null], ['storage', 'mvp']]);
  assert.deepEqual(changesOf(d, 'mvp').map(x => x.data.id), ['save-books']);
  assert.equal(readSlice(d, 'mvp').data.title, 'First release'); assert.equal(changeDirOf(d, 'mvp'), path.dirname(m.file));   // its batches go in its folder
  // names are unique across milestones, changes and slices
  assert.throws(() => change(d, 'x', { name: 'mvp' }), /the name mvp is taken by the milestone First release \[mvp\]/); assert.throws(() => mvp(d, { name: 'save-books' }), /taken by the change [^[]+\[save-books\]/);
  assert.throws(() => change(d, 'x', { inChange: 'mvp' }), /First release \[mvp\] is a milestone: open a change in it with --milestone mvp/);
  assert.throws(() => change(d, 'x', { milestone: 'save-books' }), /\[save-books\] is not a milestone/);
  assert.throws(() => change(d, 'x', { milestone: 'mvp', inChange: 'save-books' }), /give --in or --milestone, not both/);
  assert.throws(() => change(d, 'x', { kind: 'milestone' }), /buddy milestone start/);
  assert.throws(() => stepAddTo(d, 'mvp', 'a step'), /\[mvp\] is a milestone: its work is in its changes/);
});

test('a milestone follows the ready rule and is accepted only when every change of it is accepted or abandoned', () => {
  const d = repo(); mvp(d, { criteria: [], excludes: [] });
  assert.throws(() => moveSlice(d, 'mvp', 'ready'), /not ready: it has no acceptance criteria.*it does not say what it leaves out/);
  const e = repo(); mvp(e); const a = change(e, 'Save books', { milestone: 'mvp' });
  for (const to of ['ready', 'building', 'delivered']) moveSlice(e, 'mvp', to);
  assert.throws(() => moveSlice(e, 'mvp', 'accepted', { by: 'owner' }), /1 change\(s\) of the milestone are not accepted yet: Save books \[save-books, refining\]/);
  assert.match(loadBoard(e, NOW).waiting.map(w => w.text).join('\n'), /accept the milestone: First release/);
  moveSlice(e, a.id, 'abandoned'); assert.equal(moveSlice(e, 'mvp', 'accepted', { by: 'owner' }).data.status, 'accepted'); assert.deepEqual(problems(e), []);
  // a closed milestone takes no change, by opening or by moving
  assert.throws(() => change(e, 'Late', { milestone: 'mvp' }), /the milestone First release \[mvp\] is accepted: a change is opened only into a milestone that is still open/);
  const late = change(e, 'Late'); assert.throws(() => moveChangeTo(e, late.id, 'mvp'), /the milestone First release \[mvp\] is accepted: a change is moved only into a milestone that is still open/);
});

test('verify: where milestones and changes live, and what a milestone may hold', () => {
  const d = repo(); const m = mvp(d); const a = change(d, 'Save books', { milestone: 'mvp' });
  const put = (f, text) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
  const mtext = fs.readFileSync(m.file, 'utf8');
  fs.writeFileSync(m.file, mtext.replace('Its changes are in', '## Steps\n- [ ] 1. A step\n\nIts changes are in'));
  assert.ok(problems(d).some(p => /milestone\.md: Steps: a milestone has no steps/.test(p)));
  fs.writeFileSync(m.file, mtext.replace('status: refining', 'status: accepted\naccepted:\n  by: owner\n  at: 2026-10-31T12:00:00Z').replace(/(updated: .*\n)/, '$1'));
  assert.ok(problems(d).some(p => /accepted while 1 change\(s\) of it are open \(save-books\)/.test(p)), problems(d).join('\n'));
  fs.writeFileSync(m.file, mtext);
  put(path.join(d, 'docs/buddy/backlog/2026-10-31-odd/change.md'), canonicalText({ schema: 'buddy/slice@1', id: 'odd', title: 'Odd', kind: 'milestone', status: 'refining', rank: 9000, created: '2026-10-31T12:00:00Z', request: 'r' }, '# Odd\n'));
  assert.ok(problems(d).some(p => /odd\/change\.md: kind: a milestone is the file milestone\.md/.test(p)));
  fs.rmSync(path.join(d, 'docs/buddy/backlog'), { recursive: true });
  put(path.join(d, 'docs/buddy/milestones/2026-10-31-ghost/changes/2026-10-31-lost/change.md'), canonicalText({ schema: 'buddy/slice@1', id: 'lost', title: 'Lost', kind: 'feat', status: 'refining', rank: 9000, created: '2026-10-31T12:00:00Z', request: 'r' }, '# Lost\n'));
  assert.ok(problems(d).some(p => /lost\/change\.md: id: this change is in the changes\/ folder of a milestone that has no milestone\.md/.test(p)));
  fs.rmSync(path.join(d, 'docs/buddy/milestones/2026-10-31-ghost'), { recursive: true });
  put(path.join(d, 'docs/buddy/elsewhere/2026-10-31-stray/change.md'), canonicalText({ schema: 'buddy/slice@1', id: 'stray', title: 'Stray', kind: 'feat', status: 'refining', rank: 9000, created: '2026-10-31T12:00:00Z', request: 'r' }, '# Stray\n'));
  assert.ok(problems(d).some(p => /stray\/change\.md: id: a change lives in docs\/buddy\/backlog\/ or in the changes\/ folder of a milestone/.test(p)));
  fs.rmSync(path.join(d, 'docs/buddy/elsewhere'), { recursive: true });
  put(path.join(d, 'docs/buddy/milestones/2026-10-31-mvp/changes/2026-10-31-dup/change.md'), canonicalText({ schema: 'buddy/slice@1', id: 'mvp', title: 'Dup', kind: 'feat', status: 'refining', rank: 9000, created: '2026-10-31T12:00:00Z', request: 'r' }, '# Dup\n'));
  assert.ok(problems(d).some(p => /duplicate slice id mvp/.test(p)));                                    // one name, one record, across the repository
  fs.rmSync(path.join(d, 'docs/buddy/milestones/2026-10-31-mvp/changes/2026-10-31-dup'), { recursive: true });
  assert.deepEqual(problems(d), []); assert.equal(a.milestone, 'mvp');
});

test('move-to moves a change folder with everything in it between a milestone and the backlog, keeping its name and date', () => {
  const d = repo(); mvp(d); startMilestone({ repo: d, title: 'Second phase', request: 'g', ...goal, now: clock() });
  const a = change(d, 'Save books'); change(d, 'Storage', { inChange: a.id });
  const dir = path.dirname(a.file); writeBatchFile(path.join(dir, 'questions-1.md'), createBatch({ slice: a.id, questions: [{ situation: 'Order?', blocking: true, options: [{ label: 'a', cost: 'x' }, { label: 'b', cost: 'y' }] }] }, { date: '2026-10-31' }));
  fs.mkdirSync(path.join(dir, 'evidence')); fs.writeFileSync(path.join(dir, 'evidence', 'evidence-1.json'), JSON.stringify({ when: '2026-10-31T13:00:00Z', slice: a.id, reasons: [] }));
  const files = d2 => fs.readdirSync(d2, { recursive: true }).map(f => f.split(path.sep).join('/')).sort(); const before = files(dir);
  const r = moveChangeTo(d, a.id, 'mvp'); assert.equal(r.to, 'mvp'); assert.equal(r.files, 4);
  const into = path.join(d, 'docs/buddy/milestones/2026-10-31-mvp/changes/2026-10-31-save-books');
  assert.equal(r.dir, into); assert.deepEqual(files(into), before); assert.ok(!fs.existsSync(dir)); assert.ok(!fs.existsSync(path.join(d, 'docs/buddy/backlog')));   // an emptied backlog folder goes
  assert.equal(readSlice(d, 'storage').milestone, 'mvp'); assert.equal(readSlice(d, 'storage').change, 'save-books'); assert.deepEqual(problems(d), []);
  assert.equal(digest(d, NOW, { since: '2026-10-31T00:00:00Z' }).checkpoints.length, 1);                 // the digest finds its evidence where it is now
  assert.equal(moveChangeTo(d, a.id, 'second-phase').dir, path.join(d, 'docs/buddy/milestones/2026-10-31-second-phase/changes/2026-10-31-save-books'));
  assert.ok(!fs.existsSync(path.join(d, 'docs/buddy/milestones/2026-10-31-mvp/changes')));
  assert.equal(moveChangeTo(d, a.id, 'backlog').to, null); assert.equal(rel(d, readSlice(d, a.id).file), 'docs/buddy/backlog/2026-10-31-save-books/change.md'); assert.deepEqual(problems(d), []);
  assert.throws(() => moveChangeTo(d, a.id, 'backlog'), /\[save-books\] is already in the backlog/);
  assert.throws(() => moveChangeTo(d, 'storage', 'mvp'), /\[storage\] is a slice of [^[]+\[save-books\]: a slice moves with its change \(buddy move-to save-books mvp\)/);
  assert.throws(() => moveChangeTo(d, 'mvp', 'backlog'), /First release \[mvp\] is a milestone/);
  assert.throws(() => moveChangeTo(d, a.id, 'nowhere'), /no slice or change nowhere/);
  assert.throws(() => moveChangeTo(d, a.id, 'storage'), /\[storage\] is not a milestone \(it is a slice of [^[]+\[save-books\]\)/);
  // a milestone renamed while refining keeps its changes; a change renamed in a milestone stays in it
  moveChangeTo(d, a.id, 'mvp'); renameSlice(d, 'mvp', 'first-release'); assert.equal(readSlice(d, a.id).milestone, 'first-release');
  renameSlice(d, a.id, 'keep-books'); assert.equal(rel(d, readSlice(d, 'keep-books').file), 'docs/buddy/milestones/2026-10-31-first-release/changes/2026-10-31-keep-books/change.md');
  assert.deepEqual(problems(d), []);
});

test('the board groups the changes under their milestone, then the backlog; without milestones it is one group', () => {
  const d = repo(); change(d, 'Loose fix', { kind: 'fix' });
  const plain = boardText(loadBoard(d, NOW)); assert.doesNotMatch(plain, /MILESTONE|BACKLOG/); assert.match(plain, /\nrefining \(1\)\n  loose-fix /);
  mvp(d); const a = change(d, 'Save books', { milestone: 'mvp' }); change(d, 'Storage', { inChange: a.id }); moveSlice(d, a.id, 'ready');
  const b = loadBoard(d, NOW);
  assert.deepEqual(b.milestones.map(m => [m.id, m.status, m.changes]), [['mvp', 'refining', { accepted: 0, total: 1 }]]);
  assert.deepEqual(b.slices.map(r => [r.id, r.milestone]), [['loose-fix', null], ['save-books', 'mvp'], ['storage', 'mvp']]);
  const text = boardText(b);
  assert.match(text, /\nMILESTONE  mvp  First release  · refining · 0 of 1 change\(s\) accepted\n\n  refining \(1\)\n    storage  feat     Storage  <Save books \[save-books\]>  · [^\n]+\n\n  ready \(1\)\n    save-books  feat     Save books  · [^\n]+\n\nBACKLOG  1 change\(s\) of no milestone\n\n  refining \(1\)\n    loose-fix  fix      Loose fix  · [^\n]+\n$/);
  const html = boardHtml(b); assert.ok(html.indexOf('Milestone: First release') < html.indexOf('Backlog: changes of no milestone')); assert.equal(html.match(/class="cols"/g).length, 2);
  const empty = repo(); mvp(empty); assert.match(boardText(loadBoard(empty, NOW)), /MILESTONE  mvp  First release  · refining · 0 of 0 change\(s\) accepted\n  \(no changes yet\)\n\nBACKLOG  0 change\(s\) of no milestone\n$/);
});

test('docs/buddy/changes/ is read as the backlog until migrate moves it to docs/buddy/backlog/ with git mv, so the files keep their history', () => {
  const d = repo(); execFileSync('git', ['init', '-q'], { cwd: d });
  const a = change(d, 'Save books'); const b = change(d, 'Loose fix'); change(d, 'Storage', { inChange: a.id });
  fs.renameSync(path.join(d, 'docs/buddy/backlog'), path.join(d, 'docs/buddy/changes'));                  // the layout of before milestones
  assert.deepEqual(problems(d), []); assert.equal(rel(d, readSlice(d, a.id).file), 'docs/buddy/changes/2026-10-31-save-books/change.md');
  assert.deepEqual(listSlices(d).map(x => [x.data.id, x.milestone]), [['save-books', null], ['loose-fix', null], ['storage', null]]);
  assert.deepEqual(loadBoard(d, NOW).slices.map(r => r.id), ['save-books', 'loose-fix', 'storage']);
  mvp(d); assert.equal(moveChangeTo(d, b.id, 'mvp').to, 'mvp');                                             // a change moves out of it like out of the backlog
  const n = change(d, 'New one'); assert.equal(rel(d, n.file), 'docs/buddy/backlog/2026-10-31-new-one/change.md');   // new changes go to the backlog
  execFileSync('git', ['add', '--', 'docs'], { cwd: d });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', `core.hooksPath=${os.tmpdir()}`, 'commit', '-q', '-m', 'before'], { cwd: d });
  fs.writeFileSync(path.join(d, 'docs/buddy/changes/2026-10-31-save-books/notes.txt'), 'untracked, moves too');
  const dry = migrate(d, { dry: true }); assert.deepEqual(dry.moves, [{ from: 'docs/buddy/changes/2026-10-31-save-books', to: 'docs/buddy/backlog/2026-10-31-save-books', folder: true }]);
  assert.ok(fs.existsSync(path.join(d, 'docs/buddy/changes')));
  const r = migrate(d); assert.equal(r.moves.length, 1); assert.ok(!fs.existsSync(path.join(d, 'docs/buddy/changes')));
  assert.ok(fs.existsSync(path.join(d, 'docs/buddy/backlog/2026-10-31-save-books/notes.txt')));
  const staged = execFileSync('git', ['diff', '--cached', '--name-status', '-M'], { cwd: d, encoding: 'utf8' });
  assert.match(staged, /^R100\tdocs\/buddy\/changes\/2026-10-31-save-books\/change\.md\tdocs\/buddy\/backlog\/2026-10-31-save-books\/change\.md$/m);
  assert.match(staged, /^R100\tdocs\/buddy\/changes\/2026-10-31-save-books\/storage\.md\tdocs\/buddy\/backlog\/2026-10-31-save-books\/storage\.md$/m);
  assert.deepEqual(problems(d), []); assert.equal(readSlice(d, 'storage').change, 'save-books');
  assert.equal(migrate(d).nothing, true);                                                                   // a second run finds nothing
  // without git, the folders are renamed; a folder already in the backlog stops everything before anything moves
  const e = repo(); change(e, 'One'); fs.renameSync(path.join(e, 'docs/buddy/backlog'), path.join(e, 'docs/buddy/changes'));
  fs.mkdirSync(path.join(e, 'docs/buddy/backlog/2026-10-31-one'), { recursive: true });
  assert.throws(() => migrate(e), /docs\/buddy\/backlog\/2026-10-31-one already exists/); assert.ok(fs.existsSync(path.join(e, 'docs/buddy/changes/2026-10-31-one/change.md')));
  fs.rmSync(path.join(e, 'docs/buddy/backlog'), { recursive: true }); assert.equal(migrate(e).moves.length, 1); assert.deepEqual(problems(e), []);
});

test('the CLI: milestone start, start --milestone, move-to, status grouped, migrate', () => {
  const d = repo();
  const m = run(d, 'milestone', 'start', 'First release', '--name', 'mvp', '--request', 'The smallest useful list', '--ac', 'Works', '--exclude', 'Sharing');
  assert.equal(m.status, 0, m.stderr); assert.match(m.stdout, /^started the milestone mvp \(refining\)\n/);
  assert.deepEqual(readSlice(d, 'mvp').data.criteria, [{ id: 'AC1', text: 'Works' }]); assert.deepEqual(readSlice(d, 'mvp').data.excludes, [{ id: 'X1', text: 'Sharing' }]);
  const s = run(d, 'start', 'Save books', '--request', 'r', '--milestone', 'mvp'); assert.equal(s.status, 0, s.stderr); assert.match(s.stdout, /^started save-books in the milestone mvp \(feat, refining, rank 1000\)/);
  assert.equal(run(d, 'start', 'Loose fix', '--request', 'r', '--kind', 'fix').status, 0);
  const st = run(d, 'status'); assert.equal(st.stdout, 'mvp  refining  milestone First release\n  save-books  refining  feat     Save books\nbacklog (no milestone)\n  loose-fix  refining  fix      Loose fix\n');
  const js = JSON.parse(run(d, 'status', '--json').stdout); assert.deepEqual(js.map(x => [x.id, x.kind, x.milestone]), [['mvp', 'milestone', null], ['save-books', 'feat', 'mvp'], ['loose-fix', 'fix', null]]);
  const mv = run(d, 'move-to', 'loose-fix', 'mvp'); assert.equal(mv.status, 0, mv.stderr); assert.match(mv.stdout, /^loose-fix moved into the milestone mvp: /);
  const back = run(d, 'move-to', 'save-books', 'backlog'); assert.match(back.stdout, /^save-books moved to the backlog: /);
  const bad = run(d, 'move-to', 'save-books', 'backlog'); assert.equal(bad.status, 1); assert.match(bad.stderr, /refused: .*\[save-books\] is already in the backlog/);
  assert.equal(run(d, 'move', 'mvp', 'ready').status, 0); assert.equal(spawnSync(process.execPath, [BUDDY, 'verify', '--canonical', path.join(d, 'docs', 'buddy')]).status, 0);
  assert.match(run(d, 'migrate').stdout, /Nothing to migrate/);
});

test('questions at the level of a milestone: queue new --slice <milestone> writes the batch in its folder, and a blocking one keeps it from ready', () => {
  const d = repo(); mvp(d);
  const spec = path.join(d, 'spec.json');
  fs.writeFileSync(spec, JSON.stringify({ questions: [{ situation: 'Which database?', blocking: true, options: [{ label: 'Postgres', cost: 'a hosted server' }, { label: 'SQLite', cost: 'none' }] }] }));
  const q = (...a) => spawnSync(process.execPath, [BUDDY, 'queue', ...a], { encoding: 'utf8', cwd: d });
  const r = q('new', '--in', spec, '--slice', 'mvp'); assert.equal(r.status, 0, r.stderr);
  const file = path.join(d, 'docs/buddy/milestones/2026-10-31-mvp/questions-1.md'); assert.ok(fs.existsSync(file), r.stdout);
  fs.writeFileSync(spec, JSON.stringify({ slice: 'mvp', questions: [{ situation: 'Currency?', options: [{ label: 'EUR', cost: 'none' }, { label: 'USD', cost: 'none' }] }] }));
  assert.equal(q('new', '--in', spec).status, 0); assert.ok(fs.existsSync(path.join(d, 'docs/buddy/milestones/2026-10-31-mvp/questions-2.md')));   // the spec's slice field
  assert.match(q('new', '--in', spec, '--slice', 'nowhere').stderr, /no slice or change nowhere/);
  assert.deepEqual(problems(d), []);
  assert.throws(() => moveSlice(d, 'mvp', 'ready'), /not ready: blocking question\(s\) still open: Which database\? \[Q-/);
  assert.match(boardText(loadBoard(d, NOW)), /  - answer: Which database\? \[Q-[0-9a-f-]+\] \(for First release \[mvp\]\)/);
  const qid = fs.readFileSync(file, 'utf8').match(/id: (Q-\S+)/)[1];
  assert.equal(q('answer', file, '--q', qid, '--option', 'b').status, 0);
  assert.equal(moveSlice(d, 'mvp', 'ready').data.status, 'ready'); assert.deepEqual(problems(d), []);
  // the batches move with the milestone when it is renamed while refining
  const e = repo(); mvp(e); fs.writeFileSync(path.join(e, 'spec.json'), fs.readFileSync(spec));
  assert.equal(spawnSync(process.execPath, [BUDDY, 'queue', 'new', '--in', 'spec.json'], { cwd: e }).status, 0);
  renameSlice(e, 'mvp', 'first-release'); assert.match(fs.readFileSync(path.join(e, 'docs/buddy/milestones/2026-10-31-first-release/questions-1.md'), 'utf8'), /\nslice: first-release\n/);
  assert.deepEqual(problems(e), []);
});
// name-ids-in-refusals (R162): a rename refused names the change by its title, and the one that already has the name.
test('a rename refused names the change, and the change that already has the name, by their titles', () => {
  const d = repo(); const a = change(d, 'Save books'); change(d, 'Export the list', { name: 'export' });
  assert.throws(() => renameSlice(d, a.id, a.id), e => e.message === 'Save books [save-books] already has that name');
  assert.throws(() => renameSlice(d, a.id, 'export'), e => e.message === 'the name export is taken by the change Export the list [export]; choose another with --name');
});
