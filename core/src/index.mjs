// The index of the records (R138, R139): one reader reads, in one pass, every record Buddy keeps (milestones, changes and their pieces, the
// map of what was asked, the question batches, the checkpoint evidence and the decisions of docs/requirements-log.md) into one object, the
// one the board, its page, the digest and the order of the work are built from. `.buddy/index.json` is its by-product for other readers
// (`buddy find`, an agent): it is rewritten only when a record changed (the fingerprint of the files read: path, size and time) and never
// kept in the history (X2). No server, no viewer (X1). A record that does not read is named in `problems`, not left out in silence. A file
// written by an earlier version of what it computes (RULES; Now and Next joined it in R144, a waiting milestone in R147) is rebuilt.
// Every reader that only reads the records takes them from here (R148): the board, the digest, the minutes, resume, the accept card's
// batches and the story view; the writers and verify read the files. A rebuild rereads only the files whose size or time changed since the
// last one (`.buddy/index-cache.json` keeps, per file read, its stamp and what was read from it), and reads the short summary a
// checkpoint writes beside its evidence instead of the whole evidence when there is one.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { linkChanges, inLayout } from './verify.mjs';
import { parseDocument } from './frontmatter.mjs';
import { parseSteps } from './slice.mjs';
import { unspecifiedOf, withReclassified, EVIDENCE_FILE, summaryFileOf, evidenceSummary } from './evidence.mjs';
import { PRIORITIES, proposedDependencies } from './requests.mjs';
import { buddyDir, ensureBuddyDir, isGitRepo } from './gitdir.mjs';

export const INDEX = '.buddy/index.json';   // Buddy's local unversioned index at the project root (ignored by .gitignore; per worktree)
export const indexFile = repo => path.join(buddyDir(repo), 'index.json');
export const cacheFile = repo => path.join(buddyDir(repo), 'index-cache.json');
export const DECISIONS = 'docs/requirements-log.md';
const CLOSED = ['accepted', 'abandoned'];
const DELIVERED = ['delivered', 'accepted'];   // a change waited for no longer holds the others back (R144)
const DONE = [...DELIVERED, 'abandoned'];       // what is left out of Next
const rel = (repo, f) => path.relative(repo, f).split(path.sep).join('/');
const EVIDENCE = EVIDENCE_FILE;
// The version of what the index computes from the records: a file written by an earlier one is rebuilt even when no record changed.
const RULES = 7;   // 2: Next may be a milestone waiting for the owner's go-ahead (R147); 3: that go-ahead is the milestone moved to building;
                   // 4: the dependencies Buddy proposed and the owner has not confirmed are counted (R148); 5: every reader's data (R148);
                   // 6: Next may be the next piece of a change being built in pieces (R156); 7: only open requests' proposed dependencies count (R162)

// The files read: the .md under docs/buddy, docs/decisions and docs/questions.md (the records, in the order loadFiles gives), the evidence of
// each change folder and of .buddy (checkpoints run without a change), and the decisions. Only a listing and a stat each: cheap.
export function inputs(repo) {
  const md = []; const evidence = []; const docs = path.join(repo, 'docs');
  const walk = p => {
    for (const e of fs.readdirSync(p, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      if (e.name === 'node_modules' || e.name.startsWith('.git')) continue; const f = path.join(p, e.name);
      if (e.isDirectory()) { if (e.name === 'evidence' && fs.existsSync(path.join(p, 'change.md'))) evidence.push(...fs.readdirSync(f).filter(x => EVIDENCE.test(x)).sort().map(x => path.join(f, x))); walk(f); }
      else if (e.name.endsWith('.md')) md.push(f);
    }
  };
  if (fs.existsSync(path.join(docs, 'buddy'))) walk(path.join(docs, 'buddy'));
  if (fs.existsSync(path.join(docs, 'decisions'))) walk(path.join(docs, 'decisions'));
  if (fs.existsSync(path.join(docs, 'questions.md'))) md.push(path.join(docs, 'questions.md'));
  const gb = buddyDir(repo); if (fs.existsSync(gb)) evidence.unshift(...fs.readdirSync(gb).filter(x => EVIDENCE.test(x)).sort().map(x => path.join(gb, x)));
  const decisions = fs.existsSync(path.join(repo, DECISIONS)) ? path.join(repo, DECISIONS) : null;
  return { md, evidence, decisions };
}
export function fingerprint(repo, inp = inputs(repo)) {
  const h = crypto.createHash('sha256');
  for (const f of [...inp.md, ...inp.evidence, ...(inp.decisions ? [inp.decisions] : [])]) h.update(`${rel(repo, f)}\t${stampOf(f)}\n`);   // an evidence with its summary
  return h.digest('hex').slice(0, 16);
}

// One evidence file, summarised: what the board and the digest read, and whether it holds the fingerprints acceptance compares. Its
// decisions nobody specified are read with the reclassifications the record of its slice keeps (reclassified, R140).
const summary = (file, e, reclassified) => ({ file, slice: e.slice ?? null, when: e.when ?? null, decision: e.decision ?? null, reasons: e.reasons || [], checks: e.checks || {}, unspecified: unspecifiedOf(withReclassified(e, path.posix.basename(file), reclassified)), code_hash: !!e.code_hash, files_hash: !!e.files_hash });
// One row of the requirements log, `| R<n> | <date> | <status> | <built> | **<title>** ... | <refs> |` (a principle of the blueprint is a
// `P<n>` row); the title is its first bold text, else its first sentence. The Built cell (R110) is one of BUILT, then `: <where>` (a change,
// a file, the reason it is deferred, the decision that supersedes it); a row written before that column has `built: null`.
export const BUILT = ['built', 'partly', 'not built', 'backlog', 'deferred', 'superseded', 'not applicable'];
const ROW = /^\| ([RP]\d+) \| ([^|]*?) \| ([^|]*?) \| (?:((?:not built|not applicable|built|partly|backlog|deferred|superseded)(?::[^|]*)?) \| )?(.*) \| ([^|]*?) \|\s*$/;
export function readDecisions(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const m = ROW.exec(line); if (!m) continue; const body = m[5].trim(); const b = /\*\*(.+?)\*\*/.exec(body);
    const cell = m[4] ? /^([^:]+)(?::\s*(.*))?$/.exec(m[4].trim()) : null;
    out.push({ id: m[1], date: m[2].trim(), status: m[3].trim(), built: cell ? cell[1].trim() : null, where: cell ? (cell[2] ?? '').trim() : '', title: b ? b[1] : body.split(/(?<=\.)\s|;\s/)[0], text: body, refs: m[6].trim() });
  }
  return out;
}

// What the index keeps of one file, read once and kept in the cache until its size or time changes. A record (.md): its front matter, and
// for a slice its steps, for a decision record its body; a front matter that does not read is kept as such. Evidence: its summary (the
// checkpoint's own summary file when there is one, else made here from the whole file by the same code). The decisions log: its rows.
const RECORD = ['buddy/slice@1', 'buddy/question-batch@0', 'buddy/requests@1', 'buddy/decision@0', 'buddy/finding@0'];
function readMd(f) {
  const text = fs.readFileSync(f, 'utf8'); const d = parseDocument(text);
  if (d.error) return { error: d.error, buddy: /^schema:\s*buddy\//m.test(text) };
  if (!d.data || !RECORD.includes(d.data.schema)) return { none: true };
  return { data: d.data, ...(d.data.schema === 'buddy/slice@1' ? { steps: parseSteps(d.body).steps } : {}), ...(d.data.schema === 'buddy/decision@0' ? { body: d.body } : {}) };
}
function readEvidenceFile(f) {
  const sf = summaryFileOf(f);
  if (fs.existsSync(sf)) { try { return { summary: JSON.parse(fs.readFileSync(sf, 'utf8')), from: 'summary' }; } catch { /* read the whole evidence */ } }
  try { return { summary: evidenceSummary(JSON.parse(fs.readFileSync(f, 'utf8'))), from: 'evidence' }; } catch (e) { return { error: e.message }; }
}
const stampOf = f => { const st = fs.statSync(f); const sf = summaryFileOf(f); const ss = sf !== f && fs.existsSync(sf) ? fs.statSync(sf) : null; return `${st.size}:${st.mtimeMs}${ss ? `|${ss.size}:${ss.mtimeMs}` : ''}`; };

// `cache`: { files: { <path>: { stamp, v } } }, the files read last time; what is read is put in it, the files gone are dropped, and
// `cache.reread` lists the paths read this time. Without one, every file is read.
export function buildIndex(repo, { now = () => new Date(), inp = inputs(repo), cache } = {}) {
  const was = cache?.files || {}; const files = {}; const reread = [];
  const load = (f, read) => { const k = rel(repo, f); const stamp = stampOf(f); const c = was[k]; if (c && c.stamp === stamp) { files[k] = c; return c.v; } const v = read(f); files[k] = { stamp, v }; reread.push(k); return v; };
  const docs = []; const batches = []; let requests = null; const problems = []; const notes = [];
  for (const f of inp.md) {
    const v = load(f, readMd);
    if (v.error) { if (v.buddy) problems.push({ file: rel(repo, f), message: v.error }); continue; }
    if (v.none) continue; const data = v.data;
    if (data.schema === 'buddy/slice@1' && !inLayout(f)) continue; if (data.schema === 'buddy/slice@1') docs.push({ data, steps: v.steps, file: f });
    else if (data.schema === 'buddy/question-batch@0') batches.push({ ...data, id: data.id, slice: data.slice ?? null, file: rel(repo, f), questions: (data.questions || []).map(q => ({ ...q, blocking: !!q.blocking, answer: q.answer ?? null })), assumed_defaults: data.assumed_defaults || [] });
    else if (data.schema === 'buddy/requests@1') requests = (data.items || []).map(x => ({ ...x }));
    else notes.push({ schema: data.schema, file: rel(repo, f), data, ...(v.body !== undefined ? { body: v.body } : {}) });
  }
  const evidence = []; const recl = new Map(docs.map(x => [x.data.id, x.data.reclassified]));
  for (const f of inp.evidence) { const v = load(f, readEvidenceFile); if (v.error) problems.push({ file: rel(repo, f), message: v.error }); else evidence.push(summary(rel(repo, f), v.summary, recl.get(v.summary.slice))); }
  // the latest evidence of a record is the last by name in its change folder that names it
  const latest = (file, id) => { const dir = rel(repo, path.join(path.dirname(file), 'evidence')) + '/'; return evidence.filter(e => e.file.startsWith(dir) && !e.file.slice(dir.length).includes('/') && e.slice === id).pop()?.file ?? null; };
  const all = linkChanges(docs).map(({ data: s, steps: st, file, change, milestone, folder }) => {
    const i = st.findIndex(x => !x.done);
    return { id: s.id, title: s.title, kind: s.kind, status: s.status, rank: s.rank, change, milestone, file: rel(repo, file), updated: s.updated ?? s.created, branch: s.branch ?? null,
      request: s.request ?? null, depends_on: s.depends_on || [], batches: s.batches || [], departures: (s.divergences || []).filter(v => v.status === 'declared').length,
      assurance: s.accepted ? (s.accepted.assurance ?? 'recorded') : null, criteria: s.criteria || [], excludes: s.excludes || [], assumptions: s.assumptions || [],
      steps: { done: st.filter(x => x.done).length, total: st.length, next: i < 0 ? null : { n: i + 1, text: st[i].text } }, evidence: folder ? latest(file, s.id) : null,
      folder: !!folder, data: s, step_list: st };
  }).sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));
  const milestones = all.filter(r => r.kind === 'milestone'); const changes = all.filter(r => r.kind !== 'milestone');
  // Each change's priority and what it waits for (R133). Its priority is the highest of the requests covered by it or by one of its slices;
  // it waits for another change not yet delivered that covers a request its own depend on, or that it depends on directly (`depends_on`).
  // A delivered one no longer holds it back: acceptance never blocks the work (R115, R144). An abandoned one counts as finished, and is named
  // apart so a dependency that went nowhere is not hidden.
  const byId = new Map(changes.map(r => [r.id, r])); const items = requests || []; const item = new Map(items.map(x => [x.id, x]));
  const own = r => items.filter(x => x.destination === 'covered' && (x.to === r.id || byId.get(x.to)?.change === r.id));
  const unit = id => { const c = byId.get(id); return c ? c.change ?? c.id : null; };   // the change that covers a request, its slice's change
  for (const r of changes) {
    const mine = own(r); r.priority = PRIORITIES.find(p => mine.some(x => x.priority === p)) ?? null; r.waits_for = []; r.abandoned_deps = [];
    if (CLOSED.includes(r.status)) continue;
    const need = new Set(r.depends_on);
    for (const x of mine) for (const d of x.depends_on || []) { const y = item.get(d.id); if (y?.destination === 'covered') need.add(unit(y.to)); }
    for (const o of changes) if (need.has(o.id) && o.id !== r.id && o.id !== r.change && !DELIVERED.includes(o.status)) (o.status === 'abandoned' ? r.abandoned_deps : r.waits_for).push({ id: o.id, title: o.title, status: o.status });
  }
  // Now and Next (design/17 §3, R144), computed here once for the board, its page, the digest and Buddy: Now is what is being built, each with
  // its first open step (its position among all the steps); Next is the first change by rank, in the milestone being built, that is not
  // delivered, accepted, abandoned or being built, even when it waits (then it says for what). A change with a piece being built is in Now,
  // not Next. The owner's go-ahead for a milestone is moving it to building (R147): the milestone being built is the first by rank in
  // building that is not finished (every change delivered, accepted or abandoned). With none, Next is the first open milestone that is
  // refining or ready and not finished, which waits for that go-ahead, whether or not the one before is already accepted; the changes of a
  // milestone that is not building are never Next. With no open milestone, Next comes from the backlog; without milestones every change
  // counts. Nothing left: null.
  const current = changes.filter(r => r.status === 'building').map(r => ({ id: r.id, title: r.title, change: r.change, step: r.steps.next ? { n: r.steps.next.n, total: r.steps.total, text: r.steps.next.text } : null }));
  const finished = id => { const ch = changes.filter(r => r.milestone === id && !r.change); return ch.length > 0 && ch.every(r => DONE.includes(r.status)); };
  const open = milestones.filter(m => !CLOSED.includes(m.status)); const active = open.find(m => m.status === 'building' && !finished(m.id));
  const scope = !milestones.length ? undefined : active ? active.id : !open.length ? null : false;   // false: no change of any milestone is Next
  const busy = new Set(current.map(r => r.change).filter(Boolean));
  // A change being built in pieces (some piece building, delivered or accepted, some still refining or ready) comes first: Next is its next
  // piece by rank, with the change named (R156), before any other change.
  const inScope = r => !r.change && (scope === undefined || r.milestone === scope) && !DONE.includes(r.status);
  const piecesOf = id => changes.filter(p => p.change === id); const LEFT = ['refining', 'ready'];
  const split = scope === false ? null : changes.find(r => inScope(r) && piecesOf(r.id).some(p => ['building', ...DELIVERED].includes(p.status)) && piecesOf(r.id).some(p => LEFT.includes(p.status)));
  const np = split ? piecesOf(split.id).find(p => LEFT.includes(p.status)) : null;
  const nx = np || scope === false ? null : changes.find(r => !r.change && (scope === undefined || r.milestone === scope) && ![...DONE, 'building'].includes(r.status) && !busy.has(r.id));
  const nm = scope === false ? open.find(m => ['refining', 'ready'].includes(m.status) && !finished(m.id)) ?? null : null;
  const next = np ? { id: np.id, title: np.title, status: np.status, milestone: split.milestone ?? null, waits_for: np.waits_for, change: { id: split.id, title: split.title } }
    : nx ? { id: nx.id, title: nx.title, status: nx.status, milestone: nx.milestone ?? null, waits_for: nx.waits_for }
    : nm ? { kind: 'milestone', id: nm.id, title: nm.title, status: nm.status, milestone: nm.id, waits_for: [], go_ahead: true } : null;
  const decisions = inp.decisions ? load(inp.decisions, f => readDecisions(fs.readFileSync(f, 'utf8'))) : [];
  // the dependencies of the map of what was asked that Buddy proposed (origin assumed) and the owner has not confirmed (R148), of the
  // requests still open only: not excluded, deferred or covered by a change or milestone delivered or accepted (R162)
  const proposed_dependencies = proposedDependencies(requests, new Map([...milestones, ...changes].map(r => [r.id, r.status])));
  const index = { schema: 'buddy/index@1', rules: RULES, generated: now().toISOString().slice(0, 19) + 'Z', fingerprint: fingerprint(repo, inp), milestones, changes, now: current, next, requests, proposed_dependencies, batches, evidence, decisions,
    decision_records: notes.filter(n => n.schema === 'buddy/decision@0'), findings: notes.filter(n => n.schema === 'buddy/finding@0'), problems };
  if (cache) { cache.files = files; cache.reread = reread; }
  return index;
}

// The index as `.buddy/index.json` holds it, rebuilt (and written) when a record changed since, or with `force`. A rebuild rereads only
// the files whose stamp changed, from the cache; `force` reads every file again. Outside a git repository nothing is written. Returns
// { index, rebuilt, file, reread } (`reread`: the paths read again, on a rebuild).
const readCache = repo => { try { const c = JSON.parse(fs.readFileSync(cacheFile(repo), 'utf8')); return c.rules === RULES && c.files ? c : null; } catch { return null; } };
function writeOut(repo, index, cache) {
  if (!isGitRepo(repo)) return; const file = indexFile(repo); ensureBuddyDir(repo);
  fs.writeFileSync(file, JSON.stringify(index) + '\n'); if (cache) fs.writeFileSync(cacheFile(repo), JSON.stringify({ rules: RULES, files: cache.files }) + '\n');
}
export function refreshIndex(repo, { force = false, now } = {}) {
  const file = indexFile(repo); const inp = inputs(repo); const fp = fingerprint(repo, inp);
  if (!force) { try { const was = JSON.parse(fs.readFileSync(file, 'utf8')); if (was.schema === 'buddy/index@1' && was.fingerprint === fp && was.rules === RULES) return { index: was, rebuilt: false, file, reread: [] }; } catch { /* none yet, or unreadable: rebuild */ } }
  const cache = { files: force ? {} : readCache(repo)?.files || {} };
  const index = buildIndex(repo, { now, inp, cache });
  writeOut(repo, index, cache);
  return { index, rebuilt: true, file, reread: cache.reread };
}
// The radiators that build the index themselves leave the file up to date as a by-product.
export function saveIndex(repo, index) {
  const file = indexFile(repo); if (!isGitRepo(repo)) return;
  try { if (JSON.parse(fs.readFileSync(file, 'utf8')).fingerprint === index.fingerprint) return; } catch { /* write it */ }
  writeOut(repo, index, null);
}
// The index for a reader: the file when it is up to date, else rebuilt through the cache (R148).
export const readIndex = repo => refreshIndex(repo).index;

export const indexText = x => `index: ${x.milestones.length} milestone(s), ${x.changes.filter(r => !r.change).length} change(s), ${x.changes.filter(r => r.change).length} piece(s), ${(x.requests || []).length} request(s), ${x.batches.reduce((n, b) => n + b.questions.length, 0)} question(s), ${x.evidence.length} checkpoint(s), ${x.decisions.length} decision(s)${x.problems.length ? `; ${x.problems.length} record(s) did not read: ${x.problems.map(p => p.file).join(', ')}` : ''}`;

// Finding by words (AC3): every word must be in the text, case and accents aside. One hit per thing: { kind, id, text, path }.
const fold = s => String(s ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
export function find(x, words) {
  const ws = fold(words).split(/\s+/).filter(Boolean); if (!ws.length) return [];
  const hits = []; const add = (kind, id, text, where, ...more) => { const t = fold([text, ...more].join(' ')); if (ws.every(w => t.includes(w))) hits.push({ kind, id, text, path: where }); };
  for (const m of x.milestones) add('milestone', m.id, m.title, m.file, m.request);
  for (const r of x.changes) add(r.change ? 'piece' : 'change', r.id, r.title, r.file, r.request);
  for (const r of [...x.milestones, ...x.changes]) for (const c of r.criteria) add('criterion', `${r.id} ${c.id}`, c.text, r.file);
  for (const it of x.requests || []) add('request', it.id, it.text, 'docs/buddy/requests.md', it.source);
  for (const b of x.batches) for (const q of b.questions) add('question', q.id, q.situation, b.file);
  for (const d of x.decisions) add('decision', d.id, d.title, DECISIONS, d.text);
  return hits;
}
const short = (s, n = 80) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
export const findText = hits => (hits.length ? hits.map(h => `${h.kind.padEnd(9)} ${h.id}  ${short(h.text)}  · ${h.path}`).join('\n') : 'nothing found');
