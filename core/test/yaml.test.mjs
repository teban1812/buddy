import test from 'node:test';
import assert from 'node:assert/strict';
import { parseYaml, parseDocument } from '../src/frontmatter.mjs';
import { dumpYaml, dumpDocument } from '../src/yaml.mjs';

const rt = x => parseYaml(dumpYaml(x));
test('round trip of nested maps and lists', () => {
  const x = { a: 1, b: 'plain text', c: ['x', 'y'], d: [{ id: 'q1', label: 'one: two', n: 2, nested: { k: true, z: null } }, { id: 'q2', list: [{ a: 1 }, { b: 2 }] }], e: [], f: {}, g: false };
  assert.deepEqual(rt(x), x);
});
test('strings that look like other types or syntax are quoted and survive', () => {
  const x = { a: 'true', b: '123', c: '- dash', d: '# hash', e: 'a: b', f: ' spaced ', g: '', h: 'He said "hi"', i: "it's", j: '[brackets]', k: 'null' };
  assert.deepEqual(rt(x), x);
});
test('lists of strings with commas or quotes use block form', () => {
  const x = { l: ['a, b', "c'd", 'plain'] };
  assert.deepEqual(rt(x), x);
});
test('multi-line values are refused instead of corrupting the file', () => {
  assert.throws(() => dumpYaml({ a: 'one\ntwo' }), /multi-line/);
});
test('dumpDocument output is readable by parseDocument', () => {
  const d = parseDocument(dumpDocument({ schema: 'x', n: 1 }, '# Body\n'));
  assert.deepEqual(d.data, { schema: 'x', n: 1 }); assert.equal(d.body, '# Body\n');
});
