import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { startSlice, startMilestone, moveSlice, renameSlice } from '../src/slicestore.mjs';
import { addRequest, setRequest, removeRequest, listRequests, readRequests, REQUESTS } from '../src/requests.mjs';
import { createBatch, writeBatchFile } from '../src/queue.mjs';
import { verify } from '../src/verify.mjs';
import { loadBoard, boardText, boardHtml } from '../src/board.mjs';
import { digest, digestText } from '../src/digest.mjs';

// The map of what was asked (design/17 §3a): docs/buddy/requests.md, every requirement with its destination, counted on the board and the digest.
const BUDDY = fileURLToPath(new URL('../bin/buddy.mjs', import.meta.url));
const NOW = '2026-10-31T18:00:00Z';
const repo = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rq-')); fs.mkdirSync(path.join(d, 'docs')); return d; };
let tick = 0; const now = () => new Date(Date.UTC(2026, 9, 31, 12, 0, tick++));
const goal = { criteria: ['Works'], excludes: ['Nothing beyond the criteria above'] };
const problems = d => verify([path.join(d, 'docs')], { canonical: true }).problems.map(p => `${p.where}: ${p.message}`);
const run = (d, ...a) => spawnSync(process.execPath, [BUDDY, ...a, '--repo', d], { encoding: 'utf8' });
function project() {
  const d = repo();
  startMilestone({ repo: d, title: 'First release', name: 'mvp', request: 'The smallest useful list', ...goal, now });
  startSlice({ repo: d, title: 'Export the list', name: 'export-csv', request: 'r', milestone: 'mvp', ...goal, now });
  return d;
}

test('add gives the next id, set records one destination, remove only while it has none; ids are never renumbered nor given again', () => {
  const d = project();
  assert.equal(listRequests(d).exists, false);
  for (const [t, s] of [['Export to CSV', 'docs/inputs/prd.md §2.3'], ['Login with SSO', 'prototype: Login screen'], ['Dark mode', 'docs/inputs/prd.md §4'], ['Print', 'docs/inputs/prd.md §5'], ['Typo', 'x']]) addRequest(d, t, s, { now });
  assert.ok(fs.existsSync(path.join(d, REQUESTS)));
  assert.deepEqual(setRequest(d, 'RQ1', { to: 'export-csv' }, { now }), { id: 'RQ1', text: 'Export to CSV', source: 'docs/inputs/prd.md §2.3', destination: 'covered', to: 'export-csv' });
  assert.equal(setRequest(d, 'RQ3', { excluded: 'mvp' }, { now }).to, 'mvp');                                   // the name of a milestone: excluded by it
  assert.equal(setRequest(d, 'RQ2', { excluded: 'Not in the first year' }, { now }).reason, 'Not in the first year');   // otherwise a reason
  assert.deepEqual(setRequest(d, 'RQ2', { deferred: 'after the first release' }, { now }), { id: 'RQ2', text: 'Login with SSO', source: 'prototype: Login screen', destination: 'deferred', reason: 'after the first release' });
  assert.throws(() => setRequest(d, 'RQ4', { to: 'nothing' }, { now }), /no change or milestone named nothing/);
  assert.throws(() => setRequest(d, 'RQ4', { waiting: 'Q-2026-10-31-abcd' }, { now }), /unknown question Q-2026-10-31-abcd/);   // verified, rolled back
  assert.equal(readRequests(d).data.items.find(x => x.id === 'RQ4').destination, undefined);
  assert.throws(() => setRequest(d, 'RQ4', { to: 'export-csv', deferred: 'later' }, { now }), /say one destination/);
  assert.throws(() => setRequest(d, 'RQ9', { deferred: 'later' }, { now }), /no request RQ9; there are RQ1 to RQ5/);
  assert.throws(() => setRequest(d, 'X1', { deferred: 'later' }, { now }), /"X1" is not a request id/);
  assert.throws(() => addRequest(d, 'two\nlines', 's', { now }), /one line/); assert.throws(() => addRequest(d, 't', '', { now }), /--source/);
  const b = createBatch({ questions: [{ situation: 'Which formats?', blocking: true, options: [{ label: 'CSV', cost: 'none' }, { label: 'CSV and JSON', cost: 'a day' }] }] }, { date: '2026-10-31' });
  writeBatchFile(path.join(d, 'docs', 'questions.md'), b);
  assert.equal(setRequest(d, 'RQ4', { waiting: b.questions[0].id }, { now }).question, b.questions[0].id);
  assert.throws(() => removeRequest(d, 'RQ1', { now }), /^Error: .+ \[RQ1\] already has a destination \(covered by export-csv\)/);
  removeRequest(d, 'RQ5', { now });
  assert.equal(addRequest(d, 'Share the list', 'docs/inputs/prd.md §6', { now }).id, 'RQ6');                        // RQ5 is not given again
  assert.deepEqual(listRequests(d, { open: true }).items.map(x => x.id), ['RQ6']);
  assert.deepEqual(listRequests(d).items.map(x => [x.id, x.destination ?? null]), [['RQ1', 'covered'], ['RQ2', 'deferred'], ['RQ3', 'excluded'], ['RQ4', 'waiting'], ['RQ6', null]]);
  assert.deepEqual(problems(d), []);
  // renaming the change it is covered by: the map follows
  renameSlice(d, 'export-csv', 'export-the-list', { now });
  assert.equal(readRequests(d).data.items[0].to, 'export-the-list'); assert.match(fs.readFileSync(path.join(d, REQUESTS), 'utf8'), /covered by export-the-list\n/);
  assert.deepEqual(problems(d), []);
});

test('verify: a destination names something that exists, ids are unique, the fields match the destination, one map per project', () => {
  const d = project(); addRequest(d, 'Export to CSV', 'prd', { now }); addRequest(d, 'Print', 'prd', { now }); setRequest(d, 'RQ1', { to: 'export-csv' }, { now });
  const f = path.join(d, REQUESTS); const text = fs.readFileSync(f, 'utf8'); const edit = (a, b) => { fs.writeFileSync(f, text.replace(a, b)); const p = problems(d); fs.writeFileSync(f, text); return p.join('\n'); };
  assert.match(edit('to: export-csv', 'to: gone'), /items\.RQ1\.to: no change or milestone named gone/);
  assert.match(edit('id: RQ2', 'id: RQ1'), /items\.RQ1: duplicate id/);
  assert.match(edit('destination: covered\n    to: export-csv', 'destination: covered'), /covered by what/);
  assert.match(edit('destination: covered', 'destination: deferred'), /items\.RQ1\.to: a request deferred has no to[\s\S]*deferred needs its reason/);
  assert.match(edit('destination: covered\n    to: export-csv', 'destination: waiting\n    question: Q-2026-10-31-0000'), /unknown question Q-2026-10-31-0000/);
  assert.match(edit('    destination: covered\n', ''), /a request with no destination has no to/);
  assert.match(edit('destination: covered\n    to: export-csv', 'destination: excluded'), /excluded needs/);
  assert.match(edit('destination: covered', 'destination: lost'), /must be one of covered, excluded, deferred, waiting/);
  assert.match(edit('last: 2', 'last: 1'), /last is 1 but an item has the id RQ2/);
  fs.writeFileSync(path.join(d, 'docs', 'buddy', 'other.md'), text);
  assert.match(problems(d).join('\n'), /one map of what was asked per project[\s\S]*is the file requests\.md/);
  fs.rmSync(path.join(d, 'docs', 'buddy', 'other.md')); assert.deepEqual(problems(d), []);
});

test('the board and the digest: what has nobody waits for the owner, with the totals; all placed is one line; no map says nothing', () => {
  const d = project();
  const plain = boardText(loadBoard(d, NOW)); assert.doesNotMatch(plain, /asked for/); assert.equal(loadBoard(d, NOW).requests, null);
  for (const t of ['Export to CSV', 'Login with SSO', 'Dark mode', 'Print', 'Share the list']) addRequest(d, t, 'prd', { now });
  setRequest(d, 'RQ1', { to: 'export-csv' }, { now });
  const b = loadBoard(d, NOW); const text = boardText(b);
  assert.match(text, /^BOARD  2026-10-31 18:00 UTC\n\nNow: nothing is being built\nNext: milestone First release \[mvp\] · waits for your go-ahead\n\nWaiting for you \(1\)\n  - 4 of what you asked for have no destination yet: Login with SSO \[RQ2\] \| Dark mode \[RQ3\] \| Print \[RQ4\] \| and 1 more \(buddy requests list --open\)\n\nWhat you asked for \(5\): 1 covered, 4 without a destination yet\n\nMILESTONE/);
  assert.match(boardHtml(b), /4 of what you asked for have no destination yet[\s\S]*What you asked for \(5\): 1 covered, 4 without a destination yet/);
  const dg = digestText(digest(d, NOW)); assert.match(dg, /Waiting for you \(1\)\n  - 4 of what you asked for have no destination yet: [^\n]+\n\nWhat you asked for \(5\): 1 covered, 4 without a destination yet\n/);
  assert.deepEqual(digest(d, NOW).requests.nobody.map(x => x.id), ['RQ2', 'RQ3', 'RQ4', 'RQ5']);
  setRequest(d, 'RQ2', { excluded: 'mvp' }, { now }); setRequest(d, 'RQ3', { deferred: 'later' }, { now }); setRequest(d, 'RQ4', { to: 'export-csv' }, { now });
  assert.match(boardText(loadBoard(d, NOW)), /  - 1 of what you asked for has no destination yet: Share the list \[RQ5\]\n\nWhat you asked for \(5\): 2 covered, 1 excluded, 1 deferred, 1 without a destination yet\n/);
  setRequest(d, 'RQ5', { deferred: 'a later phase' }, { now });
  const all = boardText(loadBoard(d, NOW)); assert.match(all, /^BOARD [^\n]+\n\nNow: [^\n]+\nNext: [^\n]+\n\nNothing is waiting for you\.\n\nEverything you asked for has a destination \(5\): 2 covered, 1 excluded, 2 deferred\n\nMILESTONE/);
  // a change that is abandoned leaves what it covered with nobody again
  moveSlice(d, 'export-csv', 'abandoned', { now });
  assert.match(boardText(loadBoard(d, NOW)), /  - 2 of what you asked for have no destination yet: Export to CSV \[RQ1\] \| Print \[RQ4\]\n\nWhat you asked for \(5\): 1 excluded, 2 deferred, 2 without a destination yet\n/);
});

test('the CLI: requests add, set, list, remove', () => {
  const d = project();
  assert.match(run(d, 'requests', 'list').stdout, /no map of what was asked yet/);
  const a = run(d, 'requests', 'add', 'Export to CSV', '--source', 'docs/inputs/prd.md §2.3'); assert.equal(a.status, 0, a.stderr); assert.equal(a.stdout, 'RQ1\n');
  assert.equal(run(d, 'requests', 'add', 'Print', '--source', 'prototype: Print screen').stdout, 'RQ2\n');
  assert.equal(run(d, 'requests', 'add', 'No source').status, 2);
  assert.equal(run(d, 'requests', 'set', 'RQ1', '--to', 'export-csv').stdout, 'RQ1 covered by export-csv\n');
  const bad = run(d, 'requests', 'set', 'RQ2', '--to', 'nowhere'); assert.equal(bad.status, 1); assert.match(bad.stderr, /^refused: no change or milestone named nowhere/);
  assert.equal(run(d, 'requests', 'list').stdout, 'RQ1  Export to CSV  · docs/inputs/prd.md §2.3  · covered by export-csv\nRQ2  Print  · prototype: Print screen  · no destination yet\n\nWhat you asked for (2): 1 covered, 1 without a destination yet\n');
  assert.deepEqual(JSON.parse(run(d, 'requests', 'list', '--open', '--json').stdout).map(x => x.id), ['RQ2']);
  assert.equal(run(d, 'requests', 'set', 'RQ2', '--excluded', 'Printing is done from the browser').stdout, 'RQ2 excluded: Printing is done from the browser\n');
  assert.equal(run(d, 'requests', 'list', '--open').stdout, 'Everything you asked for has a destination (2): 1 covered, 1 excluded\n');
  assert.equal(run(d, 'requests', 'remove', 'RQ2').status, 1);
  assert.equal(run(d, 'requests', 'add', 'Typo', '--source', 'x').stdout, 'RQ3\n'); assert.equal(run(d, 'requests', 'remove', 'RQ3').stdout, 'removed RQ3\n');
  assert.equal(spawnSync(process.execPath, [BUDDY, 'verify', '--canonical', path.join(d, 'docs', 'buddy')]).status, 0);
});
