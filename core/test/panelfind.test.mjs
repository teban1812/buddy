import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SCRIPT } from '../../panel/claude/hooks/find.js';

// How Claude Code's panel finds Buddy's program (build-claude-panel): the project's own core/bin/buddy.mjs, else the highest version of the Buddy plugin
// installed on the machine; it says 3 outside a Buddy project and 4 when there is no program. Run as the panel runs it: `node -e SCRIPT json|open`.
const tmp = p => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p)));
const fake = (file, name) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `const a = process.argv.slice(2);\nif (a[1] === '--out') fs.writeFileSync(a[2], '<html></html>');\nelse console.log(JSON.stringify({ from: ${JSON.stringify(name)}, args: a }));\n`.replace('const a', "import fs from 'node:fs';\nconst a")); };
const run = (cwd, mode, env = {}) => spawnSync(process.execPath, ['-e', SCRIPT, mode], { cwd, encoding: 'utf8', env: { ...process.env, HOME: cwd, USERPROFILE: cwd, CLAUDE_CONFIG_DIR: path.join(cwd, 'nothing'), ...env } });
const project = () => { const d = tmp('panel-'); fs.mkdirSync(path.join(d, 'docs', 'buddy'), { recursive: true }); return d; };

test('outside a Buddy project it answers 3, and with no program anywhere it answers 4', () => {
  assert.equal(run(tmp('panel-none-'), 'json').status, 3);
  assert.equal(run(project(), 'json').status, 4);
});

test('it prefers the project\'s own core/bin/buddy.mjs', () => {
  const d = project(); fake(path.join(d, 'core', 'bin', 'buddy.mjs'), 'own');
  const cfg = path.join(d, 'cfg'); fake(path.join(cfg, 'plugins', 'cache', 'cat', 'buddy', '9.0.0', 'bin', 'buddy.mjs'), 'installed');
  const r = run(d, 'json', { CLAUDE_CONFIG_DIR: cfg });
  assert.equal(r.status, 0); assert.deepEqual(JSON.parse(r.stdout), { from: 'own', args: ['board', '--json'] });
});

test('else it takes the highest version of the Buddy plugin installed, across catalogues (0.10.0 is above 0.9.0)', () => {
  const d = project(); const cache = path.join(d, '.claude', 'plugins', 'cache');
  for (const [cat, v] of [['one', '0.9.0'], ['two', '0.10.0'], ['three', '0.4.0']]) fake(path.join(cache, cat, 'buddy', v, 'bin', 'buddy.mjs'), `${cat}-${v}`);
  fake(path.join(cache, 'four', 'other-plugin', '9.9.9', 'bin', 'buddy.mjs'), 'not buddy');
  const r = run(d, 'json', { CLAUDE_CONFIG_DIR: '' });
  assert.equal(r.status, 0); assert.equal(JSON.parse(r.stdout).from, 'two-0.10.0');
});

// R287 (find-project-from-subfolder): the conversation's folder may have moved inside the project (docs/buddy/milestones); the finder goes up to the nearest folder
// holding docs/buddy and runs everything there, the page included; outside any project it still answers 3, and a project inside another is itself.
test('from a folder inside the project it goes up to the nearest folder holding docs/buddy, for the board and the page; a project inside another is itself', { skip: process.platform === 'win32' }, () => {
  const d = project(); fake(path.join(d, 'core', 'bin', 'buddy.mjs'), 'own');
  const sub = path.join(d, 'docs', 'buddy', 'milestones'); fs.mkdirSync(sub, { recursive: true });
  const r = run(sub, 'json');
  assert.equal(r.status, 0, r.stderr); assert.deepEqual(JSON.parse(r.stdout), { from: 'own', args: ['board', '--json'] });
  run(sub, 'open', { PATH: path.join(d, 'nobin') });
  assert.ok(fs.existsSync(path.join(d, '.buddy', 'board.html')), 'the page is written at the project\'s root');
  assert.ok(!fs.existsSync(path.join(sub, '.buddy')), 'not in the subfolder');
  const inner = path.join(d, 'apps', 'inner'); fs.mkdirSync(path.join(inner, 'docs', 'buddy'), { recursive: true }); fake(path.join(inner, 'core', 'bin', 'buddy.mjs'), 'inner');
  const deep = path.join(inner, 'src', 'lib'); fs.mkdirSync(deep, { recursive: true });
  assert.equal(JSON.parse(run(deep, 'json').stdout).from, 'inner', 'the nearest project wins');
  assert.equal(JSON.parse(run(path.join(d, 'apps'), 'json').stdout).from, 'own', 'beside the inner project it is the outer one');
});

test('from a folder inside no project, however deep, it still answers 3', () => {
  const deep = path.join(tmp('panel-none-'), 'a', 'b', 'c'); fs.mkdirSync(deep, { recursive: true });
  assert.equal(run(deep, 'json').status, 3);
  assert.equal(run(deep, 'open').status, 3);
});

// R284 (open-board-with-own-buddy): each panel prefers the Buddy of its own tool, and falls back to the other's only when its own is not installed.
const both = d => {
  fake(path.join(d, '.claude', 'plugins', 'cache', 'cat', 'buddy', '0.4.0', 'bin', 'buddy.mjs'), 'claude');
  fake(path.join(d, '.gemini', 'config', 'plugins', 'buddy', 'bin', 'buddy.mjs'), 'antigravity');
};
const from = (d, ...a) => { const r = spawnSync(process.execPath, ['-e', SCRIPT, ...a], { cwd: d, encoding: 'utf8', env: { ...process.env, HOME: d, USERPROFILE: d, CLAUDE_CONFIG_DIR: '' } }); assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout).from; };

test('Claude Code\'s panel takes Claude Code\'s Buddy and Antigravity\'s panel the one installed in Antigravity, for the short view and the page alike', { skip: process.platform === 'win32' }, () => {
  const d = project(); both(d);
  assert.equal(from(d, 'json'), 'claude');
  assert.equal(from(d, 'json', 'antigravity'), 'antigravity');
  // `open` writes the page with the same program the short view used: the fake records which one wrote it.
  for (const [tool, want] of [[[], 'claude'], [['antigravity'], 'antigravity']]) {
    const f = path.join(d, '.claude', 'plugins', 'cache', 'cat', 'buddy', '0.4.0', 'bin', 'buddy.mjs');
    const g = path.join(d, '.gemini', 'config', 'plugins', 'buddy', 'bin', 'buddy.mjs');
    for (const [file, name] of [[f, 'claude'], [g, 'antigravity']]) fs.writeFileSync(file, `import fs from 'node:fs'; const a = process.argv.slice(2); if (a[1] === '--out') fs.writeFileSync(a[2], ${JSON.stringify(name)});`);
    spawnSync(process.execPath, ['-e', SCRIPT, 'open', ...tool], { cwd: d, env: { ...process.env, HOME: d, USERPROFILE: d, CLAUDE_CONFIG_DIR: '', PATH: path.join(d, 'nobin') } });
    assert.equal(fs.readFileSync(path.join(d, '.buddy', 'board.html'), 'utf8'), want);
  }
});

test('each panel falls back to the other tool\'s Buddy only when its own is not installed, and the project\'s own program still wins', () => {
  const onlyAg = project(); fake(path.join(onlyAg, '.gemini', 'config', 'plugins', 'buddy', 'bin', 'buddy.mjs'), 'antigravity');
  assert.equal(from(onlyAg, 'json'), 'antigravity');
  const onlyClaude = project(); fake(path.join(onlyClaude, '.claude', 'plugins', 'cache', 'cat', 'buddy', '0.4.0', 'bin', 'buddy.mjs'), 'claude');
  assert.equal(from(onlyClaude, 'json', 'antigravity'), 'claude');
  const repo = project(); both(repo); fake(path.join(repo, 'core', 'bin', 'buddy.mjs'), 'own');
  assert.equal(from(repo, 'json'), 'own'); assert.equal(from(repo, 'json', 'antigravity'), 'own');
});

test('open writes the board\'s page to .buddy/board.html and answers 6 when no browser opens', { skip: process.platform === 'win32' }, () => {
  const d = project(); fake(path.join(d, 'core', 'bin', 'buddy.mjs'), 'own');
  const r = run(d, 'open', { PATH: path.join(d, 'nobin') });
  assert.ok(fs.existsSync(path.join(d, '.buddy', 'board.html')));
  assert.equal(r.status, 6, 'with no opener on the path it answers 6 (the panel then says it could not open it)');
});

test('language prints the person\'s language from the setting `buddy tools language` writes, in any folder; empty when unset or unreadable', () => {
  const home = tmp('panel-home-'); const d = tmp('panel-any-');
  const lang = () => run(d, 'language', { BUDDY_HOME: home });
  assert.deepEqual([lang().status, lang().stdout], [0, '\n']);
  const set = spawnSync(process.execPath, [fileURLToPath(new URL('../bin/buddy.mjs', import.meta.url)), 'tools', 'language', 'es'], { encoding: 'utf8', env: { ...process.env, BUDDY_HOME: home } });
  assert.equal(set.status, 0, set.stderr);
  assert.equal(lang().stdout, 'es\n');
  fs.writeFileSync(path.join(home, 'environment.json'), '{ not json');
  assert.equal(lang().stdout, '\n');
});
