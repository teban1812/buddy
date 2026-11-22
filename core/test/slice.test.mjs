import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verify } from '../src/verify.mjs';
import { parseSteps } from '../src/slice.mjs';

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
test('identity (R87): duplicate name, the folder of a change, the file of a slice, no epic in a folder', WORKSHOP, () => {
  assert.ok(has(run({ extra: { 'dup.md': read(`${CH}/save-books-to-reading-list.md`) } }), /duplicate slice id/));
  assert.ok(has(run({ e: t => t.replace('created: 2026-10-31T14:00:00Z', 'created: 2026-10-30T14:00:00Z') }), /a change lives in a folder named by its date and its name: 2026-10-30-reading-list/));
  assert.ok(has(run({ a: t => t.replace('id: save-books-to-reading-list', 'id: save-books') }), /a slice of a change is the file save-books\.md/));
  assert.ok(has(run({ a: t => t.replace('rank: 3000', 'rank: 3000\nepic: reading-list') }), /a slice of a change has no epic: its change is its folder \(reading-list\)/));
  assert.ok(has(run({ e: t => t.replace('rank: 2000', 'rank: 2000\nepic: save-books-to-reading-list') }), /a change has no epic/));
  assert.ok(has(run({ e: t => t.replace('Steps: in the slices of this change.', '- [ ] 1. Do it') }), /a change in slices keeps its steps in its slices/));
});
test('identity in the flat layout of before R87 (read until buddy migrate): unknown epic, epic of the wrong kind, self epic, epic with an epic', WORKSHOP, () => {
  const flat = (id, extra) => read(`${CH}/save-books-to-reading-list.md`).replace('id: save-books-to-reading-list', `id: ${id}`).replace('rank: 3000', `rank: 3000\n${extra}`);
  assert.ok(has(run({ extra: { 'x.md': flat('flat-x', 'epic: no-such-slice') } }), /epic: unknown slice/));
  assert.ok(has(run({ extra: { 'x.md': flat('flat-x', 'epic: flat-x') } }), /cannot be its own epic/));
  assert.ok(has(run({ extra: { 'x.md': flat('flat-x', 'epic: reading-list') } }), /is not of kind epic/));
  assert.ok(has(run({ extra: { 'x.md': flat('flat-x', 'epic: flat-y').replace('kind: feat', 'kind: epic'), 'y.md': flat('flat-y', '').replace('kind: feat', 'kind: epic') } }), /one level only/));
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
