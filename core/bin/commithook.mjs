#!/usr/bin/env node
// The plugin's PreToolUse hook for the Bash tool (R111): reads what Claude Code is about to run on stdin and refuses a `git commit` whose message
// breaks Conventional Commits or Buddy's trailers, or that would put a secret in the repository. It acts only in a Buddy project (docs/buddy/ exists),
// writes nothing into it, and is quiet (exit 0) for everything else. A refusal is exit 2 with the reasons on stderr, which Claude reads and fixes.
import fs from 'node:fs';
import path from 'node:path';
import { readCommitCommands, scanStaged, scanFiles, changedFiles, filesToCommit } from '../src/commithook.mjs';
import { checkCommitMessage } from '../src/commitcheck.mjs';

let input = '';
try { input = fs.readFileSync(0, 'utf8'); } catch { process.exit(0); }
let ev; try { ev = JSON.parse(input); } catch { process.exit(0); }
if (ev.tool_name !== 'Bash' || typeof ev.tool_input?.command !== 'string') process.exit(0);
const cwd = ev.cwd || process.cwd();
const plan = readCommitCommands(ev.tool_input.command, { readFile: f => fs.readFileSync(path.resolve(cwd, f), 'utf8') });
const commits = plan.commits;
if (!commits.length || !fs.existsSync(path.join(cwd, 'docs', 'buddy'))) process.exit(0);
const problems = [];
for (const cmd of commits) {                                  // every git commit of the command, not only the first
  if (!cmd.message) continue;
  const r = checkCommitMessage(cmd.message, { cwd });
  if (!r.ok) problems.push(`The commit message breaks the rules:\n${r.errors.map(e => `  - ${e}`).join('\n')}`);
}
const leak = text => `gitleaks found something that looks like a secret in ${text} (not shown here):\n  Take it out of the commit (and rotate it if it is real) before committing again.`;
// What the commit will contain: what is staged now, and what this same command adds before committing it (git add paths, -A, a pathspec, -a);
// of the paths it names, only the files that change (a file committed earlier and left as it is is not scanned again)
const extra = filesToCommit(cwd, [...plan.adds, ...commits.flatMap(c => c.paths)].filter(f => fs.existsSync(path.resolve(cwd, f))));
const everything = plan.addsAll ? changedFiles(cwd, { untracked: true }) : commits.some(c => c.all) ? changedFiles(cwd) : [];
if (scanStaged(cwd).status === 'failed') problems.push(leak('what is staged'));
else if ([...extra, ...everything].length && scanFiles(cwd, [...new Set([...extra, ...everything])]).status === 'failed') problems.push(leak('the files this command adds to the commit'));
if (problems.length) { process.stderr.write(`Buddy stopped this commit before it happened.\n${problems.join('\n')}\n`); process.exit(2); }
process.exit(0);
