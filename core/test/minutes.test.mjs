import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { startSlice, startMilestone, moveSlice, stepAddTo, stepSetIn } from '../src/slicestore.mjs';
import { createBatch, answerQuestion, writeBatchFile } from '../src/queue.mjs';
import { ownerMinutes, minutesLines, span } from '../src/minutes.mjs';
import { digest, digestText } from '../src/digest.mjs';

const BUDDY = fileURLToPath(new URL('../bin/buddy.mjs', import.meta.url));
const at = (d, h, m = 0) => () => new Date(Date.UTC(2026, 9, d, h, m, 0)); const iso = (d, h, m = 0) => at(d, h, m)().toISOString().slice(0, 19) + 'Z';
const G = ['-c', 'user.name=t', '-c', 'user.email=t@t'];
const repo = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'om-')); execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: d }); fs.mkdirSync(path.join(d, 'docs')); return d; };
const building = (d, title, now, opts = {}) => { const s = startSlice({ repo: d, title, request: 'r', criteria: ['x'], excludes: ['Nothing beyond the criteria above'], now, ...opts }); stepAddTo(d, s.id, 'One', { now }); for (const to of ['ready', 'building']) moveSlice(d, s.id, to, { now }); stepSetIn(d, s.id, '1', true, { now }); return s; };
const evidence = (dir, slice, when, reasons = []) => { const e = path.join(dir, 'evidence'); fs.mkdirSync(e, { recursive: true }); fs.writeFileSync(path.join(e, `evidence-${when.replace(/:/g, '')}-${slice}.json`), JSON.stringify({ when, slice, reasons })); };

// A milestone with one change: two questions (one answered a day later, one still open), a checkpoint exception, then a clean one, then the acceptance.
function alpha() {
  const d = repo(); startMilestone({ repo: d, title: 'Version one', name: 'v1', request: 'r', criteria: ['x'], excludes: ['Nothing beyond the criteria above'], now: at(29, 8) });
  for (const to of ['ready', 'building']) moveSlice(d, 'v1', to, { now: at(29, 8) });                  // the owner's go-ahead (R147)
  const a = building(d, 'Alpha', at(29, 9), { milestone: 'v1' }); const dir = path.dirname(a.file);
  const b = createBatch({ slice: a.id, questions: [{ situation: 'Which?', blocking: false, options: [{ label: 'x', cost: 'c' }, { label: 'y', cost: 'c' }] }, { situation: 'And?', blocking: false, options: [{ label: 'x', cost: 'c' }, { label: 'y', cost: 'c' }] }] }, { date: '2026-10-30' });
  answerQuestion(b, b.questions[0].id, { option: 'a', at: '2026-10-31' }); writeBatchFile(path.join(dir, 'questions-1.md'), b);
  evidence(dir, a.id, '2026-10-31T08:00:00.000Z', ['no tests added']); evidence(dir, a.id, '2026-10-31T10:00:00.000Z');
  moveSlice(d, a.id, 'delivered', { now: at(31, 10) }); moveSlice(d, a.id, 'accepted', { by: 'owner', now: at(31, 13) });
  return { d, a };
}

test('per change: the questions, the exceptions and the acceptance, each with the time it waited for the owner; a missing date is counted, not timed', () => {
  const { d, a } = alpha(); const x = ownerMinutes(d); const c = x.changes.find(y => y.id === a.id);
  assert.deepEqual(c.events.map(e => [e.kind, e.minutes]), [['question', 1440], ['question', null], ['exception', 120], ['acceptance', 180]]);
  assert.equal(c.events[0].resolution, 'day'); assert.equal(c.events[0].from, '2026-10-30');            // a day stays a day: no invented hour
  assert.equal(c.asked, 3); assert.equal(c.undated, 1);                                               // a checkpoint exception is not a time the owner was asked (R139)
  assert.equal(c.waited_minutes, 1440 + 180);                                                          // nor in the time it waited for them
  assert.equal(c.exceptions, 1); assert.equal(c.exceptions_waited_minutes, 120); assert.equal(c.exceptions_undated, 0);
  assert.deepEqual(x.milestones, [{ id: 'v1', title: 'Version one', asked: 3, waited_minutes: 1620, undated: 1, exceptions: 1, exceptions_waited_minutes: 120, exceptions_undated: 0 }]);
  const lines = minutesLines(x).join('\n');
  assert.match(lines, /v1: you were asked 3 times; it waited for you 1 d 3 h in all \(1 without a date\)\n    1 checkpoint exception, waited 2 h for a decision\n/);
  assert.match(lines, /Alpha \[alpha\]: asked you 3 times; it waited for you 1 d 3 h \(1 without a date\)\n        1 checkpoint exception, waited 2 h for a decision$/);
});

test('a change in pieces accepted at once is one acceptance, from its last piece delivered', () => {
  const d = repo(); const c = startSlice({ repo: d, title: 'Delta', request: 'r', criteria: ['x'], excludes: ['Nothing beyond the criteria above'], now: at(31, 7) }); const dir = path.dirname(c.file);
  const p1 = building(d, 'Piece one', at(31, 7), { inChange: c.id }); const p2 = building(d, 'Piece two', at(31, 7), { inChange: c.id });
  evidence(dir, p1.id, '2026-10-31T09:00:00.000Z'); moveSlice(d, p1.id, 'delivered', { now: at(31, 9) });
  evidence(dir, p2.id, '2026-10-31T11:00:00.000Z'); moveSlice(d, p2.id, 'delivered', { now: at(31, 11) });
  for (const to of ['ready', 'delivered']) moveSlice(d, c.id, to, { now: at(31, 11) }); moveSlice(d, c.id, 'accepted', { by: 'owner', now: at(31, 12) });
  const x = ownerMinutes(d); assert.equal(x.changes.length, 1);
  assert.deepEqual(x.changes[0].events.map(e => [e.kind, e.minutes]), [['acceptance', 60]]);
  assert.deepEqual(x.milestones.map(m => m.id), [null]); assert.match(minutesLines(x)[0], /^  backlog: you were asked 1 time; it waited for you 1 h in all$/);
});

test('without checkpoint evidence the acceptance waits from the commit that delivered it, read from git', () => {
  const d = repo(); const s = building(d, 'Gamma', at(31, 7)); moveSlice(d, s.id, 'delivered', { now: at(31, 9) });
  execFileSync('git', [...G, 'add', '-A'], { cwd: d }); execFileSync('git', [...G, 'commit', '-qm', 'delivered'], { cwd: d, env: { ...process.env, GIT_COMMITTER_DATE: '2026-10-31T09:00:00Z', GIT_AUTHOR_DATE: '2026-10-31T09:00:00Z' } });
  moveSlice(d, s.id, 'accepted', { by: 'owner', now: at(31, 12) });
  assert.deepEqual(ownerMinutes(d).changes[0].events.map(e => [e.kind, e.from, e.minutes]), [['acceptance', '2026-10-31T09:00:00Z', 180]]);
});

test('the digest: the changes with an event since the last look, the total of their milestone, and the numbers in its JSON', () => {
  const { d, a } = alpha(); building(d, 'Quiet', at(29, 9), { milestone: 'v1' });
  const all = digest(d, iso(31, 14)); assert.equal(all.minutes.changes.length, 1); assert.equal(all.minutes.changes[0].id, a.id);
  const t = digestText(all); assert.match(t, /Times you were asked \(time it waited for you, not your working time\)\n  v1: you were asked 3 times[^\n]*\n    1 checkpoint exception, waited 2 h for a decision\n    Alpha \[alpha\]: asked you 3 times[^\n]*\n        1 checkpoint exception, waited 2 h for a decision/);
  assert.equal(digest(d, iso(31, 14), { since: iso(31, 12) }).minutes.changes.length, 1);             // the acceptance at 13:00 is after the look
  const none = digest(d, iso(31, 15), { since: iso(31, 14) }); assert.equal(none.minutes.changes.length, 0); assert.doesNotMatch(digestText(none), /Times you were asked/);
  const m = JSON.parse(JSON.stringify(all)).minutes.milestones[0]; assert.equal(m.waited_minutes, 1620); assert.equal(m.exceptions, 1); assert.equal(m.exceptions_waited_minutes, 120);
});

test('buddy minutes: all time, one change with its events, a milestone, JSON, and an unknown name refused', () => {
  const { d, a } = alpha(); const run = (...x) => spawnSync(process.execPath, [BUDDY, 'minutes', '--repo', d, ...x], { encoding: 'utf8' });
  assert.match(run().stdout, /time it waited for you, not your working time[\s\S]*v1: you were asked 3 times[^\n]*\n    1 checkpoint exception, waited 2 h for a decision/);
  const one = run(a.id).stdout; assert.match(one, /exception  alpha: 2026-10-31 08:00 -> 2026-10-31 10:00, 2 h/); assert.match(one, /question   Q-[^:]+: 2026-10-30 -> \? \(without a date\)/); assert.match(one, /: 2026-10-30 -> 2026-10-31, 1 d/);
  assert.doesNotMatch(run('v1').stdout, /exception  alpha/);
  const j = JSON.parse(run('--json').stdout).changes[0]; assert.equal(j.asked, 3); assert.equal(j.exceptions, 1); assert.equal(j.exceptions_waited_minutes, 120);
  const bad = run('nope'); assert.equal(bad.status, 1); assert.match(bad.stderr, /no change or milestone nope/);
  assert.match(spawnSync(process.execPath, [BUDDY, 'minutes', '--repo', repo()], { encoding: 'utf8' }).stdout, /Nothing was asked of you/);
});

test('span: days and hours, hours and minutes, minutes', () => {
  assert.equal(span(0), '0 min'); assert.equal(span(59), '59 min'); assert.equal(span(60), '1 h'); assert.equal(span(125), '2 h 5 min'); assert.equal(span(1440), '1 d'); assert.equal(span(3060), '2 d 3 h');
});
