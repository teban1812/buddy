// `buddy migrate`: moves the records of older layouts into today's, once; run again, it finds nothing to move.
// 1. The flat layout of before R87 into one folder per change. Every record of docs/buddy/slices becomes a change in the backlog
// (docs/buddy/backlog/<created date>-<name>/change.md), except a record that names an `epic:`, which becomes a slice file in its epic's folder
// (the folder replaces the field; an epic becomes a change of kind feat). Old ids take the names of the map (R86); every reference follows.
// The question batches of docs/buddy/questions taken for a slice move into its change's folder; other records (decisions included: they
// stay in docs/decisions) are rewritten in place. All or nothing: if the result would not verify, nothing is written.
// 2. The backlog of before R118, docs/buddy/changes/, into docs/buddy/backlog/ (its changes belong to no milestone): each folder moves whole,
// with its name and date, through `git mv` when git tracks it, so the files keep their history; nothing inside is rewritten.
import fs from 'node:fs';
import path from 'node:path';
import { parseDocument } from './frontmatter.mjs';
import { loadFiles } from './verify.mjs';
import { SLICE_NAME, NAME_RULE } from './ids.mjs';
import { execFileSync } from 'node:child_process';
import { listSlices, commitAll, CHANGES, BACKLOG } from './slicestore.mjs';
import { git } from './proc.mjs';
import { canonicalText, NO_STEPS, parseSteps } from './slice.mjs';

// A body without steps says so (R87); the word goes under the Steps heading, which is added when missing.
const sayNoSteps = (body, word) => parseSteps(body).steps.length || Object.values(NO_STEPS).some(w => body.includes(w)) ? body
  : /^##\s+Steps\s*$/m.test(body) ? body.replace(/^##\s+Steps\s*$/m, `## Steps\n\n${word}`) : `${body.trimEnd()}\n\n## Steps\n\n${word}\n`;

export function migrate(repo, { map = {}, dry = false } = {}) {
  const flat = migrateFlat(repo, { map, dry }); const backlog = migrateBacklog(repo, { dry });
  const moves = [...flat.moves, ...backlog];
  return moves.length ? { moves, renamed: flat.renamed, dry } : { moves: [], nothing: true };
}

const rel = (repo, f) => path.relative(repo, f).split(path.sep).join('/');
function migrateBacklog(repo, { dry }) {
  const old = path.join(repo, CHANGES); if (!fs.existsSync(old)) return [];
  const moves = fs.readdirSync(old).sort().map(n => ({ from: path.join(old, n), to: path.join(repo, BACKLOG, n) }));
  for (const m of moves) if (fs.existsSync(m.to)) throw new Error(`${rel(repo, m.to)} already exists: move ${rel(repo, m.from)} by hand or rename one of them`);
  const out = moves.map(m => ({ from: rel(repo, m.from), to: rel(repo, m.to), folder: true }));
  if (dry) return out;
  const tracked = m => git(['ls-files', '--', rel(repo, m.from)], repo).trim() !== '';
  const mv = (from, to, viaGit) => {
    if (!viaGit) { fs.renameSync(from, to); return; }
    try { execFileSync('git', ['mv', rel(repo, from), rel(repo, to)], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { throw new Error(`git mv ${rel(repo, from)} failed: ${String(e.stderr || e.message).trim()}`); }
  };
  fs.mkdirSync(path.join(repo, BACKLOG), { recursive: true }); const done = [];
  try { for (const m of moves) { const g = tracked(m); mv(m.from, m.to, g); done.push({ ...m, g }); } }
  catch (e) { for (const m of done.reverse()) mv(m.to, m.from, m.g); throw e; }                   // all or nothing
  if (!fs.readdirSync(old).length) fs.rmdirSync(old);
  return out;
}

function migrateFlat(repo, { map, dry }) {
  const all = listSlices(repo); const flat = all.filter(s => !s.folder);
  if (!flat.length) return { moves: [], renamed: {} };
  const name = id => map[id] ?? id;
  for (const s of flat) if (!SLICE_NAME.test(name(s.data.id))) throw new Error(`${s.data.id} has no name: add it to the map (${NAME_RULE})`);
  const seen = new Map(); for (const s of all) { const n = s.folder ? s.data.id : name(s.data.id); if (seen.has(n)) throw new Error(`two records would be named ${n}: ${seen.get(n)} and ${s.data.id}`); seen.set(n, s.data.id); }
  const renamed = new Map(flat.filter(s => name(s.data.id) !== s.data.id).map(s => [s.data.id, name(s.data.id)]));
  const ref = id => renamed.get(id) ?? id;
  const byId = new Map(flat.map(s => [s.data.id, s]));
  const parentOf = s => (s.data.epic && byId.has(s.data.epic) ? s.data.epic : null);
  const dirOf = id => { const s = byId.get(id); const top = parentOf(s) ? byId.get(parentOf(s)) : s; return path.join(repo, BACKLOG, `${String(top.data.created).slice(0, 10)}-${name(top.data.id)}`); };
  const writes = []; const homeOf = new Map();                   // old slice id -> the folder of its change
  for (const s of flat) {
    const kids = flat.filter(x => parentOf(x) === s.data.id); const dir = dirOf(s.data.id); homeOf.set(s.data.id, dir);
    const data = { ...s.data, id: name(s.data.id), ...(s.data.kind === 'epic' ? { kind: 'feat' } : {}), ...(s.data.depends_on ? { depends_on: s.data.depends_on.map(ref) } : {}) }; delete data.epic;
    const file = parentOf(s) ? path.join(dir, `${data.id}.md`) : path.join(dir, 'change.md');
    if (fs.existsSync(file)) throw new Error(`${path.relative(repo, file)} already exists`);
    writes.push({ was: s.file, file, text: canonicalText(data, sayNoSteps(s.body, parentOf(s) ? NO_STEPS.slice : kids.length ? NO_STEPS.split : NO_STEPS.change)) });
  }
  for (const s of all.filter(x => x.folder && (x.data.depends_on || []).some(d => renamed.has(d)))) writes.push({ file: s.file, text: canonicalText({ ...s.data, depends_on: s.data.depends_on.map(ref) }, s.body) });
  // batches, decisions and findings: `slice:` and `requested_by` follow; the batches of docs/buddy/questions move (decisions stay in docs/decisions)
  const field = /^((?:slice|requested_by):[ \t]+)"?([^"\s]+)"?[ \t]*$/gm; const n = new Map();
  const questions = path.resolve(repo, 'docs', 'buddy', 'questions') + path.sep;
  for (const f of loadFiles([path.join(repo, 'docs')])) {
    const text = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n'); const d = parseDocument(text);
    if (!['buddy/question-batch@0', 'buddy/decision@0', 'buddy/finding@0'].includes(d.data?.schema)) continue;
    const owner = homeOf.has(d.data.slice) ? d.data.slice : null; const end = text.indexOf('\n---', 3) + 1;
    const next = text.slice(0, end).replace(field, (m, k, v) => renamed.has(v) ? `${k}${renamed.get(v)}` : m) + text.slice(end);
    let file = f;
    if (owner && path.resolve(f).startsWith(questions)) { const dir = homeOf.get(owner); let i = (n.get(dir) ?? 0) + 1; while (fs.existsSync(path.join(dir, `questions-${i}.md`))) i++; n.set(dir, i); file = path.join(dir, `questions-${i}.md`); }    if (file !== f || next !== text) writes.push({ was: f, file, text: next });
  }
  const rel = f => path.relative(repo, f).split(path.sep).join('/'); const moves = writes.map(w => ({ from: rel(w.was ?? w.file), to: rel(w.file) }));
  if (!dry) commitAll(repo, writes, { all: true });
  return { moves, renamed: Object.fromEntries(renamed), dry };
}
