import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { VAGUE, vagueWords, vagueWarnings } from '../src/vague.mjs';
import { startSlice, startMilestone, readSlice, moveSlice, goalAdd, goalSet } from '../src/slicestore.mjs';

// Vague acceptance criteria are flagged, never refused (R94; change return-vague-criteria, AC1 and AC2).
const BUDDY = fileURLToPath(new URL('../bin/buddy.mjs', import.meta.url));
const repo = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'vg-')); fs.mkdirSync(path.join(d, 'docs')); return d; };
let tick = 0; const clock = () => () => new Date(Date.UTC(2026, 10, 2, 12, 0, tick++));
const run = (d, ...a) => spawnSync(process.execPath, [BUDDY, ...a, '--repo', d], { encoding: 'utf8' });

test('the fixed list: English and Spanish, whole words, any case, accents tolerated, the longest phrase once', () => {
  assert.ok(VAGUE.includes('fast') && VAGUE.includes('as appropriate') && VAGUE.includes('rápido') && VAGUE.includes('por definir'));
  assert.deepEqual(vagueWords('The list loads FAST and is user-friendly'), ['fast', 'user friendly']);
  assert.deepEqual(vagueWords('Shown as appropriate, TBD'), ['as appropriate', 'TBD']);
  assert.deepEqual(vagueWords('La lista carga rapido y es fácil de usar; el orden está por definir'), ['rápido', 'fácil', 'por definir']);
  assert.deepEqual(vagueWords('Una pantalla Intuitiva, según corresponda'), ['intuitivo', 'según corresponda']);
  assert.deepEqual(vagueWords('Breakfast is listed; a goodbye message; the easyjet code; simpler'), []);   // whole words only
  assert.deepEqual(vagueWords('Loads in under 2 seconds with 1000 books'), []);
});
test('a warning per vague criterion, with its id, its text, the words and what to do', () => {
  const w = vagueWarnings([{ id: 'AC1', text: 'Shows saved books' }, { id: 'AC2', text: 'Search is fast and easy' }]);
  assert.equal(w.length, 1);
  assert.deepEqual(w[0], { id: 'AC2', text: 'Search is fast and easy', words: ['fast', 'easy'],
    message: 'AC2 "Search is fast and easy" is vague ("fast", "easy"): propose a checkable wording to the owner (a number, a time, a list, an example)' });
});
test('start, criteria add and edit and the move to ready warn about vague criteria and never block', () => {
  const d = repo();
  const s = startSlice({ repo: d, title: 'Save books', request: 'r', criteria: ['Shows saved books', 'Saving is quick'], excludes: ['Nothing beyond the criteria above'], now: clock() });
  assert.deepEqual(s.vague.map(v => v.id), ['AC2']);
  assert.deepEqual(goalAdd(d, s.id, 'criteria', 'Sorted as needed').vague.map(v => v.words), [['as needed']]);
  assert.deepEqual(goalAdd(d, s.id, 'criteria', 'Sorted by title').vague, []);
  assert.deepEqual(goalSet(d, s.id, 'criteria', 'AC3', 'Sorted by title, then author').vague, []);
  assert.deepEqual(goalAdd(d, s.id, 'excludes', 'Anything fast').vague, []);                    // exclusions are not criteria
  const r = moveSlice(d, s.id, 'ready'); assert.equal(readSlice(d, s.id).data.status, 'ready');
  assert.deepEqual(r.vague.map(v => v.id), ['AC2']);
  assert.equal(moveSlice(d, s.id, 'building').vague, undefined);                                 // only the move to ready checks
  const m = startMilestone({ repo: d, title: 'First release', name: 'mvp', request: 'g', criteria: ['Robusto y escalable'], now: clock() });
  assert.deepEqual(m.vague.map(v => v.words), [['robusto', 'escalable']]);
});
test('the CLI prints one warning line per vague criterion, exits 0, and --json carries them in vague', () => {
  const d = repo();
  const s = run(d, 'start', 'Archive a book', '--request', 'r', '--name', 'archive', '--ac', 'Hidden from the list', '--ac', 'Archiving is easy', '--exclude', 'Restoring');
  assert.equal(s.status, 0, s.stderr);
  assert.match(s.stdout, /\nwarning: AC2 "Archiving is easy" is vague \("easy"\): propose a checkable wording to the owner \(a number, a time, a list, an example\)\n?$/);
  const add = run(d, 'criteria', 'add', 'archive', 'Shown in the archive'); assert.equal(add.status, 0); assert.doesNotMatch(add.stdout, /warning/);
  const ed = JSON.parse(run(d, 'criteria', 'edit', 'archive', 'AC3', 'Shown in the archive, TBD', '--json').stdout);
  assert.deepEqual(ed.vague.map(v => [v.id, v.words]), [['AC3', ['TBD']]]);
  const mv = run(d, 'move', 'archive', 'ready'); assert.equal(mv.status, 0, mv.stderr);
  assert.equal(mv.stdout.split('\n').filter(l => l.startsWith('warning: ')).length, 2);
  const ms = JSON.parse(run(d, 'milestone', 'start', 'First release', '--request', 'g', '--name', 'mvp', '--ac', 'Works well', '--json').stdout);
  assert.deepEqual(ms.vague, []);
  const js = JSON.parse(run(d, 'start', 'Lend a book', '--request', 'r', '--ac', 'Lending is seamless', '--json').stdout);
  assert.deepEqual(js.vague.map(v => v.words), [['seamless']]);
});
test('Buddy\'s instructions: when a criterion is flagged vague, show the owner why and propose a checkable wording before ready', () => {
  const md = fs.readFileSync(fileURLToPath(new URL('../agents/buddy.md', import.meta.url)), 'utf8');
  const step1 = md.slice(md.indexOf('## A change'), md.indexOf('2. **Ask**'));
  assert.match(step1, /criterion is vague[^\n]*show the owner why[^\n]*propose a checkable wording[^\n]*before the change is ready[^\n]*never blocks/);
});
// Key examples are agreed while a change refines (R209, R214; change agree-key-examples-while-refining). Text only: no program checks it.
test('Buddy\'s instructions: a doubted criterion gets one example that meets it and one that does not, confirmed by the owner and written inside its text; an undoubted one gets none', () => {
  const md = fs.readFileSync(fileURLToPath(new URL('../agents/buddy.md', import.meta.url)), 'utf8');
  const step1 = md.slice(md.indexOf('## A change'), md.indexOf('2. **Ask**'));
  assert.match(step1, /\*\*Key examples\.\*\*[^\n]*that warning[^\n]*the owner hesitates on a criterion[^\n]*two ways to read it/);                   // AC1: the three cases
  assert.match(step1, /one example that meets it and one that does not, in the owner's business terms[^\n]*wait for them to confirm/);       // AC1
  assert.match(step1, /while the change refines/);                                                                                           // A3
  assert.match(step1, /inside the criterion's text \(`buddy criteria edit`\)[^\n]*Dev, the reviewer and the owner at acceptance/);           // AC2
  assert.match(step1, /A criterion nobody doubted gets no example[^\n]*never ask for examples for every criterion/);                         // AC4
});
test('Dev\'s instructions: the way to try a criterion that carries examples starts from them', () => {
  const md = fs.readFileSync(fileURLToPath(new URL('../agents/dev.md', import.meta.url)), 'utf8');
  const how = md.slice(md.indexOf('## How to try it'), md.indexOf('## When the slice is finished'));
  assert.match(how, /criterion carries examples[^\n]*start from them/);                                                                      // AC3
});
