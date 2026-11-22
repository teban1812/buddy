import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from '../src/frontmatter.mjs';
import { startSlice, listSlices, changeDirOf } from '../src/slicestore.mjs';
import { privateNames, nameIn, ABSENT } from './private-names.mjs';

const CORE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(CORE, 'skills', 'qa-audit');
const skill = fs.readFileSync(path.join(DIR, 'SKILL.md'), 'utf8');
const refs = fs.readdirSync(path.join(DIR, 'references')).sort();
const all = [skill, ...refs.map(f => fs.readFileSync(path.join(DIR, 'references', f), 'utf8'))].join('\n');
const buddy = fs.readFileSync(path.join(CORE, 'agents', 'buddy.md'), 'utf8');
const files = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]);

test('AC1: the QA audit ships as a skill of the plugin that says when to load it, for one change or the whole app, with its references', () => {
  const d = parseDocument(skill); assert.ok(!d.error, d.error); assert.equal(d.data.name, 'qa-audit'); assert.match(d.data.description, /one change, or the whole app/); assert.match(d.data.description, /Never a stage of the cycle/);
  assert.deepEqual(refs, ['independence.md', 'report-format.md', 'safe-environment.md', 'testing-technique.md']);
  for (const r of refs) assert.ok(skill.includes(`references/${r}`), r);   // each reference is named where it is needed, and read only then
  for (const must of ['**One change**', '**The whole app**', 'never in parallel', 'docs/standards/normative.md', 'never fetch a link', 'docs/inputs/prototype/manifest.md', 'declared', "project's `CLAUDE.md`", 'buddy requests add', 'only when the owner agrees']) assert.ok(skill.includes(must), must);
  for (const must of ['**How to reproduce:**', '**Source:**', 'qa/report.md']) assert.ok(all.includes(must), must);
});
test('AC2: the audit answers to what is outside the team, and a report with no findings shows the effort behind it', () => {
  assert.match(skill, /material under review, never the yardstick/); assert.match(all, /A recorded decision never lowers a finding's severity/);
  assert.match(all, /## Evidence of effort \(mandatory\)/); assert.match(all, /A report with no findings and this section empty or generic is not finished/);
});
const NAMES = privateNames();
test('the skills, the agents, the library guide, the program and the public docs carry no organisation\'s own name or standard', { skip: NAMES ? false : ABSENT }, () => {
  const bad = [];
  const ROOT = path.join(CORE, '..');
  const publicDocs = [path.join(ROOT, 'README.md'), ...[path.join(ROOT, 'docs', 'guide'), path.join(ROOT, '.github', 'ISSUE_TEMPLATE')].flatMap(d => fs.existsSync(d) ? files(d) : [])];
  for (const f of [...['skills', 'agents', 'src', 'bin', 'hooks'].flatMap(d => fs.existsSync(path.join(CORE, d)) ? files(path.join(CORE, d)) : []), path.join(CORE, 'LIBRARY-GUIDE.md'), ...publicDocs]) fs.readFileSync(f, 'utf8').split('\n').forEach((l, k) => { if (nameIn(NAMES, l)) bad.push(`${path.relative(CORE, f)}:${k + 1}: ${l.slice(0, 80)}`); });
  assert.deepEqual(bad, []);
  assert.ok(NAMES.length >= 8, `only ${NAMES.length} names read from the list`);
});
test('the QA audit skill stays light and holds only text', () => {
  assert.ok(files(DIR).every(f => f.endsWith('.md')), 'only text: no scripts or canaries');
  assert.ok(skill.split(/\s+/).length < 1500, `SKILL.md has ${skill.split(/\s+/).length} words: keep detail in references/`);
});
test('a report in the qa/ folder of a change does not disturb its records', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-')); fs.mkdirSync(path.join(d, 'docs'));
  const c = startSlice({ repo: d, title: 'Save books', request: 'A list', criteria: ['Shows saved books'], excludes: ['Sharing'] });
  const q = path.join(changeDirOf(d, c.id), 'qa'); fs.mkdirSync(q); fs.writeFileSync(path.join(q, 'report.md'), '# QA audit: Save books\n\nNo front matter here.\n');
  assert.deepEqual(listSlices(d).map(s => s.data.id), [c.id]);
});
test('Buddy offers the audit on demand, never as a stage of the cycle', () => {
  const at = buddy.indexOf('**QA audit, on demand.**'); assert.ok(at > 0);
  const line = buddy.slice(at, buddy.indexOf('\n', at));
  for (const must of ['`qa-audit` skill', 'never a stage of the cycle', 'do not run it unasked', 'only when the owner agrees']) assert.ok(line.includes(must), must);
});
