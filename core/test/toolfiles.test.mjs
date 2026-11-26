import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execSync } from 'node:child_process';
import { BLOCK } from '../src/claudemd.mjs';
import { wrapperOf, readManifest } from '../src/toolfiles.mjs';

// Bringing each tool its files (support-antigravity, steps 6.2 and 6.3): stand-in programs on a scratch PATH and a scratch BUDDY_HOME, no model is called.
const BUDDY = fileURLToPath(new URL('../bin/buddy.mjs', import.meta.url));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tf-'));
const g = (cwd, c) => execSync(`git -c core.autocrlf=false -c user.name=t -c user.email=t@t ${c}`, { cwd, encoding: 'utf8' });
const NODE = path.dirname(process.execPath), posix = process.platform !== 'win32';
const PROMPT = '---\nname: release-review\ndescription: "Reviews a change before a test environment. Use it before a deployment."\nprofiles: [x]\n---\n# Release review\nSee appendix.md.\n';
const lib = (() => { const d = tmp(); g(d, 'init -q'); fs.mkdirSync(path.join(d, 'standards/x'), { recursive: true }); fs.writeFileSync(path.join(d, 'standards/x/r.md'), '# r\n');
  fs.mkdirSync(path.join(d, 'prompts/release-review'), { recursive: true }); fs.writeFileSync(path.join(d, 'prompts/release-review/SKILL.md'), PROMPT); fs.writeFileSync(path.join(d, 'prompts/release-review/appendix.md'), 'appendix\n'); g(d, 'add -A'); g(d, 'commit -q -m v1'); return d; })();
// node and npm in a folder of their own, so a claude installed beside node is not found
const machine = tools => { const d = tmp(), bin = path.join(d, 'bin'), nodeBin = path.join(d, 'node'); fs.mkdirSync(bin); fs.mkdirSync(nodeBin); fs.symlinkSync(process.execPath, path.join(nodeBin, 'node')); for (const t of ['npm', 'npx']) { const real = spawnSync('sh', ['-c', `command -v ${t}`], { encoding: 'utf8' }).stdout.trim(); if (real) { fs.writeFileSync(path.join(nodeBin, t), `#!/bin/sh\nexec "${real}" "$@"\n`); fs.chmodSync(path.join(nodeBin, t), 0o755); } } for (const t of tools) { fs.writeFileSync(path.join(bin, t), '#!/bin/sh\n'); fs.chmodSync(path.join(bin, t), 0o755); }
  return { PATH: `${bin}${path.delimiter}${nodeBin}${path.delimiter}/usr/bin${path.delimiter}/bin`, BUDDY_HOME: path.join(d, 'home'), HOME: d, GIT_AUTHOR_NAME: 'o', GIT_AUTHOR_EMAIL: 'o@o', GIT_COMMITTER_NAME: 'o', GIT_COMMITTER_EMAIL: 'o@o' }; };
const buddy = (args, cwd, env) => { const e = { ...process.env, ...env }; delete e.BUDDY_LIBRARY; delete e.CLAUDE_PLUGIN_ROOT; delete e.CLAUDECODE; return spawnSync(process.execPath, [BUDDY, ...args], { encoding: 'utf8', cwd, env: e }); };
const born = tools => { const d = path.join(tmp(), 'shop'); fs.mkdirSync(d); const r = buddy(['init', '--library', lib, '--profile', 'x'], d, machine(tools)); assert.equal(r.status, 0, r.stderr); return { d, r }; };
const at = (d, f) => { try { return fs.readFileSync(path.join(d, f), 'utf8'); } catch { return null; } };
const opts = { skip: !posix };

test('born on a machine with Claude Code only: the prompt in full in .agents/skills, a thin wrapper with the same front matter in .claude/skills, no AGENTS.md, a manifest of hashes', opts, () => {
  const { d, r } = born(['claude']);
  assert.equal(at(d, '.agents/skills/release-review/SKILL.md'), PROMPT); assert.equal(at(d, '.agents/skills/release-review/appendix.md'), 'appendix\n');
  const w = at(d, '.claude/skills/release-review/SKILL.md'); assert.equal(w, wrapperOf('release-review', PROMPT));
  assert.ok(w.startsWith(PROMPT.slice(0, PROMPT.indexOf('# Release review')))); assert.match(w, /Read the full prompt in `\.agents\/skills\/release-review\/SKILL\.md`/); assert.ok(!w.includes('See appendix'));
  assert.equal(at(d, 'AGENTS.md'), null); assert.equal(at(d, 'CLAUDE.md'), BLOCK);
  assert.deepEqual(Object.keys(readManifest(d)).sort(), ['.agents/skills/release-review/SKILL.md', '.agents/skills/release-review/appendix.md', '.claude/skills/release-review/SKILL.md', 'CLAUDE.md'].sort());
  assert.match(g(d, 'show --name-only --format='), /docs\/buddy\/tool-files\.json/); assert.equal(g(d, 'status --porcelain'), '');
  assert.match(r.stdout, /created +\.claude\/skills\/release-review\/SKILL\.md/);
});
test('born with Antigravity alone: the full prompt and AGENTS.md, nothing for Claude Code', opts, () => {
  const { d } = born(['agy']);
  assert.equal(at(d, '.agents/skills/release-review/SKILL.md'), PROMPT); assert.equal(at(d, 'AGENTS.md'), BLOCK);
  assert.equal(at(d, 'CLAUDE.md'), null); assert.equal(at(d, '.claude/skills/release-review/SKILL.md'), null); assert.equal(at(d, '.claude/settings.json'), null);
});
test('a tool that shows up later: the board brings its missing files, never over what exists, and then says nothing', opts, () => {
  const { d } = born(['claude']); fs.writeFileSync(path.join(d, 'CLAUDE.md'), `${BLOCK}\nMy own rules.\n`);
  const r = buddy(['board'], d, machine(['claude', 'agy'])); assert.equal(r.status, 0, r.stderr);
  assert.equal(at(d, 'AGENTS.md'), BLOCK); assert.match(r.stdout, /created +AGENTS\.md/); assert.equal(at(d, 'CLAUDE.md'), `${BLOCK}\nMy own rules.\n`);
  assert.ok('AGENTS.md' in readManifest(d)); assert.doesNotMatch(buddy(['board'], d, machine(['claude', 'agy'])).stdout, /created|found on this machine/);
  fs.writeFileSync(path.join(d, 'AGENTS.md'), 'Mine.\n'); buddy(['board'], d, machine(['claude', 'agy'])); assert.equal(at(d, 'AGENTS.md'), 'Mine.\n');
  const { d: e } = born(['agy']); const b = buddy(['board'], e, machine(['claude', 'agy']));
  assert.equal(at(e, 'CLAUDE.md'), BLOCK); assert.equal(at(e, '.claude/skills/release-review/SKILL.md'), wrapperOf('release-review', PROMPT)); assert.match(b.stdout, /created +\.claude\/skills\/release-review\/SKILL\.md/);
  assert.equal(at(e, '.agents/skills/release-review/SKILL.md'), PROMPT);
});
test('a project that Buddy did not build, and --json, get nothing written', opts, () => {
  const d = tmp(); g(d, 'init -q'); fs.mkdirSync(path.join(d, 'docs/buddy/backlog'), { recursive: true }); buddy(['board'], d, machine(['claude', 'agy'])); assert.deepEqual(fs.readdirSync(d).filter(f => f !== '.buddy').sort(), ['.git', 'docs']);
  const { d: e } = born(['claude']); buddy(['board', '--json'], e, machine(['claude', 'agy'])); assert.equal(at(e, 'AGENTS.md'), null);
});
test('a real prompt edited later: the wrapper follows its front matter, unless the owner edited the wrapper; the real file is never replaced', opts, () => {
  const { d } = born(['claude']); const real = path.join(d, '.agents/skills/release-review/SKILL.md'), wrap = path.join(d, '.claude/skills/release-review/SKILL.md');
  const edited = PROMPT.replace('Reviews a change', 'Reviews every change'); fs.writeFileSync(real, edited);
  const r = buddy(['board'], d, machine(['claude'])); assert.equal(fs.readFileSync(real, 'utf8'), edited); assert.equal(fs.readFileSync(wrap, 'utf8'), wrapperOf('release-review', edited)); assert.match(r.stdout, /merged +\.claude\/skills\/release-review\/SKILL\.md/);
  fs.writeFileSync(wrap, 'My wrapper.\n'); fs.writeFileSync(real, PROMPT); const k = buddy(['board'], d, machine(['claude']));
  assert.equal(fs.readFileSync(wrap, 'utf8'), 'My wrapper.\n'); assert.match(k.stdout, /kept +\.claude\/skills\/release-review\/SKILL\.md \(you edited it/);
});
test('with neither tool found init works as in 0.4.0 (Claude Code), and an owner\'s skill in .claude/skills is kept', opts, () => {
  const d = path.join(tmp(), 'shop'); fs.mkdirSync(path.join(d, '.claude/skills/release-review'), { recursive: true }); fs.writeFileSync(path.join(d, '.claude/skills/release-review/SKILL.md'), 'mine\n');
  const r = buddy(['init', '--library', lib, '--profile', 'x'], d, machine([])); assert.equal(r.status, 0, r.stderr);
  assert.equal(at(d, '.claude/skills/release-review/SKILL.md'), 'mine\n'); assert.equal(at(d, 'CLAUDE.md'), BLOCK); assert.equal(at(d, 'AGENTS.md'), null); assert.equal(at(d, '.agents/skills/release-review/SKILL.md'), PROMPT);
});
// Switching tool in the middle of a project loses nothing (support-antigravity, step 7, AC4): built on a machine with one tool, continued on a machine with the other.
const tree = d => { const out = {}; const walk = (p, r) => { for (const e of fs.readdirSync(p, { withFileTypes: true })) { if (e.name === '.git' || e.name === '.buddy') continue; const f = path.join(p, e.name), k = path.join(r, e.name); e.isDirectory() ? walk(f, k) : out[k] = fs.readFileSync(f, 'utf8'); } }; walk(d, ''); return out; };
test('built with Claude Code and continued with Antigravity (and back): the records, steps, decisions and rules are the same files, nothing lost', opts, () => {
  const { d } = born(['claude']), cc = machine(['claude']), ag = machine(['agy']);
  const run = (env, args) => { const r = buddy(args, d, env); assert.equal(r.status, 0, `${args.join(' ')}: ${r.stderr}`); return r; };
  run(cc, ['slice', 'start', 'Save books', '--request', 'Save a book to read later', '--ac', 'A saved book shows in the list', '--exclude', 'Nothing beyond the criteria above']);
  run(cc, ['slice', 'step', 'add', 'save-books', 'Build the list']); run(cc, ['slice', 'step', 'add', 'save-books', 'Build the form']); for (const to of ['ready', 'building']) run(cc, ['slice', 'move', 'save-books', to]); run(cc, ['slice', 'step', 'done', 'save-books', '1']);
  run(cc, ['decide', '--title', 'Keep a flag', '--requested-by', 'owner', '--context', 'c', '--options', 'a; b', '--outcome', 'a', '--reason', 'simple', '--decided-by', 'agent', '--rule', 'flags are enough|agent', '--built', 'not built', '--consulted', 'the architect']);
  run(cc, ['worker', 'register', '--slice', 'save-books', '--role', 'dev', '--id', 'w1', '--runtime', 'claude-code']);
  const before = tree(d), workers = fs.readFileSync(path.join(d, '.buddy/workers.jsonl'), 'utf8');
  // the other tool shows up: everything Buddy reads is still there, and what he adds is only that tool's own files
  const board = run(ag, ['board']), resume = run(ag, ['resume', 'save-books']);
  assert.match(board.stdout, /save-books/); assert.match(resume.stdout, /Build the list/); assert.match(resume.stdout, /Build the form/);
  const after = tree(d);
  for (const [f, text] of Object.entries(before)) if (f !== 'docs/buddy/tool-files.json') assert.equal(after[f], text, `${f} changed`);
  assert.deepEqual(Object.keys(after).filter(f => !(f in before)), ['AGENTS.md']); assert.equal(after['AGENTS.md'], before['CLAUDE.md']);   // only what the new tool reads, the same pointers
  assert.deepEqual(Object.keys(readManifest(d)).filter(f => !(f in JSON.parse(before['docs/buddy/tool-files.json']).files)), ['AGENTS.md']);
  assert.equal(fs.readFileSync(path.join(d, '.buddy/workers.jsonl'), 'utf8'), workers);
  // both tools: the second tool's files are brought, the first one's are untouched, and both hold the same rules
  const both = machine(['claude', 'agy']); run(both, ['board']);
  assert.equal(at(d, 'AGENTS.md'), at(d, 'CLAUDE.md')); assert.equal(at(d, '.agents/skills/release-review/SKILL.md'), PROMPT);
  // continue with the other tool: Dev built in Antigravity this time, Claude Code reviews; the earlier steps are still ticked
  run(ag, ['slice', 'step', 'done', 'save-books', '2']); run(both, ['worker', 'register', '--slice', 'save-books', '--role', 'dev', '--id', 'w2', '--runtime', 'antigravity']);
  const back = run(cc, ['resume', 'save-books']).stdout; assert.match(back, /\[x\] 1\. Build the list/); assert.match(back, /\[x\] 2\. Build the form/);
  const list = run(cc, ['worker', 'list', '--slice', 'save-books']).stdout; assert.match(list, /w1/); assert.match(list, /w2/);
  assert.equal(Object.keys(tree(d)).filter(f => /keep-a-flag/.test(f)).length, 1);
});
// With Claude Code only everything works as in 0.4.0 (support-antigravity, step 8, AC7): a stand-in claude is the only tool on the path, no setting exists, and init,
// the board and the checkpoint behave as they did: the same files, the reviewer is a fresh claude session, and nothing is written for a tool that is not there.
test('Claude Code only: init, the board and the checkpoint run as in 0.4.0, the review by a fresh claude, and nothing for Antigravity or the home folder', opts, () => {
  const env = machine(['claude']), claude = path.join(path.dirname(env.PATH.split(path.delimiter)[0]), 'bin', 'claude');
  const verdict = JSON.stringify({ type: 'result', result: JSON.stringify({ does_what_was_asked: true, weakens_or_hides_checks: false, unspecified_decisions: [], details: 'fine' }), total_cost_usd: 0.001 });
  fs.writeFileSync(claude, `#!/bin/sh\ncat >/dev/null\nprintf '%s\\n' '${verdict}'\n`);
  const { d, r } = (() => { const d = path.join(tmp(), 'shop'); fs.mkdirSync(d); const r = buddy(['init', '--library', lib, '--profile', 'x'], d, env); assert.equal(r.status, 0, r.stderr); return { d, r }; })();
  assert.equal(at(d, 'CLAUDE.md'), BLOCK); assert.equal(at(d, 'AGENTS.md'), null); assert.equal(at(d, '.claude/settings.json') !== null, true);
  assert.equal(at(d, '.claude/skills/release-review/SKILL.md'), wrapperOf('release-review', PROMPT));
  const b = buddy(['board'], d, env); assert.equal(b.status, 0, b.stderr); assert.doesNotMatch(b.stdout, /created|found on this machine/);
  assert.match(buddy(['tools'], d, env).stdout, /Claude Code/); assert.deepEqual(fs.readdirSync(env.BUDDY_HOME), ['environment.json'], 'the home folder holds only the setting'); assert.deepEqual(JSON.parse(at(env.BUDDY_HOME, 'environment.json')), { panelsTold: { claude: true } }, 'which says only that the missing Claude Code panel was mentioned (tell-missing-panel)');
  fs.writeFileSync(path.join(d, 'validate.sh'), '#!/bin/sh\necho validate ok\n'); fs.chmodSync(path.join(d, 'validate.sh'), 0o755); g(d, 'add validate.sh'); g(d, 'commit -q -m "chore: validate"');
  fs.mkdirSync(path.join(d, '.buddy'), { recursive: true }); fs.writeFileSync(path.join(d, '.buddy/request.txt'), 'Add the c module.');
  fs.mkdirSync(path.join(d, 'tests'), { recursive: true }); fs.writeFileSync(path.join(d, 'tests/c.test.mjs'), "import { c } from '../c.mjs';\nit('c', () => { expect(c).toBe(1); });\n"); g(d, 'add tests/c.test.mjs');
  fs.writeFileSync(path.join(d, 'c.mjs'), 'export const c = 1;\n'); fs.writeFileSync(path.join(d, 'notes.md'), '## Assumptions made since checkpoint 0\nnone\n'); g(d, 'add c.mjs'); g(d, 'commit -q -m "feat: add c"');
  const k = buddy(['checkpoint', '--run', 'cc', '--notes', 'notes.md', '--base', 'HEAD~1', '--human', '1'], d, env); assert.equal(k.status, 0, k.stderr + k.stdout);
  assert.match(k.stdout, /APPROVE|decision/i); assert.doesNotMatch(k.stdout + k.stderr, /agy|Antigravity/);
  const ev = fs.readdirSync(path.join(d, '.buddy')).filter(f => /^evidence-.*\.json$/.test(f) && !/summary/.test(f)); assert.equal(ev.length, 1);
  const e = JSON.parse(at(d, `.buddy/${ev[0]}`)); assert.equal(e.review.not_run, undefined); assert.match(JSON.stringify(e.review), /fine/); assert.equal(e.environment?.reviewer ?? 'claude', 'claude');
});
