// Where Buddy keeps what is not worth the history (R134): `buddy/` inside the repository's git folder. In a plain repository that folder
// is `<repo>/.git`; in a git worktree `.git` is a one-line file and the folder is the worktree's own one inside the main repository, which
// git names (R146): each worktree keeps its own hand-overs, index and marks. Every module asks here instead of assuming `.git` is a folder.
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
// Buddy's folder in it: `<git folder>/buddy`; outside a git repository, `<repo>/.git/buddy` as before (the callers that need git say so).
export const buddyDir = repo => path.join(gitDir(repo) ?? path.join(repo, '.git'), 'buddy');
