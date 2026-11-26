import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { registerWorker, seenWorker, finishWorker, workers, pidAlive } from '../src/workers.mjs';
import { startSlice, moveSlice, stepAddTo } from '../src/slicestore.mjs';
import { resumeBrief, briefText } from '../src/resume.mjs';

const BIN = fileURLToPath(new URL('../bin/worker.mjs', import.meta.url));
const S = 'save-books';
const repo = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wk-')); execFileSync('git', ['init', '-q'], { cwd: d }); fs.mkdirSync(path.join(d, 'docs')); return d; };
const at = h => () => new Date(Date.UTC(2026, 9, 31, h, 0, 0));

test('register, see, finish: one record per worker, folded from an append-only log', () => {
  const d = repo();
  registerWorker(d, { slice: S, role: 'dev', id: 'agent-1', session: 'sess-9' }, { now: at(9) });
  registerWorker(d, { slice: S, role: 'reviewer', id: 'agent-2' }, { now: at(9) });
  seenWorker(d, 'agent-1', { now: at(10) }); finishWorker(d, 'agent-2', 'done', { now: at(10) });
  const w = workers(d, { slice: S, now: at(12) }); const dev = w.find(x => x.id === 'agent-1');
  assert.equal(dev.status, 'running'); assert.equal(dev.last_seen, '2026-10-31T10:00:00Z'); assert.equal(dev.age, '2 h'); assert.equal(dev.session, 'sess-9'); assert.equal(dev.runtime, 'claude-code');
  assert.equal(w.find(x => x.id === 'agent-2').status, 'done'); assert.deepEqual(workers(d, { slice: 'remove-a-book' }), []);
  assert.equal(fs.readFileSync(path.join(d, '.buddy', 'workers.jsonl'), 'utf8').trim().split('\n').length, 4);
});
test('refusals: bad slice, role or id, a repeated id, an unknown worker, no git repository', () => {
  const d = repo();
  assert.throws(() => registerWorker(d, { slice: 'Not-A-Slice', role: 'dev', id: 'a' }), /not a slice id/); assert.throws(() => registerWorker(d, { slice: S, role: 'boss', id: 'a' }), /role must be/);
  assert.throws(() => registerWorker(d, { slice: S, role: 'dev', id: 'two words' }), /no spaces/); assert.throws(() => registerWorker(d, { slice: S, role: 'dev', id: 'a', pid: -3 }), /pid/);
  registerWorker(d, { slice: S, role: 'dev', id: 'a' }); assert.throws(() => registerWorker(d, { slice: S, role: 'dev', id: 'a' }), /already registered/);
  assert.throws(() => seenWorker(d, 'zz'), /no worker/); assert.throws(() => finishWorker(d, 'a', 'exploded'), /status must be/);
  assert.throws(() => registerWorker(fs.mkdtempSync(path.join(os.tmpdir(), 'nogit-')), { slice: S, role: 'dev', id: 'a' }), /not a git repository/);
});
test('a process id says whether a process still runs: a running worker whose process is gone is lost', () => {
  const d = repo(); const dead = spawnSync(process.execPath, ['-e', '0']).pid;               // a child that has already exited
  assert.equal(pidAlive(process.pid), true); assert.equal(pidAlive(dead), false);
  registerWorker(d, { slice: S, role: 'dev', id: 'proc-alive', pid: process.pid }); registerWorker(d, { slice: S, role: 'dev', id: 'proc-gone', pid: dead }); registerWorker(d, { slice: S, role: 'dev', id: 'agent-no-pid' });
  const by = Object.fromEntries(workers(d).map(x => [x.id, x]));
  assert.equal(by['proc-alive'].status, 'running'); assert.equal(by['proc-alive'].pid_state, 'alive'); assert.equal(by['proc-gone'].status, 'lost'); assert.equal(by['proc-gone'].pid_state, 'gone');
  assert.equal(by['agent-no-pid'].status, 'running'); assert.equal(by['agent-no-pid'].pid_state, 'unknown');           // only the runtime can say: ask by id
  finishWorker(d, 'proc-gone', 'stopped'); assert.equal(workers(d).find(x => x.id === 'proc-gone').status, 'stopped');
});
test('the resume brief lists the workers and tells Buddy to ask the running Dev by its id first', () => {
  const d = repo(); const s = startSlice({ repo: d, title: 'T', request: 'r', criteria: ['x'], excludes: ['Nothing beyond the criteria above'] }); stepAddTo(d, s.id, 'Step'); for (const to of ['ready', 'building']) moveSlice(d, s.id, to);
  const now = new Date().toISOString().slice(0, 19) + 'Z';
  assert.doesNotMatch(briefText(resumeBrief(d, s.id, now)), /Workers raised/);
  registerWorker(d, { slice: s.id, role: 'dev', id: 'agent-77' }); registerWorker(d, { slice: s.id, role: 'reviewer', id: 'agent-78' }); finishWorker(d, 'agent-78', 'done');
  const t = briefText(resumeBrief(d, s.id, now));
  assert.match(t, /Workers raised for this slice \(ask each running one by its id/); assert.match(t, /dev      agent-77  running .*\[claude-code\]/); assert.match(t, /reviewer agent-78  done/);
  assert.match(t, /A Dev may still be running\. Ask it by its id first/);
  finishWorker(d, 'agent-77', 'lost'); assert.doesNotMatch(briefText(resumeBrief(d, s.id, now)), /A Dev may still be running/);
});
test('the CLI: register, see, list, finish, and a refusal', () => {
  const d = repo(); const run = (...x) => spawnSync(process.execPath, [BIN, ...x, '--repo', d], { encoding: 'utf8' });
  assert.equal(run('register', '--slice', S, '--role', 'dev', '--id', 'agent-5').status, 0); assert.equal(run('seen', '--id', 'agent-5').status, 0);
  assert.match(run('list').stdout, /dev      agent-5  running/); assert.equal(JSON.parse(run('list', '--json').stdout)[0].id, 'agent-5');
  assert.equal(run('finish', '--id', 'agent-5', '--status', 'stopped').status, 0); assert.match(run('list', '--slice', S).stdout, /stopped/);
  const bad = run('seen', '--id', 'nobody'); assert.equal(bad.status, 1); assert.match(bad.stderr, /no worker/);
});
