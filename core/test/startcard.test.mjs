import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startMilestone, startSlice, moveSlice, assumeAdd, assumeNone, assumeSet, readSlice } from '../src/slicestore.mjs';
import { createBatch, writeBatchFile } from '../src/queue.mjs';
import { milestoneCard } from '../src/startcard.mjs';
import { verify } from '../src/verify.mjs';

const BUDDY = fileURLToPath(new URL('../bin/buddy.mjs', import.meta.url));
function project() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-')); execFileSync('git', ['init', '-q'], { cwd: d }); fs.mkdirSync(path.join(d, 'docs/buddy/backlog'), { recursive: true });
  const m = startMilestone({ repo: d, title: 'First release', request: 'Readers keep a list of books', criteria: ['A reader saves a book'], excludes: ['Sharing lists'] });
  const a = startSlice({ repo: d, title: 'Save books', request: 'Save a book', milestone: m.id, criteria: ['It is saved'], excludes: ['Nothing else'] });
  const b = startSlice({ repo: d, title: 'Sort books', request: 'Sort the list', milestone: m.id, criteria: ['Sorted by title', 'Sorted by date'], excludes: ['Nothing else'], dependsOn: [a.id] });
  return { d, m, a, b };
}

test('the card says what will be built and in what order, the doubts that wait and the assumptions made, and that nothing starts before the go-ahead', () => {
  const { d, m, a, b } = project();
  assumeAdd(d, a.id, 'A book belongs to one reader', 'sharing books needs a new data model'); assumeSet(d, a.id, 'A1', 'confirmed', { by: 'owner' });
  assumeAdd(d, b.id, 'Titles are compared without accents', 'accents sort apart');
  const batch = createBatch({ slice: b.id, questions: [{ situation: 'Is the list sorted newest first?', blocking: true, options: [{ label: 'Newest first', cost: 'none' }, { label: 'Oldest first', cost: 'none' }] }, { situation: 'How many books fit in a page?', options: [{ id: 'o1', label: '20', cost: 'none' }, { label: '50', cost: 'none' }], recommended: 'o1' }] }, { date: '2026-11-05' });
  writeBatchFile(path.join(d, 'docs', 'questions.md'), batch);
  const card = milestoneCard(d, m.id);
  assert.match(card, /^START  First release \[.*\]  ·  waits for your go-ahead/); assert.match(card, /You asked for:\n  Readers keep a list of books/);
  assert.match(card, /It is done when:\n  AC1  A reader saves a book/); assert.match(card, /It does not include:\n  X1  Sharing lists/);
  assert.match(card, /What I will build, in this order \(2 changes\):\n  1\. Save books \[.*\]  ·  feat · 1 criteria · still being refined\n  2\. Sort books \[.*\]  ·  feat · 2 criteria · waits for Save books · still being refined/);
  assert.match(card, /Doubts I need you to resolve \(2, 1 stop the work\):\n  - Sort books \[.*\]: Is the list sorted newest first\?  \(nothing of it is built until you answer\)\n  - Sort books \[.*\]: How many books fit in a page\?  \(I go on with 20 unless you say otherwise\)/);
  assert.match(card, /What I assumed, and will build on unless you correct it \(2\):\n  - Save books: A book belongs to one reader  \(if it is not so: sharing books needs a new data model\)  \[you confirmed it\]\n  - Sort books: Titles are compared without accents  \(if it is not so: accents sort apart\)/);
  assert.match(card, /Answer the doubts that stop the work, say what you correct, and then give the go-ahead\./);
  assert.doesNotMatch(card, /\b[RQ]\d{1,3}\b/);
});
test('with no doubt and no assumption it says so, asks only for the go-ahead, and a building milestone says it is already building', () => {
  const { d, m, a, b } = project(); assumeNone(d, a.id); assumeNone(d, b.id);
  const card = milestoneCard(d, m.id); assert.match(card, /Doubts: none open\./); assert.match(card, /\nStudied, nothing to assume: Save books, Sort books\.\n/); assert.doesNotMatch(card, /Not studied yet|none announced/); assert.match(card, /Say "yes" to start, or answer a doubt or correct an assumption first\. Nothing is built until you do\./);
  moveSlice(d, m.id, 'ready'); moveSlice(d, m.id, 'building');
  assert.match(milestoneCard(d, m.id), /^START  .*already building/); assert.match(milestoneCard(d, m.id), /Already building: this is what is being built\./);
  assert.throws(() => milestoneCard(d, 'ghost'), /there is no milestone ghost; they are: /);
});
test('the command prints it, and the refusal to start a change in a milestone that waits points to it', () => {
  const { d, m, a } = project();
  const out = spawnSync(process.execPath, [BUDDY, 'milestone', 'card', m.id], { cwd: d, encoding: 'utf8' }); assert.equal(out.status, 0, out.stderr); assert.match(out.stdout, /waits for your go-ahead/);
  moveSlice(d, a.id, 'ready');
  assert.throws(() => moveSlice(d, a.id, 'building'), new RegExp(`buddy move ${m.id} building\\)\\. Present it first: buddy milestone card ${m.id}`));
});
test('a change not studied yet is named as such, apart from one studied with nothing to assume; a delivered, accepted or abandoned one never is', () => {
  const { d, m, a, b } = project();
  let card = milestoneCard(d, m.id);
  assert.doesNotMatch(card, /none announced/); assert.ok(card.includes(`\nNot studied yet, so their assumptions are still to come (2): Save books [${a.id}], Sort books [${b.id}].\n`), card);
  assumeNone(d, a.id); assert.deepEqual(readSlice(d, a.id).data.assumptions, []); assert.deepEqual(verify([path.join(d, 'docs')]).problems, []);
  card = milestoneCard(d, m.id); assert.match(card, /\nStudied, nothing to assume: Save books\.\nNot studied yet, so their assumptions are still to come \(1\): Sort books \[/);
  assumeNone(d, a.id);   // marking it again changes nothing
  assumeAdd(d, a.id, 'A book belongs to one reader', 'sharing needs a new model');   // an assumption announced later takes the mark's place
  card = milestoneCard(d, m.id); assert.match(card, /What I assumed, and will build on unless you correct it \(1\):\n  - Save books: A book belongs to one reader/); assert.doesNotMatch(card, /Studied, nothing to assume/);
  assert.throws(() => assumeNone(d, a.id), /already has assumptions, so it cannot be marked as needing none: A1 \(A book belongs to one reader\)/);
  for (const st of ['delivered', 'accepted']) {
    const f = readSlice(d, b.id).file; fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/^status: \w+$/m, `status: ${st}`));
    assert.doesNotMatch(milestoneCard(d, m.id), /Not studied yet/, st);
  }
  moveSlice(d, a.id, 'abandoned'); assert.doesNotMatch(milestoneCard(d, m.id), /Not studied yet|Save books/);
});
test('the CLI marks a change as needing no assumption, and refuses it in plain words when it has some', () => {
  const { d, a, b } = project(); assumeAdd(d, b.id, 'Titles sort without accents', 'accents sort apart');
  const run = (...args) => spawnSync(process.execPath, [BUDDY, 'slice', 'assume', ...args], { cwd: d, encoding: 'utf8' });
  const ok = run(a.id, 'none'); assert.equal(ok.status, 0, ok.stderr); assert.match(ok.stdout, /is studied and needs no assumption/); assert.deepEqual(readSlice(d, a.id).data.assumptions, []);
  const no = run(b.id, 'none'); assert.notEqual(no.status, 0); assert.match(no.stderr, /already has assumptions, so it cannot be marked as needing none: A1 \(Titles sort without accents\)/);
  assert.equal(readSlice(d, b.id).data.assumptions.length, 1);
});
test("Buddy's instructions: before presenting a milestone's card, study every change and announce its assumptions or mark it none, so the owner confirms them all at once", () => {
  const md = fs.readFileSync(fileURLToPath(new URL('../agents/buddy.md', import.meta.url)), 'utf8');
  assert.match(md, /Before presenting it, study every change of it and announce its assumptions .*or mark one that needs none \(`buddy slice assume <name> none`\), so the owner confirms them all at once; the card names each change not studied yet\. Then present that milestone with `buddy milestone card <milestone>`/);
});
