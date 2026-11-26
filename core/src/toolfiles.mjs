// What each tool reads in a project, and what Buddy wrote of it (support-antigravity, steps 6.2 and 6.3).
// Claude Code reads CLAUDE.md and .claude/skills/, Antigravity AGENTS.md and .agents/skills/. A saved prompt of the library is written once, in full, to
// .agents/skills/<name>/; for Claude Code a thin SKILL.md in .claude/skills/<name>/ carries the same front matter (copied, never typed) and says to read the real file.
// docs/buddy/tool-files.json holds a hash of each file Buddy wrote, committed like the other records: a file whose hash differs was edited by the owner and is never replaced.
// Antigravity's form of the routine permissions is not written: where it reads a project's rules and their syntax are not verified.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { BEGIN, BLOCK } from './claudemd.mjs';
import { findTools } from './tools.mjs';

export const INSTRUCTIONS = { claude: 'CLAUDE.md', agy: 'AGENTS.md' };
export const FULL = '.agents/skills', WRAPPED = '.claude/skills', MANIFEST = 'docs/buddy/tool-files.json';
const FRONT = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;
const hash = text => createHash('sha256').update(text).digest('hex');

export function readManifest(root) {
  try { const m = JSON.parse(fs.readFileSync(path.join(root, MANIFEST), 'utf8')); return m && typeof m.files === 'object' && m.files ? m.files : {}; } catch { return {}; }
}
// Adds the hash of each file (a path in the project, with /) as it is now; what was recorded before is kept.
export function recordFiles(root, rels) {
  const files = readManifest(root);
  for (const rel of rels) { try { files[rel] = hash(fs.readFileSync(path.join(root, rel), 'utf8')); } catch { /* not there: nothing to record */ } }
  const file = path.join(root, MANIFEST); fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ schema: 'buddy/tool-files@1', files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) }, null, 2) + '\n');
  return MANIFEST;
}

// The thin SKILL.md for Claude Code: the real prompt's front matter as it is, and a body that only sends to the real file.
export const wrapperOf = (name, real) => `${real.match(FRONT)?.[0] ?? ''}Read the full prompt in \`${FULL}/${name}/SKILL.md\` (with any other file in that folder) and follow it as if it were written here.\n`;

// Writes a file only when there is none; returns whether it did.
export function writeNew(root, rel, text) {
  const to = path.join(root, rel); if (fs.existsSync(to)) return false;
  fs.mkdirSync(path.dirname(to), { recursive: true }); fs.writeFileSync(to, text); return true;
}

// When Buddy picks a project up and a tool is on the machine whose files are missing, he writes them (never over what exists). Only for a project Buddy built
// (one that holds his block or his manifest). A wrapper follows its prompt's front matter unless the owner edited it. Returns the actions, as init reports them.
export function bringTools(root, tools = findTools()) {
  const had = rel => { try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch { return null; } };
  const files = readManifest(root);
  if (!Object.keys(files).length && !Object.values(INSTRUCTIONS).some(f => had(f)?.includes(BEGIN))) return [];
  const out = [], wrote = [];
  for (const t of tools) if (writeNew(root, INSTRUCTIONS[t], BLOCK)) { wrote.push(INSTRUCTIONS[t]); out.push({ done: 'created', what: INSTRUCTIONS[t], note: 'the same short pointers the other tool reads' }); }
  if (tools.includes('claude')) for (const rel of Object.keys(files).filter(f => f.startsWith(`${FULL}/`) && f.endsWith('/SKILL.md'))) {
    const name = rel.split('/')[2], real = had(rel), wrap = `${WRAPPED}/${name}/SKILL.md`; if (real == null) continue;
    const want = wrapperOf(name, real), have = had(wrap);
    if (have == null) { writeNew(root, wrap, want); wrote.push(wrap); out.push({ done: 'created', what: wrap, note: `reads ${FULL}/${name}/SKILL.md` }); }
    else if (have !== want && hash(have) === files[wrap]) { fs.writeFileSync(path.join(root, wrap), want); wrote.push(wrap); out.push({ done: 'merged', what: wrap, note: "its prompt's front matter changed, so the wrapper follows it" }); }
    else if (have !== want) out.push({ done: 'kept', what: wrap, note: "you edited it, and its prompt's front matter differs; left as it was" });
  }
  if (wrote.length) recordFiles(root, wrote);
  return out;
}
export const bringReport = actions => actions.length ? ['', 'A tool found on this machine had no files here; what Buddy wrote is not committed yet and goes with the next commit:', ...actions.map(a => `  ${a.done.padEnd(8)} ${a.what} (${a.note})`)].join('\n') : '';
