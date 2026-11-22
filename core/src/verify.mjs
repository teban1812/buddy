#!/usr/bin/env node
// Verifier for Buddy v0 files. usage: node verify.mjs <dir|file>... [--require-risk-confirmed] [--json]
// Reads every .md file under the given paths, picks the schema from the "schema:" front matter field,
// validates the shape, then checks the rules that a shape cannot express (ids, references, origins, states).
// Exit code 0 = no problems, 1 = problems, 2 = usage. Zero dependencies.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from './frontmatter.mjs';
import { validate } from './jsonschema-lite.mjs';
import { contextStatements, riskLines } from './context.mjs';
import { checkSlice, isCanonical } from './slice.mjs';
import { evidenceSummary } from './evidence.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KINDS = {
  'buddy/context@0': 'context', 'buddy/question-batch@0': 'question', 'buddy/decision@0': 'decision',
  'buddy/slice@1': 'slice', 'buddy/finding@0': 'finding', 'buddy/playbook@0': 'playbook', 'buddy/requests@1': 'requests', 'buddy/prototype@1': 'prototype',
};
const schemas = Object.fromEntries(Object.values(KINDS).map(k => [k, JSON.parse(fs.readFileSync(path.join(HERE, '..', 'schemas', `${k}.schema.json`), 'utf8'))]));

export { contextStatements };

// Marks each slice record of a change folder with the change it belongs to (`change`, `folder: true`): the folder's change.md (R87).
// A record outside a folder keeps the parent named by `epic:`, the flat layout of before R87. docs: [{ file, data }] of schema slice@1.
// A milestone is the milestone.md of its folder (R118): `milestone` marks each change of its changes/ folder, and the slices of those changes,
// with the milestone's name (null in the backlog); `milestoneFolder` says the change sits in a milestone's changes/ folder at all.
export function linkChanges(docs) {
  const base = d => path.basename(d.file);
  const at = new Map(docs.filter(d => base(d) === 'change.md').map(d => [path.dirname(path.resolve(d.file)), d.data.id]));
  const ms = new Map(docs.filter(d => base(d) === 'milestone.md').map(d => [path.dirname(path.resolve(d.file)), d.data.id]));
  for (const d of docs) {
    if (base(d) === 'milestone.md') { Object.assign(d, { change: null, folder: true, milestone: null, milestoneFolder: false }); continue; }
    const c = base(d) === 'change.md' ? undefined : at.get(path.dirname(path.resolve(d.file)));
    Object.assign(d, c ? { change: c, folder: true } : { change: base(d) === 'change.md' ? null : d.data.epic ?? null, folder: base(d) === 'change.md' });
    const home = d.folder ? path.dirname(path.dirname(path.resolve(d.file))) : null;           // the folder that holds the change folder
    const mdir = home && path.basename(home) === 'changes' ? path.dirname(home) : null;
    Object.assign(d, { milestone: mdir ? ms.get(mdir) ?? null : null, milestoneFolder: !!mdir && path.basename(path.dirname(mdir)) === 'milestones' });
  }
  return docs;
}

export function loadFiles(paths) {
  const files = [];
  const walk = p => {
    const st = fs.statSync(p);
    if (st.isDirectory()) for (const e of fs.readdirSync(p).sort()) { if (e === 'node_modules' || e.startsWith('.git')) continue; walk(path.join(p, e)); }
    else if (p.endsWith('.md')) files.push(p);
  };
  paths.forEach(walk);
  return files;
}

const SUMMARY = /^evidence-.*\.summary\.json$/;
const summaryFiles = paths => { const out = []; const walk = p => { if (!fs.existsSync(p)) return; const st = fs.statSync(p); if (st.isDirectory()) { for (const e of fs.readdirSync(p).sort()) { if (e === 'node_modules' || e.startsWith('.git')) continue; walk(path.join(p, e)); } } else if (SUMMARY.test(path.basename(p))) out.push(p); }; paths.forEach(walk); return out; };

export function verify(paths, opts = {}) {
  const problems = []; const docs = [];
  const add = (file, where, message) => problems.push({ file, where, message });
  for (const file of loadFiles(paths)) {
    const text = fs.readFileSync(file, 'utf8');
    const peek = /^---\n(?:[\s\S]*?\n)?schema:\s*(\S+)/.exec(text.replace(/\r\n/g, '\n'));
    if (!peek || !(peek[1] in KINDS)) continue;               // not a Buddy file: ignore
    const doc = parseDocument(text);
    if (doc.error) { add(file, 'front matter', doc.error); continue; }
    const kind = KINDS[doc.data.schema];
    for (const e of validate(schemas[kind], doc.data)) add(file, e.path, e.message);
    if (opts.canonical && kind === 'slice' && !isCanonical(text, doc.data, doc.body)) add(file, 'form', 'not in canonical form: the file differs from what the program would write (change slices with `buddy start|step|move`, not by hand)');
    docs.push({ file, kind, data: doc.data, body: doc.body });
  }
  const byKind = k => docs.filter(d => d.kind === k);
  const ids = new Map();
  const idOf = d => (d.kind === 'playbook' ? d.data.id : d.data.id);
  for (const d of docs) {
    if (d.kind === 'context' || d.kind === 'requests') continue;
    const key = `${d.kind}:${idOf(d)}`;
    if (ids.has(key)) add(d.file, 'id', `duplicate ${d.kind} id ${idOf(d)} (also in ${ids.get(key)})`); else ids.set(key, d.file);
  }
  const has = (kind, id) => ids.has(`${kind}:${id}`);
  const questionIds = new Set(byKind('question').flatMap(d => (d.data.questions || []).map(q => q.id)));
  const questionDup = new Map();
  for (const d of byKind('question')) for (const q of d.data.questions || []) {
    if (questionDup.has(q.id)) add(d.file, `questions.${q.id}`, `duplicate question id (also in ${questionDup.get(q.id)})`); else questionDup.set(q.id, d.file);
  }

  // the screens a change covers must be screens of the manifest, when the manifest is among the files verified
  const manifest = byKind('prototype')[0];
  if (manifest) { const known = new Set(contextStatements(manifest.body).filter(x => x.section === 'Screens').map(x => (/^`([a-z0-9-]+)`/.exec(x.text) || [])[1])); for (const d of byKind('slice')) for (const n of d.data.screens || []) if (!known.has(n)) add(d.file, 'screens', `${n} is not a screen of the prototype's manifest (${manifest.file})`); }
  // the prototype's manifest (R126): its statements carry an origin like the business context's
  for (const d of byKind('prototype')) {
    const st = contextStatements(d.body);
    for (const x of st) {
      if (!x.origin) add(d.file, `line ${x.line}`, `statement has no origin tag (human, assumed or unknown): "${x.text.slice(0, 50)}"`);
      else if (x.origin === 'human' && !x.date) add(d.file, `line ${x.line}`, 'a human-confirmed statement needs the date of the confirmation: `human YYYY-MM-DD`');
    }
    const names = st.filter(x => x.section === 'Screens').map(x => (/^`([a-z0-9-]+)`/.exec(x.text) || [])[1]).filter(Boolean);
    if (names.length !== new Set(names).size) add(d.file, 'Screens', 'two screens have the same name');
  }

  // context
  for (const d of byKind('context')) {
    const st = contextStatements(d.body);
    if (!st.length) add(d.file, 'body', 'no statements found (expected bullets that end with an origin tag)');
    for (const s of st) {
      if (!s.origin) add(d.file, `line ${s.line}`, `statement has no origin tag (human, assumed or unknown): "${s.text.slice(0, 50)}"`);
      else if (s.origin === 'human' && !s.date) add(d.file, `line ${s.line}`, `a human-confirmed statement needs the date of the confirmation: \`human YYYY-MM-DD\``);
    }
    const risk = riskLines(st, d.data);
    if (d.data.risk_section && !risk.length) add(d.file, 'risk_section', `the header names "${d.data.risk_section}" as the risk section, and the context has no section with that heading or the section has no line`);
    else if (opts.requireRiskConfirmed && !d.data.risk_assumed_accepted) {
      if (!risk.length) add(d.file, 'Risk appetite', 'no risk-appetite section');
      for (const s of risk) if (s.origin !== 'human') add(d.file, `line ${s.line}`, `risk-appetite line is ${s.origin ?? 'untagged'}, not human-confirmed: "${s.text.slice(0, 50)}"`);
    }
  }

  // questions
  for (const d of byKind('question')) {
    const b = d.data;
    if (b.status === 'closed' && (b.questions || []).some(q => q.status === 'open')) add(d.file, 'status', 'batch is closed but a question is still open');
    for (const q of b.questions || []) {
      const w = `questions.${q.id}`; const opt = new Set((q.options || []).map(o => o.id));
      if (opt.size !== (q.options || []).length) add(d.file, w, 'option ids are not unique');
      for (const f of ['recommended', 'default']) if (q[f] && !opt.has(q[f])) add(d.file, `${w}.${f}`, `"${q[f]}" is not one of the options`);
      if (!q.blocking && !q.default) add(d.file, w, 'a non-blocking question needs a minimal default (the work proceeds on it)');
      if (q.status === 'open' && q.answer) add(d.file, w, 'an open question has an answer');
      if (q.status === 'answered' || q.status === 'assumed') {
        if (!q.answer) { add(d.file, w, `status ${q.status} but no answer recorded`); continue; }
        if (!q.answer.option && !q.answer.text) add(d.file, `${w}.answer`, 'needs an option or free text');
        if (q.answer.option && !opt.has(q.answer.option)) add(d.file, `${w}.answer.option`, `"${q.answer.option}" is not one of the options`);
      }
      if (q.status === 'answered' && q.answer && !['human', 'delegated'].includes(q.answer.origin)) add(d.file, `${w}.answer.origin`, 'an answered question needs origin human or delegated (an assumed default has status assumed)');
      if (q.status === 'assumed' && q.answer && (q.answer.origin !== 'assumed' || q.answer.by !== 'agent')) add(d.file, `${w}.answer`, 'an assumed default is recorded by the agent with origin assumed');
      if (q.answer?.origin === 'human' && q.answer.by !== 'human') add(d.file, `${w}.answer`, 'origin human requires by human');
    }
    if (b.slice && !has('slice', b.slice)) add(d.file, 'slice', `unknown slice ${b.slice}`);
  }

  // decisions
  const supersededBy = new Map();
  for (const d of byKind('decision')) {
    const x = d.data;
    for (const s of x.supersedes || []) {
      if (!has('decision', s)) add(d.file, 'supersedes', `unknown decision ${s}`);
      if (s === x.id) add(d.file, 'supersedes', 'a decision cannot supersede itself');
      supersededBy.set(s, x.id);
    }
    for (const q of x.questions || []) if (!questionIds.has(q)) add(d.file, 'questions', `unknown question ${q}`);
    if (x.slice && !has('slice', x.slice)) add(d.file, 'slice', `unknown slice ${x.slice}`);
    (x.rules || []).forEach((r, i) => {
      if (['human', 'delegated'].includes(r.origin) && x.decided_by !== 'human') add(d.file, `rules[${i}]`, `origin ${r.origin} requires decided_by human`);
      if (r.origin === 'repo' && !r.confidence) add(d.file, `rules[${i}]`, 'a rule found in the repository needs a confidence tier and a citation');
      if (r.origin === 'repo' && !r.cite) add(d.file, `rules[${i}]`, 'a rule found in the repository needs a citation');
    });
    if (!/^##\s+Decision Outcome\s*\n+\S/m.test(d.body)) add(d.file, 'body', 'missing or empty "## Decision Outcome" section');
  }
  for (const d of byKind('decision')) {
    const st = String(d.data.status); const by = supersededBy.get(d.data.id);   // MADR 4 says "superseded by <id>"; older records say "superseded"
    if (by && !['superseded', `superseded by ${by}`].includes(st)) add(d.file, 'status', `superseded by ${by} but status is ${st}`);
    if (!by && st.startsWith('superseded')) add(d.file, 'status', 'status superseded but no decision supersedes it');
  }
  for (const d of byKind('decision')) {      // cycles
    const seen = new Set(); let cur = d.data.id;
    while (supersededBy.has(cur)) { if (seen.has(cur)) { add(d.file, 'supersedes', 'supersession cycle'); break; } seen.add(cur); cur = supersededBy.get(cur); }
  }

  // slices (buddy/slice@1, docs/design/14 section 3). A record of a change folder belongs to the folder's change.md (R87).
  linkChanges(byKind('slice'));
  checkSlice(byKind('slice'), {
    sliceIds: new Set(byKind('slice').map(d => d.data.id)),
    hasId: has,
    batchQuestions: id => byKind('question').find(x => x.data.id === id)?.data.questions,
    questionsOfSlice: id => byKind('question').filter(x => x.data.slice === id).flatMap(x => x.data.questions || []),
    findingStatus: id => byKind('finding').find(x => x.data.id === id)?.data.status,
  }, add);

  // findings
  for (const d of byKind('finding')) {
    const f = d.data;
    if (!has('slice', f.slice)) add(d.file, 'slice', `unknown slice ${f.slice}`);
    if (f.source === 'program' && !f.evidence) add(d.file, 'evidence', 'a program finding must point to its evidence');
    if (['accepted', 'resolved', 'rejected'].includes(f.status) && !f.disposition) add(d.file, 'disposition', `status ${f.status} needs a disposition (who, when, why)`);
    if (f.status === 'open' && f.disposition) add(d.file, 'disposition', 'an open finding has a disposition');
    if (f.severity === 'needs-human' && f.status === 'accepted' && f.disposition?.by !== 'human') add(d.file, 'disposition', 'a needs-human finding can only be accepted by the human');
    if (f.disposition?.decision && !has('decision', f.disposition.decision)) add(d.file, 'disposition.decision', `unknown decision ${f.disposition.decision}`);
  }

  // the map of what was asked (buddy/requests@1): one per project, docs/buddy/requests.md; every destination names something that exists
  const reqs = byKind('requests');
  for (const d of reqs.slice(1)) add(d.file, 'schema', `there is one map of what was asked per project (also ${reqs[0].file})`);
  for (const d of reqs) {
    if (path.basename(d.file) !== 'requests.md') add(d.file, 'schema', 'the map of what was asked is the file requests.md in docs/buddy/');
    const seen = new Set(); let max = 0;
    for (const it of d.data.items || []) {
      const w = `items.${it.id}`; const n = Number(String(it.id).slice(2)) || 0; max = Math.max(max, n);
      if (seen.has(it.id)) add(d.file, w, 'duplicate id'); seen.add(it.id);
      const dest = it.destination; const extra = f => it[f] !== undefined && it[f] !== null;
      const allowed = { covered: ['to'], excluded: ['to', 'reason'], deferred: ['reason'], waiting: ['question'] }[dest] ?? [];
      for (const f of ['to', 'reason', 'question']) if (extra(f) && !allowed.includes(f)) add(d.file, `${w}.${f}`, dest ? `a request ${dest} has no ${f}` : `a request with no destination has no ${f}`);
      if (dest === 'covered' && !extra('to')) add(d.file, w, 'covered by what: the change or milestone (to) is missing');
      if (dest === 'excluded' && !extra('to') && !extra('reason')) add(d.file, w, 'excluded needs the change or milestone that leaves it out (to) or a reason');
      if (dest === 'excluded' && extra('to') && extra('reason')) add(d.file, w, 'excluded by a change or milestone (to) or for a reason, not both');
      if (dest === 'deferred' && !extra('reason')) add(d.file, w, 'deferred needs its reason');
      if (dest === 'waiting' && !extra('question')) add(d.file, w, 'waiting for which question: the question id is missing');
      if (extra('to') && !has('slice', it.to)) add(d.file, `${w}.to`, `no change or milestone named ${it.to}`);
      if (extra('question') && !questionIds.has(it.question)) add(d.file, `${w}.question`, `unknown question ${it.question}`);
      for (const f of ['priority_origin', 'priority_why']) if (extra(f) && !extra('priority')) add(d.file, `${w}.${f}`, `a request with no priority has no ${f}`);   // R136
      if (extra('priority') && ['prd', 'assumed'].includes(it.priority_origin) && !extra('priority_why')) add(d.file, `${w}.priority_why`, it.priority_origin === 'prd' ? 'a priority from the PRD needs its citation (priority_why)' : 'a priority Buddy proposed needs its reason (priority_why)');
    }
    for (const it of d.data.items || []) for (const x of it.depends_on || []) {   // what it depends on is another item of the map (R132)
      if (x.id === it.id) add(d.file, `items.${it.id}.depends_on`, 'a request does not depend on itself');
      else if (!seen.has(x.id)) add(d.file, `items.${it.id}.depends_on`, `no request ${x.id} in the map`);
    }
    if (d.data.last !== undefined && d.data.last !== null && d.data.last < max) add(d.file, 'last', `last is ${d.data.last} but an item has the id RQ${max}`);
  }

  // playbooks
  for (const d of byKind('playbook')) {
    const p = d.data; const uniq = (arr, what) => { const s = new Set(); for (const x of arr || []) { if (s.has(x.id)) add(d.file, what, `duplicate id ${x.id}`); s.add(x.id); } return s; };
    const roles = uniq(p.roles, 'roles'), arts = uniq(p.artifacts, 'artifacts'), stages = uniq(p.stages, 'stages'), checks = uniq(p.checks, 'checks'), gates = uniq(p.gates, 'gates');
    const classes = new Set((p.checks || []).map(c => c.finding_class).filter(Boolean));
    for (const s of p.stages || []) {
      if (!roles.has(s.role)) add(d.file, `stages.${s.id}.role`, `unknown role ${s.role}`);
      for (const a of s.produces || []) if (!arts.has(a)) add(d.file, `stages.${s.id}.produces`, `unknown artifact ${a}`);
      for (const a of s.reads || []) if (!arts.has(a) && !(p.inputs || []).some(i => i.id === a)) add(d.file, `stages.${s.id}.reads`, `unknown artifact or input ${a}`);
      for (const c of s.checks || []) if (!checks.has(c)) add(d.file, `stages.${s.id}.checks`, `unknown check ${c}`);
      if (s.gate && !gates.has(s.gate)) add(d.file, `stages.${s.id}.gate`, `unknown gate ${s.gate}`);
    }
    for (const a of p.artifacts || []) if (!roles.has(a.owner)) add(d.file, `artifacts.${a.id}.owner`, `unknown role ${a.owner}`);
    for (const g of p.gates || []) for (const t of g.triggers || []) if (!checks.has(t) && !classes.has(t)) add(d.file, `gates.${g.id}.triggers`, `trigger ${t} is neither a check nor a finding class`);
    for (const c of p.checks || []) {
      if (c.kind === 'program' && !c.run) add(d.file, `checks.${c.id}`, 'a program check needs a run command (or a named built-in)');
      const used = (p.stages || []).some(s => (s.checks || []).includes(c.id)); if (!used) add(d.file, `checks.${c.id}`, 'check is never used by a stage');
    }
    for (const r of p.roles || []) if (r.kind === 'reviewer' && r.may_write && r.may_write !== 'nothing') add(d.file, `roles.${r.id}`, 'an independent reviewer may write nothing');
    if (!(p.roles || []).some(r => r.kind === 'human')) add(d.file, 'roles', 'a playbook needs a human role (the navigator)');
    if (!(p.gates || []).length) add(d.file, 'gates', 'a playbook needs at least one gate');
  }
  // The summary a checkpoint writes beside its evidence (R148) must say what the evidence says: one that does not, or has no evidence, is named.
  for (const f of summaryFiles(paths)) {
    const full = f.replace(/\.summary\.json$/, '.json'); let want; let got;
    try { want = evidenceSummary(JSON.parse(fs.readFileSync(full, 'utf8'))); } catch (e) { add(f, 'evidence', fs.existsSync(full) ? `its evidence does not read: ${e.message}` : 'a summary with no evidence beside it'); continue; }
    try { got = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { add(f, 'summary', `does not read: ${e.message}`); continue; }
    if (JSON.stringify(got) !== JSON.stringify(want)) add(f, 'summary', `does not match its evidence ${path.basename(full)}: the checkpoint writes both; write it again from the evidence`);
  }
  return { problems, count: docs.length, kinds: Object.fromEntries(Object.keys(schemas).map(k => [k, byKind(k).length])) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2); const flags = args.filter(a => a.startsWith('--')); const paths = args.filter(a => !a.startsWith('--'));
  if (!paths.length) { console.error('usage: node verify.mjs <dir|file>... [--require-risk-confirmed] [--canonical] [--json]'); process.exit(2); }
  const r = verify(paths, { requireRiskConfirmed: flags.includes('--require-risk-confirmed'), canonical: flags.includes('--canonical') });
  if (flags.includes('--json')) console.log(JSON.stringify(r, null, 1));
  else {
    for (const p of r.problems) console.error(`${p.file}: ${p.where}: ${p.message}`);
    console.log(`${r.count} Buddy file(s) checked, ${r.problems.length} problem(s)`);
  }
  process.exit(r.problems.length ? 1 : 0);
}
