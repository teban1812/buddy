import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from '../src/frontmatter.mjs';
import { startSlice, listSlices, changeDirOf } from '../src/slicestore.mjs';
import { prototypeFiles, PROTOTYPE_DIR } from '../src/prototype.mjs';
import { privateNames, nameIn } from './private-names.mjs';

const CORE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(CORE, 'skills', 'ux-audit');
const skill = fs.readFileSync(path.join(DIR, 'SKILL.md'), 'utf8');
const refs = fs.readdirSync(path.join(DIR, 'references')).sort();
const read = f => fs.readFileSync(path.join(DIR, 'references', f), 'utf8');
const all = [skill, ...refs.map(read)].join('\n');
const buddy = fs.readFileSync(path.join(CORE, 'agents', 'buddy.md'), 'utf8');
const files = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]);

test('AC1: the usability audit ships as a skill of the plugin, for the prototype before its manifest is confirmed, one change, or the whole app', () => {
  const d = parseDocument(skill); assert.ok(!d.error, d.error); assert.equal(d.data.name, 'ux-audit');
  assert.match(d.data.description, /of the prototype before the owner confirms its manifest, of one change, or of the whole app/); assert.match(d.data.description, /A fixed step only on the prototype/); assert.match(d.data.description, /on a change or the app, never a stage of the cycle/);
  assert.deepEqual(refs, ['accessibility.md', 'heuristics.md', 'report-format.md']);
  for (const r of refs) assert.ok(skill.includes(`references/${r}`), r);   // each reference is named where it is needed, and read only then
  for (const shared of ['independence.md', 'safe-environment.md']) {   // shared with the QA audit, not copied
    assert.ok(skill.includes(`../qa-audit/references/${shared}`), shared); assert.ok(fs.existsSync(path.join(CORE, 'skills', 'qa-audit', 'references', shared)), shared);
  }
  for (const must of ['**The prototype, before the owner confirms its manifest.**', '**One change**', '**The whole app**', 'never in parallel', 'docs/inputs/prototype/manifest.md', 'buddy prototype facts', 'buddy prototype draft', 'docs/standards/normative.md', 'never fetch a link', 'WCAG 2.2 Level AA', 'ISO 9241-110', '**Never fix built code during the audit**', 'buddy requests add', 'only when the owner agrees']) assert.ok(skill.includes(must), must);
  for (const must of ['docs/discovery/ux-audit.md', 'qa/ux-report.md', 'docs/qa/ux-app.md']) assert.ok(read('report-format.md').includes(must), must);
});
test('AC2: every finding names what it breaks and its cost to the user, and the prototype audit says which fixes are free and which cost built work', () => {
  assert.match(skill, /\*\*every finding names the criterion or principle it breaks and its cost to the user\*\*/);
  const fmt = read('report-format.md');
  assert.match(fmt, /## Severity is the cost to the user/); assert.match(fmt, /\*\*Every finding names what it breaks\*\*/);
  assert.equal((fmt.match(/\*\*What it breaks and what it costs the user:\*\*/g) || []).length, 3);   // in both prototype sections and in the change's template
  assert.match(fmt, /## Free to fix now/); assert.match(fmt, /## Fixing these costs work already built/); assert.match(fmt, /A prototype report that does not state this for every finding is not finished/);
  assert.match(skill, /\*\*split every finding by what its fix costs\*\*: \*free\* when no change that covers the screen has been built, \*costs built work\* when one has/);
  assert.match(all, /A recorded decision never lowers a finding's severity/); assert.match(fmt, /## Evidence of effort \(mandatory\)/);
});
test('the skill stays light and holds only text; its words carry no organisation (the guard of the QA audit covers every skill)', () => {
  assert.ok(files(DIR).every(f => f.endsWith('.md')), 'only text: no scripts');
  assert.ok(skill.split(/\s+/).length < 1500, `SKILL.md has ${skill.split(/\s+/).length} words: keep detail in references/`);
  assert.doesNotMatch(all, /\bC-[A-Z]{2,3}-\d\w*\b/i);   // no constitution row ids of the project it came from
  const names = privateNames();   // and no organisation's name, when the list is here (the workshop; the public copy is checked against it when it is written)
  if (names) assert.deepEqual(all.split('\n').map(l => nameIn(names, l)).filter(Boolean), []);
});
test('a report beside the prototype leaves its manifest alone, and one in a change\'s qa/ folder leaves its records alone', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ux-')); fs.mkdirSync(path.join(d, 'docs'));
  const p = path.join(d, ...PROTOTYPE_DIR.split('/')); fs.mkdirSync(p, { recursive: true }); fs.writeFileSync(path.join(p, 'index.html'), '<h1>Books</h1>');
  const before = prototypeFiles(d).map(f => f.name);
  fs.writeFileSync(path.join(p, 'ux-audit.md'), '# Usability audit of the prototype\n'); fs.mkdirSync(path.join(p, 'ux-audit')); fs.writeFileSync(path.join(p, 'ux-audit', 'list.png'), 'png');
  assert.deepEqual(prototypeFiles(d).map(f => f.name), before);   // only the HTML is the prototype, so its fingerprint does not move
  const c = startSlice({ repo: d, title: 'Save books', request: 'A list', criteria: ['Shows saved books'], excludes: ['Sharing'] });
  const q = path.join(changeDirOf(d, c.id), 'qa'); fs.mkdirSync(q); fs.writeFileSync(path.join(q, 'ux-report.md'), '# Usability audit: Save books\n\nNo front matter here.\n');
  assert.deepEqual(listSlices(d).map(s => s.data.id), [c.id]);
});
test('Buddy offers the usability audit on demand for a change or the app, and runs it as a fixed step on the prototype, never as a stage otherwise', () => {
  const at = buddy.indexOf('**Usability audit, on demand.**'); assert.ok(at > 0);
  const line = buddy.slice(at, buddy.indexOf('\n', at));
  for (const must of ['`ux-audit` skill', 'never a stage of the cycle for a change or the app', 'do not run it unasked there', 'a fixed step, run by the `discover` and `intake` skills', 'only when the owner agrees']) assert.ok(line.includes(must), must);
  const intake = fs.readFileSync(path.join(CORE, 'skills', 'intake', 'SKILL.md'), 'utf8');   // reading and confirming the prototype live in the intake skill
  const confirm = intake.slice(intake.indexOf('2. **Have the owner confirm it, line by line**'));
  assert.match(confirm, /Before they confirm, run the prototype audit of the `ux-audit` skill/); assert.match(confirm, /nothing changes until they accept/);
  assert.ok(confirm.indexOf('ux-audit') < confirm.indexOf('prototype confirm --all'), 'run before the manifest is confirmed');
  assert.match(skill, /`discover` runs it before the test with users, `intake` before a handed-over manifest is confirmed/);
});
