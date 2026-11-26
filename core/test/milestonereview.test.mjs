import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startMilestone, startSlice, moveSlice, stepAddTo, stepSetIn, readSlice, howtoSet, howtoRemove } from '../src/slicestore.mjs';
import { checkpoint, reviewerPrompt, reviewInputs } from '../src/checkpoint.mjs';
import { milestoneReview } from '../src/review.mjs';
import { verify } from '../src/verify.mjs';

const BUDDY = fileURLToPath(new URL('../bin/buddy.mjs', import.meta.url));
const G = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf8', stdio: 'pipe' });
const clean = () => ({ does_what_was_asked: true, weakens_or_hides_checks: false, unspecified_decisions: [], details: 'fine' });
function repo() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-')); G(d, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: 'x', scripts: { validate: 'node -e "0"' } })); fs.mkdirSync(path.join(d, 'docs')); fs.writeFileSync(path.join(d, 'README.md'), 'x\n'); G(d, 'add', '-A'); G(d, 'commit', '-qm', 'base');
  return d;
}
const change = (d, title, extra = {}) => startSlice({ repo: d, title, request: `${title}, as the reader asked`, criteria: ['It works', 'It is easy'], excludes: ['Nothing beyond the criteria above'], ...extra });
const building = (d, id) => { stepAddTo(d, id, 'Do it'); moveSlice(d, id, 'ready'); moveSlice(d, id, 'building'); stepSetIn(d, id, '1', true); };

test('how to try a criterion: two parts, one per criterion of the change, while it is being built; the record stays canonical', () => {
  const d = repo(); const c = change(d, 'Save books'); building(d, c.id);
  const r = howtoSet(d, c.id, 'ac1', { steps: 'Open the list and press Add', expect: 'The book is in the list' }); assert.equal(r.criterion, 'AC1');
  howtoSet(d, c.id, 'AC1', { steps: 'Open the list, press Add and type a title', expect: 'The book is in the list' });          // setting it again replaces it
  const [h, ...more] = readSlice(d, c.id).data.howto; assert.equal(more.length, 0); assert.match(h.at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);   // when it was written (count-only-open-review-notes)
  assert.deepEqual({ ...h, at: undefined }, { criterion: 'AC1', steps: 'Open the list, press Add and type a title', expect: 'The book is in the list', at: undefined });
  assert.throws(() => howtoSet(d, c.id, 'AC9', { steps: 'x', expect: 'y' }), /AC9 is not a criterion of .*; there are: AC1, AC2/);
  assert.throws(() => howtoSet(d, c.id, 'AC2', { steps: '', expect: 'y' }), /what to do \(--steps\) is missing/); assert.throws(() => howtoSet(d, c.id, 'AC2', { steps: 'a', expect: 'b\nc' }), /one paragraph/);
  assert.deepEqual(verify([path.join(d, 'docs/buddy')], { canonical: true }).problems ?? [], []);
  assert.throws(() => howtoRemove(d, c.id, 'AC2'), /has no way to try it written; there is one for: AC1/); howtoRemove(d, c.id, 'AC1'); assert.equal(readSlice(d, c.id).data.howto, undefined);
  const e = change(d, 'Not started'); assert.throws(() => howtoSet(d, e.id, 'AC1', { steps: 'a', expect: 'b' }), /is refining: how to try a criterion is written while the slice is being built or once it is delivered/);
  moveSlice(d, c.id, 'delivered'); howtoSet(d, c.id, 'AC2', { steps: 'Look at the list', expect: 'It is easy to read' });   // Buddy writes the ones a delivered change lacks
  assert.equal(readSlice(d, c.id).data.howto.length, 1); assert.equal(readSlice(d, c.id).data.howto[0].criterion, 'AC2'); moveSlice(d, c.id, 'accepted', { by: 'owner' }); assert.throws(() => howtoSet(d, c.id, 'AC1', { steps: 'a', expect: 'b' }), /is accepted/);
});
test('a change opened from the day of the rule with a criterion nobody says how to try does not come out clean; the old ones are not asked', () => {
  const d = repo(); const c = change(d, 'Save books'); building(d, c.id); fs.writeFileSync(path.join(d, 'a.js'), 'export const a = 1;\n'); fs.writeFileSync(path.join(d, 'a.test.js'), "import assert from 'node:assert';\nassert.equal(1, 1);\n");
  howtoSet(d, c.id, 'AC1', { steps: 'Open the list', expect: 'It lists books' });
  const r = checkpoint({ repo: d, slice: c.id, review: clean, human: true });
  assert.equal(r.decision, 'NEEDS_HUMAN'); assert.match(r.evidence.reasons.join('|'), /no way to try AC2 is written: Dev writes how to try each criterion with buddy slice try set save-books <criterion> --steps "<what to do>" --expect "<what to see>"/); assert.doesNotMatch(r.evidence.reasons.join('|'), /AC1 is/);
  moveSlice(d, c.id, 'rework'); moveSlice(d, c.id, 'building'); howtoSet(d, c.id, 'AC2', { steps: 'Look at the list', expect: 'It is easy to read' });
  assert.equal(checkpoint({ repo: d, slice: c.id, review: clean, human: true, id: 'again' }).decision, 'APPROVE');
  const old = repo(); const o = change(old, 'Old thing'); const f = fs.readdirSync(path.join(old, 'docs/buddy/backlog'))[0]; const dir = path.join(old, 'docs/buddy/backlog', '2026-11-01-old-thing'); fs.renameSync(path.join(old, 'docs/buddy/backlog', f), dir);
  fs.writeFileSync(path.join(dir, 'change.md'), fs.readFileSync(path.join(dir, 'change.md'), 'utf8').replace(/created: .*/, 'created: 2026-11-01T10:00:00Z')); building(old, o.id); fs.writeFileSync(path.join(old, 'a.js'), 'export const a = 1;\n'); fs.writeFileSync(path.join(old, 'a.test.js'), "import assert from 'node:assert';\nassert.equal(1, 1);\n");
  assert.equal(checkpoint({ repo: old, slice: o.id, review: clean, human: true }).decision, 'APPROVE', 'a change opened before the rule is not asked');
});
test('the reviewer reads how each criterion is tried and may say that doing it would not prove the criterion, which is an exception', () => {
  const d = repo(); const c = change(d, 'Save books'); building(d, c.id); howtoSet(d, c.id, 'AC1', { steps: 'Open the page', expect: 'The page opens' }); howtoSet(d, c.id, 'AC2', { steps: 'Look', expect: 'It looks right' });
  const given = reviewInputs(d, readSlice(d, c.id).data); const p = reviewerPrompt('req', 'diff', { agent: true, given });
  assert.match(p, /How Dev says each criterion is tried[^]*AC1  do: Open the page  ·  see: The page opens/); assert.match(p, /"howto_problems": \["<id>: why doing what it says would not prove the criterion"\]/);
  assert.doesNotMatch(reviewerPrompt('req', 'diff', { agent: true, given: { ...given, howto: [] } }), /howto_problems/);
  fs.writeFileSync(path.join(d, 'a.js'), 'export const a = 1;\n'); fs.writeFileSync(path.join(d, 'a.test.js'), "import assert from 'node:assert';\nassert.equal(1, 1);\n");
  const r = checkpoint({ repo: d, slice: c.id, human: true, review: () => ({ ...clean(), howto_problems: ['AC1: opening the page does not show that a book is saved'] }) });
  assert.equal(r.decision, 'NEEDS_HUMAN'); assert.match(r.evidence.reasons.join('|'), /a way to try a criterion would not prove it \(AC1: opening the page does not show that a book is saved\)/);
});

function milestone() {
  const d = repo(); const m = startMilestone({ repo: d, title: 'First release', request: 'Readers keep a list of books', criteria: ['A reader saves a book'], excludes: ['Sharing lists'] });
  const next = startMilestone({ repo: d, title: 'Second release', request: 'Readers share lists', criteria: ['A reader shares'], excludes: ['Payments'] });
  moveSlice(d, m.id, 'ready'); moveSlice(d, m.id, 'building');
  const a = change(d, 'Save books', { milestone: m.id }); const b = change(d, 'Sort books', { milestone: m.id, dependsOn: [a.id] });
  for (const c of [a, b]) building(d, c.id);
  howtoSet(d, a.id, 'AC1', { steps: 'Open the list and press Add', expect: 'The book is in the list' });
  for (const c of [a, b]) moveSlice(d, c.id, 'delivered');
  return { d, m, next, a, b };
}
test('the script of a milestone: promised and delivered, the order to try, how to try each change, what the checks found, how to answer and what comes next', () => {
  const { d, m, next, a, b } = milestone();
  const t = milestoneReview(d, m.id);
  assert.match(t, /^REVIEW  First release \[first-release\]  ·  every change is delivered/); assert.match(t, /What you asked for:\n  Readers keep a list of books/);
  assert.match(t, /2 of 2 changes delivered or accepted\./); assert.match(t, /The whole test suite has NOT been shown green on the code as it is now \(it has not run on this code\): run buddy suite before you accept\./);
  assert.doesNotMatch(t, /evidence-|\.json/, 'no internal path in what the owner reads');
  assert.match(t, /Order to try them \(2\):\n  1\. Save books \[save-books\]  ·  delivered, waits for you\n  2\. Sort books \[sort-books\]  ·  delivered, waits for you  ·  builds on Save books: try that first/);
  assert.match(t, /1\. Save books \[save-books\]  ·  delivered, waits for you\n   For what: Save books, as the reader asked\n   How to try it:\n     AC1  It works\n          do:  Open the list and press Add\n          see: The book is in the list\n     AC2  It is easy\n          \(nobody wrote how to try it: ask Buddy for it\)/);
  assert.match(t, /Not included: Nothing beyond the criteria above/); assert.match(t, /What the checks found:\n     - no checkpoint on record\./);
  assert.match(t, new RegExp(`Answer: buddy move ${a.id} accepted --by owner   ·   or send it back: buddy move ${a.id} rework   ·   the full card: buddy slice accept-card ${a.id}`));
  assert.match(t, /buddy requests add "<what you noticed>" --source "review of First release"/); assert.match(t, new RegExp(`the next one is Second release \\[${next.id}\\]: Buddy presents it with buddy milestone card ${next.id} and starts it only with your go-ahead`));
  assert.doesNotMatch(t, /\b[RQ]\d{1,3}\b/);
});
test('a milestone with a change still being built says it is not ready and names it; an accepted one is only a line; an abandoned one is named apart', () => {
  const { d, m, a, b } = milestone(); const c = change(d, 'Share lists', { milestone: m.id }); building(d, c.id); const e = change(d, 'Old idea', { milestone: m.id }); moveSlice(d, e.id, 'abandoned');
  const t0 = milestoneReview(d, m.id); assert.match(t0, /NOT READY: some changes are not delivered/); assert.match(t0, /2 of 3 changes delivered or accepted\.\n  Not delivered \(1\): Share lists \[share-lists\], still being built\.\n  Abandoned: Old idea \[old-idea\]\./);
  moveSlice(d, a.id, 'accepted', { by: 'owner' });
  assert.match(milestoneReview(d, m.id), /1\. Save books \[save-books\]  ·  accepted\n   For what: Save books, as the reader asked\n   You accepted it on \d{4}-\d{2}-\d{2}\.\n\n2\. Sort books/);
  assert.throws(() => milestoneReview(d, 'ghost'), /there is no milestone ghost; they are: /);
});
test('the command prints the script', () => {
  const { d, m } = milestone(); const out = spawnSync(process.execPath, [BUDDY, 'milestone', 'review', m.id], { cwd: d, encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr); assert.match(out.stdout, /^REVIEW  First release/); assert.match(out.stdout, /Order to try them \(2\)/);
});

test('the short forms of the commands Dev and Buddy use most reach the slice commands: buddy try, assume, unverified, decision', () => {
  const d = repo(); const c = change(d, 'Save books'); building(d, c.id);
  const run = (...a) => spawnSync(process.execPath, [BUDDY, ...a], { cwd: d, encoding: 'utf8' });
  const t = run('try', 'set', c.id, 'AC1', '--steps', 'Open it', '--expect', 'It opens'); assert.equal(t.status, 0, t.stderr); assert.equal(readSlice(d, c.id).data.howto[0].criterion, 'AC1');
  // the others reach the slice command: what they answer is its own refusal, never the list of commands
  for (const args of [['assume', c.id, 'Names as typed', '--if-otherwise', 'a format rule'], ['unverified', 'undo', c.id, 'list'], ['decision', c.id, '1', 'costly']]) { const r = run(...args); assert.doesNotMatch(`${r.stdout}${r.stderr}`, /usage: buddy <command>/, args[0]); assert.notEqual(r.status, 0, args[0]); }
});
