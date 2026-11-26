import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseDocument } from '../src/frontmatter.mjs';

// Buddy's plugin loads in Claude Code and in Antigravity from one text (support-antigravity, step 1, A2). Antigravity skips an agent whose
// `tools` is a string (Claude Code takes a string or a list) and a hooks file that is not an event map under "hooks"; these tests fail
// when either drifts back, and, where `agy` is installed, the real loader is asked (it runs no model, in a scratch HOME).
const CORE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const agents = fs.readdirSync(path.join(CORE, 'agents')).filter(f => f.endsWith('.md'));

test('each tool gets Dev\'s tools in its own names: the shared agent names Antigravity\'s (Claude Code does not read it), Claude Code\'s adapter names Claude\'s', () => {
  const CLAUDE = ['Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob'];
  for (const f of agents) {
    const { data: frontmatter, error } = parseDocument(fs.readFileSync(path.join(CORE, 'agents', f), 'utf8'));
    assert.equal(error, null, `${f}: ${error}`);
    if (frontmatter.tools === undefined) continue;
    assert.ok(Array.isArray(frontmatter.tools), `${f}: tools must be a list`);
    for (const t of frontmatter.tools) assert.ok(!CLAUDE.includes(t), `${f}: ${t} is Claude Code's name; \`agy --agent\` fails with "tool not found in registry"`);
  }
  const shared = parseDocument(fs.readFileSync(path.join(CORE, 'agents/dev.md'), 'utf8')).data;
  assert.deepEqual(shared.tools, ['read_file', 'edit_file', 'write_file', 'run_command'], 'without a tools line Antigravity gives Dev read tools only, so it cannot build (real run, agy 1.5.14)');
  const adapter = fs.readFileSync(path.join(CORE, '.claude-plugin/agents/dev.md'), 'utf8');
  const { data: fm, error } = parseDocument(adapter);
  assert.equal(error, null);
  assert.deepEqual(fm.tools, CLAUDE); assert.equal(fm.name, 'dev');
  assert.match(adapter, /agents\/dev\.md/);
  const manifest = JSON.parse(fs.readFileSync(path.join(CORE, '.claude-plugin/plugin.json'), 'utf8'));
  assert.ok(manifest.agents.includes('./.claude-plugin/agents/dev.md') && manifest.agents.includes('./agents/buddy.md') && !manifest.agents.includes('./agents/dev.md'));
});

test('the commit-check hook is an event map under "hooks" that runs the plugin\'s program, in the one file both tools convert', () => {
  const j = JSON.parse(fs.readFileSync(path.join(CORE, 'hooks', 'hooks.json'), 'utf8'));
  const entry = j.hooks?.PreToolUse?.[0];
  assert.equal(entry?.matcher, 'Bash');
  assert.equal(entry.hooks[0].type, 'command');
  assert.match(entry.hooks[0].command, /bin\/commithook\.mjs/);
});

test('the commit-check hook reads what each tool sends: Claude Code (tool_name, tool_input) and Antigravity (toolCall.args.CommandLine), blocking a bad message in both', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-project-'));
  fs.mkdirSync(path.join(project, 'docs', 'buddy'), { recursive: true });
  const run = payload => spawnSync('node', [path.join(CORE, 'bin', 'commithook.mjs')], { input: JSON.stringify({ cwd: project, ...payload }), encoding: 'utf8' });
  const claude = cmd => ({ tool_name: 'Bash', tool_input: { command: cmd } });
  const antigravity = cmd => ({ toolCall: { name: 'run_command', args: { CommandLine: cmd } } });
  for (const [tool, send] of [['Claude Code', claude], ['Antigravity', antigravity]]) {
    const bad = run(send("git commit -m 'bad message'"));
    assert.equal(bad.status, 2, `${tool}: a bad message must be refused: ${bad.stderr}`);
    assert.match(bad.stderr, /Buddy stopped this commit/);
    assert.equal(run(send("git commit -m 'feat(core): add a'")).status, 0, `${tool}: a good message passes`);
    assert.equal(run(send('ls')).status, 0, `${tool}: other commands are left alone`);
  }
});

const agy = spawnSync('agy', ['--version'], { encoding: 'utf8' });
test('the real Antigravity loader keeps both agents and the hook', { skip: agy.status !== 0 && 'agy is not installed' }, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-home-'));
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  const run = (...a) => spawnSync('agy', ['plugin', ...a], { env, encoding: 'utf8' });
  const inst = run('install', CORE); assert.equal(inst.status, 0, inst.stdout + inst.stderr);
  const v = run('validate', path.join(home, '.gemini', 'config', 'plugins', 'buddy'), '--strict');
  assert.equal(v.status, 0, v.stdout + v.stderr);
  assert.match(v.stdout, new RegExp(`agents ${agents.length} .* hooks 1 `));
});

test('the program is reached the same way in the three places that call it: each names Claude Code\'s way and Antigravity\'s, once, in the one text', () => {
  const claude = '${CLAUDE_PLUGIN_ROOT}/bin/buddy.mjs';
  const antigravity = 'node "$(command -v buddy.mjs)"';
  for (const f of ['agents/buddy.md', 'agents/dev.md', 'skills/intake/SKILL.md']) {
    const text = fs.readFileSync(path.join(CORE, f), 'utf8');
    assert.ok(text.includes(`node "${claude}"`), `${f}: Claude Code's way must stay`);
    assert.ok(text.includes(antigravity), `${f}: must tell Antigravity how to find buddy.mjs (its plugin's bin folder is on the path; the Claude variable arrives empty)`);
  }
});
