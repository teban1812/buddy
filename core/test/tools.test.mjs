import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { effective, findTools, toolCommand, offers, resolveLevel, readSetting, setWord, settingFile } from '../src/tools.mjs';

// The setting of each environment (support-antigravity, step 3). No model is called: the tools are stand-in programs on a scratch PATH that print a model list.
const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'buddy.mjs');
const LIST = ['gemini-4-neon-high\tNeon (High)', 'gemini-4-neon-low\tNeon (Low)', 'gemini-4-argon-medium\tArgon', 'gemini-3.8-flash-high\tFlash (High)', 'gemini-3.8-flash-low\tFlash (Low)'];
function machine(tools, models = LIST) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-')); const bin = path.join(d, 'bin'); fs.mkdirSync(bin);
  for (const t of tools) { fs.writeFileSync(path.join(bin, t), `#!/bin/sh\nprintf 'Fetching available models...\\n'\n${models.map(m => `printf '${m.replace('\t', '\\t')}\\n'`).join('\n')}\n`); fs.chmodSync(path.join(bin, t), 0o755); }
  return { home: path.join(d, 'home'), env: { PATH: bin, BUDDY_HOME: path.join(d, 'home') } };
}
const posix = process.platform !== 'win32';

test('the setting lives in the home folder (BUDDY_HOME overrides it), finds the tools there and starts from them: Dev and the review in Buddy\'s tool (R235)', { skip: !posix }, () => {
  const both = machine(['claude', 'agy']);
  assert.deepEqual(findTools(both.env), ['claude', 'agy']);
  assert.equal(settingFile(both.env), path.join(both.home, 'environment.json'));
  let e = effective({ ...both.env, CLAUDE_PLUGIN_ROOT: '/x' }); assert.deepEqual([e.runsIn, e.dev, e.reviewer], ['claude', 'claude', 'claude']);
  e = effective({ ...both.env, BUDDY_TOOL: 'agy' }); assert.deepEqual([e.runsIn, e.dev, e.reviewer], ['agy', 'agy', 'agy']);
  const one = machine(['claude']); e = effective({ ...one.env, CLAUDE_PLUGIN_ROOT: '/x' }); assert.deepEqual([e.dev, e.reviewer], ['claude', 'claude']);
  const agyOnly = machine(['agy']); e = effective(agyOnly.env); assert.deepEqual([e.runsIn, e.dev, e.reviewer], ['agy', 'agy', 'agy']);
  assert.equal(fs.existsSync(both.home), false, 'reading the setting writes nothing');
});

test('a setting from before R238 that named a tool per role is ignored: Dev and the review stay in Buddy\'s tool', { skip: !posix }, () => {
  const { env } = machine(['claude', 'agy']); fs.mkdirSync(path.dirname(settingFile(env)), { recursive: true });
  fs.writeFileSync(settingFile(env), JSON.stringify({ dev: 'agy', reviewer: 'claude' }));
  let e = effective({ ...env, CLAUDE_PLUGIN_ROOT: '/x' }); assert.deepEqual([e.runsIn, e.dev, e.reviewer], ['claude', 'claude', 'claude']);
  e = effective({ ...env, BUDDY_TOOL: 'agy' }); assert.deepEqual([e.runsIn, e.dev, e.reviewer], ['agy', 'agy', 'agy']);
});

test('base words per level and tool: Claude haiku, sonnet, opus; Antigravity flash for the economical and the tool\'s default for the others; the command shows what each tool offers', { skip: !posix }, () => {
  const m = machine(['claude', 'agy']);
  assert.deepEqual(offers('agy', { env: m.env }).models, ['gemini-4-neon-high', 'gemini-4-neon-low', 'gemini-4-argon-medium', 'gemini-3.8-flash-high', 'gemini-3.8-flash-low']);
  assert.deepEqual(['economical', 'balanced', 'strong'].map(l => resolveLevel('claude', l, { env: m.env }).model), ['haiku', 'sonnet', 'opus']);
  assert.equal(resolveLevel('agy', 'economical', { env: m.env }).model, 'gemini-3.8-flash-high');
  const r = resolveLevel('agy', 'strong', { env: m.env }); assert.equal(r.model, undefined); assert.match(r.notes[0], /default model is used/);
  const out = spawnSync(process.execPath, [BIN, 'tools'], { encoding: 'utf8', env: m.env });
  assert.equal(out.status, 0, out.stderr); assert.match(out.stdout, /Antigravity offers: gemini-4-neon-high/); assert.match(out.stdout, /efforts: low, medium, high/); assert.match(out.stdout, /Claude Code offers: haiku, sonnet, opus/);
  const set = spawnSync(process.execPath, [BIN, 'tools', 'word', 'agy', 'strong', 'neon', 'high'], { encoding: 'utf8', env: m.env });
  assert.equal(set.status, 0, set.stderr); assert.match(set.stdout, /strong\s+word neon \+ high -> gemini-4-neon-high/);
  assert.equal(spawnSync(process.execPath, [BIN, 'tools', 'word', 'agy', 'huge', 'x'], { encoding: 'utf8', env: m.env }).status, 1);
});

test('an effort word joins the model offered today; where the tool offers no such effort it is ignored and says so', { skip: !posix }, () => {
  const { env } = machine(['claude', 'agy']);
  setWord('agy', 'strong', 'neon', 'low', env); let r = resolveLevel('agy', 'strong', { env });
  assert.equal(r.model, 'gemini-4-neon-low'); assert.deepEqual(r.notes, []);
  setWord('agy', 'strong', 'argon', 'high', env); r = resolveLevel('agy', 'strong', { env });
  assert.equal(r.model, 'gemini-4-argon-medium'); assert.match(r.notes[0], /no "high" version/);
  setWord('agy', 'strong', 'neon', 'xhigh', env); r = resolveLevel('agy', 'strong', { env, offer: { models: ['gemini-4-neon-low'], efforts: ['low'] } });
  assert.equal(r.model, 'gemini-4-neon-low'); assert.match(r.notes[0], /offers no "xhigh" effort/);
  setWord('claude', 'balanced', 'sonnet', 'high', env); r = resolveLevel('claude', 'balanced', { env });
  assert.deepEqual([r.model, r.effort], ['sonnet', 'high']);
  setWord('agy', 'strong', 'neon', '-', env); assert.equal(resolveLevel('agy', 'strong', { env }).model, 'gemini-4-neon-high');
});

test('a word that matches nothing any more: the same family is used, the work carries on, the setting is corrected and a note waits for the owner\'s summary', { skip: !posix }, () => {
  const { env } = machine(['agy']);
  setWord('agy', 'economical', 'flash-lite', undefined, env);
  const r = resolveLevel('agy', 'economical', { env }); assert.equal(r.model, 'gemini-3.8-flash-high'); assert.match(r.notes[0], /"flash-lite" matches nothing/); assert.match(r.notes[0], /"flash", the same family/);
  assert.equal(readSetting(env).levels.agy.economical.word, 'flash'); assert.match(readSetting(env).notes[0], /was "flash-lite".*took "flash"/);
  assert.deepEqual(resolveLevel('agy', 'economical', { env }).notes, [], 'once corrected, it says nothing more');
  // no family left: the tool's default
  setWord('agy', 'balanced', 'zeta9', undefined, env);
  const d = resolveLevel('agy', 'balanced', { env }); assert.equal(d.model, undefined); assert.match(d.notes[0], /default model is used/); assert.equal(readSetting(env).levels.agy.balanced.word, null);
  assert.equal(readSetting(env).notes.length, 2);
  const shown = spawnSync(process.execPath, [BIN, 'tools'], { encoding: 'utf8', env }); assert.match(shown.stdout, /Changed by Buddy: The balanced word/);
  assert.doesNotMatch(spawnSync(process.execPath, [BIN, 'tools', 'seen'], { encoding: 'utf8', env }).stdout, /Changed by Buddy/);
});

test('a tool whose model list cannot be read does not stop the work: its default is used and the word is not "corrected"', { skip: !posix }, () => {
  const { env } = machine(['agy'], []);
  const r = resolveLevel('agy', 'economical', { env }); assert.equal(r.model, undefined); assert.match(r.notes[0], /gave no list/);
  assert.equal(readSetting(env).levels, undefined);
});

// Step 4: the reviewer and the analysis ask for a level and run through the tool the setting names. Stand-ins on a scratch PATH, no model.
import { claudeReviewer } from '../src/checkpoint.mjs';
import { claudeAsk } from '../src/analysis.mjs';
import { plan } from '../src/tools.mjs';
function standIns(tools, reply) {   // agy answers `models` with the list and anything else with `reply`; claude is only found
  const m = machine(tools), bin = m.env.PATH;
  if (tools.includes('agy')) { fs.writeFileSync(path.join(bin, 'agy'), `#!/bin/sh\nif [ "$1" = models ]; then\n${LIST.map(x => `printf '${x.replace('\t', '\\t')}\\n'`).join('\n')}\nelse\nprintf '%s\\n' "$@" > "${bin}/argv"\n${reply.split('\n').map(l => `printf '%s\\n' '${l.replace(/'/g, "'\\''")}'`).join('\n')}\nfi\n`); fs.chmodSync(path.join(bin, 'agy'), 0o755); }
  return m;
}
const VERDICT = '{"does_what_was_asked": true, "weakens_or_hides_checks": false, "unspecified_decisions": [], "details": "ok"}';

test('a machine with Claude Code only asks for the same words as 0.4.0: haiku for the analysis, and the reviewer (the same tool as Dev) one level above Dev\'s', { skip: !posix }, () => {
  const m = machine(['claude']); const env = { ...m.env, CLAUDE_PLUGIN_ROOT: '/x' };
  assert.deepEqual(plan('analysis', 'economical', { env }).flags, ['--model', 'haiku']);
  assert.deepEqual(plan('dev', 'balanced', { env }).flags, ['--model', 'sonnet']);
  assert.deepEqual(plan('reviewer', 'balanced', { env }).flags, ['--model', 'opus']);
  assert.deepEqual(plan('analysis', 'economical', { env, model: 'claude-x' }).flags, ['--model', 'claude-x'], 'a word given by hand skips the level');
  let call; const rv = claudeReviewer({ env, spawn: (cmd, args, o) => { call = { cmd, args, o }; return { status: 0, stdout: JSON.stringify({ type: 'result', result: VERDICT }), stderr: '' }; } });
  assert.equal(rv('p').does_what_was_asked, true); assert.equal(call.cmd, 'claude'); assert.deepEqual(call.args.slice(0, 3), ['-p', '--model', 'opus']); assert.equal(rv.agent, true);
  assert.deepEqual(plan('reviewer', 'balanced', { env: { ...env, BUDDY_TOOL: 'claude' } }).flags, ['--model', 'opus']);
});

test('in Antigravity the review is a fresh agy session with --output-format stream-json, even with Claude Code on the machine: agent mode parses opened files and verdict, plain text falls back, and level notes pass on', { skip: !posix }, () => {
  const agyReply = [
    JSON.stringify({ event: 'step_update', step_update: { step_index: 1, state: 'DONE', step_type: 'tool', tool_name: 'read_file', tool_info: { name: 'read_file', parameters: { Path: '/repo/core/src/init.mjs' } } } }),
    JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: `Here it is:\n${VERDICT}` } }),
  ].join('\n');
  const m = standIns(['claude', 'agy'], agyReply); const env = { ...m.env, BUDDY_TOOL: 'agy' };
  setWord('agy', 'balanced', 'neon', 'high', env); setWord('agy', 'strong', 'oldname', undefined, env);
  const p = plan('reviewer', 'balanced', { env }); assert.equal(p.tool, 'agy'); assert.deepEqual(p.flags, ['--model', 'gemini-4-neon-high']);
  let call; const rv = claudeReviewer({ env, spawn: (cmd, args, o) => { call = { cmd, args, o }; return spawnSync(cmd, args, { ...o, env }); } });
  const r = rv('the prompt'); assert.equal(r.does_what_was_asked, true); assert.equal(rv.agent, true, 'agy runs in agent mode with stream-json');
  assert.deepEqual(r.opened.read, ['/repo/core/src/init.mjs']);
  assert.equal(call.cmd, 'agy'); assert.deepEqual(call.args, ['--model', 'gemini-4-neon-high', '--output-format', 'stream-json', '-p=the prompt']); assert.equal(call.o.input, undefined);
  assert.equal(fs.readFileSync(path.join(m.env.PATH, 'argv'), 'utf8').split('\n')[0], '--model');
  // plain-text fallback when an older stub or non-JSON reply returns plain text
  const plain = claudeReviewer({ env, spawn: () => ({ status: 0, stdout: `Here it is:\n${VERDICT}`, stderr: '' }) })('p');
  assert.equal(plain.does_what_was_asked, true);
  // a retired word: the work goes on with the tool's default, says so, and the correction is in the setting
  setWord('agy', 'balanced', 'oldname', undefined, env); const q = claudeReviewer({ env, spawn: (c, a, o) => spawnSync(c, a, { ...o, env }) }); const r2 = q('x');
  assert.equal(r2.does_what_was_asked, true); assert.match(r2.notes[0], /"oldname" matches nothing Antigravity offers/);
  assert.ok(readSetting(env).notes.length, 'the owner is told in his next summary');
  const dead = claudeReviewer({ env, spawn: () => ({ status: 1, stdout: '', stderr: 'boom\n' }) })('x'); assert.equal(dead.does_what_was_asked, null); assert.match(dead.details, /ended without a verdict \(exit 1\): boom/);
});

test('the analysis runs through agy at the economical level when Dev builds there', { skip: !posix }, async () => {
  const m = standIns(['agy'], 'request'); const env = { ...m.env }; const was = process.env.PATH; process.env.PATH = m.env.PATH;
  try {
    const notes = []; const ask = claudeAsk({ env, onNote: n => notes.push(n) });
    assert.equal((await ask('what now')).trim(), 'request');
    assert.deepEqual(fs.readFileSync(path.join(m.env.PATH, 'argv'), 'utf8').split('\n').slice(0, 2), ['--model', 'gemini-3.8-flash-high']);
    assert.deepEqual(notes, []);
  } finally { process.env.PATH = was; }
});

// Step 5.1 and R235: the tool that built is recorded when Dev was raised; the review stays in the tool Buddy runs in, as a fresh session.
import { registerWorker, builderOf } from '../src/workers.mjs';
import { execFileSync } from 'node:child_process';
test('Dev is registered with its tool in general terms, and the checkpoint reads who built', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bld-')); execFileSync('git', ['init', '-q'], { cwd: d });
  assert.equal(builderOf(d, 'some-change'), undefined);
  registerWorker(d, { slice: 'some-change', role: 'dev', id: 'd1', runtime: 'antigravity' }); assert.equal(builderOf(d, 'some-change'), 'agy');
  registerWorker(d, { slice: 'some-change', role: 'reviewer', id: 'r1' }); registerWorker(d, { slice: 'some-change', role: 'dev', id: 'd2' });
  assert.equal(builderOf(d, 'some-change'), 'claude', 'the latest Dev counts; no runtime means Claude Code');
  assert.throws(() => registerWorker(d, { slice: 'some-change', role: 'dev', id: 'd3', runtime: 'gemini-4-neon' }), /the tool, never the model/);
});
test('with both tools on the machine the review stays in the tool Buddy runs in, a fresh session at the strong level (R235, R238)', { skip: !posix }, () => {
  const both = machine(['claude', 'agy']).env;
  const inClaude = { ...both, CLAUDE_PLUGIN_ROOT: '/x' }; const p = plan('reviewer', 'balanced', { env: inClaude });
  assert.equal(p.tool, 'claude'); assert.deepEqual(p.flags, ['--model', 'opus']);
  let call; const rv = claudeReviewer({ env: inClaude, spawn: cmd => { call = cmd; return { status: 0, stdout: '', stderr: '' }; } }); rv('p'); assert.equal(call, 'claude'); assert.equal(rv.agent, true);
  assert.equal(plan('reviewer', 'balanced', { env: { ...both, BUDDY_TOOL: 'agy' } }).tool, 'agy');
  assert.equal(plan('dev', 'balanced', { env: inClaude }).tool, 'claude');
});

test('Antigravity bundled binary (~/.gemini/bin/agy) is found when agy is not on PATH, and missing agy gives a clear error (support-antigravity-ide, step 2)', { skip: !posix }, () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-bundle-'));
  const gbin = path.join(d, '.gemini', 'bin'); fs.mkdirSync(gbin, { recursive: true });
  const bundled = path.join(gbin, 'agy');
  fs.writeFileSync(bundled, `#!/bin/sh\nprintf 'gemini-3.8-flash-high\\tFlash (High)\\n'\n`); fs.chmodSync(bundled, 0o755);
  const env = { PATH: path.join(d, 'empty'), HOME: d, BUDDY_HOME: path.join(d, 'buddy') };
  assert.equal(toolCommand('agy', env), bundled);
  assert.deepEqual(findTools(env), ['agy']);
  assert.equal(plan('reviewer', 'balanced', { env }).cmd, bundled);
  assert.deepEqual(offers('agy', { env }).models, ['gemini-3.8-flash-high']);
  const missingEnv = { PATH: path.join(d, 'empty'), HOME: path.join(d, 'no-home'), BUDDY_HOME: path.join(d, 'buddy2') };
  assert.equal(toolCommand('agy', missingEnv), null);
  assert.match(offers('agy', { env: missingEnv }).error, /was not found on PATH or in ~\/\.gemini\/bin\/agy/);
});

test('buddy tools language <en|es> keeps the language of the panels in the setting of the machine, English when unset (R253)', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lang-')); const env = { ...process.env, BUDDY_HOME: home };
  const tools = (...a) => spawnSync(process.execPath, [BIN, 'tools', ...a], { encoding: 'utf8', env });
  assert.match(tools().stdout, /Language of the panels: English \(en\), none set/);
  assert.equal(tools('language', 'es').status, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(home, 'environment.json'), 'utf8')).language, 'es');
  assert.match(tools().stdout, /Language of the panels: Spanish \(es\), set by you/);
  const bad = tools('language', 'fr'); assert.equal(bad.status, 1); assert.match(bad.stderr, /not "fr"/);
  assert.equal(tools('language').status, 2);
  assert.match(tools('language', 'en').stdout, /English \(en\), set by you/, 'a no is kept too, so Buddy does not ask again');
});
