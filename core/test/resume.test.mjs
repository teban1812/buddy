import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { startSlice, moveSlice, stepAddTo, stepSetIn } from '../src/slicestore.mjs';
import { createBatch, writeBatchFile, answerQuestion, assumeDefaults } from '../src/queue.mjs';
import { decideV0 } from '../src/decide.mjs';
import { resumeBrief, briefText, inFlight } from '../src/resume.mjs';

const BIN = fileURLToPath(new URL('../bin/resume.mjs', import.meta.url));
const NOW = '2026-10-31T18:00:00Z';
const G = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf8', stdio: 'pipe' });
// A slice cut in the middle: two steps, one done; one answered and one assumed question; one open blocking question; a decision; an uncommitted file.
function cut() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-')); G(d, 'init', '-q', '-b', 'feat/list'); fs.mkdirSync(path.join(d, 'docs')); fs.writeFileSync(path.join(d, 'a.txt'), '1\n'); G(d, 'add', '-A'); G(d, 'commit', '-qm', 'base');
  const clock = () => new Date(Date.UTC(2026, 9, 31, 9, 0, 0)); const s = startSlice({ repo: d, title: 'Reading list', request: 'The reader keeps a list', criteria: ['Shows saved books'], excludes: ['Nothing beyond the criteria above'], branch: 'feat/list', now: clock });
  stepAddTo(d, s.id, 'Storage', { now: clock }); stepAddTo(d, s.id, 'Screen', { now: clock });
  for (const to of ['ready', 'building']) moveSlice(d, s.id, to, { now: clock });
  stepSetIn(d, s.id, '1', true, { now: clock });          // the questions below come up mid-build
  const b = createBatch({ slice: s.id, questions: [
    { situation: 'Order of the list?', options: [{ label: 'Newest first', cost: 'none' }, { label: 'Oldest first', cost: 'none' }] },
    { situation: 'Page size?', options: [{ label: '20', cost: 'none' }, { label: '50', cost: 'none' }] },
    { situation: 'May a book be deleted?', blocking: true, options: [{ label: 'Yes', cost: 'data loss' }, { label: 'No', cost: 'none' }] }] }, { date: '2026-10-31' });
  answerQuestion(b, b.questions[0].id, { option: 'b' }); b.questions[1].default = 'a'; assumeDefaults(b); writeBatchFile(path.join(d, 'docs', 'questions.md'), b);
  const file = s.file; fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('request: The reader keeps a list', `request: The reader keeps a list\nbatches: [${b.id}]`));
  decideV0({ title: 'Store books in a file', requested_by: 'owner', decided_by: 'human', context: 'c', options: 'a; b', outcome: 'a', reason: 'r', rules: [{ text: 'one file', origin: 'human' }], slice: s.id }, d, { date: '2026-10-31' });
  fs.writeFileSync(path.join(d, 'half-done.js'), 'x\n');
  return { d, id: s.id, b };
}

test('the brief says what was done, what is next, what was decided and what is still open', () => {
  const { d, id } = cut(); const t = briefText(resumeBrief(d, id, NOW));
  for (const re of [/Request: The reader keeps a list/, /AC1  Shows saved books/, /Steps \(1 of 2 done\)/, /\[x\] 1\. Storage/, /\[ \] 2\. Screen   <- next/, /Order of the list\? \[Q-[0-9-a-f]+\] -> Oldest first  \[human\]/, /Page size\? \[Q-[0-9a-f-]+\] -> 20  \[assumed, not confirmed\]/, /D-2026-10-31-[0-9a-f]{4}  Store books in a file/, /BLOCKING May a book be deleted\? \[Q-[0-9a-f-]+\]/, /branch feat\/list, last commit [0-9a-f]+ base, 2 changed file/, /\?\? half-done\.js/, /Continue at step 2/])
    assert.match(t, re, String(re));
  assert.match(t, /last change 9 h ago/);
});
test('same files and same clock give the same brief; resuming writes nothing', () => {
  const { d, id } = cut(); const before = G(d, 'status', '--porcelain');
  assert.equal(briefText(resumeBrief(d, id, NOW)), briefText(resumeBrief(d, id, NOW))); assert.equal(G(d, 'status', '--porcelain'), before);
});
test('with every step done the brief points at the checkpoint; blocked says to wait; other states are refused', () => {
  const { d, id } = cut(); stepSetIn(d, id, '2', true);
  assert.match(briefText(resumeBrief(d, id, NOW)), /Every step is done: run the checkpoint/);
  moveSlice(d, id, 'delivered'); assert.throws(() => resumeBrief(d, id, NOW), /nothing to resume: .* is delivered/);
  const e = cut(); assert.equal(resumeBrief(e.d, e.id, NOW).next_step, '2');
});
test('a slice with no steps asks for the plan first', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-')); fs.mkdirSync(path.join(d, 'docs')); G(d, 'init', '-q'); const s = startSlice({ repo: d, title: 'T', request: 'r', criteria: ['x'], excludes: ['Nothing beyond the criteria above'] });
  for (const to of ['ready', 'building']) moveSlice(d, s.id, to); assert.match(briefText(resumeBrief(d, s.id, NOW)), /No steps written yet/);
});
test('in flight: building, rework and blocked slices only', () => {
  const { d, id } = cut(); const t = startSlice({ repo: d, title: 'Other', request: 'r' });
  const f = inFlight(d, NOW); assert.deepEqual(f.map(x => x.id), [id]); assert.equal(f[0].steps_done, 1); assert.ok(!f.some(x => x.id === t.id));
});
test('the CLI: list, brief, --json, and a refusal', () => {
  const { d, id } = cut(); const run = (...x) => spawnSync(process.execPath, [BIN, '--repo', d, '--now', NOW, ...x], { encoding: 'utf8' });
  assert.match(run().stdout, new RegExp(`${id}  building  Reading list  \\[1/2\\]`)); assert.match(run(id).stdout, /RESUME/);
  assert.equal(JSON.parse(run(id, '--json').stdout).next_step, '2');
  const bad = run('no-such-slice'); assert.equal(bad.status, 1); assert.match(bad.stderr, /no slice/);
});
test('with sub-steps the next step is the first open leaf, and nesting is shown', () => {
  const { d, id } = cut(); stepAddTo(d, id, 'Empty state', { under: '2' }); stepAddTo(d, id, 'Saved books', { under: '2' });
  const b = resumeBrief(d, id, NOW); assert.equal(b.next_step, '2.1');
  assert.match(briefText(b), /\n  \[ \] 2\. Screen\n    \[ \] 2\.1 Empty state   <- next\n    \[ \] 2\.2 Saved books/);
  stepSetIn(d, id, '2.1', true); stepSetIn(d, id, '2.2', true); assert.equal(resumeBrief(d, id, NOW).next_step, '2');      // children done: now the parent
});
test('--handover writes the brief to .git/buddy/handover/ and prints its path (R134)', () => {
  const { d, id } = cut(); const r = spawnSync(process.execPath, [BIN, '--repo', d, '--now', NOW, id, '--handover'], { encoding: 'utf8' });
  const file = r.stdout.trim(); assert.equal(r.status, 0, r.stderr);
  assert.equal(path.relative(d, file).replace(/\\/g, '/'), `.git/buddy/handover/${id}-dev-2026-10-31T180000Z.md`);
  assert.equal(fs.readFileSync(file, 'utf8'), briefText(resumeBrief(d, id, NOW)));
});
import { assumeAdd, assumeSet } from '../src/slicestore.mjs';
test('the brief carries the assumptions the owner confirmed before building, and only those (R136)', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-')); G(d, 'init', '-q', '-b', 'main'); fs.mkdirSync(path.join(d, 'docs')); fs.writeFileSync(path.join(d, 'a.txt'), '1\n'); G(d, 'add', '-A'); G(d, 'commit', '-qm', 'base');
  const s = startSlice({ repo: d, title: 'Reading list', request: 'A list', criteria: ['Shows saved books'], excludes: ['Nothing beyond the criteria above'] });
  assumeAdd(d, s.id, 'A book belongs to one reader', 'sharing needs a new data model'); assumeAdd(d, s.id, 'English only', 'translations are a new change'); assumeSet(d, s.id, 'A1', 'confirmed', { by: 'owner' });
  for (const to of ['ready', 'building']) moveSlice(d, s.id, to);
  const b = resumeBrief(d, s.id, NOW); assert.deepEqual(b.assumptions, [{ id: 'A1', text: 'A book belongs to one reader' }]);
  assert.match(briefText(b), /Assumptions the Product Owner confirmed before building \(build on them; do not ask again\):\n  A1  A book belongs to one reader/); assert.doesNotMatch(briefText(b), /English only/);
});
test('AC2: the hand-over names the index of normative documents next to the standards when the project has it (bring-normative-documents)', () => {
  const { d, id } = cut(); assert.doesNotMatch(briefText(resumeBrief(d, id, NOW)), /normative/);
  fs.mkdirSync(path.join(d, 'docs/standards'), { recursive: true }); fs.writeFileSync(path.join(d, 'docs/standards/normative.md'), '---\ndocuments: []\n---\n');
  const t = briefText(resumeBrief(d, id, NOW));
  assert.match(t, /\nNormative documents: docs\/standards\/normative\.md, next to the standards in docs\/standards\/\. /);
  assert.match(t, /SCS v2.0 clause 4.2/); assert.match(t, /Never fetch a link/); assert.match(t, /needs the document itself/);
});
