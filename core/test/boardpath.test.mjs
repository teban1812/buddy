import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startSlice, startMilestone, moveSlice, howtoSet, screensAdd } from '../src/slicestore.mjs';
import { addRequest, setRequest, setPriority } from '../src/requests.mjs';
import { decideV0 } from '../src/decide.mjs';
import { loadBoard, boardHtml, refreshBoardPage } from '../src/board.mjs';

// live-board, fourth piece: the path to the release, my own test, and the pieces bar that counts abandoned and blocked apart; fifth piece (R248): the path only with two or more milestones ahead, no snapshot, no decisions, my own test only in the group waiting for me.
const NOW = '2026-10-31T18:00:00Z';
const lang = h => h.replace(/<span lang="en">(.*?)<\/span>/g, '$1');   // the records' own text is marked with its language: out for what these tests read
const en = h => lang(h).replace(/<span data-l="es">.*?<\/span>/g, '').replace(/<span data-l="en">(.*?)<\/span>/g, '$1');
const es = h => text(lang(h).replace(/<span data-l="en">.*?<\/span>/g, '').replace(/<span data-l="es">(.*?)<\/span>/g, '$1'));
const text = h => en(h).replace(/<style>[\s\S]*?<\/style>|<script>[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const row = (id, title, status, o = {}) => ({ id, title, kind: 'feat', status, change: null, milestone: null, updated: NOW, steps: { done: 0, total: 0 }, priority: null, waits_for: [], abandoned_deps: [], assurance: null, merge: null, howto: [], screens: [], ...o });
const ms = (id, title, status, acc, total) => ({ id, title, status, rank: 1, changes: { accepted: acc, total } });
const base = o => ({ now: NOW, current: [], next: null, waiting: [], requests: null, decisions: null, milestones: [], slices: [], ...o });

test('a change\'s pieces bar leaves the abandoned out of its total and shows the blocked as such', () => {
  const b = base({ milestones: [ms('m', 'First', 'building', 0, 1)], slices: [row('ch', 'List', 'ready', { milestone: 'm' }),
    ...[['a', 'accepted'], ['b', 'abandoned'], ['c', 'blocked'], ['d', 'refining'], ['e', 'abandoned']].map(([id, s]) => row(id, 'Piece ' + id, s, { change: 'ch', milestone: 'm' }))] });
  const raw = boardHtml(b); const html = en(raw);
  assert.match(html, /1 of 3 delivered · 1 accepted · 1 blocked · 2 abandoned, not counted/); assert.match(es(raw), /1 de 3 entregadas · 1 aceptadas · 1 bloqueadas · 2 descartadas, no cuentan/);
  const bar = /<div class="bar small"[^>]*>(.*?)<\/div>/.exec(html)[1];
  assert.equal(bar, '<span class="s-done" style="flex:1"></span><span class="s-blocked" style="flex:1"></span><span class="s-define" style="flex:1"></span>');   // accepted, blocked, to define: 3 in all
  assert.match(html, /See the 5 pieces/);   // the abandoned are still listed, not counted
});

test('the path (two or more milestones ahead) numbers today and each milestone not accepted, marks the steps where the owner acts and shows what is built in each; Today points at what waits and does not repeat it', () => {
  const b = base({ waiting: [{ kind: 'answer', text: 'answer: Which format? [Q-1]', ref: 'Q-1', since: NOW }, { kind: 'accept', text: 'try and accept: Try me [b]', ref: 'b', since: NOW }],
    milestones: [ms('m1', 'First release', 'delivered', 1, 3), ms('m2', 'Second release', 'ready', 0, 1), ms('m3', 'Third release', 'refining', 0, 0), ms('m0', 'Zero', 'accepted', 1, 1)],
    slices: [row('a', 'Done thing', 'accepted', { milestone: 'm1' }), row('b', 'Try me', 'delivered', { milestone: 'm1' }), row('c', 'Abandoned thing', 'abandoned', { milestone: 'm1' }), row('d', 'Later', 'refining', { milestone: 'm2' })] });
  const html = en(boardHtml(b)); const path_ = /<section class="box"><h2>Path to the release<\/h2>(.*?)<\/section>/.exec(html)[1];
  const steps = path_.split('<li class="').slice(1).filter(s => s.includes('class="no"'));
  assert.deepEqual(steps.map(s => /class="no">(\d+)</.exec(s)[1]), ['1', '2', '3', '4']); assert.match(steps[0], /Today[\s\S]*You act[\s\S]*2 things wait for you, in the box above/);
  assert.doesNotMatch(steps[0], /Which format|Try me/);   // what waits is in its own box, not repeated in the path
  assert.match(steps[1], /^owner[\s\S]*First release[\s\S]*Try and accept 1 change[\s\S]*Accept the milestone[\s\S]*Try me/); assert.doesNotMatch(steps[1], /Done thing|Abandoned thing/);
  assert.match(steps[2], /^owner[\s\S]*Second release[\s\S]*Give the go-ahead to start it[\s\S]*Later/);
  assert.match(steps[3], /^[^o][\s\S]*Third release[\s\S]*No changes defined yet/); assert.doesNotMatch(steps[3], /You act/); assert.doesNotMatch(path_, /Zero/);
  assert.match(boardHtml(b), /Hoy[\s\S]*2 cosas esperan por ti, en el recuadro de arriba[\s\S]*Da el visto bueno para empezarlo/); assert.match(boardHtml(b), /Camino hasta la entrega/);
  assert.match(en(boardHtml(base({ waiting: [{ kind: 'answer', text: 'answer: Q', ref: 'q', since: null }], milestones: [ms('m', 'M', 'building', 0, 0), ms('n', 'N', 'refining', 0, 0)] }))), /Today[\s\S]*1 thing waits for you, in the box above/);   // the singular reads right
  assert.match(en(boardHtml(base({ waiting: [], milestones: [ms('m', 'M', 'building', 0, 0), ms('n', 'N', 'refining', 0, 0)] }))), /Today[\s\S]*Nothing from you for now/);
  assert.doesNotMatch(en(boardHtml(base())), /Path to the release/);   // no milestone, no path
  assert.doesNotMatch(en(boardHtml(base({ milestones: [ms('m', 'M', 'building', 0, 0)] }))), /Path to the release/);   // one milestone ahead: nothing to add (R248)
  assert.doesNotMatch(en(boardHtml(base({ milestones: [ms('m', 'M', 'building', 0, 0), ms('z', 'Done', 'accepted', 1, 1)] }))), /Path to the release/);   // a finished milestone is not ahead
});

test('the page has no snapshot in numbers and no list of decisions (R248), even when the project has requests, screens and decisions', () => {
  const b = base({ milestones: [ms('m', 'First', 'building', 1, 2)], slices: [row('a', 'A', 'accepted', { milestone: 'm', priority: 'must', screens: ['login', 'home'] }), row('c', 'C', 'refining', { milestone: 'm', priority: 'could', screens: ['home'] })],
    snapshot: { priorities: { must: 2, should: 0, could: 1, wont: 1, none: 0 }, changes: { total: 2, accepted: 1 }, screens: { total: 5, covered: 3, by: { must: ['home'], should: [], could: [], none: [] } } },
    decided: [{ id: 'D1', title: 'Logs for 30 days', date: '2026-10-31', by: 'owner', outcome: 'keep logs', file: 'docs/decisions/D1.md', slice: null }] });
  const t = text(boardHtml(b)); assert.doesNotMatch(t, /In numbers|What you asked for|Prototype screens|Screens by priority|What was decided|Logs for 30 days|Lo que se decidió|En números/);
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-')); fs.mkdirSync(path.join(d, 'docs')); const board = loadBoard(d, NOW);
  assert.ok(!('snapshot' in board) && !('decided' in board));   // not built at all: the board's data is smaller too
});

test('my own test is only in the group waiting for me: what I try for each change from its ways to try (and its pieces\'), and nowhere else', () => {
  const how = [{ criterion: 'AC1', steps: 'Open the list <script>x</script>', expect: 'See 3 books' }];
  const b = base({ milestones: [ms('m', 'First', 'building', 1, 3)], slices: [row('a', 'Save books', 'delivered', { milestone: 'm', howto: how }), row('b', 'Export', 'building', { milestone: 'm' }), row('c', 'Sort', 'accepted', { milestone: 'm', howto: how }), row('z', 'Gone', 'abandoned', { milestone: 'm' }),
    row('y', 'Define me', 'refining', { milestone: 'm' }), row('p', 'Piece', 'delivered', { change: 'b', milestone: 'm', howto: [{ criterion: 'AC1', steps: 'Press Export', expect: 'A file' }] })] });
  const raw = boardHtml(b); const html = en(raw);
  const own = [...html.matchAll(/<div class="own">(.*?)<\/ul><\/div>/g)].map(x => x[1]);
  assert.equal(own.length, 1);   // only the group waiting for me (Export's only piece is delivered, so it is mine too); none in agent, to define or done
  assert.match(own[0], /Save books[\s\S]*How to try it \(1\)[\s\S]*Open the list &lt;script&gt;x&lt;\/script&gt; <i>See: See 3 books/); assert.match(own[0], /Export[\s\S]*Press Export/);
  assert.ok(!own[0].includes('Sort') && !own[0].includes('Gone') && !own[0].includes('Define me'));
  assert.doesNotMatch(html, /Done: you accepted it|Not tried yet|tried and accepted/); assert.match(es(raw), /Tu prueba/); assert.match(es(raw), /Cómo probarlo \(1\)/);
  assert.doesNotMatch(raw, /<script>x/);
  const none = en(boardHtml(base({ milestones: [ms('m', 'First', 'building', 0, 1)], slices: [row('b', 'Export', 'building', { milestone: 'm' })] })));
  assert.doesNotMatch(none, /class="own"/);   // nothing waits for me: no block of mine
});

test('on a real project the page is rewritten in well under a second, with the new parts built from the records', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-')); fs.mkdirSync(path.join(d, 'docs')); let min = 0; const now = () => new Date(Date.UTC(2026, 9, 31, 8, min++, 30));
  const goal = { criteria: ['Works'], excludes: ['Nothing beyond the criteria above'] };
  startMilestone({ repo: d, title: 'First release', name: 'mvp', request: 'r', ...goal, now });
  const a = startSlice({ repo: d, title: 'Export the list', name: 'export-csv', request: 'r', milestone: 'mvp', ...goal, now });
  for (const t of ['A', 'B', 'C']) addRequest(d, t, 'prd', { now });
  setRequest(d, 'RQ1', { to: 'export-csv' }, { now }); setPriority(d, 'RQ1', 'must', {}, { now }); setPriority(d, 'RQ2', 'could', {}, { now });
  for (const to of ['ready', 'building']) moveSlice(d, 'mvp', to, { now });
  for (const to of ['ready', 'building', 'delivered']) moveSlice(d, a.id, to, { now });
  howtoSet(d, a.id, 'AC1', { steps: 'Open it', expect: 'See it', now });
  fs.mkdirSync(path.join(d, '.buddy'), { recursive: true }); fs.writeFileSync(path.join(d, '.buddy', 'board.html'), 'x');
  const t0 = process.hrtime.bigint(); assert.equal(refreshBoardPage(d), true); const ms_ = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms_ < 1000, `rewriting took ${ms_} ms`);
  const t = text(fs.readFileSync(path.join(d, '.buddy', 'board.html'), 'utf8'));
  assert.doesNotMatch(t, /Path to the release|In numbers/);   // one milestone ahead: no path (R248)
  assert.match(t, /Waiting for you \(2\)[\s\S]*try and accept: Export the list/); assert.match(t, /Your test[\s\S]*Open it See: See it/);
});
