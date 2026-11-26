import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startSlice, startMilestone, moveSlice } from '../src/slicestore.mjs';
import { loadBoard, boardText, groupWaiting } from '../src/board.mjs';
import { digest, digestText } from '../src/digest.mjs';

const NOW = '2026-11-07T12:00:00Z';
function project() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-')); fs.mkdirSync(path.join(d, 'docs')); let min = 0;
  const now = () => new Date(Date.UTC(2026, 10, 3, 8, min++, 30));
  const m = startMilestone({ repo: d, title: 'First release', request: 'g', name: 'first', criteria: ['Works'], excludes: ['Nothing beyond the criteria above'], now });
  for (const to of ['ready', 'building']) moveSlice(d, m.id, to, { now });
  const make = (title, milestone) => {
    const s = startSlice({ repo: d, title, request: 'r', criteria: ['Works'], excludes: ['Nothing beyond the criteria above'], milestone, now });
    for (const to of ['ready', 'building', 'delivered']) moveSlice(d, s.id, to, { now }); return s;
  };
  return { d, m, make };
}

test('several delivered changes of one milestone are one line with how many wait, since when and how to answer', () => {
  const { d, m, make } = project(); make('Save books', m.id); make('Remove a book', m.id); make('Export the list', m.id);
  const b = loadBoard(d, NOW); assert.equal(b.waiting.length, 3, 'the items are all kept');
  const text = boardText(b);
  assert.match(text, /Waiting for you \(1\)\n  - First release \[first\]: 3 changes wait for your acceptance \(see each and answer: buddy milestone review first\)  · 4 d/);
  assert.doesNotMatch(text, /try and accept: Save books/);
  assert.match(digestText(digest(d, NOW)), /Waiting for you \(1\)\n  - First release \[first\]: 3 changes wait/);
});

test('one change waiting is not grouped, and a change outside any milestone forms its own group', () => {
  const { d, m, make } = project(); make('Save books', m.id); make('Quick idea one'); make('Quick idea two');
  const text = boardText(loadBoard(d, NOW));
  assert.match(text, /Waiting for you \(2\)/);
  assert.match(text, /- try and accept: Save books \[[^\]]+\]/);
  assert.match(text, /- Outside any milestone: 2 changes wait for your acceptance \(see them: buddy slice list, then buddy slice accept-card <change>\)/);
});

test('a change that needs a decision stays named on its own under its milestone, and the other kinds keep their own lines', () => {
  const rows = [{ id: 'a', milestone: 'm' }, { id: 'b', milestone: 'm' }, { id: 'c', milestone: 'm' }, { id: 'p', milestone: 'm', change: 'c' }];
  const ms = [{ id: 'm', title: 'Release' }];
  const waiting = [
    { kind: 'accept', ref: 'a', text: 'try and accept: A [a]', since: '2026-11-05T00:00:00Z' },
    { kind: 'accept', ref: 'b', text: 'try and accept: B [b] (2 departures from the prototype to decide; the reviews left 3 notes)', since: '2026-11-04T00:00:00Z' },
    { kind: 'accept', ref: 'c', text: 'try and accept: C [c]', since: '2026-11-03T00:00:00Z' },
    { kind: 'accept', ref: 'p', text: 'decide: C [c]: the work stopped after several reviews and needs your decision', since: '2026-11-06T00:00:00Z' },
    { kind: 'answer', ref: 'q1', text: 'answer: Which format? [q1]', since: null },
    { kind: 'proposed', ref: null, text: '3 priorities Buddy proposed', since: null }];
  const view = groupWaiting(waiting, rows, ms);
  assert.deepEqual(view.map(v => v.kind), ['accept', 'answer', 'proposed']);
  assert.equal(view[0].text, 'Release [m]: 2 changes wait for your acceptance (see each and answer: buddy milestone review m)');
  assert.equal(view[0].since, '2026-11-03T00:00:00Z', 'the oldest wait of the clean ones');
  assert.deepEqual(view[0].under.map(u => u.ref), ['b', 'p'], 'the ones needing a decision are named under the group');
});
