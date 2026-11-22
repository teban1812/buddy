import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { startSlice, startMilestone, moveSlice } from '../src/slicestore.mjs';
import { addRequest, setRequest, removeRequest, readRequests, setPriority, confirmPriorities, dependRequest, undependRequest, confirmRequest, requestOrder, REQUESTS } from '../src/requests.mjs';
import { verify } from '../src/verify.mjs';
import { loadBoard, boardText } from '../src/board.mjs';
import { digest, digestText } from '../src/digest.mjs';

// The priority (MoSCoW) and the dependencies of what was asked, and the order of the work that follows from them (R132).
const BUDDY = fileURLToPath(new URL('../bin/buddy.mjs', import.meta.url));
const NOW = '2026-11-02T18:00:00Z';
let tick = 0; const now = () => new Date(Date.UTC(2026, 10, 2, 12, 0, tick++));
const goal = { criteria: ['Works'], excludes: ['Nothing beyond the criteria above'] };
const problems = d => verify([path.join(d, 'docs')], { canonical: true }).problems.map(p => `${p.where}: ${p.message}`);
const run = (d, ...a) => spawnSync(process.execPath, [BUDDY, ...a, '--repo', d], { encoding: 'utf8' });
const item = d => id => readRequests(d).data.items.find(x => x.id === id);
function project(n = 0) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rqo-')); fs.mkdirSync(path.join(d, 'docs'));
  startMilestone({ repo: d, title: 'First release', name: 'mvp', request: 'The smallest useful list', ...goal, now });
  startSlice({ repo: d, title: 'Export the list', name: 'export-csv', request: 'r', milestone: 'mvp', ...goal, now });
  for (let i = 1; i <= n; i++) addRequest(d, `Item ${i}`, 'prd', { now });
  return d;
}
const order = d => requestOrder(readRequests(d).data.items);

test('priority: must, should or could, none clears it, independent of the destination; excluded or deferred reads as Won\'t', () => {
  const d = project(3); const it = item(d);
  assert.equal(setPriority(d, 'RQ1', 'must', { now }).priority, 'must'); setPriority(d, 'RQ2', 'could', { now }); setPriority(d, 'RQ3', 'should', { now });
  assert.throws(() => setPriority(d, 'RQ1', 'wont', { now }), /must, should, could or none, not "wont"/);
  setPriority(d, 'RQ3', 'none', { now }); assert.equal('priority' in it('RQ3'), false);
  setRequest(d, 'RQ1', { to: 'export-csv' }, { now }); assert.equal(it('RQ1').priority, 'must');   // a destination keeps the priority
  setRequest(d, 'RQ2', { deferred: 'later' }, { now }); assert.equal(it('RQ2').priority, 'could');
  const view = fs.readFileSync(path.join(d, REQUESTS), 'utf8');
  assert.match(view, /- \*\*RQ1\*\* \[Must\] Item 1 \(prd\): covered by export-csv\n- \*\*RQ2\*\* \[Won't\] Item 2 \(prd\): deferred: later\n- \*\*RQ3\*\* Item 3 \(prd\): no destination yet\n/);
  assert.equal(run(d, 'requests', 'list').stdout.split('\n\n')[0], "RQ1  [Must] Item 1  · prd  · covered by export-csv\nRQ2  [Won't] Item 2  · prd  · deferred: later\nRQ3  Item 3  · prd  · no destination yet");
  assert.equal(run(d, 'requests', 'priority', 'RQ3', 'should').stdout, 'RQ3 Should\n');
  assert.equal(run(d, 'requests', 'priority', 'RQ2', 'must').stdout, "RQ2 must, read as Won't while deferred: later\n");
  assert.equal(run(d, 'requests', 'priority', 'RQ3', 'often').status, 1);
  assert.deepEqual(problems(d), []);
});

test('dependencies: the owner\'s word is human, Buddy\'s proposal assumed until confirmed; undepend; verify refuses an unknown id and itself; remove refused when needed', () => {
  const d = project(4); const it = item(d);
  dependRequest(d, 'RQ1', ['RQ2', 'RQ3'], { assumed: true, now }); dependRequest(d, 'RQ4', ['RQ2'], { now });
  assert.deepEqual(it('RQ1').depends_on, [{ id: 'RQ2', origin: 'assumed' }, { id: 'RQ3', origin: 'assumed' }]); assert.deepEqual(it('RQ4').depends_on, [{ id: 'RQ2', origin: 'human' }]);
  dependRequest(d, 'RQ4', ['RQ2'], { assumed: true, now }); assert.equal(it('RQ4').depends_on[0].origin, 'human');   // never downgraded
  assert.match(fs.readFileSync(path.join(d, REQUESTS), 'utf8'), /- \*\*RQ1\*\* Item 1 \(prd; depends on RQ2 \(assumed\), RQ3 \(assumed\)\): no destination yet\n/);
  assert.throws(() => dependRequest(d, 'RQ1', ['RQ9'], { now }), /items\.RQ1\.depends_on: no request RQ9 in the map/);
  assert.throws(() => dependRequest(d, 'RQ1', ['RQ1'], { now }), /items\.RQ1\.depends_on: a request does not depend on itself/);
  assert.equal(it('RQ1').depends_on.length, 2);                                                                     // rolled back
  assert.throws(() => removeRequest(d, 'RQ2', { now }), /Item 1 \[RQ1\] \| Item 4 \[RQ4\] depend on Item 2 \[RQ2\]: undo that first \(buddy requests undepend <RQ id> --on RQ2\)/);
  assert.throws(() => undependRequest(d, 'RQ1', ['RQ4'], { now }), /Item 1 \[RQ1\] does not depend on Item 4 \[RQ4\]; it depends on Item 2 \[RQ2\], Item 3 \[RQ3\]/);
  assert.deepEqual(confirmRequest(d, 'RQ1', { now }).confirmed, ['RQ2', 'RQ3']); assert.ok(it('RQ1').depends_on.every(x => x.origin === 'human'));
  assert.throws(() => confirmRequest(d, 'RQ1', { now }), /Item 1 \[RQ1\] has no assumed dependency to confirm/);
  undependRequest(d, 'RQ4', ['RQ2'], { now }); assert.equal('depends_on' in it('RQ4'), false);
  assert.deepEqual(problems(d), []);
  // a file edited by hand: verify names it
  const f = path.join(d, REQUESTS); const text = fs.readFileSync(f, 'utf8');
  fs.writeFileSync(f, text.replace('- id: RQ3\n        origin: human', '- id: RQ7\n        origin: human')); assert.match(problems(d).join('\n'), /items\.RQ1\.depends_on: no request RQ7 in the map/);
  fs.writeFileSync(f, text.replace('origin: human', 'origin: maybe')); assert.match(problems(d).join('\n'), /origin/);
  fs.writeFileSync(f, text);
  // the CLI
  assert.equal(run(d, 'requests', 'depend', 'RQ4', '--on', 'RQ1', '--on', 'RQ3', '--assumed').stdout, 'RQ4 depends on RQ1 (assumed), RQ3 (assumed)\n');
  assert.equal(run(d, 'requests', 'confirm', 'RQ4').stdout, 'RQ4 depends on RQ1, RQ3 (confirmed RQ1, RQ3)\n');
  assert.equal(run(d, 'requests', 'undepend', 'RQ4', '--on', 'RQ1').stdout, 'RQ4 depends on RQ3\n');
  assert.equal(run(d, 'requests', 'depend', 'RQ4').status, 2);
  const bad = run(d, 'requests', 'depend', 'RQ4', '--on', 'RQ4'); assert.equal(bad.status, 1); assert.match(bad.stderr, /^refused: .*does not depend on itself/);
  assert.match(run(d, 'requests', 'list').stdout, /RQ4  Item 4  · prd  · depends on RQ3  · no destination yet\n/);
});

test('order: what others need first, ties by priority then id; it warns of a lower priority, a dependency on what is excluded or deferred, and a cycle', () => {
  const d = project(8);
  for (const [id, p] of [['RQ1', 'could'], ['RQ2', 'must'], ['RQ3', 'should'], ['RQ5', 'must'], ['RQ6', 'must']]) setPriority(d, id, p, { now });
  dependRequest(d, 'RQ2', ['RQ4'], { now });   // a Must on an item of no priority
  dependRequest(d, 'RQ5', ['RQ3'], { now });   // a Must on a Should
  setRequest(d, 'RQ6', { excluded: 'not this year' }, { now });   // Won't: not in the order
  dependRequest(d, 'RQ3', ['RQ6'], { now });   // on what is excluded
  setRequest(d, 'RQ8', { deferred: 'later' }, { now }); dependRequest(d, 'RQ1', ['RQ8'], { now });
  let r = order(d);
  // RQ3 and RQ4 take the Must of what needs them (RQ5, RQ2), so they go before RQ1 (Could); RQ3 before RQ4 by its own priority (Should)
  assert.deepEqual(r.order.map(x => x.id), ['RQ3', 'RQ5', 'RQ4', 'RQ2', 'RQ1', 'RQ7']);
  assert.deepEqual(r.warnings, ['RQ1 depends on RQ8, which is deferred: later', 'RQ2 (Must) depends on RQ4 (no priority): it should be Must too',
    'RQ3 depends on RQ6, which is excluded: not this year', 'RQ5 (Must) depends on RQ3 (Should): it should be Must too']);
  assert.deepEqual(r.cycles, []);
  // a cycle: its requests, and what needs them, go last in id order
  dependRequest(d, 'RQ4', ['RQ7'], { now }); dependRequest(d, 'RQ7', ['RQ4'], { now });
  r = order(d);
  assert.deepEqual(r.order.map(x => x.id), ['RQ3', 'RQ5', 'RQ1', 'RQ2', 'RQ4', 'RQ7']);
  assert.deepEqual(r.cycles, [['RQ4', 'RQ7']]); assert.equal(r.warnings.at(-1), 'a cycle: RQ4, RQ7 depend on each other; they go last, in id order');
  // the CLI writes nothing
  const before = fs.readFileSync(path.join(d, REQUESTS), 'utf8'); const out = run(d, 'requests', 'order');
  assert.equal(out.status, 0, out.stderr); assert.equal(fs.readFileSync(path.join(d, REQUESTS), 'utf8'), before);
  assert.match(out.stdout, /^1\. RQ3  \[Should\] Item 3  · prd  · depends on RQ6  · no destination yet\n2\. RQ5 [^\n]+\n[\s\S]*6\. RQ7 [^\n]+\n\nWarnings \(5\)\n  - RQ1 depends on RQ8/);
  assert.deepEqual(JSON.parse(run(d, 'requests', 'order', '--json').stdout).cycles, [['RQ4', 'RQ7']]);
});

test('a Must with no destination is its own alarm on the board and the digest, before the others', () => {
  const d = project(4); setPriority(d, 'RQ1', 'must', { now }); setPriority(d, 'RQ3', 'must', { now }); setRequest(d, 'RQ3', { to: 'export-csv' }, { now });
  const text = boardText(loadBoard(d, NOW));
  assert.match(text, /Waiting for you \(2\)\n  - 1 Must of what you asked for has no destination yet: Item 1 \[RQ1\]\n  - 2 of what you asked for have no destination yet: Item 2 \[RQ2\] \| Item 4 \[RQ4\]\n\nWhat you asked for \(4\): 1 covered, 1 Must without a destination yet \(RQ1\), 2 without a destination yet\n/);
  assert.match(digestText(digest(d, NOW)), /  - 1 Must of what you asked for has no destination yet: Item 1 \[RQ1\]\n/);
  moveSlice(d, 'export-csv', 'abandoned', { now });   // the Must it covered has nobody again
  assert.match(boardText(loadBoard(d, NOW)), /  - 2 Must of what you asked for have no destination yet: Item 1 \[RQ1\] \| Item 3 \[RQ3\]\n[\s\S]*2 Must without a destination yet \(RQ1, RQ3\), 2 without a destination yet\n/);
});

test('a milestone is not accepted while a Must covered by one of its changes, abandoned, has no destination again', () => {
  const d = project(3); setPriority(d, 'RQ1', 'must', { now }); setPriority(d, 'RQ2', 'should', { now });
  setRequest(d, 'RQ1', { to: 'export-csv' }, { now }); setRequest(d, 'RQ2', { to: 'export-csv' }, { now }); setRequest(d, 'RQ3', { to: 'mvp' }, { now });
  for (const to of ['ready', 'building', 'delivered']) moveSlice(d, 'mvp', to, { now });
  moveSlice(d, 'export-csv', 'abandoned', { now });
  assert.throws(() => moveSlice(d, 'mvp', 'accepted', { by: 'owner', now }), /1 Must of what you asked for lost its destination in this milestone: Item 1 \[RQ1\], covered by Export the list \[export-csv\], abandoned/);
  setRequest(d, 'RQ1', { deferred: 'the next milestone' }, { now });   // a Should left behind does not hold it back
  assert.equal(moveSlice(d, 'mvp', 'accepted', { by: 'owner', now }).data.status, 'accepted');
  assert.deepEqual(problems(d), []);
});

// Where a priority comes from (R136): the PRD's (with its citation), Buddy's proposal (with its reason) or the owner's.
test('a priority from the PRD, proposed by Buddy or the owner\'s; neither the PRD nor Buddy overwrites the owner\'s; a newer PRD replaces the PRD\'s and says so', () => {
  const d = project(4); const it = item(d);
  setPriority(d, 'RQ1', 'must', { proposed: true, why: 'the PRD calls it the core flow', now });
  assert.deepEqual([it('RQ1').priority_origin, it('RQ1').priority_why], ['assumed', 'the PRD calls it the core flow']);
  assert.throws(() => setPriority(d, 'RQ2', 'must', { proposed: true, now }), /a proposed priority needs its reason/);
  assert.throws(() => setPriority(d, 'RQ2', 'must', { fromPrd: 'PRD §1', proposed: true, why: 'r', now }), /from the PRD .* or is proposed by Buddy .*, not both/);
  assert.throws(() => setPriority(d, 'RQ2', 'none', { proposed: true, why: 'r', now }), /only the owner clears a priority/);
  assert.equal(setPriority(d, 'RQ2', 'should', { fromPrd: 'PRD §3.2: P2', now }).was, null);
  assert.deepEqual(setPriority(d, 'RQ2', 'must', { fromPrd: 'PRD §3.2 v2: P1', now }).was, { priority: 'should', priority_origin: 'prd', priority_why: 'PRD §3.2: P2' });
  assert.throws(() => setPriority(d, 'RQ2', 'could', { proposed: true, why: 'r', now }), /Item 2 \[RQ2\] is Must from the PRD \(PRD §3\.2 v2: P1\): a proposal does not replace it/);
  setPriority(d, 'RQ3', 'could', { now }); assert.equal(it('RQ3').priority_origin, 'human');
  assert.throws(() => setPriority(d, 'RQ3', 'must', { proposed: true, why: 'r', now }), /Item 3 \[RQ3\] is Could by the owner's word: Buddy does not change it \(only the owner does, with requests priority RQ3 <priority>\)/);
  assert.throws(() => setPriority(d, 'RQ3', 'must', { fromPrd: 'PRD §4', now }), /Item 3 \[RQ3\] is Could by the owner's word/);
  setPriority(d, 'RQ1', 'should', { now }); assert.deepEqual([it('RQ1').priority_origin, 'priority_why' in it('RQ1')], ['human', false]);   // the owner changes a proposal: theirs, its reason gone
  setPriority(d, 'RQ1', 'none', { now }); assert.equal(Object.keys(it('RQ1')).some(k => k.startsWith('priority')), false);
  assert.deepEqual(problems(d), []);
  // the CLI
  assert.equal(run(d, 'requests', 'priority', 'RQ4', 'could', '--proposed', '--why', 'a nice-to-have in the PRD').stdout, 'RQ4 Could proposed\n');
  assert.equal(run(d, 'requests', 'priority', 'RQ2', 'should', '--from-prd', 'PRD §3.2 v3: P2').stdout, 'RQ2 Should from the PRD (changed from Must, PRD §3.2 v2: P1, to Should, PRD §3.2 v3: P2)\n');
  const bad = run(d, 'requests', 'priority', 'RQ3', 'must', '--from-prd', 'PRD §4'); assert.equal(bad.status, 1); assert.match(bad.stderr, /^refused: Item 3 \[RQ3\] is Could by the owner's word/);
  assert.equal(run(d, 'requests', 'priority', 'RQ1', 'must', '--proposed').status, 1);
  assert.equal(run(d, 'requests', 'why', 'RQ4').stdout, 'RQ4 Could, proposed by Buddy: a nice-to-have in the PRD\n');
  assert.equal(run(d, 'requests', 'why', 'RQ2').stdout, 'RQ2 Should, from the PRD: PRD §3.2 v3: P2\n');
  assert.equal(run(d, 'requests', 'why', 'RQ3').stdout, 'RQ3 Could, yours\n');
  assert.equal(run(d, 'requests', 'why', 'RQ1').stdout, 'RQ1 has no priority\n');
  assert.equal(run(d, 'requests', 'why', 'RQ9').status, 1);
});

test('list and the view show the origin; proposals wait for the owner after the Must alarm; confirm --priorities; a priority set before R136 is the owner\'s; verify', () => {
  const d = project(4); const it = item(d);
  setPriority(d, 'RQ1', 'must', { proposed: true, why: 'core flow', now }); setPriority(d, 'RQ2', 'must', { fromPrd: 'PRD §3.2: P1', now }); setPriority(d, 'RQ3', 'must', { now });
  setPriority(d, 'RQ4', 'could', { proposed: true, why: 'optional in the PRD', now });
  assert.match(fs.readFileSync(path.join(d, REQUESTS), 'utf8'), /- \*\*RQ1\*\* \[Must · proposed\] Item 1 \(prd\): no destination yet\n- \*\*RQ2\*\* \[Must · PRD\] Item 2 \(prd\): no destination yet\n- \*\*RQ3\*\* \[Must\] Item 3 \(prd\): no destination yet\n/);
  assert.equal(run(d, 'requests', 'list').stdout.split('\n\n')[0], 'RQ1  [Must · proposed] Item 1  · prd  · no destination yet\nRQ2  [Must · PRD] Item 2  · prd  · no destination yet\nRQ3  [Must] Item 3  · prd  · no destination yet\nRQ4  [Could · proposed] Item 4  · prd  · no destination yet');
  assert.deepEqual(JSON.parse(run(d, 'requests', 'list', '--json').stdout).map(x => [x.priority_origin, x.priority_why ?? null]), [['assumed', 'core flow'], ['prd', 'PRD §3.2: P1'], ['human', null], ['assumed', 'optional in the PRD']]);
  setRequest(d, 'RQ2', { to: 'export-csv' }, { now });
  const line = '2 priorities proposed by Buddy wait for your confirmation (buddy requests confirm --priorities, or change the ones you disagree with)';
  assert.ok(boardText(loadBoard(d, NOW)).includes(`Waiting for you (3)\n  - 2 Must of what you asked for have no destination yet: Item 1 [RQ1] | Item 3 [RQ3]\n  - ${line}\n  - 1 of what you asked for has no destination yet: Item 4 [RQ4]\n`));
  assert.ok(digestText(digest(d, NOW)).includes(`  - ${line}\n`));
  assert.equal(run(d, 'requests', 'confirm', 'RQ1', '--priorities').status, 1);
  assert.equal(run(d, 'requests', 'confirm', '--priorities').stdout, 'confirmed 2 priorities proposed by Buddy (RQ1, RQ4): now yours\n');
  assert.deepEqual([it('RQ1').priority_origin, it('RQ1').priority_why, it('RQ2').priority_origin], ['human', 'core flow', 'prd']);
  assert.deepEqual(confirmPriorities(d, { now }), []); assert.doesNotMatch(boardText(loadBoard(d, NOW)), /proposed by Buddy/);
  assert.deepEqual(problems(d), []);
  // a priority with no origin (written before R136) reads as the owner's; verify names what does not hold
  const f = path.join(d, REQUESTS); const text = fs.readFileSync(f, 'utf8');
  fs.writeFileSync(f, text.replace(/\n(\s+)priority_origin: human\n\s+priority_why: core flow/, ''));
  assert.equal(it('RQ1').priority_origin, undefined); assert.equal(run(d, 'requests', 'why', 'RQ1').stdout, 'RQ1 Must, yours\n'); assert.deepEqual(problems(d), []);
  assert.throws(() => setPriority(d, 'RQ1', 'could', { proposed: true, why: 'r', now }), /by the owner's word/);
  fs.writeFileSync(f, text.replace(/\n\s+priority_why: "PRD §3\.2: P1"/, '')); assert.match(problems(d).join('\n'), /items\.RQ2\.priority_why: a priority from the PRD needs its citation/);
  fs.writeFileSync(f, text.replace(/\n\s+priority: must(\n\s+priority_origin: prd)/, '$1')); assert.match(problems(d).join('\n'), /items\.RQ2\.priority_origin: a request with no priority has no priority_origin/);
});
// flag-unconfirmed-dependencies (R148): the dependencies Buddy proposed and the owner has not confirmed are counted in the index and wait
// for the owner on the board and the digest, right after the proposed priorities; confirming or removing them clears the line.
test('dependencies Buddy proposed wait for the owner on the board and the digest, after the proposed priorities, until confirmed', async () => {
  const { buildIndex } = await import('../src/index.mjs');
  const d = project(4); const one = '1 dependency Buddy proposed waits for your confirmation (buddy requests list to see them, then buddy requests confirm --dependencies, or confirm <RQ> one by one)';
  for (const id of ['RQ1', 'RQ2', 'RQ3', 'RQ4']) setRequest(d, id, { to: 'export-csv' }, { now });
  dependRequest(d, 'RQ4', ['RQ3'], { now });                                                             // the owner's word: nothing waits
  assert.equal(buildIndex(d).proposed_dependencies, 0); assert.doesNotMatch(boardText(loadBoard(d, NOW)), /Buddy proposed/);
  dependRequest(d, 'RQ1', ['RQ2', 'RQ3'], { assumed: true, now }); dependRequest(d, 'RQ4', ['RQ2'], { assumed: true, now });
  setPriority(d, 'RQ1', 'must', { proposed: true, why: 'core flow', now });
  assert.equal(buildIndex(d).proposed_dependencies, 3);
  const line = '3 dependencies Buddy proposed wait for your confirmation (buddy requests list to see them, then buddy requests confirm --dependencies, or confirm <RQ> one by one)';
  assert.ok(boardText(loadBoard(d, NOW)).includes(`  - 1 priority proposed by Buddy waits for your confirmation (buddy requests confirm --priorities, or change the ones you disagree with)\n  - ${line}\n`));
  assert.ok(digestText(digest(d, NOW)).includes(`  - ${line}\n`));
  assert.equal(run(d, 'requests', 'confirm', 'RQ1').status, 0); undependRequest(d, 'RQ4', ['RQ2'], { now });
  assert.equal(buildIndex(d).proposed_dependencies, 0); assert.doesNotMatch(digestText(digest(d, NOW)), /Buddy proposed waits?/);
  dependRequest(d, 'RQ2', ['RQ3'], { assumed: true, now }); assert.ok(boardText(loadBoard(d, NOW)).includes(`  - ${one}\n`));
});
// confirm-dependencies-at-once (R162): confirm --dependencies confirms every dependency Buddy proposed and says which, each request by its
// text; it excludes <RQ id> and --priorities; the board and the digest count only those of requests still open (not excluded, deferred or
// covered by a change delivered or accepted).
test('confirm --dependencies confirms every proposed dependency and names them; only open requests count as waiting', async () => {
  const { buildIndex } = await import('../src/index.mjs');
  const d = project(6); const it = item(d);
  startSlice({ repo: d, title: 'Send the list', name: 'send-list', request: 'r', milestone: 'mvp', ...goal, now });
  for (const id of ['RQ1', 'RQ2', 'RQ3']) setRequest(d, id, { to: 'export-csv' }, { now });
  setRequest(d, 'RQ4', { excluded: 'not now' }, { now }); setRequest(d, 'RQ5', { deferred: 'later' }, { now }); setRequest(d, 'RQ6', { to: 'send-list' }, { now });
  dependRequest(d, 'RQ1', ['RQ2', 'RQ3'], { assumed: true, now }); dependRequest(d, 'RQ2', ['RQ3'], { now });
  dependRequest(d, 'RQ4', ['RQ3'], { assumed: true, now }); dependRequest(d, 'RQ5', ['RQ3'], { assumed: true, now }); dependRequest(d, 'RQ6', ['RQ3'], { assumed: true, now });
  assert.equal(buildIndex(d).proposed_dependencies, 3);                                                   // RQ1 (2) and RQ6; not RQ4 nor RQ5
  for (const [id, s] of [['mvp', 'ready'], ['mvp', 'building'], ['send-list', 'ready'], ['send-list', 'building'], ['send-list', 'delivered']]) moveSlice(d, id, s, { now });
  assert.equal(buildIndex(d).proposed_dependencies, 2);                                                   // RQ6 is delivered
  assert.ok(boardText(loadBoard(d, NOW)).includes('  - 2 dependencies Buddy proposed wait for your confirmation (buddy requests list to see them, then buddy requests confirm --dependencies, or confirm <RQ> one by one)\n'));
  assert.equal(run(d, 'requests', 'confirm', 'RQ1', '--dependencies').status, 1);
  assert.match(run(d, 'requests', 'confirm', '--priorities', '--dependencies').stderr, /not more than one/);
  const r = run(d, 'requests', 'confirm', '--dependencies');
  assert.equal(r.stdout, 'confirmed 5 dependencies proposed by Buddy, now yours: Item 1 [RQ1] on Item 2 [RQ2], Item 3 [RQ3] | Item 4 [RQ4] on Item 3 [RQ3] | Item 5 [RQ5] on Item 3 [RQ3] | Item 6 [RQ6] on Item 3 [RQ3]\n');
  assert.deepEqual(it('RQ1').depends_on, [{ id: 'RQ2', origin: 'human' }, { id: 'RQ3', origin: 'human' }]);
  assert.deepEqual(JSON.parse(run(d, 'requests', 'confirm', '--dependencies', '--json').stdout), { confirmed: [] });
  assert.equal(run(d, 'requests', 'confirm', '--dependencies').stdout, 'no dependency proposed by Buddy waits for confirmation\n');
  assert.equal(buildIndex(d).proposed_dependencies, 0); assert.deepEqual(problems(d), []);
});
