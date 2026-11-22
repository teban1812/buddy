import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { startSlice, moveSlice, stepAddTo, stepSetIn, readSlice } from '../src/slicestore.mjs';
import { registerWorker, seenWorker, finishWorker } from '../src/workers.mjs';
import { loadBoard, boardText, ago } from '../src/board.mjs';
import { digest, digestText, readMark, writeMark } from '../src/digest.mjs';
import { checkpoint } from '../src/checkpoint.mjs';

const BIN = fileURLToPath(new URL('../bin/digest.mjs', import.meta.url));
const at = (h, m = 0) => () => new Date(Date.UTC(2026, 9, 31, h, m, 0)); const iso = (h, m = 0) => at(h, m)().toISOString().slice(0, 19) + 'Z';
const repo = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dg-')); execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: d }); fs.mkdirSync(path.join(d, 'docs')); return d; };
const building = (d, title, now) => { const s = startSlice({ repo: d, title, request: 'r', criteria: ['x'], excludes: ['Nothing beyond the criteria above'], now }); stepAddTo(d, s.id, 'One', { now }); for (const to of ['ready', 'building']) moveSlice(d, s.id, to, { now }); return s; };

test('ago: fine-grained, no locale', () => {
  assert.equal(ago('2026-10-31T09:59:30Z', iso(10)), '<1 min'); assert.equal(ago(iso(9, 55), iso(10)), '5 min'); assert.equal(ago(iso(7), iso(10)), '3 h'); assert.equal(ago('2026-10-29T10:00:00Z', iso(10)), '2 d');
});
test('the pulse: Dev seen recently, Dev stalled, and no Dev registered are three different lines on the board', () => {
  const d = repo(); const a = building(d, 'Moving', at(8)); const b = building(d, 'Silent', at(8)); const c = building(d, 'Orphan', at(8));
  registerWorker(d, { slice: a.id, role: 'dev', id: 'agent-a' }, { now: at(8) }); seenWorker(d, 'agent-a', { now: at(9, 55) });
  registerWorker(d, { slice: b.id, role: 'dev', id: 'agent-b' }, { now: at(8) }); seenWorker(d, 'agent-b', { now: at(8, 10) });
  const text = boardText(loadBoard(d, iso(10)));
  assert.match(text, /Moving .*Dev agent-a seen 5 min ago/); assert.match(text, /Silent .*STALLED\? Dev agent-b last seen 1 h ago/); assert.match(text, /Orphan .*no Dev registered/);
  assert.doesNotMatch(boardText(loadBoard(d, iso(10), { staleMinutes: 600 })), /STALLED/);                         // the threshold is a parameter, not a belief
  finishWorker(d, 'agent-b', 'done', { now: at(9) }); assert.match(boardText(loadBoard(d, iso(10))), /Silent .*no Dev registered/);   // a finished Dev is not working on it any more
});
test('the digest says what changed since a time, and everything on the first look', () => {
  const d = repo(); const a = building(d, 'Old news', at(8)); const b = building(d, 'Fresh', at(9, 30)); stepAddTo(d, b.id, 'Two', { now: at(9, 31) });
  const first = digest(d, iso(10)); assert.equal(first.first, true); assert.equal(first.changed.length, 2); assert.match(digestText(first), /first look: everything is new/);
  const since = digest(d, iso(10), { since: iso(9) }); assert.equal(since.first, false); assert.deepEqual(since.changed.map(c => c.title), ['Fresh']);
  const t = digestText(since); assert.match(t, /DIGEST  2026-10-31 10:00 UTC · since 2026-10-31 09:00 UTC/); assert.match(t, /Changed since then \(1\)/); assert.match(t, /Fresh  \[0\/2\]  · 29 min ago/);
  assert.doesNotMatch(t.slice(t.indexOf('Changed since then')), /Old news/); assert.match(t, /\nNow: Old news \[old-news\] [^\n]+ \| Fresh \[fresh\] /);   // unchanged, it is not in what changed; still building, it is in Now
  assert.match(digestText(digest(d, iso(11), { since: iso(10, 30) })), /Nothing changed since you last looked\./);
  void a;
});
test('checkpoints and finished workers since the last look, and what waits for the PO', () => {
  const d = repo(); fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: 'x', scripts: { validate: 'node -e "0"' } })); fs.writeFileSync(path.join(d, 'r.md'), 'b'); execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A'], { cwd: d }); execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'base'], { cwd: d });
  const s = building(d, 'Ship it', at(8)); registerWorker(d, { slice: s.id, role: 'dev', id: 'agent-z' }, { now: at(8) }); stepSetIn(d, s.id, '1', true, { now: at(8, 5) });
  fs.writeFileSync(path.join(d, 'x.js'), 'export const x = 1;\n');
  const r = checkpoint({ repo: d, slice: s.id, human: true, review: () => ({ does_what_was_asked: true, weakens_or_hides_checks: false, unspecified_decisions: [], details: 'ok' }), now: at(9) });
  finishWorker(d, 'agent-z', 'done', { now: at(9, 1) });
  const now = new Date().toISOString().slice(0, 19) + 'Z'; const x = digest(d, now, { since: '2020-01-01T00:00:00Z' });
  assert.equal(x.checkpoints.length, 1); assert.equal(x.checkpoints[0].slice, s.id); assert.ok(x.checkpoints[0].exceptions >= 1);       // no tests added: an exception
  assert.deepEqual(x.workers_finished, [{ id: 'agent-z', role: 'dev', slice: s.id, title: 'Ship it', status: 'done' }]);
  assert.match(digestText(x), /Checkpoints run \(1, 1 with exceptions\)/); assert.match(digestText(x), /Workers finished\n  dev agent-z done/); assert.match(digestText(x), /try and accept: Ship it/);
  assert.equal(digest(d, now, { since: '2099-01-01T00:00:00Z' }).checkpoints.length, 0);
  assert.equal(readSlice(d, s.id).data.status, 'delivered'); void r;
});
test('the marker: reading never writes; --mark records the look; the next digest starts from it', () => {
  const d = repo(); building(d, 'A', at(8)); assert.equal(readMark(d), null);
  digest(d, iso(9)); assert.equal(readMark(d), null);                                    // computing a digest does not mark it
  writeMark(d, iso(9)); assert.equal(readMark(d), iso(9)); assert.equal(digest(d, iso(10)).since, iso(9));
  assert.throws(() => writeMark(fs.mkdtempSync(path.join(os.tmpdir(), 'nogit-')), iso(9)), /not a git repository/);
  fs.writeFileSync(path.join(d, '.git', 'buddy', 'last-looked'), 'garbage\n'); assert.equal(readMark(d), null);          // a damaged marker means "never looked", not a crash
});
test('the CLI: text, --json, --since, --mark and a bad time', () => {
  const d = repo(); building(d, 'A', at(8)); const run = (...x) => spawnSync(process.execPath, [BIN, '--repo', d, ...x], { encoding: 'utf8' });
  assert.match(run('--now', iso(10)).stdout, /first look: everything is new/); assert.equal(readMark(d), null);
  assert.equal(JSON.parse(run('--now', iso(10), '--json').stdout).changed.length, 1);
  assert.equal(run('--now', iso(10), '--mark').status, 0); assert.equal(readMark(d), iso(10));
  assert.match(run('--now', iso(11)).stdout, /since 2026-10-31 10:00 UTC[\s\S]*Nothing changed since you last looked\./);
  assert.match(run('--now', iso(11), '--since', iso(7)).stdout, /Changed since then \(1\)/);
  assert.equal(run('--now', 'yesterday').status, 2); assert.equal(run('--since', 'soon').status, 2);
});
