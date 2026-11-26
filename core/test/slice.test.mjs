import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { verify } from '../src/verify.mjs';
import { parseSteps } from '../src/slice.mjs';
import { startSlice, startMilestone, listSlices, readSlice, rankChange } from '../src/slicestore.mjs';

const EX = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'design', 'examples');
const CH = 'changes/2026-10-31-reading-list';
const WORKSHOP = { skip: fs.existsSync(EX) ? false : 'the design examples (docs/design/examples) are a workshop fixture, not in the public copy' };
const read = f => fs.readFileSync(path.join(EX, f), 'utf8');
// Verifies the example change in slices after applying edits to its slice ('a') and to its change.md ('e'); extra files by name, outside the folder.
function run({ a = t => t, e = t => t, extra = {} } = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 's1-')); fs.mkdirSync(path.join(d, CH), { recursive: true });
  fs.writeFileSync(path.join(d, CH, 'change.md'), e(read(`${CH}/change.md`))); fs.writeFileSync(path.join(d, CH, 'save-books-to-reading-list.md'), a(read(`${CH}/save-books-to-reading-list.md`)));
  for (const [f, t] of Object.entries(extra)) fs.writeFileSync(path.join(d, f), t);
  return verify([d]).problems;
}
const has = (p, re) => p.some(x => re.test(`${x.where}: ${x.message}`));

test('slice@1 examples verify clean', WORKSHOP, () => assert.deepEqual(run(), []));
test('shape: unknown kind, status, bad timestamp, id and unknown field', WORKSHOP, () => {
  const p = run({ a: t => t.replace('kind: feat', 'kind: story').replace('status: building', 'status: done').replace('2026-10-31T14:39:00Z', '2026-10-31').replace('rank: 3000', 'rank: 3000\nmood: happy') });
  for (const re of [/kind: must be one of/, /status: must be one of/, /created: .*does not match/, /mood: is not a known field/]) assert.ok(has(p, re), String(re));
});
test('reclassified (R140): kept in the record, naming its evidence; only the owner lowers a decision to cheap', WORKSHOP, () => {
  const rec = (costly, by, ev = 'evidence-2026-11-02T100000Z-run.json') => t => t.replace('    text: Saving a book already in the list is refused, with a message.\n', `    text: Saving a book already in the list is refused, with a message.\nreclassified:\n  - evidence: ${ev}\n    n: 1\n    costly: ${costly}\n    by: ${by}\n    at: 2026-11-02T10:00:00Z\n`);
  assert.deepEqual(run({ a: rec(false, 'owner') }), []); assert.deepEqual(run({ a: rec(true, 'buddy') }), []);
  assert.ok(has(run({ a: rec(false, 'buddy') }), /reclassified: decision 1 of evidence-2026-11-02T100000Z-run\.json was lowered to cheap by buddy: only the owner lowers one/));
  assert.ok(has(run({ a: rec(true, 'reviewer') }), /by: must be one of/)); assert.ok(has(run({ a: rec(true, 'buddy', 'notes.txt') }), /evidence: .*does not match/));
});
test('identity (R87): duplicate name, the folder of a change, the file of a slice', WORKSHOP, () => {
  assert.ok(has(run({ extra: { 'dup.md': read(`${CH}/save-books-to-reading-list.md`) } }), /duplicate slice id/));
  assert.ok(has(run({ e: t => t.replace('created: 2026-10-31T14:00:00Z', 'created: 2026-10-30T14:00:00Z') }), /a change lives in a folder named by its date and its name: 2026-10-30-reading-list/));
  assert.ok(has(run({ a: t => t.replace('id: save-books-to-reading-list', 'id: save-books') }), /a slice of a change is the file save-books\.md/));
  assert.ok(has(run({ e: t => t.replace('Steps: in the slices of this change.', '- [ ] 1. Do it') }), /a change in slices keeps its steps in its slices/));
});
test('dependencies: unknown, self, repeated and cycles', WORKSHOP, () => {
  assert.ok(has(run({ a: t => t.replace('depends_on: []', 'depends_on: [no-such-slice]') }), /depends_on: unknown slice/));
  assert.ok(has(run({ a: t => t.replace('depends_on: []', 'depends_on: [save-books-to-reading-list]') }), /depend on itself/));
  assert.ok(has(run({ a: t => t.replace('depends_on: []', 'depends_on: [reading-list, reading-list]') }), /listed twice/));
  const cyc = run({ a: t => t.replace('depends_on: []', 'depends_on: [reading-list]'), e: t => t.replace('rank: 2000', 'rank: 2000\ndepends_on: [save-books-to-reading-list]') });
  assert.ok(has(cyc, /dependency cycle: .*->/));
});
test('criteria: duplicates, and a feat that is past refining needs one', WORKSHOP, () => {
  assert.ok(has(run({ a: t => t.replace('id: AC2', 'id: AC1') }), /duplicate criterion id/));
  const none = t => t.replace(/criteria:[\s\S]*?\n---/, '---').replace(/ \(AC\d\)/g, '');
  assert.ok(has(run({ a: none }), /needs at least one acceptance criterion/));
  assert.ok(!has(run({ a: t => none(t).replace('status: building', 'status: refining') }), /acceptance criterion/));
});
test('steps: numbering, indentation, stray lines and unknown criterion', WORKSHOP, () => {
  assert.ok(has(run({ a: t => t.replace('- [ ] 3. Refuse', '- [ ] 4. Refuse') }), /expected number 3/));
  assert.ok(has(run({ a: t => t.replace('  - [ ] 2.1 Empty', '    - [ ] 2.1 Empty') }), /indentation must be 2 spaces/));
  assert.ok(has(run({ a: t => t.replace('- [ ] 3. Refuse duplicates (AC2)', '- [ ] 3. Refuse duplicates (AC2)\nnot a step') }), /not a step/));
  assert.ok(has(run({ a: t => t.replace('(AC2)', '(AC9)') }), /cites AC9/));
  assert.ok(has(run({ a: t => t.replace('- [ ] 3.', '- [ ] 2.') }), /duplicate step number|expected number 3/));
});
test('steps parser: nesting, ticks and a body without the section', () => {
  const r = parseSteps('# t\n\n## Steps\n- [x] 1. a\n  - [x] 1.1 b\n- [ ] 2. c\n\n## Notes\n- [ ] 9. not read\n');
  assert.deepEqual(r.steps.map(s => [s.num, s.done]), [['1', true], ['1.1', true], ['2', false]]); assert.deepEqual(r.errors, []);
  assert.equal(parseSteps('# nothing').present, false);
});
test('consistency: accepted with open steps, a change accepted with an open slice, blocked without a blocking question', WORKSHOP, () => {
  assert.ok(has(run({ a: t => t.replace('status: building', 'status: accepted') }), /accepted with 4 step\(s\) still open/));
  const done = t => t.replace(/\[ \]/g, '[x]');
  assert.ok(!has(run({ a: t => done(t).replace('status: building', 'status: accepted') }), /still open/));
  assert.ok(has(run({ e: t => t.replace('status: building', 'status: accepted') }), /accepted while 1 slice\(s\) of it are open/));
  assert.ok(!has(run({ e: t => t.replace('status: building', 'status: accepted'), a: t => t.replace('status: building', 'status: abandoned') }), /accepted while/));
  assert.ok(has(run({ a: t => t.replace('status: building', 'status: blocked') }), /no open blocking question/));
});

const BUDDY = fileURLToPath(new URL('../bin/buddy.mjs', import.meta.url));
function tempRepo() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-'));
  fs.mkdirSync(path.join(d, 'docs'));
  return d;
}
let tick = 0;
const clock = () => () => new Date(Date.UTC(2026, 10, 22, 12, 0, tick++));
const mkChange = (repo, name, extra = {}) => startSlice({ repo, title: name, name, request: `Req ${name}`, criteria: ['Done'], excludes: ['Nothing else'], now: clock(), ...extra });
const canon = d => verify([path.join(d, 'docs')], { canonical: true }).problems;

test('rankChange: reorders changes in the backlog (before first, between neighbours, after last) and stays canonical', () => {
  const d = tempRepo();
  mkChange(d, 'alpha'); mkChange(d, 'beta'); mkChange(d, 'gamma');
  // alpha(1000), beta(2000), gamma(3000) -> place gamma before alpha
  const r1 = rankChange(d, 'gamma', 'before', 'alpha', { now: clock() });
  assert.equal(r1.respaced, false);
  assert.ok(r1.rank > 0 && r1.rank < 1000 && Number.isInteger(r1.rank));
  assert.deepEqual(listSlices(d).map(s => s.data.id), ['gamma', 'alpha', 'beta']);

  // place beta between gamma and alpha (after gamma)
  const r2 = rankChange(d, 'beta', 'after', 'gamma', { now: clock() });
  assert.equal(r2.respaced, false);
  assert.ok(r2.rank > readSlice(d, 'gamma').data.rank && r2.rank < readSlice(d, 'alpha').data.rank);
  assert.deepEqual(listSlices(d).map(s => s.data.id), ['gamma', 'beta', 'alpha']);

  // place gamma after alpha (last)
  const r3 = rankChange(d, 'gamma', 'after', 'alpha', { now: clock() });
  assert.equal(r3.respaced, false);
  assert.ok(r3.rank > readSlice(d, 'alpha').data.rank);
  assert.deepEqual(listSlices(d).map(s => s.data.id), ['beta', 'alpha', 'gamma']);
  assert.deepEqual(canon(d), []);
});

test('rankChange: reorders changes within a milestone without disturbing other containers', () => {
  const d = tempRepo();
  startMilestone({ repo: d, title: 'M1', name: 'm1', request: 'Goal M1', now: clock() });
  mkChange(d, 'b-one');
  mkChange(d, 'm-one', { milestone: 'm1' });
  mkChange(d, 'm-two', { milestone: 'm1' });
  mkChange(d, 'm-three', { milestone: 'm1' });

  const bRankBefore = readSlice(d, 'b-one').data.rank;
  const r = rankChange(d, 'm-three', 'before', 'm-two', { now: clock() });
  assert.equal(r.milestone, 'm1');
  assert.deepEqual(listSlices(d).filter(s => s.milestone === 'm1').map(s => s.data.id), ['m-one', 'm-three', 'm-two']);
  assert.equal(readSlice(d, 'b-one').data.rank, bRankBefore);
  assert.deepEqual(canon(d), []);
});

test('rankChange: re-spaces container by 1000 when adjacent ranks leave no integer gap or placing before <= 1', () => {
  const d = tempRepo();
  const a = mkChange(d, 'a');
  const b = mkChange(d, 'b');
  const c = mkChange(d, 'c');
  // tighten ranks of a and b to 1000 and 1001 so no integer fits between them
  fs.writeFileSync(b.file, fs.readFileSync(b.file, 'utf8').replace('rank: 2000', 'rank: 1001'));
  const r1 = rankChange(d, 'c', 'after', 'a', { now: clock() });
  assert.equal(r1.respaced, true);
  assert.deepEqual(listSlices(d).map(s => [s.data.id, s.data.rank]), [['a', 1000], ['c', 2000], ['b', 3000]]);
  assert.equal(r1.rank, 2000);
  assert.deepEqual(canon(d), []);

  // placing before first when first has rank 1 triggers re-space
  fs.writeFileSync(a.file, fs.readFileSync(a.file, 'utf8').replace('rank: 1000', 'rank: 1'));
  const r2 = rankChange(d, 'b', 'before', 'a', { now: clock() });
  assert.equal(r2.respaced, true);
  assert.deepEqual(listSlices(d).map(s => [s.data.id, s.data.rank]), [['b', 1000], ['a', 2000], ['c', 3000]]);
  assert.equal(r2.rank, 1000);
  assert.deepEqual(canon(d), []);
});

test('rankChange: refuses unknown ids, self-reference, invalid position, milestones, inner slices and different containers', () => {
  const d = tempRepo();
  startMilestone({ repo: d, title: 'M1', name: 'm1', request: 'Goal M1', now: clock() });
  startMilestone({ repo: d, title: 'M2', name: 'm2', request: 'Goal M2', now: clock() });
  mkChange(d, 'back-a');
  mkChange(d, 'back-b');
  mkChange(d, 'm1-a', { milestone: 'm1' });
  mkChange(d, 'm2-a', { milestone: 'm2' });
  mkChange(d, 'inner-a', { inChange: 'back-a' });

  assert.throws(() => rankChange(d, 'no-such', 'before', 'back-a'), /no slice or change no-such/);
  assert.throws(() => rankChange(d, 'back-a', 'before', 'no-such'), /no slice or change no-such/);
  assert.throws(() => rankChange(d, 'back-a', 'before', 'back-a'), /itself/);
  assert.throws(() => rankChange(d, 'back-a', 'above', 'back-b'), /before or after/);
  assert.throws(() => rankChange(d, 'm1', 'before', 'back-a'), /milestone/);
  assert.throws(() => rankChange(d, 'back-a', 'before', 'm1'), /milestone/);
  assert.throws(() => rankChange(d, 'inner-a', 'before', 'back-b'), /slice of/);
  assert.throws(() => rankChange(d, 'back-b', 'before', 'inner-a'), /slice of/);
  assert.throws(() => rankChange(d, 'm1-a', 'before', 'back-a'), /move-to/);
  assert.throws(() => rankChange(d, 'm1-a', 'after', 'm2-a'), /move-to/);
});

test('CLI: buddy slice rank reorders changes, supports --json and refuses invalid calls', () => {
  const d = tempRepo();
  mkChange(d, 'first'); mkChange(d, 'second');
  const run = (...args) => spawnSync(process.execPath, [BUDDY, ...args, '--repo', d], { encoding: 'utf8' });

  const ok = run('slice', 'rank', 'second', 'before', 'first');
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /second placed before first \(rank \d+\)/);
  assert.deepEqual(listSlices(d).map(s => s.data.id), ['second', 'first']);

  const okJson = run('slice', 'rank', 'second', 'after', 'first', '--json');
  assert.equal(okJson.status, 0, okJson.stderr);
  const parsed = JSON.parse(okJson.stdout);
  assert.equal(parsed.id, 'second');
  assert.equal(parsed.where, 'after');
  assert.equal(parsed.other, 'first');
  assert.deepEqual(listSlices(d).map(s => s.data.id), ['first', 'second']);

  const bad = run('slice', 'rank', 'second', 'before', 'missing');
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /refused: no slice or change missing/);
  assert.deepEqual(canon(d), []);
});
