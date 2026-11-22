import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseHtml, textOf, find } from '../src/htmlscan.mjs';
import { readPrototype, prototypeFiles } from '../src/prototype.mjs';

const read = (...files) => readPrototype(files.map(([name, html]) => ({ name, html })));
const names = p => p.screens.map(s => s.name);
const screen = (p, n) => p.screens.find(s => s.name === n);

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

// ---- screens, flows, controls
const LIST = `<!doctype html><html><body>
<nav><a href="#list">Books</a> <a href="#add">Add a book</a></nav>
<section id="list"><h1>Reading list</h1><p>Your saved books.</p><input placeholder="Search books" name="q"><ul><li>Dune</li><li>Emma</li></ul><button>Add a book</button><a href="#add">Add one</a></section>
<section id="add"><h2>Add a book</h2><form><label for="t">Title</label><input id="t" name="title"><label for="a">Author</label><input id="a"><button type="submit">Save</button></form><a href="#list">Back to the list</a> <a href="#">Help</a></section>
</body></html>`;
test('screens are the sections that links point to, with their title, controls, copy and flows', () => {
  const p = read(['index.html', LIST]);
  assert.deepEqual(names(p), ['list', 'add']);
  assert.equal(screen(p, 'list').title, 'Reading list'); assert.equal(screen(p, 'add').title, 'Add a book');
  assert.deepEqual(screen(p, 'list').controls.map(c => `${c.kind}:${c.label}`), ['field:Search books', 'button:Add a book', 'link:Add one']);
  assert.deepEqual(screen(p, 'add').controls.map(c => `${c.kind}:${c.label}`), ['field:Title', 'field:Author', 'button:Save', 'link:Back to the list', 'link:Help']);   // labels come from <label for>
  assert.deepEqual(screen(p, 'list').copy, ['Reading list', 'Your saved books.']);
  assert.deepEqual(p.flows.map(f => `${f.from}>${f.to}:${f.via}`), ['list>add:Add one', 'add>list:Back to the list']);
  assert.equal(p.scripts, false);
});
test('what does nothing is flagged: a link to nowhere, a form with no action and no script', () => {
  const add = screen(read(['index.html', LIST]), 'add');
  assert.ok(add.fake.includes('goes nowhere: link "Help"')); assert.ok(add.fake.some(f => /form with no action/.test(f)));
});
test('a prototype that switches screens with a script: data attributes and onclick words are followed; the script is not read', () => {
  const p = read(['index.html', `<div id="home" class="screen"><h1>Welcome</h1><button data-target="settings">Settings</button><button onclick="show('about')">About us</button></div>
    <div id="settings" class="screen"><h1>Settings</h1><form><input name="x"></form><button data-target="home">Back</button></div>
    <div id="about" class="screen" data-buddy-fake><h1>About</h1><p>Lorem ipsum dolor</p></div><script>function show(id){ if (1 < 2) {} }</script>`]);
  assert.deepEqual(names(p), ['home', 'settings', 'about']); assert.equal(p.scripts, true);
  assert.deepEqual(p.flows.map(f => `${f.from}>${f.to}${f.weak ? '?' : ''}`), ['home>settings', 'home>about?', 'settings>home']);   // a guess from an onclick word is marked weak
  assert.equal(screen(p, 'about').fake_screen, true); assert.ok(screen(p, 'about').fake.some(f => /placeholder text/.test(f)));
  assert.ok(!screen(p, 'settings').fake.some(f => /form with no action/.test(f)));                       // with scripts around, a form may well work
});
test('a prototype of several files: each file is a screen and links between files are flows', () => {
  const p = read(['index.html', '<h1>Shop</h1><a href="cart.html">Cart</a>'], ['cart.html', '<h1>Your cart</h1><a href="index.html">Keep shopping</a><button>Pay</button>']);
  assert.deepEqual(names(p), ['home', 'cart']); assert.equal(screen(p, 'cart').title, 'Your cart');
  assert.deepEqual(p.flows.map(f => `${f.from}>${f.to}:${f.via}`), ['home>cart:Cart', 'cart>home:Keep shopping']);
});
test('explicit annotations win over the inference, and zones and fake markers are read', () => {
  const p = read(['p.html', `<a href="#x">x</a><div id="x"><h1>Not a screen when annotated</h1></div>
    <div data-buddy-screen="Checkout out"><h1>Pay</h1><p data-buddy-zone="fixed">Terms and conditions apply</p><button data-buddy-fake>Pay now</button><p data-buddy-zone="illustrative">Sample total</p></div>`]);
  assert.deepEqual(names(p), ['checkout-out']); const s = screen(p, 'checkout-out');
  assert.deepEqual(s.zones, [{ zone: 'fixed', text: 'Terms and conditions apply' }, { zone: 'illustrative', text: 'Sample total' }]);
  assert.ok(s.fake.includes('marked fake: Pay now')); assert.equal(s.explicit, true);
});
test('names are unique and short, and a page with no sections is one screen', () => {
  const p = read(['a/index.html', '<h1>A</h1>'], ['b/index.html', '<h1>B</h1>'], ['c.html', '<h1>An extremely long heading that goes on and on about nothing in particular at all</h1>']);
  assert.deepEqual(names(p), ['home', 'home-2', 'c']); assert.ok(names(p).every(n => n.length <= 40 && /^[a-z0-9-]+$/.test(n)));
});
test('the fingerprint changes with the content and not otherwise', () => {
  const a = read(['index.html', LIST]); assert.equal(a.fingerprint, read(['index.html', LIST]).fingerprint); assert.notEqual(a.fingerprint, read(['index.html', LIST + ' ']).fingerprint);
  assert.match(a.fingerprint, /^[0-9a-f]{16}$/);
});
test('prototypeFiles reads the folder of a project in a stable order and ignores what is not HTML', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-')); const dir = path.join(d, 'docs/inputs/prototype'); fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'b.html'), '<h1>B</h1>'); fs.writeFileSync(path.join(dir, 'a.html'), '<h1>A</h1>'); fs.writeFileSync(path.join(dir, 'sub/c.htm'), '<h1>C</h1>'); fs.writeFileSync(path.join(dir, 'notes.md'), 'x');
  assert.deepEqual(prototypeFiles(d).map(f => f.name), ['a.html', 'b.html', 'sub/c.htm']); assert.deepEqual(prototypeFiles(fs.mkdtempSync(path.join(os.tmpdir(), 'pf-'))), []);
});
