// Portable process helpers (Windows and Linux). Git is always run with an argument array, never through a shell string,
// so quoting, pipes and pathspecs behave the same on cmd.exe, PowerShell and POSIX shells.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX = 1 << 27;

// Runs `git <args>` in cwd and returns stdout, or '' on failure (with `stdoutOnError`, whatever stdout had); `env` adds variables (e.g. GIT_INDEX_FILE).
export function git(args, cwd, { stdoutOnError = false, env } = {}) {
  try { return execFileSync('git', args.filter(a => a !== ''), { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: MAX, ...(env ? { env: { ...process.env, ...env } } : {}) }); }
  catch (e) { return stdoutOnError ? (e.stdout || '').toString() : ''; }
}

// True when `git <args>` exits with 0 (for questions such as "is this branch merged?").
export function gitOk(args, cwd) {
  try { execFileSync('git', args, { cwd, stdio: 'ignore' }); return true; } catch { return false; }
}

// Where a branch stands against the trunk, read from git when asked and never stored (R63): 'merged' (the branch exists and is in main),
// 'pending' (it exists and is not), 'unknown' (no trunk, or the branch is not in this clone: it may have been merged and deleted on the host),
// 'none' (no branch named).
export function branchState(repo, branch) {
  if (!branch) return { state: 'none', trunk: null };
  const trunk = ['main', 'master'].find(t => gitOk(['rev-parse', '--verify', '--quiet', t], repo)) ?? null;
  if (!trunk || !gitOk(['rev-parse', '--verify', '--quiet', branch], repo)) return { state: 'unknown', trunk };
  return { state: gitOk(['merge-base', '--is-ancestor', branch, trunk], repo) ? 'merged' : 'pending', trunk };
}

// True when the project's package.json has that script.
export function hasNpmScript(repo, name) {
  try { return !!JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')).scripts?.[name]; } catch { return false; }
}

// How to run `npm run <name>`: { cmd, args, shell, label }, or null when package.json has no such script. npm is run through
// the shell on Windows (npm is npm.cmd there), with a fixed command line: the name is one of ours, never user input.
export function npmScriptCommand(repo, name) {
  if (!/^[a-z][a-z0-9:-]*$/.test(name) || !hasNpmScript(repo, name)) return null;
  const label = `npm run ${name}`;
  return process.platform === 'win32' ? { cmd: label, args: [], shell: true, label } : { cmd: 'npm', args: ['run', name], shell: false, label };
}

// How to run the project's validate command, or null when there is none. Order is unchanged from the prototype:
// validate.sh, then the npm `validate` script; validate.sh is run with bash only if bash exists and no npm script is
// available on Windows.
export function validateCommand(repo) {
  const sh = fs.existsSync(path.join(repo, 'validate.sh'));
  if (sh && !(process.platform === 'win32' && hasNpmScript(repo, 'validate'))) return { cmd: 'bash', args: ['./validate.sh'], shell: false, label: 'validate.sh' };
  return npmScriptCommand(repo, 'validate');
}

// Runs the project's validate command and returns { status, stdout, stderr, timedOut }. It is stopped after `timeoutSec` seconds (default
// 30 minutes; the environment variable BUDDY_VALIDATE_TIMEOUT, in seconds, changes it) and everything it started is ended with it.
// A stopped validate has status 124 and says so in stderr.
export const VALIDATE_TIMEOUT_SEC = 30 * 60;
export function runValidate(repo, { timeoutSec } = {}) {
  const c = validateCommand(repo);
  if (!c) return { status: 127, missing: true, stdout: '', stderr: 'no validate.sh and no npm validate script found' };
  const env = Number(process.env.BUDDY_VALIDATE_TIMEOUT); const sec = timeoutSec ?? (env > 0 ? env : VALIDATE_TIMEOUT_SEC);
  const run = spawnSync(process.execPath, [fileURLToPath(new URL('./validaterun.mjs', import.meta.url)), JSON.stringify({ c, cwd: repo, timeoutMs: sec * 1000 })], { encoding: 'utf8', maxBuffer: MAX, timeout: sec * 1000 + 30000, killSignal: 'SIGKILL' });
  let r; try { r = JSON.parse(run.stdout); } catch { return { status: 124, timedOut: true, stdout: '', stderr: `validate did not report back after ${sec} seconds and was stopped` }; }
  if (r.timedOut) return { status: 124, timedOut: true, stdout: r.stdout, stderr: `${r.stderr}\nvalidate was stopped after ${sec} seconds (BUDDY_VALIDATE_TIMEOUT or --validate-timeout, in seconds, changes the limit); everything it started was ended` };
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, timedOut: false };
}

// Runs a command given by npmScriptCommand/validateCommand with a time limit, so it never hangs silently. On timeout the
// whole process tree is stopped (taskkill /T on Windows, the process group elsewhere): npm runs its script in a child
// shell, and stopping npm alone would leave that shell running. Resolves { status, stdout, stderr, timedOut, ms };
// status is null when it was stopped.
export function runWithTimeout(c, { cwd, timeoutMs }) {
  const win = process.platform === 'win32'; const t0 = Date.now(); const KEEP = 1 << 16;
  return new Promise(resolve => {
    let out = '', err = '', timedOut = false, done = false;
    const keep = (s, d) => (s + d).slice(-KEEP);
    const finish = status => { if (done) return; done = true; clearTimeout(timer); resolve({ status, stdout: out, stderr: err, timedOut, ms: Date.now() - t0 }); };
    const child = spawn(c.cmd, c.args, { cwd, shell: c.shell, windowsHide: true, detached: !win, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', d => { out = keep(out, d); }); child.stderr.on('data', d => { err = keep(err, d); });
    const timer = setTimeout(() => {
      timedOut = true;
      try { if (win) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); else process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
      setTimeout(() => finish(null), 3000).unref();   // a pipe held by a process that could not be stopped must not hang us
    }, timeoutMs);
    child.on('error', e => { err = keep(err, e.message); finish(127); });
    child.on('close', code => finish(timedOut ? null : code));
  });
}

// A copy of the repository's index at `to`, to read the working tree through it (`git add -A` into the copy stages nothing in the real index).
// git trusts an entry's size and modification time (to the second) to say a file did not change, unless the entry is as new as the index file
// ("racy"): a file edited within a second of being staged, with the same size, would then keep its old content in the copy. The copy is dated
// the first second of 1970, so every entry counts as racy and git reads the files' content.
export function copyIndex(repo, to) {
  const real = git(['rev-parse', '--path-format=absolute', '--git-path', 'index'], repo).trim();
  if (real && fs.existsSync(real)) { fs.copyFileSync(real, to); fs.utimesSync(to, 1, 1); }
}
