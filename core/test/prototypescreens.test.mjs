import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { startSlice, moveSlice, readSlice, screensAdd, screensRemove } from '../src/slicestore.mjs';
import { readPrototype, draftManifest, confirmManifest, readManifest, MANIFEST } from '../src/prototype.mjs';
import { verify } from '../src/verify.mjs';

const BIN = fileURLToPath(new URL('../bin/buddy.mjs', import.meta.url));
const HTML = `<section id="list"><h1>Reading list</h1><a href="#add">Add one</a><a href="#stats">Stats</a></section><section id="add"><h2>Add a book</h2><a href="#list">Back</a></section><section id="stats"><h1>Stats</h1><a href="#list">Back</a></section>`;
function project({ manifest = true } = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-')); fs.mkdirSync(path.join(d, 'docs/inputs/prototype'), { recursive: true }); fs.writeFileSync(path.join(d, 'docs/inputs/prototype/index.html'), HTML);
  if (manifest) fs.writeFileSync(path.join(d, MANIFEST), draftManifest(readPrototype([{ name: 'index.html', html: HTML }]), { date: '2026-11-01' }));
  return d;
}
const change = d => startSlice({ repo: d, title: 'List and add books', request: 'r', criteria: ['Works'], excludes: ['Nothing beyond the criteria above'] });
const confirmScreens = (d, ...names) => { const f = path.join(d, MANIFEST); const m = readManifest(f); fs.writeFileSync(f, confirmManifest(fs.readFileSync(f, 'utf8'), { lines: m.screens.filter(s => names.includes(s.name)).map(s => s.line), date: '2026-11-02' }).text); };
const canon = d => verify([path.join(d, 'docs')], { canonical: true }).problems;

test('a change covers screens of the manifest: added in order, no repeats, removed, and the record stays canonical', () => {
  const d = project(); const c = change(d);
  assert.deepEqual(readSlice(d, c.id).data.screens, undefined);
  screensAdd(d, c.id, ['list', 'add']); screensAdd(d, c.id, ['add', 'stats']); assert.deepEqual(readSlice(d, c.id).data.screens, ['list', 'add', 'stats']);
  screensRemove(d, c.id, ['add']); assert.deepEqual(readSlice(d, c.id).data.screens, ['list', 'stats']);
  screensRemove(d, c.id, ['list', 'stats']); assert.equal(readSlice(d, c.id).data.screens, undefined); assert.deepEqual(canon(d), []);
});
test('refusals: no manifest, an unknown screen (says which exist), nothing named, not covered, and not once the change is ready', () => {
  const none = project({ manifest: false }); const c0 = change(none); assert.throws(() => screensAdd(none, c0.id, ['list']), /no prototype manifest yet .*buddy prototype draft/);
  const d = project(); const c = change(d);
  assert.throws(() => screensAdd(d, c.id, ['list', 'nope']), /not a screen of the prototype: nope; the screens are: list, add, stats/);
  assert.throws(() => screensAdd(d, c.id, []), /name at least one screen/); assert.throws(() => screensRemove(d, c.id, ['list']), /does not cover: list/);
  assert.equal(readSlice(d, c.id).data.screens, undefined);                                   // the refused add left nothing
  screensAdd(d, c.id, ['list']); confirmScreens(d, 'list'); moveSlice(d, c.id, 'ready');
  assert.throws(() => screensAdd(d, c.id, ['add']), /is ready: the screens it covers can be changed only while it is refining/);
  assert.throws(() => screensRemove(d, c.id, ['list']), /only while it is refining/);
});
test('ready needs the owner to have confirmed every screen the change covers', () => {
  const d = project(); const c = change(d); screensAdd(d, c.id, ['list', 'add']);
  assert.throws(() => moveSlice(d, c.id, 'ready'), /screens it covers are not confirmed by you in the prototype's manifest: list, add .*buddy prototype confirm/);
  confirmScreens(d, 'list'); assert.throws(() => moveSlice(d, c.id, 'ready'), /a screen it covers is not confirmed by you .*: add \(/);
  confirmScreens(d, 'add'); moveSlice(d, c.id, 'ready'); assert.equal(readSlice(d, c.id).data.status, 'ready');
  const free = change(d); moveSlice(d, free.id, 'ready'); assert.equal(readSlice(d, free.id).data.status, 'ready');          // a change that covers no screen is not held back
});
test('the verifier checks the screens against the manifest, when the manifest is among the files', () => {
  const d = project(); const c = change(d); screensAdd(d, c.id, ['list']); assert.deepEqual(verify([path.join(d, 'docs')]).problems, []);
  const f = readSlice(d, c.id).file; fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('screens: [list]', 'screens: [ghost]'));
  const p = verify([path.join(d, 'docs')]).problems; assert.ok(p.some(x => /ghost is not a screen of the prototype's manifest/.test(x.message)), JSON.stringify(p));
  assert.ok(!verify([path.join(d, 'docs/buddy')]).problems.some(x => /not a screen/.test(x.message)));                         // verifying only the records cannot check it: no manifest loaded, no false alarm
});
test('the CLI: buddy slice screens add and remove', () => {
  const d = project(); const c = change(d); const run = (...a) => spawnSync(process.execPath, [BIN, 'slice', 'screens', ...a, '--repo', d], { encoding: 'utf8' });
  const r = run('add', c.id, 'list', 'add'); assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, new RegExp(`${c.id} covers: list, add`));
  assert.match(run('remove', c.id, 'add').stdout, /covers: list$/m); const bad = run('add', c.id, 'zzz'); assert.equal(bad.status, 1); assert.match(bad.stderr, /refused: not a screen of the prototype: zzz/); assert.equal(run('wat', c.id).status, 2);
});
