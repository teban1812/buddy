import test from 'node:test';
import assert from 'node:assert/strict';
import { splitPatch, aggregate, shortstat, nameStatus, reviewDiff } from '../src/patch.mjs';

const mod = (f, add, del = []) => `diff --git a/${f} b/${f}\nindex 1..2 100644\n--- a/${f}\n+++ b/${f}\n@@ -1 +1 @@\n${del.map(l => `-${l}`).join('\n')}${del.length ? '\n' : ''}${add.map(l => `+${l}`).join('\n')}\n`;
const added = (f, lines) => `diff --git a/${f} b/${f}\nnew file mode 100644\nindex 0..2\n--- /dev/null\n+++ b/${f}\n@@ -0,0 +1 @@\n${lines.map(l => `+${l}`).join('\n')}\n`;
const removed = (f, lines) => `diff --git a/${f} b/${f}\ndeleted file mode 100644\nindex 1..0\n--- a/${f}\n+++ /dev/null\n@@ -1 +0,0 @@\n${lines.map(l => `-${l}`).join('\n')}\n`;

test('splitPatch counts lines per file and does not count the ---/+++ headers', () => {
  const f = splitPatch(mod('a.js', ['x', 'y'], ['z']) + added('b.js', ['q']));
  assert.deepEqual(f.map(x => [x.file, x.status, x.add, x.del]), [['a.js', 'M', 2, 1], ['b.js', 'A', 1, 0]]);
});
test('aggregate joins the steps of a slice per file: its own lines only, added then deleted is no work', () => {
  const f = aggregate([{ origin: 'c1', patch: added('a.js', ['1']) + added('t.js', ['t']) }, { origin: 'c2', patch: mod('a.js', ['2']) + removed('t.js', ['t']) }]);
  assert.deepEqual(f.map(x => [x.file, x.status, x.add]), [['a.js', 'A', 2]]);
  assert.equal(shortstat(f), '1 file changed, 2 insertions(+)'); assert.equal(nameStatus(f), 'A\ta.js'); assert.equal(shortstat([]), '');
});
test('reviewDiff orders source, tests, docs; leaves out whole files over the cap and says so', () => {
  const big = 'x'.repeat(400);
  const f = aggregate([{ origin: 'c', patch: added('README.md', ['doc']) + added('a.test.js', ['t']) + added('src/a.js', [big]) + added('src/b.js', [big]) }]);
  const all = reviewDiff(f, 100000); assert.equal(all.cut, false); assert.ok(all.text.indexOf('src/a.js') < all.text.indexOf('a.test.js') && all.text.indexOf('a.test.js') < all.text.indexOf('README.md'));
  const some = reviewDiff(f, 900); assert.equal(some.cut, true); assert.deepEqual(some.notShown.map(n => n.file), ['src/b.js']);
  assert.match(some.text, /NOT SHOWN TO YOU.*src\/b\.js/); assert.ok(some.text.includes('README.md'), 'a later, smaller file still fits');
});
