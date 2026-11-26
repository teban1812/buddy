import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadStory } from '../src/story.mjs';
const ID = 'archive-a-book';                              // the examples folder holds three slices; the story is of this one
const load = (d, o = {}) => loadStory(d, { slice: ID, ...o });
import { renderView, summaryText, needsOwner } from '../src/view.mjs';
import { verify } from '../src/verify.mjs';

const EX = fileURLToPath(new URL('../../docs/design/examples/', import.meta.url));
const SAMPLE = fileURLToPath(new URL('../../docs/samples/c4-archive/', import.meta.url));
const WORKSHOP = { skip: fs.existsSync(EX) && fs.existsSync(SAMPLE) ? false : 'the design examples and the C4 sample (docs/design, docs/samples) are workshop fixtures, not in the public copy' };
const BIN = fileURLToPath(new URL('../bin/view.mjs', import.meta.url));

test('loadStory gathers the records of one slice', WORKSHOP, () => {
  const s = load(EX);
  assert.equal(s.slice.id, 'archive-a-book'); assert.equal(s.batches.length, 1); assert.equal(s.decisions.length, 2); assert.equal(s.findings.length, 1);
  assert.throws(() => loadStory(EX, { slice: 'no-such-slice' }), /there is no slice or change no-such-slice/);
});
test('needsOwner lists open findings and assumed defaults, once each', WORKSHOP, () => {
  const n = needsOwner(load(EX));
  assert.ok(n.some(i => /add-book form/.test(i.text)));
  assert.equal(n.filter(i => /hidden in the archive view|Hide it/.test(i.text)).length, 1);
});
test('the C4 sample verifies and its summary shows built, left out, size, unconfirmed defaults', WORKSHOP, () => {
  assert.deepEqual(verify([SAMPLE]).problems, []);
  const t = summaryText(loadStory(SAMPLE));
  assert.match(t, /Built:/); assert.match(t, /Left out:/); assert.match(t, /Size: 9 files/); assert.match(t, /\[assumed\]/); assert.match(t, /over-built/);
});
test('the page escapes content, has no external references, and strikes superseded decisions', WORKSHOP, () => {
  const html = renderView(load(EX));
  assert.ok(!/(src|href)="https?:/.test(html)); assert.match(html, /class="card struck"/); assert.match(html, /prefers-color-scheme:dark/);
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'v-')); for (const f of fs.readdirSync(EX)) if (f.endsWith('.md')) fs.copyFileSync(EX + f, path.join(d, f));
  fs.writeFileSync(path.join(d, 'slice.md'), fs.readFileSync(path.join(d, 'slice.md'), 'utf8').replace('title: Archive a book instead of deleting it', 'title: <script>alert(1)</script>'));
  assert.ok(!renderView(load(d)).includes('<script>alert'));
});
test('CLI writes the page and the text summary', WORKSHOP, () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'v-')), 'v.html');
  assert.equal(spawnSync('node', [BIN, '--dir', SAMPLE, '--out', out], { encoding: 'utf8' }).status, 0); assert.ok(fs.statSync(out).size > 3000);
  const t = spawnSync('node', [BIN, '--dir', SAMPLE, '--text'], { encoding: 'utf8' }); assert.match(t.stdout, /Needs you/);
});
test('the view of a slice@1 shows its kind, criteria, steps and who accepted it', WORKSHOP, () => {
  const s = load(EX); assert.deepEqual(s.steps.map(x => x.num), ['1', '2', '3']);
  const html = renderView(s); assert.match(html, /feat · accepted \(accepted by you 2026-10-30, recorded via chat, not signed\)/); assert.match(html, /Acceptance criteria/); assert.match(html, /Steps \(3 of 3 done\)/);
  const t = summaryText(s); assert.match(t, /Steps: 3 of 3 done/); assert.match(t, /Accepted by you on 2026-10-30 \(recorded via chat, not signed\)/);
  assert.doesNotMatch(summaryText(loadStory(SAMPLE)), /Steps:/);        // a slice with no steps says nothing about them
});
test('the summary and the page name the change and each question with its text, the id beside it', WORKSHOP, () => {
  const s = load(EX); const t = summaryText(s);
  assert.ok(t.startsWith(`${s.slice.title} [${ID}] (`), t);
  const q = s.batches.flatMap(b => b.questions).find(x => ['open', 'assumed'].includes(x.status));
  if (q) assert.ok(t.includes(`${q.situation} [${q.id}]`), t);
  const html = renderView(s); for (const x of s.batches.flatMap(b => b.questions)) assert.ok(html.includes(x.id), x.id);
});
