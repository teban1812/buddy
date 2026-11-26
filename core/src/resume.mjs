// `buddy resume`: where a slice stands, built from the files only, so that Buddy can relaunch Dev after a cut (R53, R57).
// The program writes this brief; Buddy does not paraphrase it (docs/design/08 section 4, rule 2). A pure function of the records,
// the git state and an injected clock; it reads only. The records, their steps, the batches and the decision records come from the index (R148).
import fs from 'node:fs';
import path from 'node:path';
import { readIndex } from './index.mjs';
import { RECORDS } from './slicestore.mjs';
import { git } from './proc.mjs';
import { age } from './board.mjs';
import { workers } from './workers.mjs';
import { screensBrief } from './prototype.mjs';
import { confirmedAssumptions } from './slice.mjs';
import { ensureBuddyDir } from './gitdir.mjs';

const RESUMABLE = ['building', 'rework', 'blocked'];
// The index of the normative documents the standards cite, copied from the library at birth (contract 2; init.mjs NORMATIVE).
export const NORMATIVE = 'docs/standards/normative.md';

// A record of the index by its name, as readSlice names a missing one.
function recordOf(x, id) {
  const r = [...x.milestones, ...x.changes].find(y => y.id === id);
  if (!r) throw new Error(`no slice or change ${id} under ${RECORDS}, nor a milestone of that name`);
  return r;
}

// `index`: the records as the index read them; without one it is read here.
export function resumeBrief(repo, id, now, { index } = {}) {
  const x = index ?? readIndex(repo); const s = recordOf(x, id); const d = s.data;
  if (!RESUMABLE.includes(d.status)) throw new Error(`nothing to resume: ${d.title} [${id}] is ${d.status} (only ${RESUMABLE.join(', ')} slices are resumed)`);
  const rec = { batches: x.batches, decisions: x.decision_records.map(r => r.data) }; const steps = s.step_list;
  const batches = rec.batches.filter(b => (d.batches || []).includes(b.id) || b.slice === id).sort((a, b) => a.id.localeCompare(b.id));
  const questions = batches.flatMap(b => (b.questions || []).map(q => ({ ...q, batch: b.id })));
  const label = q => q.options?.find(o => o.id === (q.answer?.option))?.label ?? q.answer?.text ?? '';
  const answered = questions.filter(q => ['answered', 'assumed'].includes(q.status) && q.answer).map(q => ({ id: q.id, situation: q.situation, answer: label(q), origin: q.answer.origin, status: q.status }));
  const open = questions.filter(q => q.status === 'open').map(q => ({ id: q.id, situation: q.situation, blocking: !!q.blocking }));
  const decisions = rec.decisions.filter(x => (d.decisions || []).includes(x.id) || x.slice === id).sort((a, b) => a.id.localeCompare(b.id)).map(x => ({ id: x.id, title: x.title, status: x.status }));
  const dirty = git(['status', '--porcelain'], repo).split('\n').filter(Boolean);
  // the next step is the first open one with no open sub-step: a parent cannot be ticked before its children
  const nextStep = steps.find(x => !x.done && !steps.some(y => y.num.startsWith(x.num + '.') && !y.done)) ?? null;
  return {
    id, title: d.title, kind: d.kind, status: d.status, branch: d.branch ?? null, updated: d.updated ?? d.created, age: age(d.updated ?? d.created, now),
    request: d.request, criteria: d.criteria || [], assumptions: [...(s.change ? confirmedAssumptions(recordOf(x, s.change).data) : []), ...confirmedAssumptions(d)], steps: steps.map(x => ({ num: x.num, text: x.text, done: x.done, ...(x.dropped ? { dropped: true } : {}) })), next_step: nextStep ? nextStep.num : null,
    normative: fs.existsSync(path.join(repo, NORMATIVE)) ? NORMATIVE : null, screens: screensBrief(repo, d.screens), divergences: d.divergences || [], answered, open, decisions, workers: workers(repo, { slice: id, now: () => new Date(now) }),
    git: { branch: git(['branch', '--show-current'], repo).trim() || null, last_commit: git(['log', '-1', '--format=%h %s'], repo).trim() || null, changed_files: dirty.length, changed: dirty.slice(0, 10).map(l => l.trim()) },
  };
}

// How Dev and the reviewer use the index (A3, A4 of bring-normative-documents): a cited clause is resolved through it; a link is never fetched.
export const NORMATIVE_RULE = 'It says which document and version each id means: resolve each clause the standards or the step records cite (such as SCS v2.0 clause 4.2) through it. Never fetch a link it gives (they may be private pages): work from the clauses as cited, and say so when a decision needs the document itself.';
export function briefText(b) {
  const o = [`RESUME  ${b.title} [${b.id}]`, `${b.kind} · ${b.status} · last change ${b.age} ago${b.branch ? ` · branch ${b.branch}` : ''}`, '', `Request: ${b.request}`];
  if (b.criteria.length) o.push('', 'Acceptance criteria:', ...b.criteria.map(c => `  ${c.id}  ${c.text}`));
  if (b.assumptions?.length) o.push('', 'Assumptions the Product Owner confirmed before building (build on them; do not ask again):', ...b.assumptions.map(a => `  ${a.id}  ${a.text}`));
  if (b.normative) o.push('', `Normative documents: ${b.normative}, next to the standards in docs/standards/. ${NORMATIVE_RULE}`);
  if (b.screens) o.push('', 'Prototype screens you cover (your experience contract: start from them, you may improve them, and declare every departure with `buddy slice divergence add`; the originals are in the files named below):', '', b.screens.text);
  if (b.divergences.length) o.push('', 'Departures from the prototype you have declared (the Product Owner accepts or rejects each at acceptance; a rejected one is yours to undo):', ...b.divergences.map(v => `  ${v.id} (${v.kind}, ${v.status}) on ${v.screen}: the prototype ${v.prototype}; built: ${v.built}; why: ${v.why}`));
  if (b.steps.length) o.push('', `Steps (${b.steps.filter(x => x.done).length} of ${b.steps.length} done):`, ...b.steps.map(x => `  ${'  '.repeat(x.num.split('.').length - 1)}[${x.dropped ? '-' : x.done ? 'x' : ' '}] ${x.num}${x.num.includes('.') ? '' : '.'} ${x.text}${x.num === b.next_step ? '   <- next' : ''}`));
  else o.push('', 'No steps written yet: write the plan first (buddy step add).');
  if (b.answered.length) o.push('', 'Decided by the Product Owner or assumed (do not ask again):', ...b.answered.map(a => `  ${a.situation} [${a.id}] -> ${a.answer}  [${a.origin}${a.status === 'assumed' ? ', not confirmed' : ''}]`));
  if (b.decisions.length) o.push('', 'Decision records:', ...b.decisions.map(x => `  ${x.id}  ${x.title}${String(x.status).startsWith('superseded') ? `  (${x.status})` : ''}`));
  if (b.workers.length) {
    o.push('', 'Workers raised for this slice (ask each running one by its id before raising another):', ...b.workers.map(w => `  ${w.role.padEnd(8)} ${w.id}  ${w.status}${w.pid_state ? ` (pid ${w.pid_state})` : ''}  last seen ${w.age} ago  [${w.runtime}]`));
    if (b.workers.some(w => w.status === 'running' && w.role === 'dev')) o.push('  A Dev may still be running. Ask it by its id first: if it answers, continue it; if nobody answers, mark it (`buddy worker finish --id <id> --status lost`) and register the new one.');
  }
  if (b.open.length) o.push('', 'Questions still open:', ...b.open.map(q => `  ${q.blocking ? 'BLOCKING ' : ''}${q.situation} [${q.id}]`));
  o.push('', `Working tree: branch ${b.git.branch ?? '(none)'}, last commit ${b.git.last_commit ?? '(none)'}, ${b.git.changed_files} changed file(s)${b.git.changed.length ? ':' : ''}`, ...b.git.changed.map(l => `  ${l}`));
  o.push('', b.status === 'blocked' ? 'This slice is blocked: it waits for an answer; do not continue it.' : b.next_step ? `Continue at step ${b.next_step}; tick each step with \`buddy step done <id> <n>\` as you finish it.` : 'Every step is done: run the checkpoint (`buddy checkpoint --slice <id>`).');
  return o.join('\n') + '\n';
}

// Slices in flight, for `buddy resume` without an id.
export function inFlight(repo, now, { index } = {}) {
  return (index ?? readIndex(repo)).changes.filter(s => RESUMABLE.includes(s.data.status)).map(s => {
    const st = s.step_list; return { id: s.data.id, title: s.data.title, status: s.data.status, age: age(s.data.updated ?? s.data.created, now), steps_done: st.filter(x => x.done).length, steps_total: st.length };
  });
}

// Dev's hand-over (R119, R134): the brief written to a file under .buddy/handover/, where what is not worth keeping in the history lives,
// so that Buddy raises Dev with its path and never a paraphrase. Returns the path.
export function writeHandover(repo, id, now) {
  const text = briefText(resumeBrief(repo, id, now)); const dir = ensureBuddyDir(repo, 'handover');
  const file = path.join(dir, `${id}-dev-${new Date(now).toISOString().slice(0, 19).replace(/:/g, '')}Z.md`); fs.writeFileSync(file, text); return path.resolve(file);
}
