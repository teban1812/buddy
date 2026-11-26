// Writes buddy/slice@1 files: start, steps, moves, renames. Every write goes through the verifier and is rolled back if the record would not
// verify, so the CLI is the only sanctioned way to change a slice (R5) and illegal moves never reach the disk.
// Layout (R87, R118): a change is <YYYY-MM-DD>-<name>/change.md; when it has more than one piece, each slice is <slice name>.md in the same
// folder, which also holds its question batches and checkpoint evidence (its decisions are in docs/decisions). A change lives in three places: in the
// changes/ folder of a milestone (docs/buddy/milestones/<YYYY-MM-DD>-<name>/, whose milestone.md is the milestone's record, kind milestone),
// in the backlog (docs/buddy/backlog/) when it belongs to no milestone.
import fs from 'node:fs';
import path from 'node:path';
import { parseDocument } from './frontmatter.mjs';
import { validate } from './jsonschema-lite.mjs';
import { verify, loadFiles } from './verify.mjs';
import { SLICE_ID, SLICE_NAME, NAME_RULE, nameFromTitle } from './ids.mjs';

// A slice, change or milestone named in a refusal or a card goes with its title, its id beside it (R78).
const sn = s => `${s.data.title} [${s.data.id}]`;
import { unconfirmedDefaults, unconfirmedIn } from './queue.mjs';
import { readIndex, inputs as recordInputs } from './index.mjs';
import { git, validateCommand, hasNpmScript } from './proc.mjs';
import { addStep, setStep, dropStep, canonicalText, NEXT, NO_STEPS, parseSteps, missingForReady, MAX_ASSUMPTIONS } from './slice.mjs';
import { refreshBoardPage } from './board.mjs';
import { MANIFEST, readManifest } from './prototype.mjs';
import { suiteGreen, FAST_TESTS, FULL_TESTS, latestEvidence, latestEvidenceFile, withReclassified, reviewFileOf, openNotes, exceptionsText, blobsAsOwned, blobOfEvidence, unspecifiedOf, apartOf } from './evidence.mjs';
import { vagueWarnings } from './vague.mjs';
import { stepRecords, stepWaitingText } from './context.mjs';

const schema = JSON.parse(fs.readFileSync(new URL('../schemas/slice.schema.json', import.meta.url), 'utf8'));
export const BACKLOG = 'docs/buddy/backlog';                 // the changes of no milestone (R118)
export const MILESTONES = 'docs/buddy/milestones';           // one folder per milestone, its changes in changes/ (R118)
export const RECORDS = 'docs/buddy';
const DATED = /^\d{4}-\d{2}-\d{2}-/;
const stamp = now => now().toISOString().slice(0, 19) + 'Z';
const parse = (file, change, folder) => { const d = parseDocument(fs.readFileSync(file, 'utf8')); if (d.error) throw new Error(`${file}: ${d.error}`); return { file, data: d.data, body: d.body, change: change ?? null, folder, milestone: null }; };
const datedDirs = dir => fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory() && DATED.test(e.name)).map(e => e.name).sort().map(n => path.join(dir, n)) : [];
export const isMilestone = s => s.data.kind === 'milestone';

// The folders that hold changes: the backlog and the changes/ folder of each milestone ({ dir, milestone }).
function changeHomes(repo) {
  const ms = datedDirs(path.join(repo, MILESTONES)).filter(d => fs.existsSync(path.join(d, 'milestone.md')))
    .map(d => ({ dir: path.join(d, 'changes'), milestone: parseDocument(fs.readFileSync(path.join(d, 'milestone.md'), 'utf8')).data?.id ?? null }));
  return [{ dir: path.join(repo, BACKLOG), milestone: null }, ...ms];
}
// Every change folder, wherever it lives (for the readers that look into the folders, such as the digest's checkpoint evidence).
export const changeDirs = repo => changeHomes(repo).flatMap(h => datedDirs(h.dir));

// Every milestone, change and slice record: { file, data, body, change, folder, milestone } (`change`: the change a slice belongs to, null
// for a change or a milestone; `milestone`: the milestone a change or its slice belongs to, null in the backlog).
function records(repo) {
  const out = [];
  for (const dir of datedDirs(path.join(repo, MILESTONES))) {
    if (!fs.existsSync(path.join(dir, 'milestone.md'))) continue;
    const m = parse(path.join(dir, 'milestone.md'), null, true); if (m.data.schema !== 'buddy/slice@1') continue; m.change = null; out.push(m);
  }
  for (const home of changeHomes(repo)) for (const dir of datedDirs(home.dir)) {
    if (!fs.existsSync(path.join(dir, 'change.md'))) continue;
    const change = parse(path.join(dir, 'change.md'), null, true); if (change.data.schema !== 'buddy/slice@1') continue; change.change = null; change.milestone = home.milestone; out.push(change);
    // a slice is a file Buddy wrote, `schema: buddy/slice@1` in its front matter; other markdown left there (notes, a report) is not read (RQ2)
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.md') && f !== 'change.md' && SLICE_ID.test(f.slice(0, -3))).sort()) {
      const head = fs.readFileSync(path.join(dir, f), 'utf8').split(/\r?\n---[ \t]*(?:\r?\n|$)/)[0];
      if (!/^---\r?\n/.test(head) || !/^schema:[ \t]*['"]?buddy\/slice@1['"]?[ \t]*$/m.test(head)) continue;
      const s = parse(path.join(dir, f), change.data.id, true); if (s.data.schema === 'buddy/slice@1') { s.milestone = home.milestone; out.push(s); }
    }
  }
  return out;
}
// An id is a milestone, change or slice name; names are unique across the repository (R87, R118).
export function readSlice(repo, id) {
  const s = records(repo).find(x => x.data.id === id);
  if (!s) throw new Error(`no slice or change ${id} under ${RECORDS}, nor a milestone of that name`);
  return s;
}
const byRank = (a, b) => a.data.rank - b.data.rank || a.data.id.localeCompare(b.data.id);
// The changes and slices (milestones apart: they are listed by listMilestones), in rank order.
export const listSlices = repo => records(repo).filter(x => !isMilestone(x)).sort(byRank);
export const listMilestones = repo => records(repo).filter(isMilestone).sort(byRank);
export const changesOf = (repo, milestone) => records(repo).filter(x => !isMilestone(x) && !x.change && x.milestone === milestone);
// The folder of the change a record belongs to (where its batches and evidence go).
export const changeDirOf = (repo, id) => path.dirname(readSlice(repo, id).file);
export const partsOf = (repo, id) => records(repo).filter(x => x.change === id);

// Writes every `{ file, text, was? }` (`was`: the file it replaces, which is removed), verifies the repository's docs, and restores every file
// it touched if a write fails or a written file has problems (with `all`, a problem anywhere under docs/buddy too): nothing is left half-done.
export function commitAll(repo, writes, { all = false } = {}) {
  const before = new Map(); for (const w of writes) for (const f of [w.file, w.was].filter(Boolean)) if (!before.has(f)) before.set(f, fs.existsSync(f) ? fs.readFileSync(f) : null);
  const made = [];
  try {
    for (const w of writes) {
      if (w.was && w.was !== w.file) fs.rmSync(w.was);
      for (let d = path.dirname(w.file); !fs.existsSync(d); d = path.dirname(d)) made.unshift(d);
      fs.mkdirSync(path.dirname(w.file), { recursive: true }); fs.writeFileSync(w.file, w.text);
    }
    const written = new Set(writes.map(w => path.resolve(w.file))); const buddy = path.resolve(repo, 'docs', 'buddy') + path.sep;
    const problems = verify([path.join(repo, 'docs')]).problems.filter(p => written.has(path.resolve(p.file)) || (all && path.resolve(p.file).startsWith(buddy)));
    if (problems.length) { const e = new Error(problems.map(p => `${writes.length > 1 ? `${path.relative(repo, p.file)} ` : ''}${p.where}: ${p.message}`).join('; ')); e.problems = problems; throw e; }
  } catch (e) {
    for (const [f, text] of before) if (text === null) fs.rmSync(f, { force: true }); else { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); }
    for (const d of made.reverse()) if (fs.existsSync(d) && !fs.readdirSync(d).length) fs.rmdirSync(d);
    throw e;
  }
  const buddy = path.resolve(repo, 'docs', 'buddy') + path.sep;      // a folder emptied by a move goes too
  for (const w of writes) if (w.was && w.was !== w.file) for (let d = path.resolve(path.dirname(w.was)); d.startsWith(buddy) && fs.existsSync(d) && !fs.readdirSync(d).length; d = path.dirname(d)) fs.rmdirSync(d);
  refreshBoardPage(repo);   // every record is written here, whichever script ran: an existing .buddy/board.html follows it (live-board)
}
// A record named by its title with its id beside it (R78), or the id alone when no record has it.
const snOf = (repo, id) => { const s = records(repo).find(x => x.data.id === id); return s ? sn(s) : id; };
const commit = (repo, file, text) => commitAll(repo, [{ file, text }]);

// A name the Product Owner gives (--name) must follow the rule and be free; a proposed one takes the first free `-2`, `-3`... (R86).
// `taken`: the records whose names are taken, so a refusal names the one that has it by its title (R78).
const takenNames = records => new Map(records.map(s => [s.data.id, s]));
const kindOf = s => (isMilestone(s) ? 'the milestone' : s.change ? 'the slice' : 'the change');
function freeName(name, taken, given) {
  if (given) {
    if (!SLICE_NAME.test(name || '')) throw new Error(`"${name}" is not a slice name: ${NAME_RULE}`);
    if (taken.has(name)) throw new Error(`the name ${name} is taken by ${kindOf(taken.get(name))} ${sn(taken.get(name))}; choose another with --name`);
    return name;
  }
  for (let i = 1; ; i++) {                                         // the suffix stays within the 40 characters: the name gives way to it
    const n = i === 1 ? name : `${name.slice(0, 40 - `-${i}`.length).replace(/-+$/, '')}-${i}`; if (!taken.has(n)) return n;
  }
}

// A milestone that takes changes: one that exists and is not closed (an accepted or abandoned milestone is finished).
function openMilestone(repo, name, doing) {
  const m = readSlice(repo, name);
  if (!isMilestone(m)) throw new Error(`${sn(m)} is not a milestone${m.change ? ` (it is a slice of ${snOf(repo, m.change)})` : ' (it is a change)'}`);
  if (['accepted', 'abandoned'].includes(m.data.status)) throw new Error(`the milestone ${sn(m)} is ${m.data.status}: ${doing} only into a milestone that is still open`);
  return m;
}

// Opens a change (its folder and change.md) in the backlog, or in a milestone with `milestone`, or with `inChange` adds a slice to an
// existing change (R87, R118).
export function startSlice({ repo = process.cwd(), title, request, name, kind = 'feat', criteria = [], excludes = [], inChange, milestone, dependsOn = [], branch, now = () => new Date() } = {}) {
  if (!title) throw new Error('a slice needs a title'); if (!request) throw new Error('a slice needs the request in the Product Owner\'s words');
  if (kind === 'milestone') throw new Error('a milestone is opened with buddy milestone start');
  if (inChange && milestone) throw new Error('a slice goes into the folder of its change, wherever the change is: give --in or --milestone, not both');
  const all = records(repo); const existing = all.filter(x => !isMilestone(x));
  const taken = takenNames(all);
  const proposal = name === undefined ? nameFromTitle(title) : null;
  const id = freeName(name ?? proposal.name, taken, name !== undefined);
  const parent = inChange ? readSlice(repo, inChange) : null;
  if (parent && isMilestone(parent)) throw new Error(`${sn(parent)} is a milestone: open a change in it with --milestone ${inChange}`);
  if (parent && parent.change) throw new Error(`${sn(parent)} is not a change in its own folder (it is a slice of ${snOf(repo, parent.change)})`);
  if (parent && stepsOf(parent).length) throw new Error(`${sn(parent)} already has steps of its own; a change in slices keeps its steps in its slices`);
  const home = milestone ? path.join(path.dirname(openMilestone(repo, milestone, 'a change is opened').file), 'changes') : path.join(repo, BACKLOG);
  const data = {
    schema: 'buddy/slice@1', id, title, kind, status: 'refining', rank: (existing.length ? Math.max(...existing.map(s => s.data.rank)) : 0) + 1000,   // milestones rank apart
    ...(dependsOn.length ? { depends_on: dependsOn } : {}), ...(branch ? { branch } : {}),
    created: stamp(now), updated: stamp(now), request,
    ...(criteria.length ? { criteria: criteria.map((text, i) => ({ id: `AC${i + 1}`, text })) } : {}),
    ...(excludes.length ? { excludes: excludes.map((text, i) => ({ id: `X${i + 1}`, text })) } : {}),
    ...((parent?.data.screens || []).length ? { screens: [...parent.data.screens] } : {}),   // a piece starts with its change's screens; it drops those it does not build (R156)
  };
  const errs = validate(schema, data); if (errs.length) throw new Error(errs.map(e => `${e.path}: ${e.message}`).join('; '));
  const file = parent ? path.join(path.dirname(parent.file), `${id}.md`) : path.join(home, `${data.created.slice(0, 10)}-${id}`, 'change.md');
  if (fs.existsSync(file) || (!parent && fs.existsSync(path.dirname(file)))) throw new Error(`${path.relative(repo, parent ? file : path.dirname(file))} already exists`);
  const writes = [{ file, text: canonicalText(data, `# ${title}\n\n## Steps\n\n${parent ? NO_STEPS.slice : NO_STEPS.change}\n`) }];
  if (parent && parent.body.includes(NO_STEPS.change)) writes.push({ file: parent.file, text: canonicalText(parent.data, parent.body.replace(NO_STEPS.change, NO_STEPS.split)) });
  commitAll(repo, writes);
  return { id, file, data, change: parent ? parent.data.id : null, milestone: parent ? parent.milestone : milestone ?? null, proposed: !!proposal, shortened: !!proposal?.shortened, vague: vagueWarnings(data.criteria) };
}

// Opens a milestone (R108, R118): docs/buddy/milestones/<date>-<name>/milestone.md, a record of kind milestone with the goal (the request),
// its criteria and what it does not include; its changes go in changes/ of the same folder. It follows the states and the ready rule of a
// change; it has no steps (its work is its changes), and it is accepted only when every change of it is accepted or abandoned.
export function startMilestone({ repo = process.cwd(), title, request, name, criteria = [], excludes = [], branch, now = () => new Date() } = {}) {
  if (!title) throw new Error('a milestone needs a title'); if (!request) throw new Error('a milestone needs its goal in the Product Owner\'s words (--request)');
  const all = records(repo); const ms = all.filter(isMilestone);
  const proposal = name === undefined ? nameFromTitle(title) : null;
  const id = freeName(name ?? proposal.name, takenNames(all), name !== undefined);
  const data = {
    schema: 'buddy/slice@1', id, title, kind: 'milestone', status: 'refining', rank: (ms.length ? Math.max(...ms.map(s => s.data.rank)) : 0) + 1000,
    ...(branch ? { branch } : {}), created: stamp(now), updated: stamp(now), request,
    ...(criteria.length ? { criteria: criteria.map((text, i) => ({ id: `AC${i + 1}`, text })) } : {}),
    ...(excludes.length ? { excludes: excludes.map((text, i) => ({ id: `X${i + 1}`, text })) } : {}),
  };
  const errs = validate(schema, data); if (errs.length) throw new Error(errs.map(e => `${e.path}: ${e.message}`).join('; '));
  const dir = path.join(repo, MILESTONES, `${data.created.slice(0, 10)}-${id}`); const file = path.join(dir, 'milestone.md');
  if (fs.existsSync(dir)) throw new Error(`${path.relative(repo, dir)} already exists`);
  commitAll(repo, [{ file, text: canonicalText(data, `# ${title}\n\n${MILESTONE_BODY}\n`) }]);
  return { id, file, data, proposed: !!proposal, shortened: !!proposal?.shortened, vague: vagueWarnings(data.criteria) };
}
// The owner rewords a milestone's goal (R250), in any state: it changes the words he reads, not what the milestone promises. The earlier wording stays in `request_history` with the moment it stopped being the goal.
export function rewordMilestoneGoal(repo, id, text, { by, now = () => new Date() } = {}) {
  if (by !== 'owner') throw new Error('only the Product Owner rewords a milestone\'s goal (--by owner)');
  const goal = String(text ?? '').trim(); if (!goal) throw new Error('the new goal is empty: give it in the Product Owner\'s words');
  const s = readSlice(repo, id); if (!isMilestone(s)) throw new Error(`${sn(s)} is not a milestone: a change's request is fixed once it is ready`);
  if (s.data.request === goal) throw new Error(`the goal of ${sn(s)} already says that`);
  const r = rewrite(repo, id, ({ data, body }) => { data.request_history = [...(data.request_history || []), { text: data.request, until: stamp(now) }]; data.request = goal; return { data, body }; }, now);
  return { ...r, request: goal };
}
export const MILESTONE_BODY = 'Its changes are in the folder changes/ next to this file.';

// Moves a change, with everything in its folder, into a milestone or to the backlog (R118). The folder keeps its date and its name, and
// references go by the name, so nothing else changes. Refused for a slice (it moves with its change), a milestone, and into a milestone that is accepted or abandoned.
export function moveChangeTo(repo, id, where) {
  const s = readSlice(repo, id);
  if (isMilestone(s)) throw new Error(`${sn(s)} is a milestone: only changes move between milestones and the backlog`);
  if (s.change) throw new Error(`${sn(s)} is a slice of ${snOf(repo, s.change)}: a slice moves with its change (buddy move-to ${s.change} ${where})`);
  if (!where) throw new Error('say where: the name of a milestone, or backlog');
  const target = where === 'backlog' ? null : openMilestone(repo, where, 'a change is moved').data.id;
  const dir = path.dirname(s.file);
  const home = target ? path.join(path.dirname(readSlice(repo, target).file), 'changes') : path.join(repo, BACKLOG);
  const nd = path.join(home, path.basename(dir));
  if (path.resolve(nd) === path.resolve(dir)) throw new Error(`${sn(s)} is already ${target ? `in the milestone ${snOf(repo, target)}` : 'in the backlog'}`);
  if (fs.existsSync(nd)) throw new Error(`${path.relative(repo, nd)} already exists`);
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  const writes = walk(dir).map(f => ({ was: f, file: path.join(nd, path.relative(dir, f)), text: fs.readFileSync(f) }));
  commitAll(repo, writes, { all: true });
  return { id, from: s.milestone, to: target, dir: nd, files: writes.length };
}

// Places a change before or after another in the same container (a milestone's changes or the backlog), picking an integer rank between
// the target's neighbours and re-spacing the container in steps of 1000 when adjacent ranks leave no integer gap.
export function rankChange(repo, id, where, otherId, { now = () => new Date() } = {}) {
  if (where !== 'before' && where !== 'after') throw new Error(`say before or after (got "${where ?? ''}")`);
  const a = readSlice(repo, id); const b = readSlice(repo, otherId);
  if (id === otherId) throw new Error(`${sn(a)} cannot be placed ${where} itself`);
  for (const x of [a, b]) {
    if (isMilestone(x)) throw new Error(`${sn(x)} is a milestone: only changes are ordered with slice rank`);
    if (x.change) throw new Error(`${sn(x)} is a slice of ${snOf(repo, x.change)}: only changes are ordered with slice rank`);
  }
  if (a.milestone !== b.milestone) {
    const loc = x => x.milestone ? `the milestone ${snOf(repo, x.milestone)}` : 'the backlog';
    throw new Error(`${sn(a)} is in ${loc(a)} and ${sn(b)} is in ${loc(b)}: move it with buddy move-to ${id} ${b.milestone || 'backlog'} first`);
  }
  const rest = changesOf(repo, a.milestone).sort(byRank).filter(x => x.data.id !== id);
  const pos = rest.findIndex(x => x.data.id === otherId) + (where === 'after' ? 1 : 0);
  const lo = pos > 0 ? rest[pos - 1].data.rank : null;
  const hi = pos < rest.length ? rest[pos].data.rank : null;
  const rank = lo === null ? (hi > 1 ? Math.floor(hi / 2) : null) : hi === null ? lo + 1000 : hi - lo > 1 ? Math.floor((lo + hi) / 2) : null;
  const ts = stamp(now);
  if (rank !== null) {
    commit(repo, a.file, canonicalText({ ...a.data, rank, updated: ts }, a.body));
    return { id, where, other: otherId, rank, milestone: a.milestone, respaced: false };
  }
  const ordered = [...rest.slice(0, pos), a, ...rest.slice(pos)];
  const writes = ordered.map((x, i) => ({ x, rank: (i + 1) * 1000 })).filter(({ x, rank: r }) => x.data.rank !== r)
    .map(({ x, rank: r }) => ({ file: x.file, text: canonicalText({ ...x.data, rank: r, updated: ts }, x.body) }));
  commitAll(repo, writes);
  return { id, where, other: otherId, rank: (pos + 1) * 1000, milestone: a.milestone, respaced: true };
}

// Renames a change or a slice, and every record that names it follows (R86, R87): a change's folder keeps its date and takes the new name,
// a slice's file takes it; `depends_on` of the other records, `slice:` of question batches, decisions
// and findings, a decision's `requested_by`, the `to` of the items of the map of what was asked, and a batch file named after the old id. Only while refining: from ready on commits cite the
// name.
export function renameSlice(repo, from, to, { now = () => new Date() } = {}) {
  const s = readSlice(repo, from); const all = records(repo);
  if (s.data.status !== 'refining') throw new Error(`${sn(s)} is ${s.data.status}: a change or slice is renamed only while it is refining, because from ready on commits cite its name`);
  if (to === from) throw new Error(`${sn(s)} already has that name`);
  freeName(to, takenNames(all.filter(x => x.data.id !== from)), true);
  const plan = new Map(); const put = (was, file, text) => plan.set(was, { was, file, text });
  const target = f => plan.get(f)?.file ?? f; const current = f => plan.has(f) ? plan.get(f).text : fs.readFileSync(f);
  if (!s.change) {                                                // a change: its whole folder moves, evidence included
    const dir = path.dirname(s.file); const nd = path.join(path.dirname(dir), `${path.basename(dir).slice(0, 11)}${to}`);
    const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
    if (fs.existsSync(nd)) throw new Error(`${path.relative(repo, nd)} already exists`);
    for (const f of walk(dir)) put(f, path.join(nd, path.relative(dir, f)), fs.readFileSync(f));
  }
  put(s.file, !s.change ? target(s.file) : path.join(path.dirname(s.file), `${to}.md`), canonicalText({ ...s.data, id: to, updated: stamp(now) }, s.body));
  for (const x of all) if (x.data.id !== from && (x.data.depends_on || []).includes(from)) {
    put(x.file, target(x.file), canonicalText({ ...x.data, depends_on: x.data.depends_on.map(d => d === from ? to : d) }, x.body));
  }
  const field = new RegExp(`^((?:slice|requested_by):[ \\t]+)"?${from}"?[ \\t]*$`, 'gm');   // a name is letters, digits and hyphens: nothing to escape
  const toField = new RegExp(`^([ \\t]+(?:- )?to:[ \\t]+)"?${from}"?[ \\t]*$`, 'gm');   // the map of what was asked: an item covered or excluded by it
  for (const f of loadFiles([path.join(repo, 'docs')])) {
    const text = String(current(f)).replace(/\r\n/g, '\n'); const d = parseDocument(text);
    if (d.data?.schema === 'buddy/requests@1' && (d.data.items || []).some(x => x.to === from)) {
      const end = text.indexOf('\n---', 3) + 1; put(f, target(f), text.slice(0, end).replace(toField, `$1${to}`) + text.slice(end).replace(new RegExp(`(: (?:covered|excluded) by )${from}$`, 'gm'), `$1${to}`)); continue;   // its generated view follows
    }
    if (!['buddy/question-batch@0', 'buddy/decision@0', 'buddy/finding@0'].includes(d.data?.schema) || (d.data.slice !== from && d.data.requested_by !== from)) continue;
    const end = text.indexOf('\n---', 3) + 1; const t = target(f); const base = path.basename(t);     // only the front matter changes: the body is free text
    put(f, base.startsWith(`${from}-`) ? path.join(path.dirname(t), to + base.slice(from.length)) : t, text.slice(0, end).replace(field, `$1${to}`) + text.slice(end));
  }
  const writes = [...plan.values()]; commitAll(repo, writes, { all: true });
  return { from, to, file: plan.get(s.file).file, status: s.data.status, changed: writes.filter(w => w.was !== s.file).map(w => path.relative(repo, w.file)) };
}

function rewrite(repo, id, edit, now) {
  const s = readSlice(repo, id); const { data, body } = edit({ data: { ...s.data }, body: s.body });
  data.updated = stamp(now); commit(repo, s.file, canonicalText(data, body));
  return { id, file: s.file, data, body };
}

// Acceptance criteria (AC1, AC2...) and exclusions (X1, X2...: what the change does not include, R109) are written and corrected
// only while the record is refining: from ready on the goal is fixed (R67), and changing it is the owner's decision, made by
// sending the change back to refining. Removing one does not renumber the others (a step that cites AC3 keeps meaning AC3); a
// new one takes the highest id present plus one, and a criterion a step cites cannot be removed.
export const GOAL_FIELDS = {
  criteria: { prefix: 'AC', one: 'criterion', words: 'acceptance criteria' },
  excludes: { prefix: 'X', one: 'exclusion', words: 'what it does not include' },
};
function goalEdit(repo, id, field, change, now) {
  const g = GOAL_FIELDS[field]; if (!g) throw new Error(`unknown list ${field}: criteria or excludes`);
  const s = readSlice(repo, id);
  if (s.data.status !== 'refining') throw new Error(`${sn(s)} is ${s.data.status}: ${g.words} can be changed only while it is refining. The goal is fixed when a change is ready; changing it is the owner's decision and goes back through refining${s.data.status === 'ready' ? ` (buddy move ${id} refining)` : ''}`);
  let result;
  const r = rewrite(repo, id, ({ data, body }) => { const list = (data[field] || []).map(x => ({ ...x })); result = change(list, g, body); if (list.length) data[field] = list; else delete data[field]; return { data, body }; }, now);
  // a vague criterion added or corrected is a warning, never a refusal (R94)
  return { ...r, ...result, vague: field === 'criteria' ? vagueWarnings((r.data.criteria || []).filter(c => c.id === result.ref)) : [] };
}
const oneLine = text => { if (!text || !String(text).trim() || /\n/.test(text)) throw new Error('the text is one line, not empty'); return String(text).trim(); };
const findGoal = (list, g, ref) => { const i = list.findIndex(x => x.id === ref); if (i < 0) throw new Error(`no ${g.one} ${ref}; ${list.length ? `there are: ${list.map(x => `${x.id} (${x.text})`).join(', ')}` : `there is none yet`}`); return i; };
export const goalAdd = (repo, id, field, text, { now = () => new Date() } = {}) => goalEdit(repo, id, field, (list, g) => {
  const t = oneLine(text); const n = Math.max(0, ...list.map(x => Number(x.id.slice(g.prefix.length)))) + 1; const ref = `${g.prefix}${n}`; list.push({ id: ref, text: t }); return { ref };
}, now);
export const goalSet = (repo, id, field, ref, text, { now = () => new Date() } = {}) => goalEdit(repo, id, field, (list, g) => { const t = oneLine(text); list[findGoal(list, g, ref)].text = t; return { ref }; }, now);
export const goalRemove = (repo, id, field, ref, { now = () => new Date() } = {}) => goalEdit(repo, id, field, (list, g, body) => {
  const i = findGoal(list, g, ref);
  const cited = field === 'criteria' ? parseSteps(body).steps.filter(x => new RegExp(`\\b${ref}\\b`).test(x.text)).map(x => x.num) : [];
  if (cited.length) throw new Error(`${ref} (${list[i].text}) is cited by step ${cited.join(', ')}; change that step first`);
  list.splice(i, 1); return { ref };
}, now);

// What Buddy will assume, announced to the owner with the questions, before building (R136): at most five, the costliest to correct later
// first, each with what changes for the owner if it is otherwise. Added while refining or ready; the owner confirms each (or all) or corrects
// one, and Buddy then writes the correction as a criterion or an exclusion with the existing commands. Confirmed ones reach Dev and the reviewer.
const BEFORE_BUILDING = ['refining', 'ready'];
export const assumeAdd = (repo, id, text, ifOtherwise, { now = () => new Date() } = {}) => {
  const s = readSlice(repo, id);
  if (!BEFORE_BUILDING.includes(s.data.status)) throw new Error(`${sn(s)} is ${s.data.status}: assumptions are announced before building (while refining or ready)`);
  if (!ifOtherwise) throw new Error('say what changes for the owner if it is otherwise (--if-otherwise "<text>")');
  const list = s.data.assumptions || [];
  if (list.length >= MAX_ASSUMPTIONS) throw new Error(`${sn(s)} already announces ${list.length} assumptions, the most there may be: keep the costliest ${MAX_ASSUMPTIONS}`);
  const entry = { id: `A${Math.max(0, ...list.map(a => Number(a.id.slice(1)))) + 1}`, text: oneLine(text), if_otherwise: oneLine(ifOtherwise), status: 'proposed' };
  const r = rewrite(repo, id, ({ data, body }) => { data.assumptions = [...list.map(a => ({ ...a })), entry]; return { data, body }; }, now);
  return { ...r, ref: entry.id, entry };
};
// A change studied and found to need no assumption keeps an empty list (`assumptions: []`); one with no list was not studied yet, and the
// milestone card tells them apart. Announcing an assumption later fills the list, so the mark goes with it.
export const assumeNone = (repo, id, { now = () => new Date() } = {}) => {
  const s = readSlice(repo, id); const list = s.data.assumptions || [];
  if (!BEFORE_BUILDING.includes(s.data.status)) throw new Error(`${sn(s)} is ${s.data.status}: assumptions are studied before building (while refining or ready)`);
  if (list.length) throw new Error(`${sn(s)} already has assumptions, so it cannot be marked as needing none: ${list.map(a => `${a.id} (${a.text})`).join(', ')}`);
  return rewrite(repo, id, ({ data, body }) => { data.assumptions = []; return { data, body }; }, now);
};
// A correction carries its text in the same command (R139): `criterion` or `exclude`, exactly one, added with goalAdd (so under the same
// rules: only while refining, the vague-words warning) and referenced from the assumption (`correction: AC3` or `X2`).
// Confirming or correcting is the owner's answer, with `by: 'owner'` (RQ1), as lowering a costly decision is (R139).
export const assumeSet = (repo, id, ref, status, { criterion, exclude, by, now = () => new Date() } = {}) => {
  const s = readSlice(repo, id);
  if (['accepted', 'abandoned'].includes(s.data.status)) throw new Error(`${sn(s)} is ${s.data.status}: its assumptions are closed`);
  if (!['confirmed', 'corrected'].includes(status)) throw new Error('an assumption is confirmed or corrected');
  if (by != null && by !== 'owner') throw new Error(`--by takes only owner (got ${by})`);
  if (by !== 'owner') throw new Error('only the owner confirms or corrects an assumption: Buddy announces them, never answers them (add --by owner when the owner said so)');
  const list = (s.data.assumptions || []).map(a => ({ ...a }));
  const pick = ref === 'all' ? list.filter(a => a.status === 'proposed') : list.filter(a => a.id === ref);
  if (ref === 'all' && status !== 'confirmed') throw new Error('correct one assumption at a time: correct A<n>');
  if (!pick.length) throw new Error(ref === 'all' ? 'no assumption is waiting for confirmation' : `no assumption ${ref}; there ${list.length ? `are: ${list.map(a => `${a.id} (${a.text})`).join(', ')}` : 'is none'}`);
  let added = null;
  if (status === 'corrected') {
    if ((criterion == null) === (exclude == null)) throw new Error(`say the correction of ${ref} in the same command, as a criterion or as an exclusion (exactly one): --criterion "<text>" or --exclude "<text>"`);
    const field = criterion != null ? 'criteria' : 'excludes'; added = { field, ...goalAdd(repo, id, field, criterion ?? exclude, { now }) };
  }
  for (const a of pick) { a.status = status; if (added) a.correction = added.ref; }
  const r = rewrite(repo, id, ({ data, body }) => { data.assumptions = list; return { data, body }; }, now);
  return { ...r, changed: pick.map(a => a.id), status, ...(added ? { correction: added.ref, field: added.field, vague: added.vague } : {}) };
};

// Buddy's correction of the reviewer's mark on one decision nobody specified (R136): `n` is its number in the latest evidence of the slice;
// it is kept in the record of the slice (`reclassified`, R140), naming the evidence whose review holds the decision; the evidence stays
// what the checkpoint wrote, and the exceptions and the accept card read the record with it (withReclassified).
// Buddy may only raise one to costly; lowering one to cheap is the owner's (R139), with `by: 'owner'`; the record keeps who did it.
export function reclassifyDecision(repo, id, n, verdict, { by, now = () => new Date() } = {}) {
  const s = readSlice(repo, id);
  if (!['costly', 'cheap'].includes(verdict)) throw new Error('a decision nobody specified is costly or cheap');
  if (by != null && by !== 'owner') throw new Error(`--by takes only owner (got ${by})`);
  if (verdict === 'cheap' && by !== 'owner') throw new Error('only the owner lowers a decision to cheap: Buddy may raise one to costly, never lower it (add --by owner when the owner decided it)');
  const dir = path.join(path.dirname(s.file), 'evidence'); const latest = latestEvidenceFile(dir, id);
  if (!latest) throw new Error(`${sn(s)} has no checkpoint evidence yet: the decisions nobody specified come from its checkpoint`);
  const list = unspecifiedOf(withReclassified(latest.e, latest.file, s.data.reclassified));
  const item = list.find(x => String(x.n) === String(n));
  if (!item) throw new Error(`no decision ${n} in the latest checkpoint of ${sn(s)}; ${list.length ? `there are: ${list.map(x => `${x.n} (${x.text})`).join(', ')}` : 'it lists none'}`);
  const entry = { evidence: reviewFileOf(latest.file, latest.e), n: item.n, costly: verdict === 'costly', by: by || 'buddy', at: stamp(now) };
  const r = rewrite(repo, id, ({ data, body }) => { data.reclassified = [...(data.reclassified || []), entry]; return { data, body }; }, now);
  return { id, n: item.n, text: item.text, costly: entry.costly, by: entry.by, evidence: entry.evidence, file: r.file };
}

// The prototype's screens a change covers (R107, R126): names from the manifest; written only while refining, fixed when the change is ready
// like the criteria; at ready every one must be confirmed by the owner. Dev and the reviewer receive them by file (R119).
function screensEdit(repo, id, names, change, now) {
  const s = readSlice(repo, id);
  if (s.data.status !== 'refining') throw new Error(`${sn(s)} is ${s.data.status}: the screens it covers can be changed only while it is refining (the goal is fixed when a change is ready)`);
  if (!names.length) throw new Error('name at least one screen (buddy prototype screens lists them)');
  return rewrite(repo, id, ({ data, body }) => { const list = change([...(data.screens || [])], s); if (list.length) data.screens = list; else delete data.screens; return { data, body }; }, now);
}
const knownScreens = repo => { const f = path.join(repo, MANIFEST); return fs.existsSync(f) ? readManifest(f).screens : null; };
export const screensAdd = (repo, id, names, { now = () => new Date() } = {}) => {
  const known = knownScreens(repo); if (!known) throw new Error(`there is no prototype manifest yet (${MANIFEST}): run buddy prototype draft and confirm it first`);
  const bad = names.filter(n => !known.some(k => k.name === n)); if (bad.length) throw new Error(`not a screen of the prototype: ${bad.join(', ')}; the screens are: ${known.map(k => k.name).join(', ') || '(none)'}`);
  return screensEdit(repo, id, names, list => [...list, ...names.filter(n => !list.includes(n))], now);
};
export const screensRemove = (repo, id, names, { now = () => new Date() } = {}) => screensEdit(repo, id, names, (list, s) => {
  const bad = names.filter(n => !list.includes(n)); if (bad.length) throw new Error(`${sn(s)} does not cover: ${bad.join(', ')}; it covers: ${list.join(', ') || '(none)'}`);
  return list.filter(n => !names.includes(n));
}, now);

// Departures from the prototype (R127). Dev declares each one while building (a command, so none is silent); it may withdraw one it undoes;
// the owner accepts or rejects each on the accept card (buddy slice divergence decide, step 6).
const BUILDING = ['building', 'rework'];
function divergenceEdit(repo, id, change, now) {
  const s = readSlice(repo, id);
  if (!BUILDING.includes(s.data.status)) throw new Error(`${sn(s)} is ${s.data.status}: departures from the prototype are declared while the slice is being built (building or rework)`);
  let result; const r = rewrite(repo, id, ({ data, body }) => { const list = (data.divergences || []).map(x => ({ ...x })); result = change(list, data); if (list.length) data.divergences = list; else delete data.divergences; return { data, body }; }, now);
  return { ...r, ...result };
}
export const divergenceAdd = (repo, id, { screen, prototype, built, why, kind = 'divergence' } = {}, { now = () => new Date() } = {}) => divergenceEdit(repo, id, (list, data) => {
  if (!(data.screens || []).length) throw new Error(`${sn({ data })} covers no prototype screen, so there is nothing to depart from (buddy slice screens add, while refining)`);
  if (!data.screens.includes(screen)) throw new Error(`${screen || '(no screen)'} is not a screen this change covers; it covers: ${data.screens.join(', ')}`);
  if (!['improvement', 'divergence'].includes(kind)) throw new Error('kind is improvement (a better way to the same flow) or divergence (it changes a flow, removes a function or contradicts a fixed text)');
  const entry = { id: `V${Math.max(0, ...list.map(x => Number(x.id.slice(1)))) + 1}`, screen, kind, prototype: oneLine(prototype), built: oneLine(built), why: oneLine(why), status: 'declared' };
  list.push(entry); return { ref: entry.id, entry };
}, now);
// The Product Owner's verdict on a declared departure, on the accept card (R127): `accept` keeps the departure on the record, `reject` says
// Dev must undo it (it stays rejected until Dev withdraws it). Only the owner, only once the slice is delivered; `ref` may be `all`, which
// applies the verdict to every departure still undecided.
export function divergenceDecide(repo, id, ref, verdict, { by, channel = 'cli', now = () => new Date() } = {}) {
  if (by !== 'owner') throw new Error('only the Product Owner decides on a departure from the prototype (--by owner)');
  if (!['accept', 'reject'].includes(verdict)) throw new Error('the verdict is accept or reject');
  if (!['chat', 'cli', 'view'].includes(channel)) throw new Error('channel must be chat, cli or view');
  const s = readSlice(repo, id);
  if (s.data.status !== 'delivered') throw new Error(`${sn(s)} is ${s.data.status}: departures are decided at acceptance, once the slice is delivered`);
  const at = now().toISOString().slice(0, 19) + 'Z'; const status = verdict === 'accept' ? 'accepted' : 'rejected'; let decided = [];
  const r = rewrite(repo, id, ({ data, body }) => {
    const list = (data.divergences || []).map(x => ({ ...x }));
    const pick = ref === 'all' ? list.filter(x => x.status === 'declared') : list.filter(x => x.id === ref);
    if (!pick.length) throw new Error(ref === 'all' ? 'no departure is waiting for a decision' : `no departure ${ref}; there ${list.length ? `are: ${list.map(x => x.id).join(', ')}` : 'is none'}`);
    for (const v of pick) { v.status = status; v.decided = { by: 'owner', at, channel }; decided.push(v.id); }
    data.divergences = list; return { data, body };
  }, now);
  return { ...r, decided, status };
}
// How to try each acceptance criterion (the milestone review, R174): Dev writes it while it builds, in two parts, what to do and what to see. One per criterion; setting it again replaces it.
const oneSentence = (t, what) => { const v = String(t ?? '').trim(); if (!v) throw new Error(`${what} is missing`); if (/\n/.test(v)) throw new Error(`${what} is one paragraph, not several lines`); return v; };
export function howtoSet(repo, id, criterion, { steps, expect, now = () => new Date() } = {}) {
  const s = readSlice(repo, id);
  if (![...BUILDING, 'delivered'].includes(s.data.status)) throw new Error(`${sn(s)} is ${s.data.status}: how to try a criterion is written while the slice is being built or once it is delivered (building, rework or delivered)`);   // Buddy also writes it for a delivered change that has none, before the review
  const c = String(criterion ?? '').toUpperCase(); if (!(s.data.criteria || []).some(x => x.id === c)) throw new Error(`${criterion || '(no criterion)'} is not a criterion of ${sn(s)}; there ${(s.data.criteria || []).length ? `are: ${s.data.criteria.map(x => x.id).join(', ')}` : 'is none'}`);
  const st = oneSentence(steps, 'what to do (--steps)'), ex = oneSentence(expect, 'what to see (--expect)');
  const r = rewrite(repo, id, ({ data, body }) => { data.howto = [...(data.howto || []).filter(h => h.criterion !== c), { criterion: c, steps: st, expect: ex, at: stamp(now) }].sort((a, b) => Number(a.criterion.slice(2)) - Number(b.criterion.slice(2))); return { data, body }; }, now);
  return { ...r, criterion: c };
}
export function howtoRemove(repo, id, criterion, { now = () => new Date() } = {}) {
  const s = readSlice(repo, id); const c = String(criterion ?? '').toUpperCase();
  if (!(s.data.howto || []).some(h => h.criterion === c)) throw new Error(`${criterion || '(no criterion)'} has no way to try it written${(s.data.howto || []).length ? `; there is one for: ${s.data.howto.map(h => h.criterion).join(', ')}` : ''}`);
  const r = rewrite(repo, id, ({ data, body }) => { const list = data.howto.filter(h => h.criterion !== c); if (list.length) data.howto = list; else delete data.howto; return { data, body }; }, now);
  return { ...r, criterion: c };
}
// A screen the reviewer knew was there and could not verify is an exception. The owner may decide that nobody tries again: it is kept (with who and when), the
// check still reads "not run", never a pass, and the exception no longer stops the slice. Decided while the slice is being built or once delivered.
const slugScreen = t => String(t ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
export function unverifiedAccept(repo, id, screen, { by, channel = 'cli', note, now = () => new Date() } = {}) {
  if (by !== 'owner') throw new Error('only the Product Owner decides that nobody tries again to verify a screen (--by owner)');
  if (!['chat', 'cli', 'view'].includes(channel)) throw new Error('channel must be chat, cli or view');
  const s = readSlice(repo, id); const sc = slugScreen(screen);
  if (![...BUILDING, 'delivered'].includes(s.data.status)) throw new Error(`${sn(s)} is ${s.data.status}: a screen is left unverified while the slice is being built or once it is delivered`);
  if (!(s.data.screens || []).includes(sc)) throw new Error(`${sc || '(no name)'} is not a screen this change covers; ${(s.data.screens || []).length ? `they are: ${s.data.screens.join(', ')}` : 'it covers none'}`);
  const at = now().toISOString().slice(0, 19) + 'Z';
  const r = rewrite(repo, id, ({ data, body }) => { data.unverified = [...(data.unverified || []).filter(u => u.screen !== sc), { screen: sc, by: 'owner', at, channel, ...(note ? { note: String(note).trim() } : {}) }]; return { data, body }; }, now);
  return { ...r, screen: sc };
}
export function unverifiedUndo(repo, id, screen, { now = () => new Date() } = {}) {
  const sc = slugScreen(screen); const s = readSlice(repo, id);
  if (!(s.data.unverified || []).some(u => u.screen === sc)) throw new Error(`${sc || '(no name)'} is not among the screens left unverified${(s.data.unverified || []).length ? `: ${s.data.unverified.map(u => u.screen).join(', ')}` : ''}`);
  const r = rewrite(repo, id, ({ data, body }) => { const list = data.unverified.filter(u => u.screen !== sc); if (list.length) data.unverified = list; else delete data.unverified; return { data, body }; }, now);
  return { ...r, screen: sc };
}
export const divergenceRemove = (repo, id, ref, { now = () => new Date() } = {}) => divergenceEdit(repo, id, list => {
  const i = list.findIndex(x => x.id === ref); if (i < 0) throw new Error(`no departure ${ref}; there ${list.length ? `are: ${list.map(x => x.id).join(', ')}` : 'is none'}`);
  if (list[i].status === 'accepted') throw new Error(`${ref} was accepted by the Product Owner: it stays on the record`);
  list.splice(i, 1); return { ref };
}, now);

export const stepAddTo = (repo, id, text, { under, now = () => new Date() } = {}) => {
  const s = readSlice(repo, id); if (isMilestone(s)) throw new Error(`${sn(s)} is a milestone: its work is in its changes, which have the steps`);
  const parts = partsOf(repo, id); if (parts.length) throw new Error(`${sn(s)} is a change in slices: add the step to one of them (${parts.map(sn).join(', ')})`);
  let num; const r = rewrite(repo, id, ({ data, body }) => { const x = addStep(body, text, under); num = x.num; return { data, body: x.body }; }, now); return { ...r, num };
};
export const stepSetIn = (repo, id, num, done, { now = () => new Date() } = {}) => {
  const s = readSlice(repo, id); const st = s.data.status;
  if (!['building', 'rework'].includes(st)) throw new Error(`steps are ticked while the slice is being built (building or rework); ${sn(s)} is ${st}`);
  return rewrite(repo, id, ({ data, body }) => ({ data, body: setStep(body, num, done) }), now);
};
export const stepDropIn = (repo, id, num, why, { now = () => new Date() } = {}) => {
  const s = readSlice(repo, id); const st = s.data.status;
  if (!['building', 'rework'].includes(st)) throw new Error(`steps are dropped while the slice is being built (building or rework); ${sn(s)} is ${st}`);
  return rewrite(repo, id, ({ data, body }) => ({ data, body: dropStep(body, num, why) }), now);
};

// Moves a slice to another state. `by: 'owner'` is required to accept (the agent has no acceptance tool, Q47; the record is as strong as the repository, H4).
// The first move to building records `base`, the commit the slice started from, where the checkpoint measures its changes from; a return to
// building (after rework or blocked) keeps it, so the checkpoint of a reworked slice still sees all of the slice's work. No commit yet, no base.
export function moveSlice(repo, id, to, { by, channel = 'cli', now = () => new Date() } = {}) {
  if (!['chat', 'cli', 'view'].includes(channel)) throw new Error('channel must be chat, cli or view');
  const s = readSlice(repo, id); const from = s.data.status;
  if (!(to in NEXT)) throw new Error(`unknown state ${to}; states: ${Object.keys(NEXT).join(', ')}`);
  // A change in pieces (R70, R83) carries no work of its own: besides the legal moves, it may go to delivered straight from the state it waited
  // in while its pieces were built (refining, ready or rework), and only with its last piece; it is accepted as a whole, with its delivered pieces.
  const pieces = isMilestone(s) ? [] : partsOf(repo, id).sort(byRank); const DONE = ['delivered', 'accepted', 'abandoned'];
  const notDone = pieces.filter(x => !DONE.includes(x.data.status)); const named = xs => xs.slice(0, 4).map(x => `${x.data.title} [${x.data.id}, ${x.data.status}]`).join(' | ');
  if (pieces.length && to === 'delivered' && ['refining', 'ready', 'rework'].includes(from)) {
    if (notDone.length || !pieces.some(x => x.data.status === 'delivered')) throw new Error(`a change in pieces is delivered from ${from} with its last piece; ${notDone.length ? `${notDone.length} piece(s) are not delivered yet: ${named(notDone)}` : 'none of its pieces is delivered'}`);
  } else if (!NEXT[from].includes(to)) throw new Error(`a slice cannot go from ${from} to ${to}; from ${from} it can go to: ${NEXT[from].join(', ') || '(nowhere, it is final)'}`);
  if (to === 'accepted' && by !== 'owner') throw new Error('only the Product Owner accepts a slice (--by owner)');
  // A change of a milestone starts only once the owner gave that milestone the go-ahead, recorded by moving it to building (R147); a change
  // that was already started returns to building from blocked or rework whatever its milestone's state.
  if (to === 'building' && from === 'ready' && !isMilestone(s) && s.milestone) {
    const m = records(repo).find(x => isMilestone(x) && x.data.id === s.milestone);
    if (m && m.data.status !== 'building') throw new Error(`${sn(s)} belongs to the milestone ${sn(m)}, which is ${m.data.status}: a milestone starts only with the owner's go-ahead, recorded by moving it to building (buddy move ${m.data.id} building). Present it first: buddy milestone card ${m.data.id}`);
  }
  // Development goes on only while the owner confirmed every line of the records of the profile's steps and approved each as it is now
  // (run-profile-steps, R193): otherwise moving any change to building is refused, naming what waits for the owner.
  if (to === 'building' && !isMilestone(s)) {
    const wait = stepRecords(repo);
    if (wait.length) throw new Error(`development starts once the owner confirms and approves the records of the profile's steps: ${wait.map(stepWaitingText).join('; ')}`);
  }
  if (to === 'accepted' && isMilestone(s)) {
    const open = changesOf(repo, id).filter(x => !['accepted', 'abandoned'].includes(x.data.status));
    if (open.length) throw new Error(`${open.length} change(s) of the milestone are not accepted yet: ${open.slice(0, 4).map(x => `${x.data.title} [${x.data.id}, ${x.data.status}]`).join(' | ')}`);
    // a Must of the map of what was asked covered by it or one of its changes, whose change was abandoned, has lost its destination (R132)
    const rq = path.join(repo, 'docs', 'buddy', 'requests.md'); const mine = changesOf(repo, id).flatMap(x => [x, ...partsOf(repo, x.data.id)]);
    const gone = new Set(mine.filter(x => x.data.status === 'abandoned').map(x => x.data.id));
    const lost = fs.existsSync(rq) ? (parseDocument(fs.readFileSync(rq, 'utf8')).data?.items || []).filter(x => x.priority === 'must' && x.destination === 'covered' && gone.has(x.to)) : [];
    if (lost.length) throw new Error(`${lost.length} Must of what you asked for lost ${lost.length === 1 ? 'its' : 'their'} destination in this milestone: ${lost.map(x => `${x.text} [${x.id}], covered by ${sn(mine.find(c => c.data.id === x.to))}, abandoned`).join(' | ')}. Give each a destination (buddy requests set <RQ id>) or change its priority`);
    // Closing a milestone requires the whole test suite (`full` or `deep`) green on the current code (R200, R239).
    if (validateCommand(repo)) {
      const g = suiteGreen(repo, recordInputs(repo).evidence, { need: FULL_TESTS, now: now() });
      if (!g.ok) throw new Error(`${sn(s)}: the whole test suite has not passed on the code as it is now (${g.why}): run it once with buddy suite, then accept the milestone again. One run serves every acceptance for 2 days with the same tools`);
    }
  }
  if (to === 'accepted' && notDone.length) throw new Error(`${notDone.length} piece(s) of ${sn(s)} are not delivered yet: ${named(notDone)}. A change is accepted when every piece of it is delivered, accepted or abandoned`);
  const delivered = pieces.filter(x => x.data.status === 'delivered'); const whole = [s, ...delivered];   // what this acceptance covers
  if (to === 'accepted') {   // every departure from the prototype is decided, and none is rejected (R127); of the change and of its delivered pieces
    const dv = whole.flatMap(x => (x.data.divergences || []).map(v => ({ ...v, of: sn(x) }))); const und = dv.filter(v => v.status === 'declared'); const rej = dv.filter(v => v.status === 'rejected');
    const where = v => `${v.id} on ${v.screen}${pieces.length ? ` (${v.of})` : ''}`; const who = pieces.length ? '<piece>' : id;
    if (und.length) throw new Error(`${und.length} departure(s) from the prototype are not decided yet: ${und.map(where).join(', ')}. The accept card lists them: decide each with buddy slice divergence decide ${who} <V id> accept|reject --by owner`);
    if (rej.length) throw new Error(`${rej.length} departure(s) from the prototype were rejected: ${rej.map(where).join(', ')}. Send the ${pieces.length ? 'piece' : 'slice'} back to rework so Dev undoes them (buddy slice divergence remove), or accept them`);
  }
  if (to === 'accepted') {
    const left = [...new Map(whole.flatMap(x => assumptionsOf(repo, x.data)).map(a => [a.id, a])).values()];
    if (left.length) throw new Error(`${left.length} assumed default(s) the Product Owner has not confirmed: ${left.slice(0, 3).map(a => `${a.text} [${a.id}]`).join(' | ')}. Present them at acceptance: confirm with "buddy queue confirm <file> --all" (or --q <id>), or change one and send the slice to rework`);
    // The evidence is about the code as it was checked (R71): the files this acceptance covers (those its own work touched; for a change in
    // pieces, the union of its pieces') must be as its latest checkpoint saw them, read as of the piece's own last commit that touched each
    // (R144): another change's commits and uncommitted work on the same files never block it, the piece's own later commits do. Work
    // elsewhere in the repository, records and documents do not count. A file several pieces touched is compared with the latest evidence
    // that saw it. Evidence without that list never blocks.
    const cache = new Map(); const dir = path.join(path.dirname(s.file), 'evidence'); const seen = new Map();
    const evs = whole.map(x => ({ x, e: latestEvidence(dir, x.data.id, cache) })).filter(o => o.e?.own_files).sort((a, b) => String(a.e.when).localeCompare(String(b.e.when)));
    for (const o of evs) for (const [f, blob] of Object.entries(o.e.own_files)) seen.set(f, { ...o, blob: blobOfEvidence(blob) });
    const blobsNow = {}; for (const o of evs) Object.assign(blobsNow, blobsAsOwned(repo, [...seen.keys()].filter(f => seen.get(f).e === o.e), [o.x.data.id], o.e.commits || []));
    const changed = [...seen.keys()].filter(f => blobsNow[f] !== seen.get(f).blob).sort();
    if (changed.length) {
      const o = changed.map(f => seen.get(f)).sort((a, b) => String(b.e.when).localeCompare(String(a.e.when)))[0];
      throw new Error(`${sn(s)}: the code changed after the last check (${o.e.when}${o.x !== s ? `, of ${sn(o.x)}` : ''}): run the checkpoint again. Changed: ${changed.slice(0, 3).join(', ')}${changed.length > 3 ? ` and ${changed.length - 3} more` : ''}`);
    }
    // And the fast tests (or full suite when validate:full is absent) must be green on the code as it is now (R173, R200, R239): the slice's own
    // files are as checked, but work elsewhere may have broken what was checked. One run is shared by every acceptance while it is under 2 days old
    // and got with the same tools; a project with no suite has nothing to ask.
    if (evs.length && validateCommand(repo)) {
      const hasFull = hasNpmScript(repo, 'validate:full');
      const g = suiteGreen(repo, recordInputs(repo).evidence, { need: FAST_TESTS, now: now() });
      if (!g.ok) throw new Error(`${sn(s)}: ${hasFull ? 'the fast tests have' : 'the whole test suite has'} not passed on the code as it is now (${g.why}): run ${hasFull ? 'a checkpoint or ' : 'it once with '}buddy suite, then accept again. One run serves every acceptance for 2 days with the same tools`);
    }
  }
  if (to === 'ready') {   // the ready rule (R114): criteria, exclusions, no blocking question open; the prototype's screens come later (R107)
    const HOW = { criteria: `it has no acceptance criteria: say how it will be accepted with buddy criteria add ${id} "<text>"`, excludes: `it does not say what it leaves out: add that with buddy excludes add ${id} "<text>" ("Nothing beyond the criteria above" is a valid answer)` };
    const open = batchesOf(repo, s.data).flatMap(x => (x.data.questions || []).filter(q => q.blocking && q.status === 'open'));
    const why = [];
    for (const m of missingForReady(s.data)) why.push(HOW[m.field]);
    if ((s.data.screens || []).length) {   // the prototype's screens a change covers must be confirmed by the owner (R107, R116)
      const known = knownScreens(repo); const pending = (s.data.screens || []).filter(n => !(known || []).some(k => k.name === n && k.origin === 'human'));
      if (pending.length) why.push(`${pending.length === 1 ? 'a screen it covers is' : 'screens it covers are'} not confirmed by you in the prototype's manifest: ${pending.join(', ')} (buddy prototype card, then buddy prototype confirm)`);
    }
    if (open.length) why.push(`blocking question(s) still open: ${open.map(q => `${q.situation} [${q.id}]`).join(' | ')}`);   // each by its text, id beside it (R78)
    if (why.length) throw new Error(`not ready: ${why.join('; ')}`);
  }
  const head = to === 'building' && !s.data.base ? git(['rev-parse', '--verify', '--quiet', 'HEAD'], repo).trim() : '';
  if (to === 'accepted' && pieces.length) {   // one write for all: the pieces and the change are accepted together, or nothing is
    const accepted = { by: 'owner', at: stamp(now), channel, assurance: 'recorded' };
    const writes = whole.map(x => ({ file: x.file, data: { ...x.data, status: 'accepted', accepted, updated: stamp(now) }, body: x.body }));
    commitAll(repo, writes.map(w => ({ file: w.file, text: canonicalText(w.data, w.body) })));
    return { id, file: s.file, files: writes.map(w => w.file), data: writes[0].data, body: s.body, pieces: delivered.map(x => x.data.id) };
  }
  const moved = rewrite(repo, id, ({ data, body }) => {
    data.status = to; if (head) data.base = head;
    if (to === 'accepted') data.accepted = { by: 'owner', at: stamp(now), channel, assurance: 'recorded' };   // level 0: recorded, not signed (R61)
    else delete data.accepted;
    return { data, body };
  }, now);
  // the move to ready warns about each vague criterion and never refuses it (R94): Buddy proposes a checkable wording to the owner
  // a piece made ready covering no screen while its change covers some is told so, and never refused (R156)
  if (to === 'ready') {
    const of = s.change && !(moved.data.screens || []).length ? (readSlice(repo, s.change).data.screens || []) : [];
    return { ...moved, vague: vagueWarnings(moved.data.criteria), ...(of.length ? { no_screens: { change: s.change, screens: of, message: `its change covers screens ${of.join(', ')}; this piece covers none: add the ones it builds with buddy slice screens add ${id} <screen>` } } : {}) };
  }
  // building with assumptions the owner has not confirmed is allowed, with a warning naming them (R136)
  if (to === 'building') { const proposed = (moved.data.assumptions || []).filter(a => a.status === 'proposed'); if (proposed.length) return { ...moved, unconfirmed: proposed }; }
  return moved;
}

// After a piece is delivered: when it was the last open piece of its change, the change is delivered too (R83). Returns the move, or null
// when there is nothing to do (not a piece, a piece still open, or the change already delivered or closed).
export function deliverChangeOf(repo, id, { now = () => new Date() } = {}) {
  const s = readSlice(repo, id); if (!s.change) return null;
  const c = readSlice(repo, s.change); if (['delivered', 'accepted', 'abandoned'].includes(c.data.status)) return null;
  if (partsOf(repo, c.data.id).some(x => !['delivered', 'accepted', 'abandoned'].includes(x.data.status))) return null;
  return moveSlice(repo, c.data.id, 'delivered', { now });
}

// Every question batch under docs/: { file, data } (also read by the owner's minutes).
export function allBatches(repo) {
  const walk = d => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? (e.name === 'node_modules' || e.name.startsWith('.') ? [] : walk(path.join(d, e.name))) : e.name.endsWith('.md') ? [path.join(d, e.name)] : []) : [];
  return walk(path.join(repo, 'docs')).map(f => ({ file: f, data: parseDocument(fs.readFileSync(f, 'utf8')).data })).filter(x => x.data?.schema === 'buddy/question-batch@0');
}
export const findBatchFile = (repo, id) => allBatches(repo).find(x => x.data.id === id)?.file ?? null;
// The batches of a slice are the ones it lists and the ones that name it: `queue new` writes `slice` in the batch, the list in the slice is optional.
export const batchesOf = (repo, slice) => allBatches(repo).filter(x => (slice.batches || []).includes(x.data.id) || x.data.slice === slice.id);

// A milestone's whole plan (R282): its record, its changes and their pieces, their batches of questions and the map of what was asked;
// the go-ahead commits it with it, so no part of the plan is left uncommitted when the first change starts.
export const planFiles = (repo, id) => { const recs = [readSlice(repo, id), ...changesOf(repo, id).flatMap(c => [c, ...partsOf(repo, c.data.id)])];
  return [...recs.map(r => r.file), ...recs.flatMap(r => batchesOf(repo, r.data).map(b => b.file)), path.join(repo, 'docs', 'buddy', 'requests.md')]; };
// What was assumed on the Product Owner's behalf and nobody confirmed, across the slice's batches (R59: shown at acceptance).
export const assumptionsOf = (repo, slice) => unconfirmedDefaults(batchesOf(repo, slice).map(x => x.file)).map(a => ({ ...a, file: path.relative(repo, a.file) }));
// The same for the accept card, from the batches the index read (R148); `index` defaults to reading it.
const assumptionsIn = (index, slice) => unconfirmedIn(index.batches.filter(b => (slice.batches || []).includes(b.id) || b.slice === slice.id).map(b => ({ file: b.file.split('/').join(path.sep), batch: b })));

// The accept card of a change in pieces (R83): the change's criteria and exclusions, the assumptions nobody confirmed across the change and
// its pieces, each piece in one line, and only the exceptions: the pieces whose latest checkpoint gave reasons, and the departures from the
// prototype still to decide or rejected. No summary of each piece.
function featureCard(repo, s, pieces, index) {
  pieces = [...pieces].sort(byRank); const id = s.data.id; const DONE = ['delivered', 'accepted', 'abandoned']; const open = pieces.filter(x => !DONE.includes(x.data.status));
  const left = [...new Map([s, ...pieces.filter(x => x.data.status !== 'abandoned')].flatMap(x => assumptionsIn(index, x.data)).map(a => [a.id, a])).values()];
  const o = [`ACCEPT  ${sn(s)}`, ''];
  if (open.length) o.push(`Not ready to accept: ${open.length} piece(s) are not delivered yet: ${open.map(x => `${x.data.title} [${x.data.id}, ${x.data.status}]`).join(' | ')}.`, '');
  if ((s.data.criteria || []).length) o.push('You asked for:', ...s.data.criteria.map(c => `  ${c.id}  ${c.text}`), '');
  if ((s.data.excludes || []).length) o.push('It does not include:', ...s.data.excludes.map(x => `  ${x.id}  ${x.text}`), '');
  o.push(`Its pieces (${pieces.filter(x => DONE.includes(x.data.status)).length} of ${pieces.length} delivered, accepted or abandoned):`, ...pieces.map(x => `  ${x.data.status.padEnd(9)} ${x.data.title} [${x.data.id}]`), '');
  const cache = new Map(); const dir = path.join(path.dirname(s.file), 'evidence');
  const exc = pieces.filter(x => x.data.status === 'delivered').map(x => ({ x, list: openNotes(latestEvidence(dir, x.data.id, cache, x.data.reclassified), x.data) })).filter(e => e.list.length);
  if (exc.length) o.push(`Exceptions the checks found (${exc.length} piece(s)):`, ...exc.map(e => `  ${e.x.data.title} [${e.x.data.id}]: ${exceptionsText(e.list)}`), '');
  const dv = pieces.filter(x => x.data.status === 'delivered').flatMap(x => (x.data.divergences || []).filter(v => v.status !== 'accepted').map(v => ({ ...v, of: sn(x) })));
  if (dv.length) o.push(`Where the build departs from your prototype (${dv.filter(v => v.status === 'declared').length} to decide, ${dv.filter(v => v.status === 'rejected').length} rejected):`, ...dv.flatMap(v => [`  ${v.id} of ${v.of}  ${v.kind === 'improvement' ? 'improvement' : 'DIVERGENCE'} on screen ${v.screen} [${v.status}]`, `        the prototype ${v.prototype}`, `        built: ${v.built}`, `        why: ${v.why}`]), '', 'Say which to accept and which to reject (a rejected one goes back to Dev; its piece goes to rework).', '');
  if (!exc.length && !dv.length) o.push('The checks found no exception in its pieces.', '');
  apart(o, pieces.filter(x => x.data.status === 'delivered').flatMap(x => apartOf(latestEvidence(dir, x.data.id, cache, x.data.reclassified)).map(a => `${a}   (${x.data.title} [${x.data.id}])`)));
  // the costly decisions nobody specified are among the exceptions above; the cheap ones wait here for the owner (R136)
  const un = pieces.filter(x => x.data.status === 'delivered').flatMap(x => unspecifiedOf(latestEvidence(dir, x.data.id, cache, x.data.reclassified)).map(d => ({ ...d, of: x })));
  const cheap = un.filter(d => !d.costly); const unasked = announced(o, [s, ...pieces.filter(x => x.data.status !== 'abandoned')]);
  closing(o, { left, cheap, unasked, costly: un.length - cheap.length, piece: 'its piece', cheapLine: d => `  ${d.n}. ${d.text}${lowered(d)}   (${d.of.data.title} [${d.of.data.id}])`, nothing: 'Try it, then accept: accepting the change accepts every delivered piece of it.' });
  return o.join('\n') + '\n';
}

export function acceptCard(repo, id, { index } = {}) {
  const x = index ?? readIndex(repo);
  const s = readSlice(repo, id); const pieces = isMilestone(s) ? [] : partsOf(repo, id); if (pieces.length) return featureCard(repo, s, pieces, x);
  const st = stepsOf(s); const left = assumptionsIn(x, s.data); const open = st.filter(x => !x.done);
  const o = [`ACCEPT  ${sn(s)}`, ''];
  if (open.length) o.push(`Not ready to accept: ${open.length} step(s) are still open (${open.slice(0, 4).map(x => x.num).join(', ')}).`, '');
  if ((s.data.criteria || []).length) o.push('You asked for:', ...s.data.criteria.map(c => `  ${c.id}  ${c.text}`), '');
  if ((s.data.excludes || []).length) o.push('It does not include:', ...s.data.excludes.map(x => `  ${x.id}  ${x.text}`), '');
  if (isMilestone(s)) { const ch = changesOf(repo, id); o.push(`Its changes (${ch.filter(x => x.data.status === 'accepted').length} of ${ch.length} accepted):`, ...ch.map(x => `  ${x.data.status.padEnd(9)} ${sn(x)}`), ''); }
  const dv = s.data.divergences || [];
  if (dv.length) o.push(`Where the build departs from your prototype (${dv.filter(v => v.status === 'declared').length} to decide, ${dv.length} in all):`, ...dv.flatMap(v => [`  ${v.id}  ${v.kind === 'improvement' ? 'improvement' : 'DIVERGENCE'} on screen ${v.screen} [${v.status}]`, `        the prototype ${v.prototype}`, `        built: ${v.built}`, `        why: ${v.why}`]), '', 'Say which to accept and which to reject (a rejected one goes back to Dev; the slice goes to rework).', '');
  const ev = latestEvidence(path.join(path.dirname(s.file), 'evidence'), id, undefined, s.data.reclassified);
  const un = unspecifiedOf(ev); const costly = un.filter(d => d.costly);
  if (costly.length) o.push(`Costly decisions nobody specified, exceptions for you to decide (${costly.length}):`, ...costly.map(d => `  ${d.n}. ${d.text}`), '', 'Say for each whether it stays (it becomes an assumption you confirmed) or changes (the slice then goes to rework).', '');
  if ((s.data.unverified || []).length) o.push(`Screens you chose not to verify (${s.data.unverified.length}), still not a pass:`, ...s.data.unverified.map(u => `  ${u.screen}, decided ${u.at.slice(0, 10)}${u.note ? `: ${u.note}` : ''}`), '');
  apart(o, apartOf(ev));
  const unasked = announced(o, [s]);
  closing(o, { left, cheap: un.filter(d => !d.costly), unasked, costly: costly.length, piece: 'the slice', cheapLine: d => `  ${d.n}. ${d.text}${lowered(d)}`, nothing: 'Try it, then accept.' });
  return o.join('\n') + '\n';
}

// What the checks said apart (R155): unstable tests to fix and screens the reviewer could not compare; findings to know, not exceptions.
function apart(o, list) { if (list.length) o.push(`Found by the checks, not exceptions by themselves (${list.length}):`, ...list.map(x => `  ${x}`), ''); }

// a decision the owner lowered from costly to cheap says so on the card (R139)
const lowered = d => (d.lowered ? '   (you lowered it to cheap)' : '');

// The assumptions announced before building (R136), apart from what nobody announced: the ones the owner confirmed, and the ones they never
// confirmed (to confirm now). The corrected ones are criteria or exclusions by now. Returns the unconfirmed ones.
function announced(o, recs) {
  const all = recs.flatMap(x => (x.data.assumptions || []).map(a => ({ ...a, of: x }))); const many = recs.length > 1;
  const line = a => `  ${a.id}  ${a.text}${many ? `   (${a.of.data.title} [${a.of.data.id}])` : ''}`;
  const ok = all.filter(a => a.status === 'confirmed'); const unasked = all.filter(a => a.status === 'proposed');
  if (ok.length) o.push(`What you confirmed before building (${ok.length}):`, ...ok.map(line), '');
  if (unasked.length) o.push(`Announced before building and not confirmed by you yet (${unasked.length}):`, ...unasked.map(a => `${line(a)}; if it is otherwise: ${a.if_otherwise}`), '');
  return unasked;
}
// What was assumed on the owner's behalf and waits for them (R59, R136): the assumed defaults of the questions, then the decisions nobody
// announced (the cheap ones the reviewer found). "Nothing was assumed" only when none of them is left, none announced is unconfirmed and no costly one.
function closing(o, { left, cheap, unasked, costly, piece, cheapLine, nothing }) {
  if (left.length) o.push(`To accept, confirm what was assumed on your behalf (${left.length}):`, ...left.map((a, i) => `  ${i + 1}. ${a.text}   [${a.id}]`), '');
  if (cheap.length) o.push(`Decisions nobody announced, taken while building (${cheap.length}): confirm them, or ask to change one:`, ...cheap.map(cheapLine), '');
  if (left.length || cheap.length || unasked.length) o.push(`Reply "ok" to confirm all, or say which to change (${piece} then goes to rework).`);
  else o.push(`${costly ? 'Nothing else was assumed on your behalf.' : 'Nothing was assumed on your behalf.'} ${nothing}`);
}

export const stepsOf = s => parseSteps(s.body).steps;
