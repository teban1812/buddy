import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync, execSync } from 'node:child_process';
import { readContext, riskState } from '../src/context.mjs';
import { verify } from '../src/verify.mjs';
import { chooseLibrary as chooseLibraryFrom, libraryChoice, parseLibraryVar, latestTag, publicUrl, projectNames, DEFAULT_LIBRARY, FALLBACK_PROFILE, CONTRACTS, fetchLibrary, libraryLine } from '../src/init.mjs';
import { runWithTimeout } from '../src/proc.mjs';
import { routineRules, buddyCommands, writePermissions, PLUGIN_ROOT } from '../src/permissions.mjs';
import { startSlice, moveSlice } from '../src/slicestore.mjs';
import { loadBoard } from '../src/board.mjs';
import { BUDDY, tmp, HOME, run, g, snapshot, BIN, put, EMPTY_TEMPLATE, PIPELINES, fakeLibrary, project } from './_init.helper.mjs';

// --- contract 2: the index of the library's normative documents (bring-normative-documents) ---
const INDEX = '---\ndocuments:\n  - id: SDS\n    title: "Acme Secure Coding Standard: applications and APIs"\n    version: v1.1\n    link: https://example.sharepoint.com/sites/x/SDS_v1_1.pdf\n'
  + '  - id: PRIV\n    title: Privacy guideline\n    version: "2026"\n    link: normative/privacy.pdf\n---\n# Normative documents\n\n| Id | Document |\n| :-- | :-- |\n| SDS | the tables stay for people |\n';
const normLibrary = (index = INDEX) => {
  const { lib } = fakeLibrary({ scripts: null, pipelines: false });
  put(lib, { 'library.json': JSON.stringify({ name: 'Acme', contract: 2, default_profile: 'x', profiles: { x: 'one line' } }), 'normative/index.md': index, 'normative/privacy.pdf': 'the document itself' });
  g(lib, 'add -A'); g(lib, 'commit -q -m normative'); return lib;
};
test('AC1, AC3: a contract 2 library lists its normative documents in normative/index.md; --questions shows them and a malformed index is refused in plain words', () => {
  const q = run(['init', '--questions', '--profile', 'x', '--library', normLibrary()], tmp()); assert.equal(q.status, 0, q.stderr);
  assert.match(q.stdout, /\nNormative documents of the library \(linked, never copied: the project receives their index at docs\/standards\/normative\.md\):\n  SDS  Acme Secure Coding Standard: applications and APIs, v1\.1: https:\/\/example\.sharepoint\.com\/sites\/x\/SDS_v1_1\.pdf\n  PRIV  Privacy guideline, 2026: normative\/privacy\.pdf\n/);
  const { lib } = fakeLibrary({ scripts: null, pipelines: false });
  assert.match(run(['init', '--questions', '--profile', 'x', '--library', lib], tmp()).stdout, /Normative documents of the library: none\./);
  const refused = (index, why) => { const r = run(['init', '--questions', '--profile', 'x', '--library', normLibrary(index)], tmp()); assert.equal(r.status, 1); assert.match(r.stderr, why); };
  refused('# Acme normative documents\n\n| Id | Document |\n', /the library's normative\/index\.md must start with a front matter that lists its documents \(documents: - id: \.\.\. title: \.\.\. version: \.\.\. link: \.\.\.\)/);
  refused(INDEX.replace('    version: v1.1\n', ''), /document 1 of the library's normative\/index\.md has no "version"/);
  refused(INDEX.replace('normative/privacy.pdf', 'normative/missing.pdf'), /document PRIV of the library's normative\/index\.md links to "normative\/missing\.pdf", which is neither a URL nor a file of the library/);
  refused(INDEX.replace('normative/privacy.pdf', '../outside.pdf'), /links to "\.\.\/outside\.pdf", which is neither a URL nor a file of the library/);
  refused(INDEX.replace('id: PRIV', 'id: SDS'), /lists the document SDS twice/);
  const e = project('shop'); assert.equal(run(['init', '--library', normLibrary(INDEX.replace('    version: v1.1\n', ''))], e).status, 1); assert.deepEqual(fs.readdirSync(e), []);
});
test('AC1: a project born from the library has its index at docs/standards/normative.md, never a document', () => {
  const d = project('shop');
  const r = run(['init', '--library', normLibrary()], d, { env: { GIT_AUTHOR_NAME: 'Owner', GIT_AUTHOR_EMAIL: 'o@o', GIT_COMMITTER_NAME: 'Owner', GIT_COMMITTER_EMAIL: 'o@o' } }); assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /copied +docs\/standards\/normative\.md \(the library's index of its normative documents \(SDS v1\.1, PRIV 2026\); the documents are linked, never copied\)/);
  assert.equal(fs.readFileSync(path.join(d, 'docs/standards/normative.md'), 'utf8'), INDEX);
  const all = fs.readdirSync(d, { recursive: true }).map(f => String(f).replace(/\\/g, '/')).filter(f => !f.startsWith('.git/'));
  assert.ok(!all.some(f => /privacy\.pdf$/.test(f)), all.join(', ')); assert.ok(!all.includes('normative'));
  assert.match(spawnSync('git', ['show', '--name-only', '--format='], { cwd: d, encoding: 'utf8' }).stdout, /docs\/standards\/normative\.md/);
  const n = project('plain'); const { lib } = fakeLibrary({ scripts: null, pipelines: false });   // a library without an index gives none
  assert.equal(run(['init', '--library', lib, '--profile', 'x'], n).status, 0); assert.ok(!fs.existsSync(path.join(n, 'docs/standards/normative.md')));
});
test('AC2: Buddy\'s and Dev\'s instructions resolve each cited clause through the index, never fetch a link, and say when a decision needs the document itself', () => {
  const read = f => fs.readFileSync(fileURLToPath(new URL(`../agents/${f}`, import.meta.url)), 'utf8');
  const buddy = read('buddy.md'); const dev = read('dev.md');
  const birth = fs.readFileSync(fileURLToPath(new URL('../skills/new-project/SKILL.md', import.meta.url)), 'utf8');   // the birth lives in the new-project skill
  const always = buddy.slice(buddy.indexOf('## A new project'), buddy.indexOf('## What the owner hands over'));   // and its rule on the index holds in every session
  for (const s of ['docs/standards/normative.md', 'Never fetch a link', 'needs the document itself']) assert.ok(always.toLowerCase().includes(s.toLowerCase()), s);
  for (const md of [birth, dev.slice(dev.indexOf('## Before you build'), dev.indexOf('## While you build'))])
    for (const s of ['docs/standards/normative.md', 'SCS v2.0 clause 4.2', 'Never fetch a link', 'needs the document itself']) assert.ok(md.includes(s), s);
  assert.match(buddy, /\*\*Raise Dev\*\*[^\n]*docs\/standards\/normative\.md/);
});
// --- contract 2: the organisation's saved prompts (bring-saved-prompts) ---
const PROMPT = '---\nname: prv-2-review\ndescription: "Reviews a change against Appendix B before it is published to UAT. Use it before a deployment to a test environment."\nprofiles: [x, y]\n---\n# PRV-2 review\n';
const promptLibrary = (prompt = PROMPT) => {
  const { lib } = fakeLibrary({ scripts: null, pipelines: false });
  put(lib, { 'library.json': JSON.stringify({ name: 'Acme', contract: 2, default_profile: 'x', profiles: { x: 'one line', y: 'another', z: 'a third' } }),
    'prompts/prv-2-review/SKILL.md': prompt, 'prompts/prv-2-review/appendix-b.md': '# Appendix B\n', 'prompts/only-z/SKILL.md': '---\nname: only-z\ndescription: For z.\nprofiles: [z]\n---\n', 'prompts/notes/README.md': 'not a prompt\n' });
  g(lib, 'add -A'); g(lib, 'commit -q -m prompts'); return lib;
};
test('AC2: a contract 2 library writes its saved prompts in prompts/<name>/SKILL.md; --questions lists the profile\'s and a malformed one is refused in plain words', () => {
  const lib = promptLibrary();
  const q = run(['init', '--questions', '--profile', 'x', '--library', lib], tmp()); assert.equal(q.status, 0, q.stderr);
  assert.match(q.stdout, /\nSaved prompts of the profile x, copied to \.agents\/skills\/ \(with a wrapper in \.claude\/skills\/ for Claude Code\):\n  prv-2-review  Reviews a change against Appendix B before it is published to UAT\. Use it before a deployment to a test environment\.\n?$/);
  assert.doesNotMatch(q.stdout, /only-z|notes/);
  assert.match(run(['init', '--questions', '--profile', 'x', '--library', fakeLibrary({ scripts: null, pipelines: false }).lib], tmp()).stdout, /Saved prompts of the profile x, copied to \.agents\/skills\/ \(with a wrapper in \.claude\/skills\/ for Claude Code\): none\./);
  const refused = (prompt, why) => { const r = run(['init', '--questions', '--profile', 'x', '--library', promptLibrary(prompt)], tmp()); assert.equal(r.status, 1); assert.match(r.stderr, why); };
  refused('# PRV-2 review\n', /the library's prompts\/prv-2-review\/SKILL\.md must start with a front matter \(name, description, profiles\)/);
  refused(PROMPT.replace('name: prv-2-review', 'name: prv-2'), /has the name "prv-2"; a saved prompt's name is the name of its folder, prv-2-review/);
  refused(PROMPT.replace(/description: .*\n/, ''), /prompts\/prv-2-review\/SKILL\.md has no "description", which says what it does and when it is used/);
  refused(PROMPT.replace('profiles: [x, y]\n', ''), /prompts\/prv-2-review\/SKILL\.md does not say which profiles it belongs to/);
  const e = project('shop'); assert.equal(run(['init', '--library', promptLibrary('# no front matter\n')], e).status, 1); assert.deepEqual(fs.readdirSync(e), []);
});
test('AC1: a project born from the library has the profile\'s saved prompts in .agents/skills/ in full and a thin wrapper in .claude/skills/, also from a profile without a template', () => {
  const lib = promptLibrary(); const d = project('shop'); const env = { GIT_AUTHOR_NAME: 'Owner', GIT_AUTHOR_EMAIL: 'o@o', GIT_COMMITTER_NAME: 'Owner', GIT_COMMITTER_EMAIL: 'o@o', PATH: claudeOnly() };
  const r = run(['init', '--library', lib], d, { env }); assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /copied +\.agents\/skills\/prv-2-review\/ \(the saved prompt prv-2-review of the profile x, which Buddy offers when its description says\)/);
  assert.equal(fs.readFileSync(path.join(d, '.agents/skills/prv-2-review/SKILL.md'), 'utf8'), PROMPT);
  assert.match(fs.readFileSync(path.join(d, '.claude/skills/prv-2-review/SKILL.md'), 'utf8'), /^---\nname: prv-2-review\n[\s\S]*?\n---\nRead the full prompt in `\.agents\/skills\/prv-2-review\/SKILL\.md`/);
  assert.ok(fs.existsSync(path.join(d, '.agents/skills/prv-2-review/appendix-b.md'))); assert.ok(!fs.existsSync(path.join(d, '.agents/skills/only-z')));
  assert.match(spawnSync('git', ['show', '--name-only', '--format='], { cwd: d, encoding: 'utf8' }).stdout, /\.agents\/skills\/prv-2-review\/appendix-b\.md/);
  const y = project('plain'); assert.equal(run(['init', '--library', lib, '--profile', 'y'], y, { env }).status, 0); assert.ok(fs.existsSync(path.join(y, '.agents/skills/prv-2-review/SKILL.md')));   // standards only
  const k = project('mine'); put(k, { '.claude/skills/prv-2-review/SKILL.md': 'my own\n' });   // one already there is kept
  const again = run(['init', '--library', lib], k, { env }); assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /kept +\.claude\/skills\/prv-2-review\/ \(already there, left as it was\)/); assert.equal(fs.readFileSync(path.join(k, '.claude/skills/prv-2-review/SKILL.md'), 'utf8'), 'my own\n');
});
test('AC1: Buddy\'s instructions offer each saved prompt at the moment its description names and never act as the independent human reviewer', () => {
  const md = fs.readFileSync(fileURLToPath(new URL('../agents/buddy.md', import.meta.url)), 'utf8');
  const sec = md.slice(md.indexOf('**Saved prompts.**'), md.indexOf('### The end of a milestone'));
  for (const s of ['.agents/skills/<name>/', '.claude/skills/<name>/', 'description says when it is used', 'no program detects that moment', 'offer the owner that prompt', 'independent human reviewer', 'never act as that reviewer']) assert.ok(sec.includes(s), s);
});
test('a command that hangs is stopped at its time limit', async () => {
  const t0 = Date.now();
  const r = await runWithTimeout({ cmd: process.execPath, args: ['-e', 'setTimeout(() => {}, 60000)'], shell: false, label: 'hang' }, { cwd: tmp(), timeoutMs: 500 });
  assert.equal(r.timedOut, true); assert.equal(r.status, null); assert.ok(Date.now() - t0 < 10000);
  const ok = await runWithTimeout({ cmd: process.execPath, args: ['-e', 'console.log("hi")'], shell: false, label: 'ok' }, { cwd: tmp(), timeoutMs: 10000 });
  assert.equal(ok.status, 0); assert.equal(ok.timedOut, false); assert.match(ok.stdout, /hi/);
});
// --- what the owner hands over ---
test('init leaves docs/inputs/ with a README for what the owner hands over, keeps one that exists, and its files never make the folder an existing project', () => {
  const d = path.join(tmp(), 'shop'); fs.mkdirSync(d);
  const r = run(['init', '--no-library'], d); assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /created +docs\/inputs\//);
  const readme = fs.readFileSync(path.join(d, 'docs/inputs/README.md'), 'utf8'); assert.match(readme, /PRD/); assert.match(readme, /prototype/); assert.match(readme, /never changes them/);
  assert.deepEqual(verify([path.join(d, 'docs')]).problems, []);
  const k = project('kept'); put(k, { 'docs/inputs/prd.md': '# PRD\n' });
  const again = run(['init', '--no-library'], k); assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /kept +docs\/inputs\/ \(already there, left as it was\)/); assert.deepEqual(fs.readdirSync(path.join(k, 'docs/inputs')), ['prd.md']);
  const { lib } = fakeLibrary(); const n = project('fresh'); put(n, { 'docs/inputs/prd.md': '# PRD\n', 'docs/inputs/prototype/index.html': '<p>x</p>\n' });
  const fresh = run(['init', '--library', lib, '--profile', 'empty'], n); assert.equal(fresh.status, 0, fresh.stderr);
  assert.doesNotMatch(fresh.stdout, /already holds a project/); assert.ok(fs.existsSync(path.join(n, 'package.json')));
  assert.equal(fs.readFileSync(path.join(n, 'docs/inputs/prd.md'), 'utf8'), '# PRD\n'); assert.ok(!fs.existsSync(path.join(n, 'docs/inputs/README.md')));
});
// --- the project's first commit (R144) ---
import { checkCommitMessage } from '../src/commitcheck.mjs';
const WHO = { GIT_AUTHOR_NAME: 'Owner', GIT_AUTHOR_EMAIL: 'o@o', GIT_COMMITTER_NAME: 'Owner', GIT_COMMITTER_EMAIL: 'o@o' };
const log = d => spawnSync('git', ['log', '-1', '--format=%s', '--name-only'], { cwd: d, encoding: 'utf8' }).stdout.trim();
test('a project is born with one first commit of what init made, named by its library, version and profile, that Buddy\'s commit rules accept', () => {
  const { lib } = fakeLibrary({ scripts: null }); put(lib, { 'library.json': JSON.stringify({ name: 'acme-standards', profiles: { x: 'x' } }) }); g(lib, 'add library.json'); g(lib, 'commit -q -m name'); g(lib, 'tag v2');
  const d = project('shop');
  const r = run(['init', '--library', lib, '--version', 'v2', '--profile', 'x', '--host', 'none'], d, { env: WHO }); assert.equal(r.status, 0, r.stderr);
  const [subject, ...files] = log(d).split('\n');
  assert.equal(subject, 'chore: born from acme-standards v2, profile x'); assert.deepEqual(checkCommitMessage(subject).errors, []);
  assert.equal(spawnSync('git', ['rev-list', '--count', 'HEAD'], { cwd: d, encoding: 'utf8' }).stdout.trim(), '1');
  for (const f of ['CLAUDE.md', 'docs/context.md', 'docs/inputs/README.md', 'docs/standards/ORIGIN.md', 'docs/standards/x/rules.md', 'package.json', 'src/Shop.Api/Program.cs']) assert.ok(files.includes(f), f);
  assert.equal(spawnSync('git', ['status', '--porcelain'], { cwd: d, encoding: 'utf8' }).stdout, '');   // nothing init made is left out
  assert.match(r.stdout, /created +the first commit \("chore: born from acme-standards v2, profile x", with the \d+ files init made\)/);
});
test('without a git identity init leaves everything uncommitted and says so plainly; it does not fail', () => {
  const d = project('shop'); const r = run(['init', '--no-library'], d, { env: { GIT_COMMITTER_NAME: '', GIT_COMMITTER_EMAIL: '', GIT_CONFIG_GLOBAL: path.join(tmp(), 'none'), GIT_CONFIG_NOSYSTEM: '1' } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /skipped +the first commit \(git does not know who you are \(user\.name and user\.email are not set\), so everything init made is left uncommitted/);
  assert.notEqual(spawnSync('git', ['rev-parse', '--verify', '--quiet', 'HEAD'], { cwd: d }).status, 0);
});
// A machine with Claude Code only (a stand-in on a scratch PATH that also reaches git and node): what init writes is what 0.4.0 wrote.
const claudeOnly = () => { const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'bin-')); for (const t of ['git', 'node']) fs.symlinkSync(execSync(`command -v ${t}`, { encoding: 'utf8' }).trim(), path.join(bin, t)); fs.writeFileSync(path.join(bin, 'claude'), '#!/bin/sh\n', { mode: 0o755 }); return bin; };
test('in a folder that already had commits init commits only the files it made, by name; what the owner had staged stays out', () => {
  const d = project('shop'); g(d, 'init -q'); put(d, { 'notes.txt': 'mine\n' }); g(d, 'add notes.txt'); g(d, 'commit -q -m "chore: start"');
  put(d, { 'staged.txt': 'not init\'s\n' }); g(d, 'add staged.txt');
  const r = run(['init', '--no-library'], d, { env: { ...WHO, PATH: claudeOnly() } }); assert.equal(r.status, 0, r.stderr);
  const [subject, ...files] = log(d).split('\n');
  assert.equal(subject, 'chore: born without a library'); assert.deepEqual(files.filter(Boolean).sort(), ['.claude/settings.json', '.gitignore', 'CLAUDE.md', 'docs/buddy/tool-files.json', 'docs/context.md', 'docs/inputs/README.md']);
  assert.match(spawnSync('git', ['status', '--porcelain'], { cwd: d, encoding: 'utf8' }).stdout, /^A  staged\.txt/m);
  const again = run(['init', '--no-library'], d, { env: { ...WHO, PATH: claudeOnly() } }); assert.match(again.stdout, /^Nothing to do/); assert.equal(log(d).split('\n')[0], 'chore: born without a library');   // nothing new, no commit
});

/// ask-only-what-matters (R157): the routine permissions are written at birth, merged with the owner's, and --permissions adds them later.
const settingsOf = d => JSON.parse(fs.readFileSync(path.join(d, '.claude/settings.json'), 'utf8'));
test('the routine rules: Buddy\'s program at this installation\'s path, the project\'s checks and local git; never a push, a deletion or an installation', () => {
  const rules = routineRules();
  const cli = path.join(PLUGIN_ROOT, 'bin', 'buddy.mjs').split(path.sep).join('/');
  for (const r of [`Bash(node "${cli}" *)`, 'Bash(npm run validate *)', 'Bash(npm run scan *)', 'Bash(npm run setup *)', 'Bash(npm test *)', 'Bash(git status *)', 'Bash(git diff *)', 'Bash(git log *)', 'Bash(git add *)', 'Bash(git commit *)', 'Bash(git show *)', 'PowerShell(git commit *)', `PowerShell(node "${cli}" *)`]) assert.ok(rules.includes(r), r);
  for (const r of rules) { assert.match(r, /^(Bash|PowerShell)\(.+ \*\)$/, r); assert.doesNotMatch(r, /push|\brm\b|remove|delete|install|npm run \*|git \*|curl/i, r); }
  const spaced = buddyCommands(path.join(path.sep, 'opt', 'my plugin'));
  assert.ok(spaced.every(c => /^node "[^"]+buddy\.mjs"$/.test(c)), `a path with spaces is only allowed quoted: ${spaced.join(' | ')}`);
  assert.ok(spaced.includes('node "/opt/my plugin/bin/buddy.mjs"'), 'the forward-slash form Claude Code writes');
});
test('a project is born with the routine permissions in .claude/settings.json, committed with the rest; a second run changes nothing', () => {
  const d = project('shop'); const r = run(['init', '--no-library'], d, { env: WHO }); assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(settingsOf(d).permissions.allow, routineRules());
  assert.match(r.stdout, /created +\.claude\/settings\.json \(Buddy's program, the project's checks .* run without asking; a push, a deletion, an installation or anything outside the project still asks\)/);
  assert.ok(log(d).split('\n').includes('.claude/settings.json'));
  const before = fs.readFileSync(path.join(d, '.claude/settings.json'), 'utf8');
  const again = run(['init', '--no-library'], d, { env: WHO }); assert.match(again.stdout, /^Nothing to do/); assert.match(again.stdout, /kept +\.claude\/settings\.json/);
  assert.equal(fs.readFileSync(path.join(d, '.claude/settings.json'), 'utf8'), before);
});
test('the owner\'s settings are kept: their rules, their other keys, and what they have not committed stays out of init\'s commit', () => {
  const d = project('shop'); put(d, { '.claude/settings.json': JSON.stringify({ model: 'x', permissions: { allow: ['Bash(make *)', 'Bash(git status *)'], deny: ['Bash(git push *)'] } }) });
  const r = run(['init', '--no-library'], d, { env: WHO }); assert.equal(r.status, 0, r.stderr);
  const s = settingsOf(d); assert.equal(s.model, 'x'); assert.deepEqual(s.permissions.deny, ['Bash(git push *)']);
  assert.deepEqual(s.permissions.allow.slice(0, 2), ['Bash(make *)', 'Bash(git status *)']); assert.equal(s.permissions.allow.filter(x => x === 'Bash(git status *)').length, 1);
  for (const rule of routineRules()) assert.ok(s.permissions.allow.includes(rule), rule);
  assert.match(r.stdout, /merged +\.claude\/settings\.json \(\d+ routine permissions added; the entries already there were kept/);
  assert.ok(!log(d).split('\n').includes('.claude/settings.json'), 'the owner\'s own file, not committed by them, stays out of the first commit');
  const bad = project('bad'); put(bad, { '.claude/settings.json': '{ not json' });
  const rb = run(['init', '--permissions'], bad); assert.equal(rb.status, 1); assert.match(rb.stderr, /not valid JSON.*left as it was/); assert.equal(fs.readFileSync(path.join(bad, '.claude/settings.json'), 'utf8'), '{ not json');
});
test('init --permissions gives an existing project the routine permissions and does nothing else', () => {
  const d = project('old'); g(d, 'init -q'); put(d, { 'docs/context.md': 'mine\n' });
  const before = snapshot(d);
  const r = run(['init', '--permissions'], d); assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^Permissions written in /); assert.match(r.stdout, /created +\.claude\/settings\.json/); assert.match(r.stdout, /Not committed/);
  const after = snapshot(d); delete after['.claude/']; delete after[path.join('.claude', 'settings.json')]; assert.deepEqual(after, before, 'nothing else was written');
  assert.deepEqual(settingsOf(d).permissions.allow, routineRules());
  const again = run(['init', '--permissions', '--repo', d], tmp()); assert.equal(again.status, 0, again.stderr); assert.match(again.stdout, /^Nothing to do: .*already has the routine permissions/);
  const mixed = run(['init', '--permissions', '--no-library'], d); assert.equal(mixed.status, 2); assert.match(mixed.stderr, /--permissions goes only with --repo/);
  assert.equal(writePermissions(d).change, 'kept');
});

// --- contract 2: a library's themes (carry-library-themes) ---
test('AC1: a library with themes/ gives the project docs/design/themes/ and says so in ORIGIN.md; one without creates nothing', () => {
  const { lib } = fakeLibrary({ scripts: null, pipelines: false });
  put(lib, { 'library.json': JSON.stringify({ name: 'Acme', contract: 2, default_profile: 'x', profiles: { x: 'one line' } }),
    'themes/calm.css': '/* Calm: soft blues */\n:root { --background: 0 0% 100%; }\n.dark { --background: 0 0% 4%; }\n', 'themes/bold.css': '/* Bold: strong colours */\n:root { --background: 0 0% 98%; }\n.dark { --background: 0 0% 2%; }\n' });
  g(lib, 'add -A'); g(lib, 'commit -q -m themes');
  const p = tmp(); const r = run(['init', '--library', lib, '--profile', 'x', '--no-template'], p);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(fs.readFileSync(path.join(p, 'docs/design/themes/calm.css'), 'utf8'), /^\/\* Calm: soft blues \*\//);
  assert.ok(fs.existsSync(path.join(p, 'docs/design/themes/bold.css')));
  assert.match(fs.readFileSync(path.join(p, 'docs/standards/ORIGIN.md'), 'utf8'), /Themes copied: `docs\/design\/themes\/bold\.css`, `docs\/design\/themes\/calm\.css`/);
  const plain = normLibrary(); const q = tmp(); const r2 = run(['init', '--library', plain, '--profile', 'x', '--no-template'], q);
  assert.equal(r2.status, 0, r2.stderr + r2.stdout);
  assert.ok(!fs.existsSync(path.join(q, 'docs/design')));
  assert.doesNotMatch(fs.readFileSync(path.join(q, 'docs/standards/ORIGIN.md'), 'utf8'), /Themes copied/);
});

// --- choose-profile-after-discovery (R276): born without a profile, then profile added after discovery ---
const discoveryLibrary = () => {
  const { lib } = fakeLibrary({ scripts: { validate: 'node -e "process.exit(0)"' }, pipelines: true });
  put(lib, {
    'library.json': JSON.stringify({ name: 'Acme', contract: 2, default_profile: 'x', profiles: { x: 'web app', y: 'service only' } }),
    'standards/general/design.md': '# Design rules\n- Must keep contrast ({{org_name}}).\n',
    'standards/x/rules.md': '# X rules\n- Target: {{runtime}}.\n',
    'standards/y/rules.md': '# Y rules\n',
    'themes/calm.css': '/* Calm: soft blues */\n:root { --background: 0 0% 100%; }\n',
    'questions/general.md': '---\nquestions:\n  - id: org\n    text: Which team owns this?\n    why: names the owner\n    section: Constraints\n    fills: org_name\n---\n',
    'questions/x.md': '---\nquestions:\n  - id: rt\n    text: Which runtime?\n    why: fixes the target\n    section: Constraints\n    fills: runtime\n---\n',
    'steps/sec/step.md': '---\nid: sec\nprofiles: [x]\nrecord: docs/security/sec.md\ntriggers:\n  - text: login\n    clause: S1\nitems:\n  - id: S1\n    text: Auth\n    clause: S1\n---\n',
    'prompts/review/SKILL.md': '---\nname: review\ndescription: Review before UAT.\nprofiles: [x]\n---\n# Review\n',
  });
  g(lib, 'add -A'); g(lib, 'commit -q -m full'); return lib;
};

test('AC1: init --no-profile brings context, general standards (with design.md) and themes, but no template, profile standards, steps, prompts or ADR', () => {
  const lib = discoveryLibrary(); const d = project('shop');
  const ans = path.join(tmp(), 'gen.json'); fs.writeFileSync(ans, JSON.stringify({ org: 'Payments' }));
  const r = run(['init', '--no-profile', '--library', lib, '--answers', ans], d, { env: { ...WHO, PATH: claudeOnly() } });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.ok(fs.existsSync(path.join(d, 'docs/context.md')));
  assert.match(fs.readFileSync(path.join(d, 'docs/context.md'), 'utf8'), /Which team owns this\? Payments\./);
  assert.match(fs.readFileSync(path.join(d, 'docs/standards/general/design.md'), 'utf8'), /Must keep contrast \(Payments\)\./);
  assert.ok(fs.existsSync(path.join(d, 'docs/design/themes/calm.css')));
  assert.match(fs.readFileSync(path.join(d, 'docs/standards/ORIGIN.md'), 'utf8'), /^- Profile: none\b/m);
  assert.ok(!fs.existsSync(path.join(d, 'docs/standards/x')));
  assert.ok(!fs.existsSync(path.join(d, 'package.json')));
  assert.ok(!fs.existsSync(path.join(d, 'docs/steps')));
  assert.ok(!fs.existsSync(path.join(d, '.agents/skills')));
  assert.ok(!fs.existsSync(path.join(d, 'docs/decisions')));
  assert.doesNotMatch(r.stdout, /Health: the project is born healthy/);
  const [subject] = log(d).split('\n');
  assert.match(subject, /^chore: born from Acme .*, without a profile$/);
  assert.deepEqual(checkCommitMessage(subject).errors, []);
  // Running init without --profile or with --no-profile again does nothing
  const env = { ...WHO, PATH: claudeOnly() };
  assert.match(run(['init', '--library', lib], d, { env }).stdout, /^Nothing to do/);
  assert.match(run(['init', '--no-profile', '--library', lib], d, { env }).stdout, /^Nothing to do/);
  // Invalid combinations with --no-profile are refused
  assert.notEqual(run(['init', '--no-profile', '--profile', 'x', '--library', lib], project('bad1')).status, 0);
  assert.notEqual(run(['init', '--no-profile', '--no-library'], project('bad2')).status, 0);
  assert.notEqual(run(['init', '--no-profile', '--list-profiles', '--library', lib], tmp()).status, 0);
  const badAns = path.join(tmp(), 'prof.json'); fs.writeFileSync(badAns, JSON.stringify({ rt: 'net10' }));
  assert.notEqual(run(['init', '--no-profile', '--library', lib, '--answers', badAns], project('bad3')).status, 0);
});

test('AC2: init --profile <name> in a project born without a profile brings template, profile standards, steps, prompts and ADR, checks health, and touches nothing discovery wrote', () => {
  const lib = discoveryLibrary(); const d = project('shop');
  const env = WHO;
  assert.equal(run(['init', '--no-profile', '--library', lib], d, { env }).status, 0);
  // Simulate discovery artifacts and owner edits
  put(d, {
    'docs/discovery/research.md': '# Research\n- Finding 1 (source: interview)\n',
    'docs/discovery/brief.md': '# Brief\n- Rule 1\n',
    'docs/discovery/flows.md': '# Flows\n- Main flow\n',
    'docs/inputs/prototype/home.html': '<!-- screen: home --><h1>Home</h1>\n',
    'docs/design/themes/custom.css': '/* Custom: brand */\n:root { --primary: 220 90% 50%; }\n',
    'README.md': '# Shop custom readme\n',
  });
  const ctxBefore = fs.readFileSync(path.join(d, 'docs/context.md'), 'utf8') + '\n- Confirmed business goal. `human 2026-11-25`\n';
  fs.writeFileSync(path.join(d, 'docs/context.md'), ctxBefore);
  g(d, 'add docs/discovery/research.md docs/discovery/brief.md docs/discovery/flows.md docs/inputs/prototype/home.html docs/design/themes/custom.css README.md docs/context.md');
  g(d, 'commit -q -m "docs: complete discovery"');

  const ans = path.join(tmp(), 'x-ans.json'); fs.writeFileSync(ans, JSON.stringify({ rt: '.NET 10' }));
  const r = run(['init', '--profile', 'x', '--host', 'github', '--library', lib, '--answers', ans], d, { env });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.doesNotMatch(r.stdout, /already holds a project/, 'CLAUDE.md/AGENTS.md from birth must not make it an existing project');
  assert.match(r.stdout, /Health: the project is born healthy:/);
  // Profile standards, template, pipeline, steps, prompts, ADR, ORIGIN.md
  assert.match(fs.readFileSync(path.join(d, 'docs/standards/x/rules.md'), 'utf8'), /Target: \.NET 10\./);
  assert.ok(fs.existsSync(path.join(d, 'package.json')));
  assert.ok(fs.existsSync(path.join(d, 'src/Shop.Api/Program.cs')));
  assert.ok(fs.existsSync(path.join(d, '.github/workflows/validate.yml')));
  assert.ok(!fs.existsSync(path.join(d, 'azure-pipelines.yml')));
  assert.ok(fs.existsSync(path.join(d, 'docs/steps/sec/step.md')));
  assert.ok(fs.existsSync(path.join(d, 'docs/security/sec.md')));
  assert.ok(fs.existsSync(path.join(d, '.agents/skills/review/SKILL.md')));
  assert.ok(fs.readdirSync(path.join(d, 'docs/decisions')).some(f => f.endsWith('.md')));
  assert.match(fs.readFileSync(path.join(d, 'docs/standards/ORIGIN.md'), 'utf8'), /^- Profile: `x`/m);
  // Nothing discovery wrote was touched
  assert.equal(fs.readFileSync(path.join(d, 'docs/discovery/brief.md'), 'utf8'), '# Brief\n- Rule 1\n');
  assert.equal(fs.readFileSync(path.join(d, 'docs/inputs/prototype/home.html'), 'utf8'), '<!-- screen: home --><h1>Home</h1>\n');
  assert.equal(fs.readFileSync(path.join(d, 'docs/design/themes/custom.css'), 'utf8'), '/* Custom: brand */\n:root { --primary: 220 90% 50%; }\n');
  assert.equal(fs.readFileSync(path.join(d, 'README.md'), 'utf8'), '# Shop custom readme\n');
  const ctxAfter = fs.readFileSync(path.join(d, 'docs/context.md'), 'utf8');
  assert.ok(ctxAfter.includes('- Confirmed business goal. `human 2026-11-25`'));
  assert.match(ctxAfter, /Which runtime\? \.NET 10\./);
  // Commit recorded
  const [subject] = log(d).split('\n');
  assert.match(subject, /^chore: add profile x from Acme /);
  assert.deepEqual(checkCommitMessage(subject).errors, []);
  // Adding another profile afterwards does nothing (profile already set)
  const second = run(['init', '--profile', 'y', '--library', lib], d, { env });
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /^Nothing to do/);
  assert.ok(!fs.existsSync(path.join(d, 'docs/standards/y')));
});
