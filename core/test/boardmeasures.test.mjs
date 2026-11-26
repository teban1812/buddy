import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { startSlice, startMilestone, moveSlice, stepAddTo, stepSetIn } from '../src/slicestore.mjs';
import { createBatch, answerQuestion, writeBatchFile } from '../src/queue.mjs';
import { stageTimes } from '../src/minutes.mjs';
import { digest, boardMeasures } from '../src/digest.mjs';
import { loadBoard, boardHtml, refreshBoardPage } from '../src/board.mjs';
import { refreshIndex } from '../src/index.mjs';

// live-board, third piece: the owner's minutes, the time in each stage and the work mix on the board's page, all from the records and git.
const at = (d, h, m = 0) => () => new Date(Date.UTC(2026, 9, d, h, m, 0)); const iso = (d, h, m = 0) => at(d, h, m)().toISOString().slice(0, 19) + 'Z';
const G = ['-c', 'user.name=t', '-c', 'user.email=t@t'];
const repo = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-')); execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: d }); fs.mkdirSync(path.join(d, 'docs')); return d; };
const commit = (d, when) => { execFileSync('git', [...G, 'add', '-A'], { cwd: d }); execFileSync('git', [...G, 'commit', '-qm', 'x'], { cwd: d, env: { ...process.env, GIT_COMMITTER_DATE: when, GIT_AUTHOR_DATE: when } }); };
const lang = h => h.replace(/<span lang="en">(.*?)<\/span>/g, '$1');   // the records' own text is marked with its language: out for what these tests read
const en = h => lang(h).replace(/<span data-l="es">.*?<\/span>/g, '').replace(/<[^>]+>/g, '');

// refining 8:00, ready 9:00, building 11:00, delivered 12:00, accepted 14:00 (31 October)
function life(milestone) {
  const d = repo(); const goal = { request: 'r', criteria: ['x'], excludes: ['Nothing beyond the criteria above'] };
  const mil = milestone ? startMilestone({ repo: d, title: 'First release', name: 'first', ...goal, now: at(31, 8) }) : null;
  const s = startSlice({ repo: d, title: 'Alpha', ...goal, ...(mil ? { milestone: mil.id } : {}), now: at(31, 8) }); commit(d, iso(31, 8));
  if (mil) { for (const to of ['ready', 'building']) moveSlice(d, mil.id, to, { now: at(31, 8, 30) }); commit(d, iso(31, 8, 30)); }
  stepAddTo(d, s.id, 'One', { now: at(31, 9) }); moveSlice(d, s.id, 'ready', { now: at(31, 9) }); commit(d, iso(31, 9));
  moveSlice(d, s.id, 'building', { now: at(31, 11) }); commit(d, iso(31, 11));
  stepSetIn(d, s.id, '1', true, { now: at(31, 11, 30) }); moveSlice(d, s.id, 'delivered', { now: at(31, 12) }); commit(d, iso(31, 12));
  return { d, s };
}

test('how long each change spent in each stage, in calendar minutes, from the commits that wrote its status (AC2)', () => {
  const { d, s } = life();
  assert.deepEqual(stageTimes(d, iso(31, 14))[s.id], { refining: 60, ready: 120, building: 60, delivered: 120 });   // still waiting for the owner at 14:00
  moveSlice(d, s.id, 'accepted', { by: 'owner', now: at(31, 14) }); commit(d, iso(31, 14));
  assert.deepEqual(stageTimes(d, iso(31, 20))[s.id], { refining: 60, ready: 120, building: 60, delivered: 120 });   // accepted ends the count
});

test('a status not committed yet counts from the record\'s own date; a change in pieces is in the stage of its pieces', () => {
  const { d, s } = life(); moveSlice(d, s.id, 'rework', { now: at(31, 13) });
  assert.equal(stageTimes(d, iso(31, 15))[s.id].building, 60 + 120);   // rework is being built again, from 13:00
  const c = startSlice({ repo: d, title: 'Big', request: 'r', criteria: ['x'], excludes: ['Nothing beyond the criteria above'], now: at(31, 8) }); commit(d, iso(31, 8));
  const p = startSlice({ repo: d, title: 'Part', request: 'r', criteria: ['x'], excludes: ['Nothing beyond the criteria above'], now: at(31, 10), inChange: c.id }); commit(d, iso(31, 10));
  stepAddTo(d, p.id, 'One', { now: at(31, 10) }); moveSlice(d, p.id, 'ready', { now: at(31, 11) }); commit(d, iso(31, 11)); moveSlice(d, p.id, 'building', { now: at(31, 12) }); commit(d, iso(31, 12));
  assert.deepEqual(stageTimes(d, iso(31, 14))[c.id], { refining: 120 + 60, ready: 60, building: 120, delivered: 0 });
});

test('without git history the stages come from the record and nothing fails', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-')); fs.mkdirSync(path.join(d, 'docs'));
  const s = startSlice({ repo: d, title: 'Loose', request: 'r', criteria: ['x'], excludes: ['Nothing beyond the criteria above'], now: at(31, 8) });
  assert.equal(stageTimes(d, iso(31, 10))[s.id].refining, 120);
});

test('the folded end of the page shows the open milestone\'s asks and waits, its average stage times, the work mix and the routes, in both languages, with no alarm and nothing on the cards (AC1, AC2, AC3)', () => {
  const { d, s } = life(true); const dir = path.dirname(s.file);
  const b0 = createBatch({ slice: s.id, questions: [{ situation: 'Which?', blocking: false, options: [{ label: 'x', cost: 'c' }, { label: 'y', cost: 'c' }] }], now: at(31, 9) });
  answerQuestion(b0, b0.questions[0].id, { option: 'a', at: iso(31, 10) }); writeBatchFile(path.join(dir, 'questions-1.md'), b0); commit(d, iso(31, 12, 30));
  const now = iso(31, 14); const index = refreshIndex(d).index; const b = loadBoard(d, now, { index }); const m = boardMeasures(d, b, index);
  const raw = boardHtml(b, m); const html = en(raw);
  assert.match(html, /you were asked 1 time; it waited for you \d+ (h|min)/);   // the singular reads right
  assert.match(html, /Average time a change spent in each stage: Being defined 1 h · Ready to start 2 h · Being built 1 h · Ready for you to try 2 h/);   // one change in the milestone: its times are the average
  assert.match(raw, /<details class="fold"><summary><b><span data-l="en">How the process is going<\/span>/); assert.ok(raw.indexOf('How the process is going') > raw.lastIndexOf('</article>'));   // folded, after the milestone's card
  assert.doesNotMatch(html.slice(0, html.indexOf('How the process is going')), /Average time|asked 1 time|waited for you/);   // none of it on the cards (AC10)
  assert.match(raw, /<span data-l="es">te preguntó 1 vez; te esperó \d+ (h|min)<\/span>/); assert.match(raw, /<span data-l="es">Tiempo medio de un cambio en cada etapa:<\/span>/); assert.match(raw, /<span data-l="es">Cómo va el proceso<\/span>/);
  const dg = digest(d, now); assert.deepEqual(m.work_mix, dg.work_mix); assert.deepEqual(m.routes, dg.routes);   // measured one way only
  assert.match(html, new RegExp(`Work mix, last 14 days \\(${dg.work_mix.total} lines\\)`)); assert.match(raw, /Mezcla de trabajo, últimos 14 días/);
  for (const k of ['product', 'tests', 'Buddy records', 'evidence', 'process']) assert.ok(html.includes(k));
  assert.match(html, /Routes used, last 14 days: feature 1/); assert.match(raw, /Rutas usadas, últimos 14 días/);
  assert.doesNotMatch(html.toLowerCase(), /alarm|warning|too much|too little|threshold/);
  assert.ok(!boardHtml(b).includes('Work mix'));   // without the measures the page is as it was
});

test('rewriting the open page with the measures stays fast', () => {
  const { d } = life(); fs.mkdirSync(path.join(d, '.buddy'), { recursive: true }); fs.writeFileSync(path.join(d, '.buddy', 'board.html'), 'old');
  const t = Date.now(); assert.equal(refreshBoardPage(d), true); assert.ok(Date.now() - t < 1000, `took ${Date.now() - t} ms`);
  assert.match(fs.readFileSync(path.join(d, '.buddy', 'board.html'), 'utf8'), /Average time a change spent in each stage/);
});
