// Loads the files of one change (slice, question batches, decisions, findings) from a directory tree. A folder of a repository's records
// (under docs/buddy) is read from the index (R148): the same story, without reading the files again; any other folder (an example, a copy)
// is read from its files. A change's decisions are in docs/decisions, each naming its change.
import fs from 'node:fs';
import path from 'node:path';
import { parseDocument } from './frontmatter.mjs';
import { parseSteps } from './slice.mjs';
import { readIndex } from './index.mjs';

const KIND = { 'buddy/slice@1': 'slices', 'buddy/question-batch@0': 'batches', 'buddy/decision@0': 'decisions', 'buddy/finding@0': 'findings', 'buddy/context@0': 'contexts' };

// The repository whose records hold `dir` (a folder at or under its docs/buddy), or null.
function recordsRepo(dir) {
  const abs = path.resolve(dir);
  for (let p = abs; ; p = path.dirname(p)) {
    const rec = path.join(p, 'docs', 'buddy');
    if (fs.existsSync(rec) && (abs === rec || abs.startsWith(rec + path.sep))) return p;
    if (path.dirname(p) === p) return null;
  }
}
// The order in which the walk of the folder meets the files: each folder's names in localeCompare order, depth first.
const walkOrder = (a, b) => { const x = a.split('/'); const y = b.split('/'); for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i].localeCompare(y[i]); return x.length - y.length; };

export function loadStory(dir, { slice, index } = {}) {
  const repo = recordsRepo(dir);
  return repo ? storyFromIndex(repo, dir, { slice, index }) : storyFromFiles(dir, { slice });
}

function pick(all, slice) {
  const s = slice ? all.slices.find(x => x.data.id === slice) : all.slices.find(x => path.basename(x.file) === 'milestone.md') ?? all.slices.find(x => path.basename(x.file) === 'change.md') ?? all.slices[0];   // a change folder tells its change's story, a milestone folder its milestone's
  if (!s) throw new Error(slice ? `there is no slice or change ${slice}` : 'no slice record found');
  const ids = x => new Set(x || []);
  const batches = all.batches.filter(b => ids(s.data.batches).has(b.data.id) || b.data.slice === s.data.id).sort((a, b) => a.data.round - b.data.round);
  const decisions = all.decisions.filter(d => ids(s.data.decisions).has(d.data.id) || d.data.slice === s.data.id);
  const findings = all.findings.filter(f => ids(s.data.findings).has(f.data.id) || f.data.slice === s.data.id);
  return { slice: s.data, steps: s.steps ?? parseSteps(s.body).steps, batches: batches.map(b => b.data), decisions, findings: findings.map(f => f.data), context: all.contexts[0] ?? null, errors: all.errors };
}

// The records of `dir` as the index holds them: the files under it, in the order the walk would meet them.
function storyFromIndex(repo, dir, { slice, index }) {
  const x = index ?? readIndex(repo); const base = path.relative(repo, path.resolve(dir)).split(path.sep).join('/');
  const under = f => f === base || f.startsWith(`${base}/`); const order = (a, b) => walkOrder(a.rel, b.rel); const abs = f => path.join(repo, f);
  const strip = ({ file: _f, ...data }) => data;   // a batch as its front matter holds it
  const all = {
    slices: [...x.milestones, ...x.changes].filter(r => under(r.file)).map(r => ({ rel: r.file, file: abs(r.file), data: r.data, steps: r.step_list })).sort(order),
    batches: x.batches.filter(b => under(b.file)).map(b => ({ rel: b.file, file: abs(b.file), data: strip(b) })).sort(order),
    decisions: x.decision_records.filter(r => under(r.file) || r.file.startsWith('docs/decisions/')).map(r => ({ rel: r.file, file: abs(r.file), data: r.data, body: r.body })).sort(order),
    findings: x.findings.filter(r => under(r.file)).map(r => ({ rel: r.file, file: abs(r.file), data: r.data })).sort(order),
    contexts: [], errors: x.problems.filter(p => under(p.file)).map(p => `${abs(p.file)}: ${p.message}`),
  };
  const story = pick(all, slice);
  story.decisions = story.decisions.map(({ rel: _r, ...d }) => d);
  return story;
}

function storyFromFiles(dir, { slice } = {}) {
  const all = { slices: [], batches: [], decisions: [], findings: [], contexts: [], errors: [] };
  const walk = p => {
    for (const e of fs.readdirSync(p, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name === 'node_modules' || e.name.startsWith('.git')) continue;
      const f = path.join(p, e.name);
      if (e.isDirectory()) walk(f);
      else if (e.name.endsWith('.md')) {
        const d = parseDocument(fs.readFileSync(f, 'utf8'));
        if (d.error) { if (/schema:\s*buddy\//.test(fs.readFileSync(f, 'utf8'))) all.errors.push(`${f}: ${d.error}`); continue; }
        const k = KIND[d.data?.schema]; if (k) all[k].push({ file: f, data: d.data, body: d.body });
      }
    }
  };
  walk(dir);
  return pick(all, slice);
}
