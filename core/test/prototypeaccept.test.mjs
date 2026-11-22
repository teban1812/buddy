import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { startSlice, moveSlice, stepAddTo, stepSetIn, readSlice, screensAdd, screensRemove, divergenceAdd, divergenceRemove, divergenceDecide, acceptCard } from '../src/slicestore.mjs';
import { readPrototype, draftManifest, confirmManifest, MANIFEST } from '../src/prototype.mjs';
import { loadBoard, boardText } from '../src/board.mjs';
import { verify } from '../src/verify.mjs';

const BIN = fileURLToPath(new URL('../bin/buddy.mjs', import.meta.url));
const HTML = `<section id="list"><h1>Reading list</h1><a href="#add">Add one</a></section><section id="add"><h2>Add a book</h2><a href="#list">Back</a></section>`;
const V1 = { screen: 'list', prototype: 'has no way to sort', built: 'sorts the list by title', why: 'a long list is hard to scan', kind: 'improvement' };
const V2 = { screen: 'add', prototype: 'saves with one button', built: 'asks to confirm first', why: 'a wrong tap lost a book' };
// A change covering two screens whose work is done and has declared two departures; delivered, so the owner can decide.
function delivered() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-')); fs.mkdirSync(path.join(d, 'docs/inputs/prototype'), { recursive: true }); fs.writeFileSync(path.join(d, 'docs/inputs/prototype/index.html'), HTML);
  fs.writeFileSync(path.join(d, MANIFEST), confirmManifest(draftManifest(readPrototype([{ name: 'index.html', html: HTML }]), { date: '2026-11-01' }), { all: true, date: '2026-11-01' }).text);
  const s = startSlice({ repo: d, title: 'List and add books', request: 'r', criteria: ['Works'], excludes: ['Nothing beyond the criteria above'] }); screensAdd(d, s.id, ['list', 'add']); stepAddTo(d, s.id, 'Build');
  moveSlice(d, s.id, 'ready'); moveSlice(d, s.id, 'building'); stepSetIn(d, s.id, '1', true); divergenceAdd(d, s.id, V1); divergenceAdd(d, s.id, V2); moveSlice(d, s.id, 'delivered');
  return { d, id: s.id };
}
const accept = (d, id) => moveSlice(d, id, 'accepted', { by: 'owner' });
const canon = d => verify([path.join(d, 'docs')], { canonical: true }).problems;

test('the accept card lists each departure with what the prototype does, what was built and why', () => {
  const { d, id } = delivered(); const card = acceptCard(d, id);
  assert.match(card, /Where the build departs from your prototype \(2 to decide, 2 in all\):/);
  assert.match(card, /V1  improvement on screen list \[declared\]\n\s+the prototype has no way to sort\n\s+built: sorts the list by title\n\s+why: a long list is hard to scan/);
  assert.match(card, /V2  DIVERGENCE on screen add \[declared\]/); assert.match(card, /Say which to accept and which to reject/);
  const x = delivered(); divergenceDecide(x.d, x.id, 'all', 'accept', { by: 'owner' }); assert.match(acceptCard(x.d, x.id), /Where the build departs from your prototype \(0 to decide, 2 in all\)/);   // decided ones stay on the card
});
test('accepting is refused while a departure is undecided, one at a time or all at once, and then it goes through', () => {
  const { d, id } = delivered(); assert.throws(() => accept(d, id), /2 departure\(s\) from the prototype are not decided yet: V1 on list, V2 on add\. The accept card lists them/);
  divergenceDecide(d, id, 'V1', 'accept', { by: 'owner', channel: 'chat', now: () => new Date('2026-11-02T10:00:00Z') });
  const v = readSlice(d, id).data.divergences; assert.deepEqual([v[0].status, v[1].status], ['accepted', 'declared']); assert.deepEqual(v[0].decided, { by: 'owner', at: '2026-11-02T10:00:00Z', channel: 'chat' });
  assert.throws(() => accept(d, id), /1 departure\(s\) from the prototype are not decided yet: V2 on add/);
  assert.match(boardText(loadBoard(d, '2026-11-02T12:00:00Z')), /try and accept: List and add books \[list-and-add-books\] \(1 departure from the prototype to decide\)/);
  divergenceDecide(d, id, 'all', 'accept', { by: 'owner' }); assert.equal(readSlice(d, id).data.divergences[0].decided.at, '2026-11-02T10:00:00Z');   // 'all' touches only what was waiting
  accept(d, id); assert.equal(readSlice(d, id).data.status, 'accepted'); assert.deepEqual(canon(d), []);
});
test('a rejected departure sends the slice back: Dev undoes it, the owner decides the rest, and the change is accepted', () => {
  const { d, id } = delivered(); divergenceDecide(d, id, 'V1', 'accept', { by: 'owner' }); divergenceDecide(d, id, 'V2', 'reject', { by: 'owner' });
  assert.throws(() => accept(d, id), /1 departure\(s\) from the prototype were rejected: V2 on add\. Send the slice back to rework so Dev undoes them/);
  moveSlice(d, id, 'rework'); assert.throws(() => divergenceRemove(d, id, 'V1'), /V1 was accepted by the Product Owner: it stays on the record/); divergenceRemove(d, id, 'V2');
  moveSlice(d, id, 'building'); moveSlice(d, id, 'delivered'); accept(d, id);
  assert.deepEqual(readSlice(d, id).data.divergences.map(x => [x.id, x.status]), [['V1', 'accepted']]); assert.deepEqual(canon(d), []);
});
test('only the owner decides, only once delivered, with a real verdict and a real departure', () => {
  const { d, id } = delivered();
  assert.throws(() => divergenceDecide(d, id, 'V1', 'accept', {}), /only the Product Owner decides/); assert.throws(() => divergenceDecide(d, id, 'V1', 'accept', { by: 'dev' }), /only the Product Owner decides/);
  assert.throws(() => divergenceDecide(d, id, 'V1', 'maybe', { by: 'owner' }), /accept or reject/); assert.throws(() => divergenceDecide(d, id, 'V9', 'accept', { by: 'owner' }), /no departure V9; there are: V1, V2/);
  assert.throws(() => divergenceDecide(d, id, 'V1', 'accept', { by: 'owner', channel: 'smoke' }), /channel must be/);
  divergenceDecide(d, id, 'all', 'accept', { by: 'owner' }); assert.throws(() => divergenceDecide(d, id, 'all', 'accept', { by: 'owner' }), /no departure is waiting for a decision/);
  moveSlice(d, id, 'rework'); assert.throws(() => divergenceDecide(d, id, 'V1', 'reject', { by: 'owner' }), /is rework: departures are decided at acceptance, once the slice is delivered/);
});
test('the verifier refuses an accepted slice with a departure that was not accepted', () => {
  const { d, id } = delivered(); divergenceDecide(d, id, 'all', 'accept', { by: 'owner' }); accept(d, id);
  const f = readSlice(d, id).file; fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/(id: V2[\s\S]*?)status: accepted/, '$1status: rejected'));
  assert.ok(verify([path.join(d, 'docs')]).problems.some(p => /accepted with 1 departure\(s\) from the prototype not accepted \(V2 rejected\)/.test(p.message)));
});
test('the CLI: the card, decide one, decide all, and the refusals', () => {
  const { d, id } = delivered(); const run = (...a) => spawnSync(process.execPath, [BIN, 'slice', ...a, '--repo', d], { encoding: 'utf8' });
  assert.match(run('accept-card', id).stdout, /Where the build departs from your prototype/);
  assert.equal(run('divergence', 'decide', id, 'V1', 'accept').status, 1); const one = run('divergence', 'decide', id, 'V1', 'accept', '--by', 'owner'); assert.equal(one.status, 0, one.stderr); assert.match(one.stdout, new RegExp(`V1 accepted for ${id}`));
  assert.equal(run('move', id, 'accepted', '--by', 'owner').status, 1); assert.match(run('move', id, 'accepted', '--by', 'owner').stderr, /1 departure\(s\) from the prototype are not decided yet: V2/);
  assert.match(run('divergence', 'decide', id, 'all', 'accept', '--by', 'owner', '--channel', 'chat').stdout, /V2 accepted/); assert.equal(run('move', id, 'accepted', '--by', 'owner').status, 0);
});
// A change in pieces (R83): the departures of its pieces are on the change's card, and accepting the change waits for every one of them.
test('the departures of the pieces are on the change\'s card and stop its acceptance until decided; a rejected one stops it too', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-')); fs.mkdirSync(path.join(d, 'docs/inputs/prototype'), { recursive: true }); fs.writeFileSync(path.join(d, 'docs/inputs/prototype/index.html'), HTML);
  fs.writeFileSync(path.join(d, MANIFEST), confirmManifest(draftManifest(readPrototype([{ name: 'index.html', html: HTML }]), { date: '2026-11-01' }), { all: true, date: '2026-11-01' }).text);
  const ch = startSlice({ repo: d, title: 'Reading list', request: 'r', criteria: ['Works'], excludes: ['Sharing'] });
  const p = startSlice({ repo: d, title: 'List books', request: 'r', criteria: ['Works'], excludes: ['Nothing beyond the criteria above'], inChange: ch.id }).id; screensAdd(d, p, ['list', 'add']);
  for (const to of ['ready', 'building']) moveSlice(d, p, to); divergenceAdd(d, p, V1); divergenceAdd(d, p, V2); moveSlice(d, p, 'delivered'); moveSlice(d, ch.id, 'delivered');
  const card = acceptCard(d, ch.id);
  assert.match(card, /Where the build departs from your prototype \(2 to decide, 0 rejected\):\n  V1 of List books \[list-books\]  improvement on screen list \[declared\]/);
  assert.throws(() => accept(d, ch.id), /2 departure\(s\) from the prototype are not decided yet: V1 on list \(List books \[list-books\]\), V2 on add \(List books \[list-books\]\)\. .*divergence decide <piece> <V id>/);
  assert.match(boardText(loadBoard(d, '2026-11-03T12:00:00Z')), /look at: List books \[list-books\], a piece of Reading list: no checkpoint evidence was kept for it; 2 departures from the prototype to decide/);
  divergenceDecide(d, p, 'V1', 'accept', { by: 'owner' }); divergenceDecide(d, p, 'V2', 'reject', { by: 'owner' });
  assert.doesNotMatch(acceptCard(d, ch.id), /V1 of List books \[list-books\]/); assert.match(acceptCard(d, ch.id), /\(0 to decide, 1 rejected\)/);   // only the exceptions: an accepted one is not
  assert.throws(() => accept(d, ch.id), /1 departure\(s\) from the prototype were rejected: V2 on add \(List books \[list-books\]\)\. Send the piece back to rework/);
  assert.equal(readSlice(d, p).data.status, 'delivered'); assert.deepEqual(canon(d), []);
});
// A piece starts with its change's screens and drops those it does not build; made ready with none while its change covers some, it is
// told so and not refused (R156). A piece of a change without screens starts with none and is told nothing.
test('a piece starts with its change\'s screens; made ready with none while its change covers some, it is warned, not refused', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-')); fs.mkdirSync(path.join(d, 'docs/inputs/prototype'), { recursive: true }); fs.writeFileSync(path.join(d, 'docs/inputs/prototype/index.html'), HTML);
  fs.writeFileSync(path.join(d, MANIFEST), confirmManifest(draftManifest(readPrototype([{ name: 'index.html', html: HTML }]), { date: '2026-11-01' }), { all: true, date: '2026-11-01' }).text);
  const goal = { request: 'r', criteria: ['Works'], excludes: ['Nothing beyond the criteria above'] };
  const ch = startSlice({ repo: d, title: 'Reading list', ...goal }); screensAdd(d, ch.id, ['list', 'add']);
  const a = startSlice({ repo: d, title: 'List books', inChange: ch.id, ...goal });
  assert.deepEqual(a.data.screens, ['list', 'add']); assert.deepEqual(readSlice(d, a.id).data.screens, ['list', 'add']);   // a copy, on the record
  screensRemove(d, a.id, ['add']); assert.deepEqual(readSlice(d, a.id).data.screens, ['list']); assert.deepEqual(readSlice(d, ch.id).data.screens, ['list', 'add']);   // the change keeps its own
  assert.equal(moveSlice(d, a.id, 'ready').no_screens, undefined);                                    // it covers one: nothing to say
  const b = startSlice({ repo: d, title: 'Store books', inChange: ch.id, ...goal }); screensRemove(d, b.id, ['list', 'add']);
  const r = moveSlice(d, b.id, 'ready'); assert.equal(r.data.status, 'ready');
  assert.deepEqual(r.no_screens, { change: ch.id, screens: ['list', 'add'], message: `its change covers screens list, add; this piece covers none: add the ones it builds with buddy slice screens add ${b.id} <screen>` });
  const c = startSlice({ repo: d, title: 'Remove books', inChange: ch.id, ...goal }); screensRemove(d, c.id, ['list', 'add']);
  const run = spawnSync(process.execPath, [BIN, 'move', c.id, 'ready'], { cwd: d, encoding: 'utf8' });   // the CLI prints it as a warning
  assert.equal(run.status, 0, run.stderr); assert.match(run.stdout + run.stderr, /warning: its change covers screens list, add; this piece covers none: add the ones it builds with buddy slice screens add remove-books <screen>/);
  const plain = startSlice({ repo: d, title: 'Loose fix', ...goal }); const q = startSlice({ repo: d, title: 'Its piece', inChange: plain.id, ...goal });
  assert.equal(q.data.screens, undefined); assert.equal(moveSlice(d, q.id, 'ready').no_screens, undefined);
  const added = spawnSync(process.execPath, [BIN, 'slice', 'start', 'Edit books', '--request', 'r', '--in', ch.id], { cwd: d, encoding: 'utf8' });
  assert.equal(added.status, 0, added.stderr); assert.match(added.stdout, /covers its change's screens: list, add \(drop the ones it does not build with buddy slice screens remove edit-books <screen>\)/);
  assert.deepEqual(canon(d), []);
});
