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

// Init brings each tool found its instructions (support-antigravity, step 6.1): stand-ins on a scratch PATH, no model.
const machine = tools => { const bin = tmp(); for (const t of ['git', 'node']) fs.symlinkSync(execSync(`command -v ${t}`, { encoding: 'utf8' }).trim(), path.join(bin, t)); for (const t of tools) fs.writeFileSync(path.join(bin, t), '#!/bin/sh\n', { mode: 0o755 }); return bin; };
const born = (tools, setup = () => {}) => { const d = project(); setup(d); const r = spawnSync('node', [BUDDY, 'init', '--no-library'], { encoding: 'utf8', cwd: d, env: { ...process.env, HOME, USERPROFILE: HOME, PATH: machine(tools), GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }); assert.equal(r.status, 0, r.stderr); return { d, r, has: f => fs.existsSync(path.join(d, f)) }; };
const posix = process.platform !== 'win32';

test('with both tools, CLAUDE.md and AGENTS.md hold the same block; no GEMINI.md', { skip: !posix }, () => {
  const { d, r, has } = born(['claude', 'agy']);
  assert.equal(claude(d), BLOCK); assert.equal(fs.readFileSync(path.join(d, 'AGENTS.md'), 'utf8'), BLOCK); assert.equal(has('GEMINI.md'), false);
  assert.match(r.stdout, /created +AGENTS\.md/); assert.ok(has('.claude/settings.json'));
});
test('with Claude Code only, init writes what 0.4.0 wrote: CLAUDE.md and the permissions, no AGENTS.md', { skip: !posix }, () => {
  const { has, d } = born(['claude']); assert.equal(has('AGENTS.md'), false); assert.equal(claude(d), BLOCK); assert.ok(has('.claude/settings.json'));
});
test('with Antigravity only, init writes AGENTS.md and nothing for Claude Code', { skip: !posix }, () => {
  const { has, d, r } = born(['agy']); assert.equal(fs.readFileSync(path.join(d, 'AGENTS.md'), 'utf8'), BLOCK); assert.equal(has('CLAUDE.md'), false); assert.equal(has('.claude'), false);
  assert.ok(!/AGENTS\.md[^\n]*git commit/.test(r.stdout)); assert.match(spawnSync('git', ['show', '--name-only', '--format='], { cwd: d, encoding: 'utf8' }).stdout, /AGENTS\.md/);
});
test('with neither tool found init falls back to Claude Code, as in 0.4.0', { skip: !posix }, () => {
  const { has } = born([]); assert.ok(has('CLAUDE.md')); assert.equal(has('AGENTS.md'), false);
});
test('an AGENTS.md the folder already had is only appended to, and a second init keeps both files', { skip: !posix }, () => {
  const { d } = born(['claude', 'agy'], d => fs.writeFileSync(path.join(d, 'AGENTS.md'), '# Ours\n'));
  const t = fs.readFileSync(path.join(d, 'AGENTS.md'), 'utf8'); assert.ok(t.startsWith('# Ours\n') && t.endsWith(BLOCK));
  const again = spawnSync('node', [BUDDY, 'init', '--no-library'], { encoding: 'utf8', cwd: d, env: { ...process.env, HOME, USERPROFILE: HOME, PATH: machine(['claude', 'agy']) } });
  assert.match(again.stdout, /kept +AGENTS\.md/); assert.equal(fs.readFileSync(path.join(d, 'AGENTS.md'), 'utf8'), t);
});
test('a template that brings its own CLAUDE.md is merged as before, and AGENTS.md gets only the block', { skip: !posix }, () => {
  const lib = library({ 'standards/p/rules.md': '# rules\n', 'templates/p/CLAUDE.md': '# Shop\nRun `npm test`.\n', 'templates/p/README.md': '# app\n' });
  const d = project(); const r = spawnSync('node', [BUDDY, 'init', '--library', lib, '--profile', 'p'], { encoding: 'utf8', cwd: d, env: { ...process.env, HOME, USERPROFILE: HOME, PATH: machine(['claude', 'agy']) } }); assert.equal(r.status, 0, r.stderr);
  assert.ok(claude(d).includes('Run `npm test`.')); assert.equal(fs.readFileSync(path.join(d, 'AGENTS.md'), 'utf8'), BLOCK);
});
