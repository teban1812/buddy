import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { migrate } from '../src/migrate.mjs';
import { listSlices, readSlice } from '../src/slicestore.mjs';
import { canonicalText } from '../src/slice.mjs';
import { createBatch, writeBatchFile, loadBatchFile } from '../src/queue.mjs';
import { decideV0 } from '../src/decide.mjs';
import { verify } from '../src/verify.mjs';
import { parseDocument } from '../src/frontmatter.mjs';

const BUDDY = fileURLToPath(new URL('../bin/buddy.mjs', import.meta.url));
const MAP = { 'S-2026-11-01-e001': 'reading-list', 'S-2026-11-01-a001': 'save-books', 'S-2026-11-01-b001': 'remove-a-book', 'S-2026-11-01-c001': 'export-the-list' };
const rec = (id, extra = {}, body = '## Steps\n') => canonicalText({ schema: 'buddy/slice@1', id, title: `Title of ${id}`, kind: 'feat', status: 'refining', rank: 1000, created: '2026-11-01T09:00:00Z', updated: '2026-11-01T09:00:00Z', request: 'r', ...extra }, `# Title of ${id}\n\n${body}`);
// The flat layout of before R87: an epic with two children, a lone slice that depends on a child, a batch named after the epic, a decision for a child.
function legacy({ epicBody } = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-')); const flat = path.join(d, 'docs/buddy/slices'); fs.mkdirSync(flat, { recursive: true });
  fs.writeFileSync(path.join(flat, 'S-2026-11-01-e001.md'), rec('S-2026-11-01-e001', { kind: 'epic' }, epicBody));
  fs.writeFileSync(path.join(flat, 'S-2026-11-01-a001.md'), rec('S-2026-11-01-a001', { rank: 2000, epic: 'S-2026-11-01-e001' }, '## Steps\n- [ ] 1. Storage\n'));
  fs.writeFileSync(path.join(flat, 'S-2026-11-01-b001.md'), rec('S-2026-11-01-b001', { rank: 3000, epic: 'S-2026-11-01-e001' }));
  fs.writeFileSync(path.join(flat, 'S-2026-11-01-c001.md'), rec('S-2026-11-01-c001', { rank: 4000, created: '2026-11-02T09:00:00Z', depends_on: ['S-2026-11-01-a001'] }));
  writeBatchFile(path.join(d, 'docs/buddy/questions/S-2026-11-01-e001-b1.md'), createBatch({ slice: 'S-2026-11-01-e001', questions: [{ situation: 'Order?', options: [{ label: 'a', cost: 'x' }, { label: 'b', cost: 'y' }] }] }, { date: '2026-11-01' }));
  decideV0({ title: 'Store in a file', requested_by: 'S-2026-11-01-a001', decided_by: 'agent', context: 'c', options: 'a; b', outcome: 'a', reason: 'r', rules: [{ text: 'one file', origin: 'agent' }], slice: 'S-2026-11-01-a001' }, d, { date: '2026-11-01' });
  return d;
}
const tree = d => { const walk = p => fs.readdirSync(p, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(p, e.name)) : [path.relative(d, path.join(p, e.name)).split(path.sep).join('/')]); return walk(path.join(d, 'docs')).sort(); };

test('migrate moves the flat layout into one folder per change, names old ids from the map, and every reference follows (R87)', () => {
  const d = legacy(); assert.deepEqual(verify([path.join(d, 'docs')], { canonical: true }).problems, []);
  const dry = migrate(d, { map: MAP, dry: true }); assert.equal(dry.moves.length, 6); assert.equal(listSlices(d).filter(s => s.folder).length, 0);   // a dry run writes nothing
  const r = migrate(d, { map: MAP }); assert.equal(r.moves.length, 6);
  const decTo = r.moves.find(m => m.to.includes('/D-')).to; assert.match(decTo, /^docs\/decisions\/D-2026-11-01-/);   // a decision stays in docs/decisions, naming its change
  assert.deepEqual(tree(d), [
    'docs/buddy/backlog/2026-11-01-reading-list/change.md', 'docs/buddy/backlog/2026-11-01-reading-list/questions-1.md',
    'docs/buddy/backlog/2026-11-01-reading-list/remove-a-book.md', 'docs/buddy/backlog/2026-11-01-reading-list/save-books.md',
    'docs/buddy/backlog/2026-11-02-export-the-list/change.md', decTo,
  ]);
  const e = readSlice(d, 'reading-list'); assert.equal(e.data.kind, 'feat'); assert.equal(e.change, null); assert.match(e.body, /Steps: in the slices of this change\./);
  const a = readSlice(d, 'save-books'); assert.equal(a.change, 'reading-list'); assert.equal(a.data.epic, undefined); assert.doesNotMatch(a.body, /Steps: planned/);   // it has steps
  assert.match(readSlice(d, 'remove-a-book').body, /Steps: planned when the slice is ready\./); assert.match(readSlice(d, 'export-the-list').body, /Steps: planned when the change is ready\./);
  assert.deepEqual(readSlice(d, 'export-the-list').data.depends_on, ['save-books']);
  assert.equal(loadBatchFile(path.join(path.dirname(e.file), 'questions-1.md')).slice, 'reading-list');
  const dec = parseDocument(fs.readFileSync(path.join(d, r.moves.find(m => m.to.includes('/D-')).to), 'utf8')).data; assert.equal(dec.slice, 'save-books'); assert.equal(dec.requested_by, 'save-books');
  assert.deepEqual(verify([path.join(d, 'docs')], { canonical: true }).problems, []);
  assert.equal(migrate(d, { map: MAP }).nothing, true);                                      // a second run finds nothing to move
});
test('migrate refuses an old id the map does not name, and a result that would not verify, and leaves everything as it was', () => {
  const d = legacy(); const before = tree(d);
  assert.throws(() => migrate(d, { map: { ...MAP, 'S-2026-11-01-b001': undefined } }), /S-2026-11-01-b001 has no name: add it to the map/);
  assert.throws(() => migrate(d, { map: { ...MAP, 'S-2026-11-01-b001': 'save-books' } }), /two records would be named save-books/);
  const bad = legacy({ epicBody: '## Steps\n- [ ] 1. Its own step\n' });            // a change in slices keeps no steps of its own
  const was = tree(bad); assert.throws(() => migrate(bad, { map: MAP }), /keeps its steps in its slices/); assert.deepEqual(tree(bad), was);
  assert.deepEqual(tree(d), before);
});
test('the CLI: --dry, --map, the moves listed, and nothing on a second run', () => {
  const d = legacy(); const map = path.join(d, 'map.json'); fs.writeFileSync(map, JSON.stringify(MAP));
  const run = (...a) => spawnSync(process.execPath, [BUDDY, 'migrate', '--repo', d, ...a], { encoding: 'utf8' });
  const dry = run('--map', map, '--dry'); assert.equal(dry.status, 0, dry.stderr); assert.match(dry.stdout, /^would move 6 record\(s\) \(dry run, nothing written\):\n  docs\/buddy\/slices\/S-2026-11-01-e001\.md -> docs\/buddy\/backlog\/2026-11-01-reading-list\/change\.md/);
  const ok = run('--map', map); assert.equal(ok.status, 0, ok.stderr); assert.match(ok.stdout, /moved 6 record\(s\)/); assert.match(ok.stdout, /commits already made keep the old ids/);
  assert.match(run('--map', map).stdout, /Nothing to migrate/);
  const none = legacy(); const r = spawnSync(process.execPath, [BUDDY, 'migrate', '--repo', none], { encoding: 'utf8' }); assert.equal(r.status, 1); assert.match(r.stderr, /refused: S-2026-11-01-e001 has no name/);
});
