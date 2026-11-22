import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { checkCommitMessage, parseTrailers } from '../src/commitcheck.mjs';
import { readCommitCommand, readCommitCommands, scanStaged, scanFiles, filesToCommit, changedFiles, words } from '../src/commithook.mjs';

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'commithook.mjs');
const ok = (m, o) => checkCommitMessage(m, { requireExisting: false, ...o });

test('trailers are read as git reads them: the last paragraph, Token: value, indented continuations', () => {
  assert.deepEqual(parseTrailers('feat: x\n\nbody\n\nSlice: save-books\nCo-Authored-By: A <a@b.c>\n'), [{ key: 'Slice', value: 'save-books' }, { key: 'Co-Authored-By', value: 'A <a@b.c>' }]);
  assert.deepEqual(parseTrailers('fix: x\n\nBuddy-Fix: the spec says\n  it must be ok\n'), [{ key: 'Buddy-Fix', value: 'the spec says it must be ok' }]);
  assert.deepEqual(parseTrailers('feat: x\n\nbody with a colon: here\nand more\n'), []);
  assert.deepEqual(parseTrailers('feat: only a subject'), []);
  assert.deepEqual(parseTrailers('feat: x\n\nSlice: save-books\n# a git comment\n'), [{ key: 'Slice', value: 'save-books' }]);
});
test('the header follows Conventional Commits: type, subject, case, full stop, length', () => {
  assert.equal(ok('feat(core): add the thing\n\nSlice: save-books').ok, true);
  for (const [msg, re] of [['Fix: x', /type "Fix" must be lowercase/], ['wip: x', /not one of/], ['chore: Add it', /must start with a lowercase letter/], ['chore: add it.', /full stop/], [`chore: ${'a'.repeat(100)}`, /at most 100/], ['no header here', /type\(scope\): subject/], ['', /empty/]])
    assert.match(ok(msg).errors.join('|'), re, msg);
  assert.equal(ok('chore: R128 numbers are fine'.replace('R128', 'r128')).ok, true);
  assert.equal(ok('Merge branch main into x').ok, true); assert.equal(ok('chore: x\n\n# a comment\n').ok, true);
  assert.match(ok('chore: x\nbody right after').warnings.join(), /blank line/);
});
test('feat names its slice (a warning) and fix says why (an error)', () => {
  assert.match(ok('feat: x').warnings.join(), /names its slice/); assert.match(ok('feat: x\n\nSlice: Not_Valid').warnings.join(), /not a slice name/); assert.equal(ok('feat: x\n\nSlice: ok-name').warnings.length, 0);
  assert.match(ok('fix: x').errors.join(), /Buddy-Fix/); assert.match(ok('fix: x\n\nBuddy-Fix: no').errors.join(), /too short/); assert.equal(ok('fix: x\n\nBuddy-Fix: the spec says it').ok, true);
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-')); fs.mkdirSync(path.join(d, 'docs/buddy/backlog/2026-11-01-real-one'), { recursive: true });
  fs.writeFileSync(path.join(d, 'docs/buddy/backlog/2026-11-01-real-one/change.md'), '---\nid: real-one\nstatus: building\n---\n');
  fs.mkdirSync(path.join(d, 'docs/buddy/backlog/2026-11-01-old-one'), { recursive: true }); fs.writeFileSync(path.join(d, 'docs/buddy/backlog/2026-11-01-old-one/change.md'), '---\nid: old-one\nstatus: abandoned\n---\n');
  const w = s => checkCommitMessage(`feat: x\n\nSlice: ${s}`, { cwd: d }).warnings.join();
  assert.equal(w('real-one'), ''); assert.match(w('ghost'), /has no record/); assert.match(w('old-one'), /abandoned/);
});

test('the message is read out of the command: -m, several -m, -am, --message=, heredocs, $(cat <<EOF), chained commands', () => {
  const m = c => readCommitCommand(c).message;
  assert.equal(m('git commit -m "fix: a" -m "Buddy-Fix: because"'), 'fix: a\n\nBuddy-Fix: because');
  assert.equal(m('git add a && git commit -am "chore: z"'), 'chore: z'); assert.equal(readCommitCommand('git commit -am "chore: z"').all, true);
  assert.equal(m("git commit --message='docs: q'"), 'docs: q');
  assert.equal(m("git commit -F - <<'EOF'\nfeat(core): x\n\nSlice: abc\nEOF"), 'feat(core): x\n\nSlice: abc');
  assert.equal(m('git commit -q -m "$(cat <<\'EOF\'\nfeat: q\n\nSlice: s\nEOF\n)"'), 'feat: q\n\nSlice: s');
  assert.equal(m('git -C sub commit -m "docs: ok"'), 'docs: ok');
  assert.equal(readCommitCommand('git commit -F msg.txt', { readFile: () => 'chore: from a file' }).message, 'chore: from a file');
  assert.equal(readCommitCommand('git commit --amend --no-edit').message, null); assert.equal(readCommitCommand('git commit').message, null);
  assert.equal(readCommitCommand('git status').found, false); assert.equal(readCommitCommand('echo "git commit"').found, false); assert.equal(readCommitCommand('git log --grep commit').found, false);
  assert.deepEqual(words("a 'b c' \"d e\" f\\ g"), ['a', 'b c', 'd e', 'f g']);
});

// a gitleaks on the PATH that behaves as told by the environment
const fakeGitleaks = (code, text = '') => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gl-')); fs.writeFileSync(path.join(dir, 'gitleaks'), `#!/bin/sh\necho "${text}"\nexit ${code}\n`); fs.chmodSync(path.join(dir, 'gitleaks'), 0o755); return dir; };
test('gitleaks on what is staged: a secret stops, a clean scan passes, a missing tool is not-run and says so', { skip: process.platform === 'win32' && 'uses a shell script as gitleaks' }, () => {
  assert.equal(scanStaged('.', { cmd: path.join(fakeGitleaks(0), 'gitleaks') }).status, 'passed');
  const bad = scanStaged('.', { cmd: path.join(fakeGitleaks(1, 'leaks found: 1'), 'gitleaks') }); assert.equal(bad.status, 'failed'); assert.match(bad.output, /leaks found/);
  const none = scanStaged('.', { cmd: 'gitleaks-that-does-not-exist' }); assert.equal(none.status, 'not-run'); assert.match(none.output, /not installed/);
});

function hook(command, { project = true, gitleaks = null } = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hk-')); if (project) fs.mkdirSync(path.join(d, 'docs/buddy/backlog'), { recursive: true });
  spawnSync('git', ['init', '-q'], { cwd: d });
  const env = { ...process.env, ...(gitleaks ? { PATH: `${gitleaks}${path.delimiter}${process.env.PATH}` } : {}) };
  return spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: d }), encoding: 'utf8', env });
}
test('the hook refuses a bad commit in a Buddy project, with what to fix, and is silent otherwise', { skip: process.platform === 'win32' && 'uses a shell script as gitleaks' }, () => {
  const bad = hook('git commit -m "Fix: Bad."'); assert.equal(bad.status, 2); assert.match(bad.stderr, /Buddy stopped this commit[^]*must be lowercase[^]*full stop/);
  assert.equal(hook('git commit -m "fix: x"').status, 2);                                                   // a fix without its reason
  assert.equal(hook('git commit -m "fix: x" -m "Buddy-Fix: the spec says it"').status, 0);
  assert.equal(hook('git commit -m "Fix: Bad.."', { project: false }).status, 0, 'a folder that is not a Buddy project is left alone');
  assert.equal(hook('npm test').status, 0); assert.equal(hook('git commit --amend --no-edit').status, 0, 'a message the command does not show cannot be judged');
  const leak = hook('git commit -m "chore: ok"', { gitleaks: fakeGitleaks(1, 'leaks found: 1') }); assert.equal(leak.status, 2); assert.match(leak.stderr, /secret/);
  assert.equal(hook('git commit -m "chore: ok"', { gitleaks: fakeGitleaks(0) }).status, 0);
  const t0 = Date.now(); hook('git commit -m "chore: ok"'); assert.ok(Date.now() - t0 < 3000, 'checking a commit is fast');
});
test('the plugin declares the hook and writes nothing into the project', () => {
  const j = JSON.parse(fs.readFileSync(path.join(path.dirname(HOOK), '..', 'hooks', 'hooks.json'), 'utf8'));
  assert.equal(j.hooks.PreToolUse[0].matcher, 'Bash'); assert.match(j.hooks.PreToolUse[0].hooks[0].command, /\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/commithook\.mjs/);
  const project = hook('git commit -m "chore: ok"'); assert.equal(project.status, 0);
});

test('every git commit of a chained command is judged, and git commit -a is covered by the secret scan too', { skip: process.platform === 'win32' && 'uses a shell script as gitleaks' }, () => {
  assert.equal(readCommitCommands('git commit -m "chore: fine" && git commit -m "Bad: x."').commits.length, 2);
  assert.equal(hook('git commit -m "chore: fine" && git commit -m "Bad: x."').status, 2, 'the second commit is the bad one');
  // a gitleaks that finds nothing in the index but a leak in the files `-a` adds: it fails only for the `dir` command
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gl2-')); fs.writeFileSync(path.join(dir, 'gitleaks'), '#!/bin/sh\n[ "$1" = dir ] && { echo "leaks found: 1"; exit 1; }\nexit 0\n'); fs.chmodSync(path.join(dir, 'gitleaks'), 0o755);
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hk-')); fs.mkdirSync(path.join(d, 'docs/buddy/backlog'), { recursive: true });
  const git = (...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: d, encoding: 'utf8' });
  git('init', '-q'); fs.writeFileSync(path.join(d, 'a.js'), 'x\n'); git('add', '-A'); git('commit', '-qm', 'chore: base'); fs.writeFileSync(path.join(d, 'a.js'), 'secret\n');   // tracked, modified, not staged
  const run = c => spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: c }, cwd: d }), encoding: 'utf8', env: { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH}` } });
  assert.equal(run('git commit -m "chore: ok"').status, 0, 'without -a the file is not part of the commit');
  const all = run('git commit -am "chore: ok"'); assert.equal(all.status, 2); assert.match(all.stderr, /files this command adds/);
  assert.equal(run('git add a.js && git commit -m "chore: ok"').status, 2, 'the add of the same command is read'); assert.equal(run('git commit -m "chore: ok" a.js').status, 2, 'a pathspec of the commit is scanned'); assert.equal(run('git add -A && git commit -m "chore: ok"').status, 2);
  assert.equal(run('git add other.js && git commit -m "chore: ok"').status, 0, 'a file that does not exist is not scanned');
});

// a repository with one commit, for the tests below
function repo(files) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-')); fs.mkdirSync(path.join(d, 'docs/buddy/backlog'), { recursive: true });
  const git = (...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: d, encoding: 'utf8' });
  git('init', '-q');
  for (const [f, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), text); }
  git('add', '-A'); git('commit', '-qm', 'chore: base');
  return { d, git };
}
test('of the paths a command names, only the files that change are scanned: a file committed earlier and left as it is is not', () => {
  const { d } = repo({ 'evidence/a.json': '{}\n', 'evidence/b.json': '{}\n', 'src/x.js': 'x\n' });
  fs.writeFileSync(path.join(d, 'src/x.js'), 'y\n'); fs.writeFileSync(path.join(d, 'src/new.js'), 'n\n'); fs.writeFileSync(path.join(d, 'evidence/c.json'), '{}\n');
  assert.deepEqual(filesToCommit(d, ['evidence/a.json', 'src/x.js']), ['src/x.js']);
  assert.deepEqual(filesToCommit(d, ['evidence']), ['evidence/c.json'], 'a folder stands for its changed files, not its whole content');
  assert.deepEqual(filesToCommit(d, ['src']).sort(), ['src/new.js', 'src/x.js']);
  assert.deepEqual(filesToCommit(d, []), []);
  const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'fc0-')); spawnSync('git', ['init', '-q'], { cwd: fresh }); fs.writeFileSync(path.join(fresh, 'a.js'), 'a\n');
  assert.deepEqual(filesToCommit(fresh, ['a.js']), ['a.js'], 'a repository with no commit yet');
});
test('in a repository with no commit yet, what git commit -a and git add -A take is every file, compared with the empty tree', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'fc1-')); spawnSync('git', ['init', '-q'], { cwd: d });
  fs.writeFileSync(path.join(d, 'tracked.js'), 't\n'); spawnSync('git', ['add', 'tracked.js'], { cwd: d }); fs.writeFileSync(path.join(d, 'new.js'), 'n\n');
  assert.deepEqual(changedFiles(d), ['tracked.js']);
  assert.deepEqual(changedFiles(d, { untracked: true }).sort(), ['new.js', 'tracked.js']);
});
const gitleaksHere = spawnSync('gitleaks', ['version'], { encoding: 'utf8' }).status === 0;
const token = () => ['gh', 'p_', 'R7xk2Lq9Vw4Tz8Bn3Mc6Hd1Fs5Gj0Ya2Pe7U'].join('');   // built at run time, so this file does not look like a secret
test('with the real gitleaks: a secret committed earlier does not block a new commit, a new one does, one file at a time', { skip: !gitleaksHere && 'gitleaks is not installed' }, () => {
  const { d } = repo({ 'evidence/old.json': `{"key": "${token()}"}\n`, 'a.js': 'a\n' });
  fs.writeFileSync(path.join(d, 'a.js'), 'b\n'); fs.writeFileSync(path.join(d, 'b.js'), 'c\n');
  const run = c => spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: c }, cwd: d }), encoding: 'utf8' });
  assert.equal(run('git add evidence/old.json a.js b.js && git commit -m "chore: ok"').status, 0, 'the old evidence is not scanned again');
  assert.equal(run('git add evidence a.js && git commit -m "chore: ok"').status, 0, 'nor through its folder');
  assert.equal(scanFiles(d, ['a.js', 'b.js']).status, 'passed');
  fs.writeFileSync(path.join(d, 'b.js'), `const k = "${token()}";\n`);
  assert.equal(scanFiles(d, ['a.js', 'b.js']).status, 'failed');
  const bad = run('git add a.js b.js && git commit -m "chore: ok"'); assert.equal(bad.status, 2); assert.match(bad.stderr, /files this command adds/);
  assert.equal(scanFiles(d, ['b.js'], { cmd: 'gitleaks-that-does-not-exist' }).status, 'not-run', 'without gitleaks the commit is not stopped');
  const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'fc2-')); fs.mkdirSync(path.join(fresh, 'docs/buddy/backlog'), { recursive: true });   // no commit yet
  spawnSync('git', ['init', '-q'], { cwd: fresh }); fs.writeFileSync(path.join(fresh, 'k.js'), `const k = "${token()}";\n`);
  const first = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git add -A && git commit -m "chore: first"' }, cwd: fresh }), encoding: 'utf8' });
  assert.equal(first.status, 2, 'the first commit of a repository is scanned too'); assert.match(first.stderr, /files this command adds/);
});

