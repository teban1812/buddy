import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { startSlice, moveSlice, stepAddTo, readSlice, screensAdd, divergenceAdd, divergenceRemove } from '../src/slicestore.mjs';
import { readPrototype, draftManifest, confirmManifest, MANIFEST } from '../src/prototype.mjs';
import { resumeBrief, briefText } from '../src/resume.mjs';
import { verify } from '../src/verify.mjs';

const BIN = fileURLToPath(new URL('../bin/buddy.mjs', import.meta.url));
const HTML = `<section id="list"><h1>Reading list</h1><a href="#add">Add one</a></section><section id="add"><h2>Add a book</h2><a href="#list">Back</a></section><section id="stats"><h1>Stats</h1><a href="#list">Back</a></section>`;
const NOW = new Date().toISOString().slice(0, 19) + 'Z';
function setup({ to = 'building' } = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-')); fs.mkdirSync(path.join(d, 'docs/inputs/prototype'), { recursive: true }); fs.writeFileSync(path.join(d, 'docs/inputs/prototype/index.html'), HTML);
  fs.writeFileSync(path.join(d, MANIFEST), confirmManifest(draftManifest(readPrototype([{ name: 'index.html', html: HTML }]), { date: '2026-11-01' }), { all: true, date: '2026-11-01' }).text);
  const s = startSlice({ repo: d, title: 'List and add books', request: 'r', criteria: ['Works'], excludes: ['Nothing beyond the criteria above'] }); screensAdd(d, s.id, ['list', 'add']); stepAddTo(d, s.id, 'Build');
  for (const st of ['ready', 'building', 'delivered', 'rework'].slice(0, ['ready', 'building', 'delivered', 'rework'].indexOf(to) + 1)) moveSlice(d, s.id, st);
  return { d, id: s.id };
}
const V = { screen: 'list', prototype: 'has no way to sort', built: 'sorts the list by title', why: 'a long list is hard to scan', kind: 'improvement' };
const canon = d => verify([path.join(d, 'docs')], { canonical: true }).problems;

test('Dev declares a departure: ids follow, the default kind is the cautious one, and the record stays canonical', () => {
  const { d, id } = setup(); const a = divergenceAdd(d, id, V); assert.equal(a.ref, 'V1');
  const b = divergenceAdd(d, id, { screen: 'add', prototype: 'saves with one button', built: 'asks to confirm first', why: 'a wrong tap lost a book' }); assert.equal(b.ref, 'V2');
  const dv = readSlice(d, id).data.divergences; assert.deepEqual(dv.map(x => [x.id, x.screen, x.kind, x.status]), [['V1', 'list', 'improvement', 'declared'], ['V2', 'add', 'divergence', 'declared']]);
  assert.deepEqual(dv[0], { id: 'V1', screen: 'list', kind: 'improvement', prototype: 'has no way to sort', built: 'sorts the list by title', why: 'a long list is hard to scan', status: 'declared' });
  assert.deepEqual(canon(d), []);
});
test('refusals leave nothing behind: not building, no screens, a screen not covered, a bad kind, empty or multi-line text', () => {
  for (const to of ['ready']) { const { d, id } = setup({ to }); assert.throws(() => divergenceAdd(d, id, V), /is ready: departures from the prototype are declared while the slice is being built/); }
  const { d, id } = setup();
  assert.throws(() => divergenceAdd(d, id, { ...V, screen: 'stats' }), /stats is not a screen this change covers; it covers: list, add/);
  assert.throws(() => divergenceAdd(d, id, { ...V, kind: 'cosmetic' }), /kind is improvement .* or divergence/);
  assert.throws(() => divergenceAdd(d, id, { ...V, why: '' }), /one line, not empty/); assert.throws(() => divergenceAdd(d, id, { ...V, built: 'two\nlines' }), /one line, not empty/);
  assert.equal(readSlice(d, id).data.divergences, undefined);
  const none = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-')); fs.mkdirSync(path.join(none, 'docs'), { recursive: true });
  const s2 = startSlice({ repo: none, title: 'No screens here', request: 'r', criteria: ['x'], excludes: ['Nothing beyond the criteria above'] }); stepAddTo(none, s2.id, 's'); moveSlice(none, s2.id, 'ready'); moveSlice(none, s2.id, 'building');
  assert.throws(() => divergenceAdd(none, s2.id, V), /covers no prototype screen, so there is nothing to depart from/);
});
test('Dev withdraws a departure it has undone; an unknown one says which exist; the last one removed leaves no empty list', () => {
  const { d, id } = setup(); divergenceAdd(d, id, V); divergenceAdd(d, id, { ...V, screen: 'add' });
  assert.throws(() => divergenceRemove(d, id, 'V9'), /no departure V9; there are: V1, V2/); divergenceRemove(d, id, 'V1'); assert.deepEqual(readSlice(d, id).data.divergences.map(x => x.id), ['V2']);
  assert.equal(divergenceAdd(d, id, V).ref, 'V3');                                          // ids are not reused: V2 still means what it meant
  divergenceRemove(d, id, 'V2'); divergenceRemove(d, id, 'V3'); assert.equal(readSlice(d, id).data.divergences, undefined); assert.deepEqual(canon(d), []);
});
test('the verifier: a departure on a screen the change does not cover, a decision with no decider, a decider on a declared one, a repeated id', () => {
  const { d, id } = setup(); divergenceAdd(d, id, V); const f = readSlice(d, id).file; const text = fs.readFileSync(f, 'utf8'); const probs = () => verify([path.join(d, 'docs')]).problems.map(p => p.message).join('\n');
  fs.writeFileSync(f, text.replace('screen: list', 'screen: stats')); assert.match(probs(), /stats is not a screen this change covers/);
  fs.writeFileSync(f, text.replace('status: declared', 'status: rejected')); assert.match(probs(), /is rejected but nobody decided it/);
  fs.writeFileSync(f, text.replace('status: declared', 'status: declared\n    decided:\n      by: owner\n      at: 2026-11-02T10:00:00Z')); assert.match(probs(), /is declared but carries a decision/);
  fs.writeFileSync(f, text.replace(/(divergences:\n  - id: V1[\s\S]*?status: declared\n)/, '$1  - id: V1\n    screen: add\n    kind: divergence\n    prototype: p\n    built: b\n    why: w\n    status: declared\n')); assert.match(probs(), /duplicate departure id/);
});
test('a resumed Dev sees the departures it already declared', () => {
  const { d, id } = setup(); assert.ok(!/Departures from the prototype you have declared/.test(briefText(resumeBrief(d, id, NOW)))); divergenceAdd(d, id, V);
  const t = briefText(resumeBrief(d, id, NOW)); assert.match(t, /Departures from the prototype you have declared/); assert.match(t, /V1 \(improvement, declared\) on list: the prototype has no way to sort; built: sorts the list by title; why: a long list is hard to scan/);
});
test('the CLI: divergence add and remove, with what is missing named', () => {
  const { d, id } = setup(); const run = (...a) => spawnSync(process.execPath, [BIN, 'slice', 'divergence', ...a, '--repo', d], { encoding: 'utf8' });
  const r = run('add', id, '--screen', 'list', '--prototype', 'has no sort', '--built', 'sorts by title', '--why', 'long lists', '--kind', 'improvement'); assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, new RegExp(`declared V1 \\(improvement\\) on list of ${id}`));
  const miss = run('add', id, '--screen', 'list'); assert.equal(miss.status, 2); assert.match(miss.stderr, /missing --prototype/);
  assert.match(run('remove', id, 'V1').stdout, /withdrew V1/); const bad = run('remove', id, 'V1'); assert.equal(bad.status, 1); assert.match(bad.stderr, /refused: no departure V1; there is none/); assert.equal(run('wat', id).status, 2);
});
