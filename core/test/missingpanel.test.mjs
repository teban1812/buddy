import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { panelInstalled, missingPanelLines, setLanguage, readSetting } from '../src/tools.mjs';

// Telling the owner how to install a missing panel (buddy-mod AC6): fake machines (a home folder and a PATH of stand-in programs); nothing is installed by Buddy.
const BUDDY = fileURLToPath(new URL('../bin/buddy.mjs', import.meta.url));
const posix = process.platform !== 'win32';
function machine({ tools = ['claude', 'agy'], claudePanel = false, agyPanel = false } = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-')), bin = path.join(d, 'bin'); fs.mkdirSync(bin);
  for (const t of tools) { fs.writeFileSync(path.join(bin, t), '#!/bin/sh\n'); fs.chmodSync(path.join(bin, t), 0o755); }
  if (claudePanel) fs.mkdirSync(path.join(d, 'cfg', 'plugins', 'cache', 'buddy', 'buddy-panel', '0.1.0'), { recursive: true });
  if (agyPanel) { fs.mkdirSync(path.join(d, '.gemini', 'config', 'plugins', 'buddy-panel'), { recursive: true }); fs.writeFileSync(path.join(d, '.gemini', 'config', 'plugins', 'buddy-panel', 'plugin.json'), '{}'); }
  return { dir: d, env: { PATH: bin, HOME: d, CLAUDE_CONFIG_DIR: path.join(d, 'cfg'), BUDDY_HOME: path.join(d, 'home') } };
}

test('a panel is installed when its folder is there, and nothing is run to know it', { skip: !posix }, () => {
  const m = machine({ claudePanel: true, agyPanel: true }), n = machine();
  assert.ok(panelInstalled('claude', m.env) && panelInstalled('agy', m.env));
  assert.ok(!panelInstalled('claude', n.env) && !panelInstalled('agy', n.env));
  const other = machine(); fs.mkdirSync(path.join(other.dir, 'cfg', 'plugins', 'cache', 'buddy', 'buddy', '0.4.0'), { recursive: true });
  assert.ok(!panelInstalled('claude', other.env), 'the Buddy plugin itself is not its panel');
});

test('a tool with its panel says nothing; one without says it once, with the install line, and a second run says nothing', { skip: !posix }, () => {
  const ok = machine({ claudePanel: true, agyPanel: true });
  assert.deepEqual(missingPanelLines(ok.env), []);
  assert.equal(readSetting(ok.env).panelsTold, undefined, 'nothing is remembered when nothing was said');
  const m = machine({ claudePanel: true });
  const first = missingPanelLines(m.env);
  assert.equal(first.length, 1); assert.match(first[0], /^Antigravity .*agy plugin install /); assert.ok(!first[0].includes('\n'));
  assert.deepEqual(missingPanelLines(m.env), []);
  assert.deepEqual(readSetting(m.env).panelsTold, { agy: true });
  const both = machine(), say = missingPanelLines(both.env);
  assert.equal(say.length, 2); assert.match(say[0], /claude plugin install buddy-panel@buddy$/);
  assert.equal(fs.existsSync(path.join(both.dir, 'cfg', 'plugins')), false, 'nothing was installed');
  assert.equal(fs.existsSync(path.join(both.dir, '.gemini')), false);
});

test('a tool that is not on the machine is not told about, and the owner\'s language is used', { skip: !posix }, () => {
  const m = machine({ tools: ['claude'] }); setLanguage('es', m.env);
  const l = missingPanelLines(m.env);
  assert.equal(l.length, 1); assert.match(l[0], /^Claude Code está aquí pero no su panel/); assert.match(l[0], /claude plugin install buddy-panel@buddy/);
  assert.equal(readSetting(m.env).language, 'es', 'the language is kept');
});

test('the text board says it once', { skip: !posix }, () => {
  const m = machine({ tools: ['claude'] }), repo = path.join(m.dir, 'proj'); fs.mkdirSync(path.join(repo, 'docs', 'buddy'), { recursive: true });
  const run = () => { const e = { ...process.env, ...m.env }; delete e.CLAUDE_PLUGIN_ROOT; delete e.CLAUDECODE; return spawnSync(process.execPath, [BUDDY, 'board', '--repo', repo], { encoding: 'utf8', env: e }); };
  const a = run(), b = run();
  assert.equal(a.status, 0, a.stderr); assert.match(a.stdout, /claude plugin install buddy-panel@buddy/);
  assert.doesNotMatch(b.stdout, /buddy-panel/);
});
