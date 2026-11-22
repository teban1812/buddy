import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execSync } from 'node:child_process';
import { mergeClaudeMd, BLOCK, BEGIN, END } from '../src/claudemd.mjs';

const BUDDY = fileURLToPath(new URL('../bin/buddy.mjs', import.meta.url));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cmd-'));
const HOME = tmp();
const run = (args, cwd) => { const e = { ...process.env, HOME, USERPROFILE: HOME }; delete e.BUDDY_LIBRARY; return spawnSync('node', [BUDDY, ...args], { encoding: 'utf8', cwd, env: e }); };
const g = (cwd, c) => execSync(`git -c core.autocrlf=false -c user.name=t -c user.email=t@t ${c}`, { cwd, encoding: 'utf8' });
const project = () => { const d = path.join(tmp(), 'shop'); fs.mkdirSync(d); return d; };
const library = files => { const lib = tmp(); g(lib, 'init -q'); for (const [f, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(lib, f)), { recursive: true }); fs.writeFileSync(path.join(lib, f), c); } g(lib, 'add -A'); g(lib, 'commit -q -m v1'); return lib; };
const claude = d => fs.readFileSync(path.join(d, 'CLAUDE.md'), 'utf8');

test('the block points to the context, standards, inputs and records, and to the commit rules; and holds no id of Buddy\'s own', () => {
  for (const must of ['docs/context.md', 'docs/standards/', 'docs/inputs/', 'docs/buddy/', 'Conventional Commits', 'Slice: <name>', 'Buddy-Fix: <reason>']) assert.ok(BLOCK.includes(must), must);
  assert.doesNotMatch(BLOCK, /\b[RQ]\d+\b/); assert.ok(BLOCK.startsWith(BEGIN) && BLOCK.trimEnd().endsWith(END));
});
test('merge: created when there is none, put first in a template\'s file, appended to a file that was already there, kept or updated when it is already inside', () => {
  assert.deepEqual(mergeClaudeMd(null), { text: BLOCK, change: 'created' });
  const tpl = mergeClaudeMd('# Shop\nRun `npm test`.\n'); assert.equal(tpl.change, 'merged'); assert.ok(tpl.text.startsWith(BEGIN)); assert.ok(tpl.text.endsWith('# Shop\nRun `npm test`.\n'));
  const mine = mergeClaudeMd('# My own rules\nBe kind.\n', { where: 'end' }); assert.equal(mine.change, 'merged'); assert.ok(mine.text.startsWith('# My own rules\nBe kind.\n')); assert.ok(mine.text.endsWith(BLOCK));
  assert.deepEqual(mergeClaudeMd(tpl.text), { text: tpl.text, change: 'kept' });
  const old = tpl.text.replace('## Built with Buddy', '## Built with Buddy (old words)'); const up = mergeClaudeMd(old); assert.equal(up.change, 'updated'); assert.equal(up.text, tpl.text);
  const edited = mergeClaudeMd(`# Top\n\n${BLOCK}\n# Below, written by the team\n`); assert.equal(edited.change, 'kept'); assert.ok(edited.text.includes('# Below, written by the team'));
});

test('init writes a CLAUDE.md in a new project, says so, and a second init keeps it', () => {
  const d = project(); const r = run(['init', '--no-library'], d); assert.equal(r.status, 0, r.stderr);
  assert.equal(claude(d), BLOCK); assert.match(r.stdout, /created +CLAUDE\.md/); assert.doesNotMatch(r.stdout, /\b[RQ]\d+\b/);
  const again = run(['init', '--no-library'], d); assert.equal(again.status, 0, again.stderr); assert.equal(claude(d), BLOCK); assert.match(again.stdout, /kept +CLAUDE\.md/);
});
test('when the library\'s template brings a CLAUDE.md, the project gets both: Buddy\'s block first, the template\'s text kept', () => {
  const lib = library({ 'standards/p/rules.md': '# rules\n', 'templates/p/CLAUDE.md': '# Shop\nRun the tests with `npm test`.\n', 'templates/p/README.md': '# app\n' });
  const d = project(); const r = run(['init', '--library', lib, '--profile', 'p'], d); assert.equal(r.status, 0, r.stderr);
  const t = claude(d); assert.ok(t.startsWith(BEGIN)); assert.ok(t.includes('Run the tests with `npm test`.')); assert.equal(t.split(BEGIN).length - 1, 1); assert.match(r.stdout, /merged +CLAUDE\.md[^\n]*template's text was kept/);
});
test('a CLAUDE.md the folder already had is only appended to; what the team wrote stays as it was', () => {
  const d = project(); fs.writeFileSync(path.join(d, 'CLAUDE.md'), '# Our rules\nNever deploy on Fridays.\n');
  const r = run(['init', '--no-library'], d); assert.equal(r.status, 0, r.stderr);
  const t = claude(d); assert.ok(t.startsWith('# Our rules\nNever deploy on Fridays.\n')); assert.ok(t.endsWith(BLOCK)); assert.match(r.stdout, /merged +CLAUDE\.md[^\n]*added at the end/);
});
