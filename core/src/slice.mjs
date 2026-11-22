// Rules for buddy/slice@1 that a shape cannot express (docs/design/14 section 3): identity, criteria, steps, consistency.
// Pure functions of already-parsed documents; verify.mjs calls checkSlice and reports what it returns.

import path from 'node:path';
import { dumpDocument } from './yaml.mjs';

const STEP = /^(\s*)- \[([ x])\] (\d+(?:\.\d+)*)\.?\s+(\S.*)$/;
// What a record without steps says in their place (R87: a record with no steps and no word about them confused the Product Owner).
export const NO_STEPS = { change: 'Steps: planned when the change is ready.', slice: 'Steps: planned when the slice is ready.', split: 'Steps: in the slices of this change.' };
const PLACEHOLDER = new Set(Object.values(NO_STEPS));

// Reads the "## Steps" section. Returns { steps: [{ line, depth, num, done, text }], errors: [{ where, message }], present }.
export function parseSteps(body) {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex(l => /^##\s+Steps\s*$/.test(l));
  if (start < 0) return { steps: [], errors: [], present: false };
  const steps = []; const errors = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^#{1,6}\s/.test(l)) break;
    if (!l.trim() || PLACEHOLDER.has(l.trim())) continue;
    const m = STEP.exec(l);
    if (!m) { errors.push({ where: `Steps, line ${i - start}`, message: `not a step ("- [ ] 1. text" or "  - [ ] 1.1 text"): "${l.trim().slice(0, 50)}"` }); continue; }
    const depth = m[3].split('.').length;
    if (m[1].length !== (depth - 1) * 2) errors.push({ where: `Steps ${m[3]}`, message: `indentation must be ${(depth - 1) * 2} spaces for a step numbered ${m[3]}` });
    steps.push({ line: i - start, depth, num: m[3], done: m[2] === 'x', text: m[4] });
  }
  // numbering: 1,2,3 at the top; n.1, n.2 under n; no gaps, no repeats
  const next = new Map(); const seen = new Set();
  for (const s of steps) {
    if (seen.has(s.num)) { errors.push({ where: `Steps ${s.num}`, message: 'duplicate step number' }); continue; }
    seen.add(s.num);
    const parts = s.num.split('.').map(Number); const last = parts.pop(); const parent = parts.join('.');
    if (parent && !seen.has(parent)) errors.push({ where: `Steps ${s.num}`, message: `step ${s.num} has no parent step ${parent} before it` });
    const expect = (next.get(parent) ?? 0) + 1;
    if (last !== expect) errors.push({ where: `Steps ${s.num}`, message: `expected number ${parent ? parent + '.' : ''}${expect}` });
    next.set(parent, last);
  }
  return { steps, errors, present: true };
}

// Canonical form (R5, Q37): the file equals what the program would write. Key order is fixed; the body is kept as it is.
export const KEY_ORDER = ['schema', 'id', 'title', 'kind', 'status', 'rank', 'epic', 'depends_on', 'branch', 'base', 'created', 'updated', 'accepted', 'request', 'batches', 'decisions', 'findings', 'criteria', 'excludes', 'assumptions', 'screens', 'divergences', 'howto', 'unverified', 'reclassified', 'outcome'];
export const orderKeys = data => Object.fromEntries([...KEY_ORDER.filter(k => k in data), ...Object.keys(data).filter(k => !KEY_ORDER.includes(k))].map(k => [k, data[k]]));
export const canonicalText = (data, body) => dumpDocument(orderKeys(data), body.endsWith('\n') ? body : body + '\n');
export const isCanonical = (text, data, body) => text.replace(/\r\n/g, '\n') === canonicalText(data, body.replace(/\r\n/g, '\n'));

// Step editing: pure functions on the body text. Top level steps are "- [ ] 3. text", deeper ones "  - [ ] 2.1 text" (as in the examples).
const stepLine = (num, text, done = false) => `${'  '.repeat(num.split('.').length - 1)}- [${done ? 'x' : ' '}] ${num}${num.includes('.') ? '' : '.'} ${text}`;
function sections(body) {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  let start = lines.findIndex(l => /^##\s+Steps\s*$/.test(l));
  if (start < 0) { while (lines.length && lines[lines.length - 1] === '') lines.pop(); lines.push('', '## Steps', ''); start = lines.length - 2; }
  let end = lines.length; for (let i = start + 1; i < lines.length; i++) if (/^#{1,6}\s/.test(lines[i])) { end = i; break; }
  return { lines, start, end };
}
export function addStep(body, text, under) {
  if (!text || /\n/.test(text)) throw new Error('a step is one line of text');
  const { lines, start, end } = sections(body); const cur = parseSteps(lines.join('\n')).steps;
  if (under && !cur.some(s => s.num === under)) throw new Error(`no step ${under} to add under`);
  const kids = cur.filter(s => (under ? s.num.startsWith(under + '.') && s.depth === under.split('.').length + 1 : s.depth === 1));
  const num = under ? `${under}.${kids.length + 1}` : String(kids.length + 1);
  // insert after the last step of that branch (the parent and everything below it); the first step goes right under the heading
  const rows = cur.map(s => ({ num: s.num, idx: start + s.line }));
  const family = under ? rows.filter(s => s.num === under || s.num.startsWith(under + '.')) : rows;
  const at = family.length ? Math.max(...family.map(s => s.idx)) + 1 : start + 1;
  lines.splice(at, 0, stepLine(num, text));
  return { body: lines.filter((l, i) => !(i > start && i <= end && PLACEHOLDER.has(l.trim()))).join('\n'), num };   // the first step replaces the word about steps
}
export function setStep(body, num, done) {
  const { lines } = sections(body); const { steps } = parseSteps(body);
  const s = steps.find(x => x.num === num); if (!s) throw new Error(`no step ${num}`);
  if (done && steps.some(x => x.num.startsWith(num + '.') && !x.done)) throw new Error(`step ${num} has open sub-steps`);
  const start = lines.findIndex(l => /^##\s+Steps\s*$/.test(l));
  const i = start + s.line; if (!STEP.test(lines[i])) throw new Error('could not locate the step line');
  lines[i] = lines[i].replace(/\[( |x)\]/, done ? '[x]' : '[ ]');
  return lines.join('\n');
}

// The ready rule (R94, R109, R114): a change or slice is ready only with at least one acceptance criterion and at least one
// exclusion (what it does not include; "Nothing beyond the criteria above" is a valid one), whatever its kind, and a change made
// of slices needs its own. The open blocking questions are checked by moveSlice, which can read the batches.
// TODO(R107): the ready rule will also require the prototype's screens the change covers to be assigned (a later change).
// The verifier applies the rule only to records opened on or after READY_RULE_FROM: the records written before it existed
// keep the rule they were made under, and are not rewritten.
export const READY_RULE_FROM = '2026-11-02';
export const readyRuleApplies = data => String(data.created || '').slice(0, 10) >= READY_RULE_FROM;
export function missingForReady(data) {
  const out = [];
  if (!(data.criteria || []).length) out.push({ field: 'criteria', message: 'needs at least one acceptance criterion' });
  if (!(data.excludes || []).length) out.push({ field: 'excludes', message: 'needs to say what it does not include (at least one exclusion)' });
  return out;
}

// Assumptions announced before building (R136): at most five, and the states each one goes through.
export const MAX_ASSUMPTIONS = 5;
export const ASSUMPTION_STATES = ['proposed', 'confirmed', 'corrected'];
export const confirmedAssumptions = data => (data?.assumptions || []).filter(a => a.status === 'confirmed').map(a => ({ id: a.id, text: a.text }));

// Legal moves between states (docs/design/08 section 2). A move is refused when it is not listed here or when the result would not verify.
export const NEXT = {
  refining: ['ready', 'abandoned'], ready: ['building', 'refining', 'abandoned'], building: ['blocked', 'delivered', 'abandoned'],
  blocked: ['building', 'abandoned'], delivered: ['accepted', 'rework', 'abandoned'], rework: ['building', 'refining', 'abandoned'], accepted: ['rework'], abandoned: [],
};

// docs: [{ file, data, body, change?, folder? }] of kind slice (`change`: the change a slice belongs to; `folder`: it is a file of a change folder, R87); ctx: { sliceIds:Set, batchQuestions:(id)=>[questions]|undefined, questionsOfSlice:(id)=>[questions], hasId:(kind,id)=>bool, findingStatus:(id)=>string|undefined }
export function checkSlice(docs, ctx, add) {
  const byId = new Map(docs.map(d => [d.data.id, d]));
  for (const d of docs) {
    const s = d.data; const f = d.file; const parts = docs.filter(x => (x.change ?? x.data.epic) === s.id);
    // identity: a change is the change.md of a folder named <date>-<name>; its slices are the other records of the folder (R87).
    // `epic:` is the flat layout of before R87, read until `buddy migrate` moves it into folders.
    // A milestone is the milestone.md of docs/buddy/milestones/<date>-<name>/, and its changes are in changes/ of that folder (R118).
    const milestone = s.kind === 'milestone';
    if (path.basename(f) === 'milestone.md') {
      const want = `${String(s.created).slice(0, 10)}-${s.id}`;
      if (!milestone) add(f, 'kind', 'milestone.md is the record of a milestone: its kind is milestone');
      if (path.basename(path.dirname(f)) !== want) add(f, 'id', `a milestone lives in a folder named by its date and its name: ${want}`);
      else if (path.basename(path.dirname(path.dirname(f))) !== 'milestones') add(f, 'id', 'a milestone lives in docs/buddy/milestones/');
      if (s.epic) add(f, 'epic', 'a milestone has no epic');
      if (parseSteps(d.body).steps.length) add(f, 'Steps', 'a milestone has no steps: its work is in its changes');
      const mine = docs.filter(x => x.milestone === s.id && !x.change && path.basename(x.file) === 'change.md');
      const open = mine.filter(x => !['accepted', 'abandoned'].includes(x.data.status));
      if (s.status === 'accepted' && open.length) add(f, 'status', `accepted while ${open.length} change(s) of it are open (${open.slice(0, 3).map(x => x.data.id).join(', ')})`);
    } else if (milestone) add(f, 'kind', 'a milestone is the file milestone.md of its folder under docs/buddy/milestones/');
    if (path.basename(f) === 'change.md') {
      const want = `${String(s.created).slice(0, 10)}-${s.id}`;
      if (path.basename(path.dirname(f)) !== want) add(f, 'id', `a change lives in a folder named by its date and its name: ${want}`);
      if (s.epic) add(f, 'epic', 'a change has no epic: it is the parent of its slices');
      if (d.milestoneFolder && !d.milestone) add(f, 'id', 'this change is in the changes/ folder of a milestone that has no milestone.md');
      else if (!['backlog', 'changes'].includes(path.basename(path.dirname(path.dirname(f))))) add(f, 'id', 'a change lives in docs/buddy/backlog/ or in the changes/ folder of a milestone');
    } else if (d.folder && !milestone) {
      if (path.basename(f) !== `${s.id}.md`) add(f, 'id', `a slice of a change is the file ${s.id}.md`);
      if (s.epic) add(f, 'epic', `a slice of a change has no epic: its change is its folder (${d.change})`);
    }
    if (s.epic && !d.folder) {
      if (s.epic === s.id) add(f, 'epic', 'a slice cannot be its own epic');
      else if (!ctx.sliceIds.has(s.epic)) add(f, 'epic', `unknown slice ${s.epic}`);
      else if (byId.has(s.epic) && byId.get(s.epic).data.kind !== 'epic') add(f, 'epic', `${s.epic} is not of kind epic`);
    }
    if (s.kind === 'epic' && s.epic) add(f, 'epic', 'an epic cannot have an epic (one level only)');
    const seenDep = new Set();
    for (const dep of s.depends_on || []) {
      if (dep === s.id) add(f, 'depends_on', 'a slice cannot depend on itself');
      else if (!ctx.sliceIds.has(dep)) add(f, 'depends_on', `unknown slice ${dep}`);
      if (seenDep.has(dep)) add(f, 'depends_on', `${dep} listed twice`); seenDep.add(dep);
    }
    // links
    for (const [field, kind] of [['batches', 'question'], ['decisions', 'decision'], ['findings', 'finding']]) for (const id of s[field] || []) if (!ctx.hasId(kind, id)) add(f, field, `unknown ${kind} ${id}`);
    // criteria
    const crit = new Set();
    for (const c of s.criteria || []) { if (crit.has(c.id)) add(f, `criteria.${c.id}`, 'duplicate criterion id'); crit.add(c.id); }
    // departures from the prototype (R127): each on a screen the change covers; a decision exists exactly when the status says so
    const dv = new Set();
    for (const v of s.divergences || []) {
      if (dv.has(v.id)) add(f, `divergences.${v.id}`, 'duplicate departure id'); dv.add(v.id);
      if (!(s.screens || []).includes(v.screen)) add(f, `divergences.${v.id}`, `${v.screen} is not a screen this change covers`);
      if (v.status !== 'declared' && !v.decided) add(f, `divergences.${v.id}`, `is ${v.status} but nobody decided it (decided: by owner, at)`);
      if (v.status === 'declared' && v.decided) add(f, `divergences.${v.id}`, 'is declared but carries a decision');
    }
    const hw = new Set(); for (const h of s.howto || []) { if (hw.has(h.criterion)) add(f, `howto.${h.criterion}`, 'listed twice'); hw.add(h.criterion); if (!(s.criteria || []).some(c => c.id === h.criterion)) add(f, `howto.${h.criterion}`, `${h.criterion} is not a criterion of this change`); }
    const uv = new Set(); for (const u of s.unverified || []) { if (uv.has(u.screen)) add(f, `unverified.${u.screen}`, 'listed twice'); uv.add(u.screen); if (!(s.screens || []).includes(u.screen)) add(f, `unverified.${u.screen}`, `${u.screen} is not a screen this change covers`); }
    // a decision nobody specified lowered to cheap is the owner's (R139); Buddy may only raise one (R140 keeps them in the record)
    for (const x of s.reclassified || []) if (x.costly !== true && x.by !== 'owner') add(f, 'reclassified', `decision ${x.n} of ${x.evidence} was lowered to cheap by ${x.by}: only the owner lowers one`);
    if (s.status === 'accepted') { const pending = (s.divergences || []).filter(v => v.status !== 'accepted'); if (pending.length) add(f, 'status', `accepted with ${pending.length} departure(s) from the prototype not accepted (${pending.slice(0, 3).map(v => `${v.id} ${v.status}`).join(', ')})`); }
    const excl = new Set();
    for (const x of s.excludes || []) { if (excl.has(x.id)) add(f, `excludes.${x.id}`, 'duplicate exclusion id'); excl.add(x.id); }
    // what Buddy will assume, announced before building (R136): at most five, each proposed, confirmed or corrected
    const asm = new Set();
    if ((s.assumptions || []).length > MAX_ASSUMPTIONS) add(f, 'assumptions', `at most ${MAX_ASSUMPTIONS} assumptions are announced before building, the costliest first; there are ${s.assumptions.length}`);
    for (const a of s.assumptions || []) {
      if (asm.has(a.id)) add(f, `assumptions.${a.id}`, 'duplicate assumption id'); asm.add(a.id);
      if (!ASSUMPTION_STATES.includes(a.status)) add(f, `assumptions.${a.id}`, `unknown status ${a.status}: ${ASSUMPTION_STATES.join(', ')}`);
    }
    if (!['refining', 'abandoned'].includes(s.status)) {
      if (readyRuleApplies(s) || milestone) for (const m of missingForReady(s)) add(f, m.field, `a ${milestone ? 'milestone' : d.change ? 'slice' : 'change'} that is ${s.status} ${m.message}`);
      // records opened before the ready rule (R114) keep the older rule: a feat without slices needs criteria
      else if (s.kind === 'feat' && !parts.length && !crit.size) add(f, 'criteria', `a feat slice that is ${s.status} needs at least one acceptance criterion`);
    }
    // steps
    const st = parseSteps(d.body);
    for (const e of st.errors) add(f, e.where, e.message);
    for (const x of st.steps) for (const ref of x.text.match(/\bAC\d+\b/g) || []) if (!crit.has(ref)) add(f, `Steps ${x.num}`, `cites ${ref}, which is not a criterion of this slice`);
    // consistency
    if (s.status === 'accepted' && !s.accepted) add(f, 'accepted', 'an accepted slice records who accepted it and when (accepted: { by: owner, at })');
    if (s.status !== 'accepted' && s.accepted) add(f, 'accepted', `has an acceptance record but status is ${s.status}`);
    if (s.status === 'accepted') {
      const open = st.steps.filter(x => !x.done);
      if (open.length) add(f, 'status', `accepted with ${open.length} step(s) still open (${open.slice(0, 3).map(x => x.num).join(', ')})`);
      for (const id of s.findings || []) if (ctx.findingStatus(id) === 'open') add(f, 'findings', `slice is accepted but ${id} is still open`);
    }
    if (s.status === 'blocked') {
      const blocking = [...(s.batches || []).flatMap(b => ctx.batchQuestions(b) || []), ...ctx.questionsOfSlice(s.id)].some(q => q.blocking && q.status === 'open');
      if (!blocking) add(f, 'status', 'blocked, but no open blocking question in its batches');
    }
    if (parts.length && st.steps.length) add(f, 'Steps', `a change in slices keeps its steps in its slices (${parts.slice(0, 3).map(x => x.data.id).join(', ')})`);
    if (s.status === 'accepted') {
      const open = parts.filter(x => !['accepted', 'abandoned'].includes(x.data.status));
      if (open.length) add(f, 'status', `accepted while ${open.length} slice(s) of it are open (${open.slice(0, 3).map(x => x.data.id).join(', ')})`);
    }
  }
  // dependency cycles
  const state = new Map();
  const visit = (id, trail, file) => {
    if (state.get(id) === 2 || !byId.has(id)) return;
    if (state.get(id) === 1) { add(file, 'depends_on', `dependency cycle: ${[...trail.slice(trail.indexOf(id)), id].join(' -> ')}`); return; }
    state.set(id, 1);
    for (const dep of byId.get(id).data.depends_on || []) visit(dep, [...trail, id], byId.get(id).file);
    state.set(id, 2);
  };
  for (const id of byId.keys()) visit(id, [], byId.get(id).file);
}
