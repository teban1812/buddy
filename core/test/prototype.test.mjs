import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseHtml, textOf, find } from '../src/htmlscan.mjs';
import { prototypeFacts, prototypeFiles } from '../src/prototype.mjs';


// ---- the reader of HTML
test('htmlscan: tolerant of unclosed tags, comments, entities, void elements and scripts', () => {
  const { root, scripts } = parseHtml('<!doctype html><!-- note --><ul><li>One<li>Two</ul><p>Tom &amp; Jerry &lt;3 &#65;<script>if (a<b) { x = "</p>"; }</script><img src=x alt=y><input disabled data-x=\'q r\'>');
  assert.equal(scripts, true);
  assert.deepEqual(find(root, e => e.tag === 'li').map(textOf), ['One', 'Two']);               // an unclosed li ends at the next li
  assert.equal(textOf(find(root, e => e.tag === 'p')[0]), 'Tom & Jerry <3 A');                  // entities decoded, the script content never read
  const input = find(root, e => e.tag === 'input')[0]; assert.equal(input.attrs.disabled, ''); assert.equal(input.attrs['data-x'], 'q r');
  assert.equal(find(root, e => e.tag === 'img')[0].attrs.alt, 'y');
});
test('htmlscan: never throws on markup it does not understand', () => {
  for (const bad of ['', '<', '<<<>>>', '<div', '<a href="x', '</p></div>', '<p><b>x</p>', '<!-- never closed', '<script>', 'plain text only', '<1>', '<div class="a"<p>q</div>']) assert.doesNotThrow(() => parseHtml(bad), bad);
});

const LIST = `<!doctype html><html><body><section id="list"><h1>Reading list</h1><a href="#add">Add one</a></section><section id="add"><h2>Add a book</h2></section></body></html>`;
test('the fingerprint changes with the content and not otherwise', () => {
  const fp = html => prototypeFacts([{ name: 'index.html', html }]).fingerprint; const a = fp(LIST); assert.equal(a, fp(LIST)); assert.notEqual(a, fp(LIST + ' '));
  assert.match(a, /^[0-9a-f]{16}$/);
});
test('prototypeFiles reads the folder of a project in a stable order and ignores what is not HTML', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-')); const dir = path.join(d, 'docs/inputs/prototype'); fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'b.html'), '<h1>B</h1>'); fs.writeFileSync(path.join(dir, 'a.html'), '<h1>A</h1>'); fs.writeFileSync(path.join(dir, 'sub/c.htm'), '<h1>C</h1>'); fs.writeFileSync(path.join(dir, 'notes.md'), 'x');
  assert.deepEqual(prototypeFiles(d).map(f => f.name), ['a.html', 'b.html', 'sub/c.htm']); assert.deepEqual(prototypeFiles(fs.mkdtempSync(path.join(os.tmpdir(), 'pf-'))), []);
});
