import test from 'node:test';
import assert from 'node:assert/strict';
import { terms, parseDiff, classifyHunk, buildSources, traceScope, describe } from '../src/scope.mjs';

const diff = [
  'diff --git a/server/store.ts b/server/store.ts', '--- a/server/store.ts', '+++ b/server/store.ts', '@@ -1,0 +1,6 @@',
  '+export function archiveBook(id: number) {', '+  const book = find(id);', '+  book.archived = true;', '+  return book;', '+}', '+',
  'diff --git a/server/audit.ts b/server/audit.ts', '--- /dev/null', '+++ b/server/audit.ts', '@@ -0,0 +1,3 @@',
  '+export function writeAuditTrail(event: string) {', '+  logger.record(event);', '+}',
  'diff --git a/package-lock.json b/package-lock.json', '--- a/package-lock.json', '+++ b/package-lock.json', '@@ -1 +1,2 @@', '+  "lockfileVersion": 3,',
  'diff --git a/server/store.test.ts b/server/store.test.ts', '--- a/server/store.test.ts', '+++ b/server/store.test.ts', '@@ -9,0 +10,3 @@',
  "+it('warns and offers restore when an archived title is added again', () => {", '+  expect(addBook(archivedTitle).warning).toBe(true);', '+});',
].join('\n');
const spec = {
  request: 'Archive a book instead of deleting it; the list hides archived books.',
  answers: [{ id: 'Q1', text: 'A reader adds a title that is archived. Tell the reader it is in the archive and offer to restore it.' }],
  risks: [{ id: 'R1', text: 'High cost: losing or silently changing a reader data.' }],
};

test('terms drops stop words and short words, folds case and plurals', () => {
  assert.deepEqual([...terms('The archivedBooks const function Archive')].sort(), ['archiv', 'book']);
});
test('parseDiff skips lockfiles, counts non-blank added lines, flags test files', () => {
  const files = parseDiff(diff);
  assert.deepEqual(files.map(f => [f.file, f.test, f.hunks[0].added.length]), [['server/store.ts', false, 4], ['server/audit.ts', false, 2], ['server/store.test.ts', true, 2]]);
});
test('classifyHunk: answer beats request on equal evidence, no overlap is initiative, one overlap is unclear', () => {
  const src = buildSources(spec);
  assert.equal(classifyHunk(terms('archive restore title warning'), src).source, 'answer:Q1');
  assert.equal(classifyHunk(terms('writeAuditTrail logger record'), src).source, 'initiative');
  assert.equal(classifyHunk(terms('archive logger something'), src).source, 'unclear');
});
test('traceScope attributes lines and reports shares that add up', async () => {
  const r = await traceScope(diff, spec);
  assert.equal(r.total_added, 8);
  assert.equal(r.items.find(i => i.file === 'server/audit.ts').source, 'initiative');
  assert.equal(r.items.find(i => i.file === 'server/store.test.ts').source, 'answer:Q1');
  assert.equal(r.lines.initiative, 2);
  assert.ok(Math.abs(Object.values(r.share).reduce((a, b) => a + b, 0) - 100) <= 3);
  assert.equal(r.test_lines, 2);
});
test('judge is consulted only for unclear hunks and its verdict is recorded', async () => {
  const calls = [];
  const d = ['diff --git a/x.ts b/x.ts', '--- a/x.ts', '+++ b/x.ts', '@@ -0,0 +1,2 @@', '+archive logger something', '+other thing here'].join('\n');
  const r = await traceScope(d, spec, { judge: async it => { calls.push(it.file); return 'initiative'; } });
  assert.deepEqual(calls, ['x.ts']); assert.equal(r.items[0].source, 'initiative'); assert.equal(r.items[0].judged, true);
});
test('a diff with no additions gives zero shares without dividing by zero', async () => {
  const r = await traceScope('', spec); assert.equal(r.total_added, 0); assert.equal(r.share.initiative, 0);
});
test('describe lists what was not traced', async () => {
  const text = describe(await traceScope(diff, spec));
  assert.match(text, /own initiative: 2\d %/); assert.match(text, /server\/audit\.ts/);
});
test('judgeRequest sends request-attributed hunks to the judge too', async () => {
  const d = ['diff --git a/x.ts b/x.ts', '--- a/x.ts', '+++ b/x.ts', '@@ -0,0 +1,2 @@', '+archive hidden books list', '+hides archived'].join('\n');
  const seen = [];
  const r = await traceScope(d, spec, { judgeRequest: true, judge: async it => { seen.push(it.source); return 'initiative'; } });
  assert.deepEqual(seen, ['request']); assert.equal(r.items[0].source, 'initiative');
  const r2 = await traceScope(d, spec, { judge: async () => { throw new Error('should not be called'); } });
  assert.equal(r2.items[0].source, 'request');
});
