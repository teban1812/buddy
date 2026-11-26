// Where Buddy keeps what is not worth the history (R134, ADR move-local-state-to-dot-buddy): `.buddy/` at the project root, ignored by `.gitignore`.
// Living inside the workspace keeps all routine Buddy commands (board, digest, resume, handovers, workers, suite) writable inside Antigravity's
// terminal sandbox (which makes `.git/` read-only by default), while still keeping each git worktree isolated in its own working tree (R146).
import fs from 'node:fs';
import path from 'node:path';
import { git } from './proc.mjs';

// The git folder of `repo`, absolute, or null when `repo` is not the top of a git repository (no `.git` there, as before). A `.git` folder
// is the answer without asking (a plain repository works exactly as it did, with no process); a `.git` file is asked of git once per
// process, since a worktree's folder does not move while it runs.
const asked = new Map();
export function gitDir(repo) {
  const dot = path.join(repo, '.git'); let st; try { st = fs.statSync(dot); } catch { return null; }
  if (st.isDirectory()) return dot;
  const key = path.resolve(repo); if (asked.has(key)) return asked.get(key);
  const d = git(['rev-parse', '--git-dir'], repo).trim(); const dir = d ? path.resolve(repo, d) : null;
  if (dir) asked.set(key, dir); return dir;
}
export const isGitRepo = repo => gitDir(repo) !== null;
export const BUDDY_LOCAL = '.buddy';
// Buddy's local unversioned folder: `<repo>/.buddy` (in a plain repo and in each worktree).
export const buddyDir = repo => path.join(repo, BUDDY_LOCAL);

// Ensures `.buddy/` is listed in `<repo>/.gitignore` so local state is never committed. Returns true if `.gitignore` was created or updated.
export function ensureBuddyIgnored(repo) {
  const gi = path.join(repo, '.gitignore');
  const existing = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : '';
  if (existing.split(/\r?\n/).some(l => /^\.buddy\/?$/.test(l.trim()))) return false;
  const prefix = existing && !existing.endsWith('\n') ? '\n' : '';
  fs.writeFileSync(gi, `${existing}${prefix}.buddy/\n`);
  return true;
}

// Ensures `<repo>/.buddy` (or a subdirectory of it) exists. Does not touch `.gitignore` (which belongs to the project's versioned files and is updated by `buddy init`);
// instead writes `.buddy/.gitignore` with `*` so git always ignores everything inside `.buddy/` without modifying the repository's own `.gitignore`.
export function ensureBuddyDir(repo, ...sub) {
  const base = buddyDir(repo);
  const dir = path.join(base, ...sub);
  fs.mkdirSync(dir, { recursive: true });
  const gi = path.join(base, '.gitignore');
  if (!fs.existsSync(gi)) fs.writeFileSync(gi, '*\n');
  return dir;
}
