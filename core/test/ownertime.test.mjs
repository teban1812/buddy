import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ownerEffort, transcriptFiles, effortLines, readEntries, READ_WPM, TYPE_WPM } from '../src/ownertime.mjs';

const BUDDY = fileURLToPath(new URL('../bin/buddy.mjs', import.meta.url));
let n = 0; const id = () => `u${++n}`;
const human = (ts, text) => ({ type: 'user', uuid: id(), timestamp: ts, origin: { kind: 'human' }, message: { role: 'user', content: text } });
const agent = (ts, text) => ({ type: 'assistant', uuid: id(), timestamp: ts, message: { role: 'assistant', content: [{ type: 'text', text }] } });
const w = k => Array.from({ length: k }, () => 'word').join(' ');

test('the effort is the time to read what Buddy last said plus the time to write the answer, once per message, and a night costs nothing', () => {
  const x = ownerEffort([agent('2026-11-01T10:00:00Z', w(400)), human('2026-11-01T10:01:00Z', w(40)), human('2026-11-01T10:02:00Z', w(40)), agent('2026-11-02T08:00:00Z', w(200)), human('2026-11-02T08:30:00Z', w(80))]);
  assert.equal(x.messages, 3);
  // 400 words read at 200 a minute = 2 min, 40 words written at 40 a minute = 1 min; the second message has nothing new to read; then 1 + 2
  assert.equal(x.minutes, 2 + 1 + 1 + 1 + 2); assert.deepEqual(Object.keys(x.days), ['2026-11-01', '2026-11-02']); assert.equal(x.days['2026-11-01'].messages, 2); assert.equal(x.first, '2026-11-01T10:01:00Z');
});
test('reading and writing are capped per message, and what the owner did not write is not counted: tool results, notices, meta entries, a repeated entry', () => {
  const big = ownerEffort([agent('2026-11-01T10:00:00Z', w(100000)), human('2026-11-01T10:01:00Z', w(100000))]);
  assert.equal(big.minutes, 10, 'at most 5 to read and 5 to write');
  const dup = human('2026-11-01T11:00:00Z', 'hello there'); const x = ownerEffort([dup, dup, { type: 'user', uuid: id(), timestamp: '2026-11-01T11:01:00Z', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } },
    { type: 'user', uuid: id(), timestamp: '2026-11-01T11:02:00Z', origin: { kind: 'task-notification' }, message: { role: 'user', content: 'a task finished' } }, { ...human('2026-11-01T11:03:00Z', 'meta'), isMeta: true }, { type: 'system', timestamp: '2026-11-01T11:04:00Z' }]);
  assert.equal(x.messages, 1); assert.equal(ownerEffort([]).messages, 0);
});
test('a message written while Buddy worked is queued, not a user entry: it counts once, and the automatic notices do not', () => {
  const q = (ts, content) => ({ type: 'queue-operation', operation: 'enqueue', timestamp: ts, content });
  const x = ownerEffort([human('2026-11-01T10:00:00Z', 'the first message'), q('2026-11-01T10:00:00Z', 'the first message'),            // the same message, queued then handed over
    q('2026-11-01T10:05:00Z', 'while you work, one more thing'), q('2026-11-01T10:06:00Z', '<task-notification>done</task-notification>'), q('2026-11-01T10:07:00Z', '[SYSTEM NOTIFICATION - NOT USER INPUT] x'), q('2026-11-01T10:08:00Z', undefined)]);
  assert.equal(x.messages, 2);
});
test('the records of the repository are found by its folder, and those of its subfolders too', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ot-')); const repo = path.join(home, 'work', 'my.repo'); const enc = path.resolve(repo).replace(/[^a-zA-Z0-9]/g, '-');
  for (const d of [enc, `${enc}-core`, `${enc}x`, 'unrelated']) { fs.mkdirSync(path.join(home, '.claude', 'projects', d), { recursive: true }); fs.writeFileSync(path.join(home, '.claude', 'projects', d, 's.jsonl'), '{}\n'); fs.writeFileSync(path.join(home, '.claude', 'projects', d, 'notes.txt'), 'x'); }
  assert.deepEqual(transcriptFiles(repo, { home }).map(f => path.basename(path.dirname(f))).sort(), [enc, `${enc}-core`].sort());
  assert.deepEqual(transcriptFiles(path.join(home, 'none'), { home }), []); assert.deepEqual(transcriptFiles(repo, { home: path.join(home, 'nowhere') }), []);
});
test('the text says how much, how it was estimated, that it is a floor, and how much of it falls on each accepted change', () => {
  // 2000 words to read are capped at 5 min and 200 to write at 5 more; then 40 words written take 1
  const x = ownerEffort([agent('2026-11-01T10:00:00Z', w(2000)), human('2026-11-01T10:10:00Z', w(200)), human('2026-11-03T10:00:00Z', w(40))]);
  const t = effortLines(x, { files: 2, accepted: ['2026-11-02', '2026-11-03', '2026-12-01'] }).join('\n');
  assert.match(t, /\(2 files, 2026-11-01 to 2026-11-03\)/); assert.match(t, /You wrote 2 messages; reading what Buddy said and writing your answers took about 11 min \(the busiest day, 2026-11-01, about 10 min\)\./);
  assert.match(t, /In that time 2 changes were accepted: about 6 min of yours for each one\./); assert.match(t, new RegExp(`${READ_WPM} words a minute to read and ${TYPE_WPM} to write`)); assert.match(t, /does NOT include the time you spend trying the software/);
  assert.deepEqual(effortLines(ownerEffort([]), { files: 0 }), []);
});
test('buddy minutes puts the owner\'s effort first, from the records of the machine or of a folder given with --transcripts', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ot2-')); const repo = path.join(home, 'proj'); fs.mkdirSync(path.join(repo, 'docs', 'buddy', 'backlog'), { recursive: true }); execFileSync('git', ['init', '-q'], { cwd: repo });
  const enc = path.resolve(repo).replace(/[^a-zA-Z0-9]/g, '-'); const dir = path.join(home, '.claude', 'projects', enc); fs.mkdirSync(dir, { recursive: true });
  const lines = [agent('2026-11-01T10:00:00Z', w(400)), human('2026-11-01T10:01:00Z', w(40))].map(e => JSON.stringify(e)).join('\n');
  fs.writeFileSync(path.join(dir, 's1.jsonl'), lines);
  const run = (...a) => spawnSync(process.execPath, [BUDDY, 'minutes', ...a], { cwd: repo, encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home } });
  const out = run(); assert.equal(out.status, 0, out.stderr); assert.match(out.stdout, /^Your own effort, estimated from the conversation records on this machine \(1 file, 2026-11-01 to 2026-11-01\):\n  You wrote 1 message; reading what Buddy said and writing your answers took about 3 min/);
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'ot3-')); fs.writeFileSync(path.join(other, 'mac.jsonl'), lines);
  const j = run('--transcripts', other, '--json'); assert.equal(j.status, 0, j.stderr); const o = JSON.parse(j.stdout); assert.equal(o.effort.messages, 1); assert.equal(o.effort.files, 1); assert.equal(o.effort.minutes, 3);
  const none = spawnSync(process.execPath, [BUDDY, 'minutes'], { cwd: repo, encoding: 'utf8', env: { ...process.env, HOME: path.join(home, 'empty'), USERPROFILE: path.join(home, 'empty') } });
  assert.doesNotMatch(none.stdout, /Your own effort/, 'no records, no number');
});
