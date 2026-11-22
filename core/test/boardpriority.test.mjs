import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { startSlice, moveSlice } from '../src/slicestore.mjs';
import { addRequest, setRequest, setPriority, dependRequest, undependRequest, mapChanges, mapChangesText, orderWarningsText } from '../src/requests.mjs';
import { loadBoard, boardText, boardHtml } from '../src/board.mjs';
import { digest, digestText } from '../src/digest.mjs';

// Each change's priority and what it waits for on the board, the warnings of the order in what waits for the owner, and the digest's line
// when a priority or a dependency changed since the last look (R133).
const NOW = '2026-11-02T18:00:00Z';
let tick = 0; const now = () => new Date(Date.UTC(2026, 10, 2, 8, 0, tick++));
const goal = { criteria: ['Works'], excludes: ['Nothing beyond the criteria above'] };
const G = (d, args, date) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd: d, encoding: 'utf8', stdio: 'pipe', env: { ...process.env, ...(date ? { GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date } : {}) } });
const accept = (d, id) => { for (const to of ['ready', 'building', 'delivered']) moveSlice(d, id, to, { now }); moveSlice(d, id, 'accepted', { by: 'owner', now }); };
function project() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-')); fs.mkdirSync(path.join(d, 'docs')); G(d, ['init', '-q', '-b', 'main']);
  const old = startSlice({ repo: d, title: 'Old idea', request: 'r', ...goal, now }); moveSlice(d, old.id, 'abandoned', { now });
  const a = startSlice({ repo: d, title: 'Sign in', request: 'r', ...goal, now });
  const b = startSlice({ repo: d, title: 'Save books', request: 'r', ...goal, now });
  const s = startSlice({ repo: d, title: 'Storage', request: 'r', ...goal, inChange: b.id, now });
  const c = startSlice({ repo: d, title: 'Export the list', request: 'r', ...goal, dependsOn: [old.id], now });
  const e = startSlice({ repo: d, title: 'Nothing asked', request: 'r', ...goal, now });
  for (const t of ['Sign in with email', 'Save a book', 'Keep a list', 'Share the list', 'Print it']) addRequest(d, t, 'prd', { now });
  setPriority(d, 'RQ1', 'must', { now }); setPriority(d, 'RQ2', 'should', { now }); setPriority(d, 'RQ3', 'could', { now }); setPriority(d, 'RQ4', 'could', { now });
  setRequest(d, 'RQ1', { to: a.id }, { now }); setRequest(d, 'RQ2', { to: s.id }, { now }); setRequest(d, 'RQ3', { to: b.id }, { now }); setRequest(d, 'RQ4', { to: c.id }, { now });
  setRequest(d, 'RQ5', { excluded: 'not now' }, { now });
  dependRequest(d, 'RQ2', ['RQ1'], { now }); dependRequest(d, 'RQ4', ['RQ5'], { now });
  return { d, old, a, b, s, c, e };
}

test('each change shows the highest priority of the requests it or its slices cover, before its title; one covering none shows none', () => {
  const { d, a, b, s, c, e } = project(); const board = loadBoard(d, NOW); const row = id => board.slices.find(r => r.id === id);
  assert.deepEqual([a, b, s, c, e].map(x => row(x.id).priority), ['must', 'should', 'should', 'could', null]);   // b: Should from its slice beats its own Could
  const text = boardText(board);
  assert.match(text, new RegExp(`${a.id}  feat     \\[Must\\] Sign in  · `)); assert.match(text, new RegExp(`${b.id}  feat     \\[Should\\] Save books  `));
  assert.match(text, new RegExp(`${e.id}  feat     Nothing asked  · `));
  const html = boardHtml(board); assert.match(html, /<b>\[Must\] Sign in<\/b>/); assert.match(html, /<b>Nothing asked<\/b>/);
  accept(d, a.id); assert.match(boardText(loadBoard(d, NOW)), new RegExp(`${a.id}  \\[Must\\] Sign in  · accepted`));
});

test('a change says what it waits for: a change covering what its requests depend on, or one it depends on directly, not yet delivered', () => {
  const { d, old, a, b, s, c } = project(); let board = loadBoard(d, NOW); const row = id => board.slices.find(r => r.id === id);
  assert.deepEqual(row(b.id).waits_for, [{ id: a.id, title: 'Sign in', status: 'refining' }]);                  // through its slice's request
  assert.deepEqual(row(s.id).waits_for.map(x => x.id), [a.id]); assert.deepEqual(row(a.id).waits_for, []);
  assert.deepEqual(row(c.id).waits_for, []); assert.deepEqual(row(c.id).abandoned_deps.map(x => x.id), [old.id]);   // abandoned counts as finished, and is said
  const text = boardText(board);
  assert.match(text, new RegExp(`\\[Should\\] Save books  waits for: Sign in \\[${a.id}\\]  · `));
  assert.match(text, new RegExp(`\\[Could\\] Export the list  its dependency Old idea \\[${old.id}\\] was abandoned  · `));
  assert.match(boardHtml(board), new RegExp(`waits for: Sign in \\[${a.id}\\]`));
  const direct = startSlice({ repo: d, title: 'Report', request: 'r', ...goal, dependsOn: [b.id], now });
  board = loadBoard(d, NOW); assert.deepEqual(row(direct.id).waits_for.map(x => x.id), [b.id]);
  for (const to of ['ready', 'building']) moveSlice(d, a.id, to, { now }); board = loadBoard(d, NOW); assert.deepEqual(row(b.id).waits_for.map(x => x.id), [a.id]);   // building: still waited for
  moveSlice(d, a.id, 'delivered', { now }); board = loadBoard(d, NOW); assert.deepEqual(row(b.id).waits_for, []); assert.doesNotMatch(boardText(board), /waits for: Sign in/);   // delivered: no longer (R144, R115)
  accept(d, direct.id); board = loadBoard(d, NOW); assert.deepEqual(row(direct.id).waits_for, []);                // an accepted change waits for nothing
});

test('the warnings of the order wait for the owner in one line: the count, the first three by their text, and where to see them', () => {
  const { d } = project(); let board = loadBoard(d, NOW); let w = board.waiting.filter(x => x.kind === 'order');
  assert.deepEqual(w.map(x => x.text), ['1 warning in the order of what you asked for: Share the list [RQ4] depends on Print it [RQ5], which is excluded: not now (buddy requests order)']);
  for (const t of ['Tag a book', 'Colour the tags', 'Loop one', 'Loop two']) addRequest(d, t, 'prd', { now });
  setPriority(d, 'RQ6', 'must', { now }); setPriority(d, 'RQ7', 'could', { now }); dependRequest(d, 'RQ6', ['RQ7'], { now });
  dependRequest(d, 'RQ8', ['RQ9'], { now }); dependRequest(d, 'RQ9', ['RQ8'], { now }); setPriority(d, 'RQ3', 'must', { now }); dependRequest(d, 'RQ3', ['RQ7'], { now });
  board = loadBoard(d, NOW); w = board.waiting.filter(x => x.kind === 'order'); assert.equal(w.length, 1);
  assert.match(w[0].text, /^4 warnings in the order of what you asked for: .*\| and 1 more \(buddy requests order\)$/); assert.equal(w[0].text.split(' | ').length, 4);
  assert.match(boardText(board), /Waiting for you[\s\S]*- 4 warnings in the order/);
  assert.equal(orderWarningsText([], []), null);
});

test('mapChanges: priorities by id, dependencies added or removed; the origin is not a change', () => {
  const before = [{ id: 'RQ1', priority: 'must', depends_on: [{ id: 'RQ2', origin: 'assumed' }] }, { id: 'RQ2' }];
  assert.deepEqual(mapChanges(before, [{ id: 'RQ1', priority: 'must', priority_origin: 'human', depends_on: [{ id: 'RQ2', origin: 'human' }] }, { id: 'RQ2' }]), { priorities: 0, dependencies: 0 });
  assert.deepEqual(mapChanges(before, [{ id: 'RQ1', priority: 'should' }, { id: 'RQ2', depends_on: [{ id: 'RQ1' }] }, { id: 'RQ3', priority: 'could' }]), { priorities: 2, dependencies: 2 });
  assert.equal(mapChangesText({ priorities: 2, dependencies: 1 }), 'Since you last looked: 2 priorities and 1 dependency changed (buddy requests list)');
  assert.equal(mapChangesText({ priorities: 0, dependencies: 3 }), 'Since you last looked: 3 dependencies changed (buddy requests list)'); assert.equal(mapChangesText({ priorities: 0, dependencies: 0 }), null);
});

test('the digest says in one line what changed in the priorities and dependencies since the last look, from the history of the map', () => {
  const { d } = project(); G(d, ['add', 'docs']); G(d, ['commit', '-qm', 'map'], '2026-11-02T10:00:00Z');
  assert.equal(digest(d, NOW, { since: '2026-11-02T11:00:00Z' }).requests_changed, null);                               // nothing changed
  setPriority(d, 'RQ3', 'must', { now }); undependRequest(d, 'RQ2', ['RQ1'], { now }); dependRequest(d, 'RQ3', ['RQ1'], { now });
  const x = digest(d, NOW, { since: '2026-11-02T11:00:00Z' }); assert.deepEqual(x.requests_changed, { priorities: 1, dependencies: 2 });
  assert.match(digestText(x), /\nSince you last looked: 1 priority and 2 dependencies changed \(buddy requests list\)\n/);
  assert.equal(digest(d, NOW, { since: '2026-11-02T09:00:00Z' }).requests_changed, null);                               // no history of the map then: nothing said
  const first = digest(d, NOW); assert.equal(first.requests_changed, null); assert.doesNotMatch(digestText(first), /Since you last looked/);   // no last look
});

test('a change depending on a delivered (not accepted) change waits for nothing on the board, its page and the digest: all read the index (R144)', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-')); fs.mkdirSync(path.join(d, 'docs')); G(d, ['init', '-q', '-b', 'main']);
  const a = startSlice({ repo: d, title: 'Sign in', request: 'r', ...goal, now }); const b = startSlice({ repo: d, title: 'Save books', request: 'r', ...goal, dependsOn: [a.id], now });
  for (const to of ['ready', 'building']) moveSlice(d, a.id, to, { now });
  const shows = () => { const board = loadBoard(d, NOW); return [boardText(board), boardHtml(board), digestText(digest(d, NOW))].map(t => t.includes(`waits for: Sign in [${a.id}]`) || t.includes(`waits for Sign in [${a.id}]`)); };
  assert.deepEqual(shows(), [true, true, true]);                     // being built: waited for everywhere (the digest says it in Next)
  moveSlice(d, a.id, 'delivered', { now });
  assert.deepEqual(shows(), [false, false, false]);                  // delivered, not accepted: no longer
  const board = loadBoard(d, NOW); assert.deepEqual(board.slices.find(r => r.id === b.id).waits_for, []); assert.equal(board.next.id, b.id); assert.deepEqual(board.next.waits_for, []);
});
