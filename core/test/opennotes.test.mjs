import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startSlice, moveSlice, readSlice, howtoSet, acceptCard } from '../src/slicestore.mjs';
import { loadBoard } from '../src/board.mjs';

// RQ7 (R250): beside a change that waits and in its summary to accept, only the notes still open count: those of each piece's latest checkpoint, less what was settled after it.
function setup() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'on-')); fs.mkdirSync(path.join(d, 'docs')); let min = 0; const now = () => new Date(Date.UTC(2026, 9, 31, 8, min++, 30));
  const ch = startSlice({ repo: d, title: 'Reading list', request: 'r', now });
  const piece = t => startSlice({ repo: d, title: t, request: 'r', criteria: ['Works'], excludes: ['Nothing beyond the criteria above'], inChange: ch.id, now }).id;
  const ev = (slice, when, reasons) => { const dir = path.join(path.dirname(readSlice(d, ch.id).file), 'evidence'); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, `evidence-${when.replace(/[-:]/g, '').slice(0, 15)}Z-${slice}.json`), JSON.stringify({ when, slice, reasons })); };
  const deliver = id => { for (const to of ['ready', 'building', 'delivered']) moveSlice(d, id, to, { now }); };
  const waiting = () => loadBoard(d, '2026-10-31T18:00:00Z').waiting.filter(w => w.kind === 'accept').map(w => w.text);
  return { d, ch, piece, ev, deliver, waiting, now, card: () => acceptCard(d, ch.id) };
}
const NOTE = 'independent reviewer: a way to try a criterion would not prove it (AC1: the steps do not say which data)';

test('three rounds whose last is clean add no note; a last round that still has a note adds it once, on the board and in the summary to accept', () => {
  const t = setup(); const a = t.piece('Save books'), b = t.piece('Remove a book');
  for (const w of ['2026-10-31T09:00:00Z', '2026-10-31T10:00:00Z']) { t.ev(a, w, ['validate failed', 'no tests added']); t.ev(b, w, ['validate failed']); }
  t.ev(a, '2026-10-31T11:00:00Z', []); t.ev(b, '2026-10-31T11:00:00Z', ['no tests added']);
  t.deliver(a); t.deliver(b);
  assert.deepEqual(t.waiting(), [`try and accept: Reading list [${t.ch.id}] (the reviews left 1 note)`]);
  const card = t.card(); assert.match(card, /Exceptions the checks found \(1 piece\(s\)\):\n  Remove a book \[[^\]]+\]: no tests added\n/);
  assert.doesNotMatch(card, /validate failed|Save books \[[^\]]+\]:/);
});

test('what was settled after the checkpoint is not open: the stop line of a delivered piece, a way to try written since, a way to try rewritten after it', () => {
  const t = setup(); const a = t.piece('Save books');
  t.ev(a, '2026-10-31T09:00:00Z', ['no way to try AC1 is written: Dev writes how to try each criterion', NOTE, 'round 4 with findings still open: do not try again by yourself; hand the matter to the owner', 'validate failed']);
  for (const to of ['ready', 'building']) moveSlice(t.d, a, to, { now: t.now });
  howtoSet(t.d, a, 'AC1', { steps: 'do it', expect: 'see it', now: () => new Date('2026-10-31T08:00:00Z') });   // written, but before the checkpoint: the reviewer's note stays
  moveSlice(t.d, a, 'delivered', { now: t.now });
  assert.deepEqual(t.waiting(), [`try and accept: Reading list [${t.ch.id}] (the reviews left 2 notes)`]);
  assert.match(t.card(), /: independent reviewer: a way to try a criterion would not prove it \(AC1: the steps do not say which data\); validate failed\n/);
  howtoSet(t.d, a, 'AC1', { steps: 'do it with these data', expect: 'see it', now: () => new Date('2026-10-31T10:00:00Z') });   // rewritten after the checkpoint: settled
  assert.deepEqual(t.waiting(), [`try and accept: Reading list [${t.ch.id}] (the reviews left 1 note)`]);
  assert.match(t.card(), /Exceptions the checks found \(1 piece\(s\)\):\n  Save books \[[^\]]+\]: validate failed\n/);
});

test('a delivered piece with no checkpoint keeps its one note: nothing says it passed', () => {
  const t = setup(); const a = t.piece('Save books'); t.deliver(a);
  assert.deepEqual(t.waiting(), [`try and accept: Reading list [${t.ch.id}] (the reviews left 1 note)`]);
  assert.match(t.card(), /no checkpoint evidence was kept for it/);
});
