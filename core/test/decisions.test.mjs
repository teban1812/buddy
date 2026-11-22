import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execSync } from 'node:child_process';
import { startSlice, moveSlice } from '../src/slicestore.mjs';
import { buildIndex, readDecisions } from '../src/index.mjs';
import { orphans, decisionTotals, decisionsLine, decisionsText, BUILT } from '../src/decisions.mjs';
import { loadBoard, boardText } from '../src/board.mjs';

// Every decision says whether it is built and where, and none is lost (keep-decisions-traced, R110).
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BUDDY = path.join(ROOT, 'core', 'bin', 'buddy.mjs');
const NOW = '2026-11-03T18:00:00Z';
const HEAD = '| # | Date | Status | Built | Requirement | Where it lives |\n| :-- | :-- | :-- | :-- | :-- | :-- |\n';
const row = (id, built, text = `**Decision ${id}** said`) => `| ${id} | 2026-11-01 | decided | ${built} | ${text} | \`x\` |\n`;
function fixture(rows) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-')); execSync('git init -q', { cwd: d }); let min = 0;
  const now = () => new Date(Date.UTC(2026, 10, 3, 8, min++, 0));
  const later = startSlice({ repo: d, title: 'Report work mix', request: 'r', criteria: ['Shown'], now });
  const gone = startSlice({ repo: d, title: 'Commit at delivery', request: 'r', criteria: ['Asked'], now }); moveSlice(d, gone.id, 'abandoned', { now });
  fs.writeFileSync(path.join(d, 'docs', 'requirements-log.md'), `# Log\n\n${HEAD}${rows({ later: later.id, gone: gone.id })}`);
  return { d, later, gone };
}

test('the log carries a Built column after Status: the index reads its state and where; a row without it still reads', () => {
  const [a, b, c] = readDecisions(`${HEAD}${row('R1', 'built: one-folder-per-change')}${row('R2', 'not applicable', 'Plain | text.')}| R3 | 2026-10-31 | stated | **Old** row | \`y\` |\n`);
  assert.deepEqual([a.id, a.status, a.built, a.where, a.title], ['R1', 'decided', 'built', 'one-folder-per-change', 'Decision R1']);
  assert.deepEqual([b.built, b.where, b.text], ['not applicable', '', 'Plain | text.']);
  assert.deepEqual([c.id, c.built, c.where, c.title], ['R3', null, '', 'Old']);
  assert.deepEqual(readDecisions(row('P4', 'partly: core/agents/dev.md')).map(r => [r.id, r.built, r.where]), [['P4', 'partly', 'core/agents/dev.md']]);
  assert.deepEqual(BUILT, ['built', 'partly', 'not built', 'backlog', 'deferred', 'superseded', 'not applicable']);
});

test('an orphan is a decision neither built, partly built, in the backlog with a change that exists, deferred with its reason, superseded by a decision, nor not applicable', () => {
  const { d } = fixture(n => [
    row('R1', 'built: core/src/x.mjs'), row('R2', 'partly: half of it'), row('R3', `backlog: ${n.later}`), row('R4', 'deferred: a later phase'),
    row('R5', 'superseded: R1'), row('R6', 'not applicable'),
    row('R7', 'not built: nobody took it'), row('R8', 'backlog: no-such-change'), row('R9', `backlog: ${n.gone}`), row('R10', 'deferred'),
    row('R11', 'superseded: by someone'), row('R12', 'superseded: R99'), row('R13', 'built'),
  ].join(''));
  const x = buildIndex(d);
  assert.deepEqual(orphans(x).map(o => o.id), ['R7', 'R8', 'R9', 'R10', 'R11', 'R12', 'R13']);
  assert.match(orphans(x).find(o => o.id === 'R8').why, /no change named no-such-change/);
  assert.match(orphans(x).find(o => o.id === 'R9').why, /abandoned/);
  assert.deepEqual(decisionTotals(x.decisions), { decided: 13, built: 2, partly: 1, 'not built': 1, backlog: 3, deferred: 2, superseded: 3, 'not applicable': 1, none: 0, not_built_yet: 4 });
});

test('the board of a repository whose log says what is built has one line on its decisions; buddy decisions lists them, by state', () => {
  const { d, later } = fixture(n => [row('R1', 'built: a.mjs'), row('R2', 'not built: nobody'), row('R3', `backlog: ${n.later}`), row('R4', 'partly: half')].join(''));
  const b = loadBoard(d, NOW); assert.equal(decisionsLine(b.decisions), 'Decisions: 4 decided, 2 not built yet, 1 partly built (buddy decisions --state "not built")');
  assert.match(boardText(b), /\nDecisions: 4 decided, 2 not built yet, 1 partly built/);
  const run = args => spawnSync(process.execPath, [BUDDY, 'decisions', ...args], { encoding: 'utf8', cwd: d });
  const all = run([]); assert.equal(all.status, 0, all.stderr); assert.equal(all.stdout, decisionsText(buildIndex(d).decisions) + '\n');
  assert.match(all.stdout, /^R1  built  Decision R1  · a\.mjs$/m);
  const nb = run(['--state', 'not built']); assert.deepEqual(nb.stdout.trim().split('\n').map(l => l.split('  ')[0]), ['R2']);
  assert.deepEqual(JSON.parse(run(['--state', 'backlog', '--json']).stdout).map(r => [r.id, r.where]), [['R3', later.id]]);
  assert.equal(run(['--state', 'maybe']).status, 2);
});

test('a board whose log has no Built column shows no decisions line', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-')); execSync('git init -q', { cwd: d }); fs.mkdirSync(path.join(d, 'docs', 'buddy', 'backlog'), { recursive: true });
  fs.writeFileSync(path.join(d, 'docs', 'requirements-log.md'), '| R1 | 2026-10-29 | decided | v1 is for one developer | `a.md` |\n');
  assert.doesNotMatch(boardText(loadBoard(d, NOW)), /Decisions:/);
});

// Buddy's own log, read through the index: no decision may be lost. The orphans found when the column was filled (2026-11-03) wait here
// for the owner; Buddy empties this list with them, one decision at a time, and the test fails as soon as one is settled and still listed.
const ORPHANS_2026_11_03 = [];   // R21 settled by the owner on 2026-11-03 (R142)
const OWN_LOG = { skip: fs.existsSync(path.join(ROOT, 'docs', 'requirements-log.md')) ? false : "Buddy's own decisions log (docs/requirements-log.md) is in the workshop, not in the public copy" };
test("Buddy's own decisions: each says whether it is built, and none is an orphan beyond today's dated list", OWN_LOG, () => {
  const x = buildIndex(ROOT);
  assert.ok(x.decisions.length > 140, `${x.decisions.length} decisions read`);
  assert.deepEqual(x.decisions.filter(r => !r.built).map(r => r.id), [], 'decisions with no Built state');
  const found = orphans(x).map(o => o.id);
  assert.deepEqual(found.filter(id => !ORPHANS_2026_11_03.includes(id)), [], `orphans: ${orphans(x).map(o => `${o.id} (${o.why})`).join('; ')}`);
  assert.deepEqual(ORPHANS_2026_11_03.filter(id => !found.includes(id)), [], 'settled: take these out of the list');
  assert.ok(x.decisions.some(r => /^P\d+$/.test(r.id)), "the blueprint's principles are decisions too");
});

test('a decision built in the backlog may name several changes, and each must exist', () => {
  const x = { decisions: [{ id: 'R1', built: 'backlog', where: 'one, two' }, { id: 'R2', built: 'backlog', where: 'one, ghost' }, { id: 'R3', built: 'backlog', where: 'gone' }], changes: [{ id: 'one', status: 'refining' }, { id: 'two', status: 'building' }, { id: 'gone', status: 'abandoned' }] };
  assert.deepEqual(orphans(x).map(o => [o.id, o.why]), [['R2', 'no change named ghost'], ['R3', 'its change gone was abandoned']]);
});
