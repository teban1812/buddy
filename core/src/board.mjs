// Radiators R1 (board) and R3 (waiting for you): docs/design/11-information-radiators.md. A radiator is a pure function of
// the files and an injected clock: no model, no network, no system clock inside, stable ordering, no locale.
// board = f(records under docs/, now), the records read once into the index (R138). Reads only; it never writes a record.
import fs from 'node:fs';
import path from 'node:path';
import { buildIndex, refreshIndex } from './index.mjs';
import { BUDDY_LOCAL } from './gitdir.mjs';
import { readContext, riskState, stepRecords, stepWaitingText } from './context.mjs';
import { branchState } from './proc.mjs';
import { workers as workersOf } from './workers.mjs';
import { latestEvidence, pieceExceptions, openNotes, ESCALATED } from './evidence.mjs';
import { named } from './ids.mjs';
import { decisionTotals, decisionsLine } from './decisions.mjs';
import { boardMeasures } from './digest.mjs';
import { span } from './minutes.mjs';
import { prototypeFiles, manifestProblems } from './prototype.mjs';
import { requestTotals, requestTotalsText, requestNobodyText, proposedPriorities, proposedPrioritiesText, proposedDependenciesText, requestOrder, orderWarningsText } from './requests.mjs';

export const STATES = ['refining', 'ready', 'building', 'blocked', 'delivered', 'rework', 'accepted', 'abandoned'];
const CLOSED = ['accepted', 'abandoned'];
export const mergeText = m => (m ? { merged: `merged into ${m.trunk}`, pending: `waiting to merge into ${m.trunk}`, unknown: 'branch not found here' }[m.state] ?? null : null);
const ASSURANCE = { recorded: 'accepted, recorded only', signed: 'accepted, signed', host: 'accepted, approved on the host' };

export function age(since, now) {                      // whole units, no locale: "<1 h", "5 h", "2 d"
  const h = Math.floor((Date.parse(now) - Date.parse(since)) / 3600000);
  return h < 1 ? '<1 h' : h < 48 ? `${h} h` : `${Math.floor(h / 24)} d`;
}

// Short, fine-grained ages for the pulse: "<1 min", "5 min", "3 h", "2 d".
export function ago(since, now) {
  const m = Math.floor((Date.parse(now) - Date.parse(since)) / 60000);
  return m < 1 ? '<1 min' : m < 60 ? `${m} min` : m < 48 * 60 ? `${Math.floor(m / 60)} h` : `${Math.floor(m / 1440)} d`;
}

// `staleMinutes`: how long a Dev may be silent before the board calls it stalled (R2). A starting point to measure in the dogfooding, not a measured value.
// `index`: the records as buildIndex read them (R138); without one it is built here.
// Discovering the product (R261): while nothing is being built, the stage the owner is in, read from docs/discovery/ and docs/inputs/prototype/ only (no record).
// A docs/discovery/ holding only ux-audit.md (and screenshots beside it) is a handed-over prototype audited without discovery, so it shows no stage.
// Stage 1: docs/discovery exists, no flows.md or wireframes/ yet. Stage 2: flows.md or wireframes/ exist, no prototype. Stage 3: a prototype exists whose manifest is not confirmed. Else none.
export const STAGES = ['research and brief', 'flows and wireframes', 'prototype and its test'];
export function discoveryStage(repo) {
  const d = path.join(repo, 'docs', 'discovery'); if (!fs.existsSync(d)) return null;
  const entries = fs.readdirSync(d).filter(n => !n.startsWith('.'));
  if (entries.length && entries.every(n => n === 'ux-audit.md' || /\.(png|jpe?g|webp|gif)$/i.test(n))) return null;
  if (prototypeFiles(repo).length) { const m = manifestProblems(repo); return m.exists && !m.unconfirmed.length && !m.problems.length ? null : 3; }
  return fs.existsSync(path.join(d, 'flows.md')) || fs.existsSync(path.join(d, 'wireframes')) ? 2 : 1;
}

export function loadBoard(repo, now, { staleMinutes = 30, index } = {}) {
  const x = index ?? buildIndex(repo); const docs = path.join(repo, 'docs'); const batches = x.batches; const asked = x.requests;
  // Where a branch stands is read from git once per branch, not once per slice: every git call is a process, and on a machine that scans each one it is seconds.
  const seen = new Map(); const stateOf = br => { const k = br ?? ''; if (!seen.has(k)) seen.set(k, branchState(repo, br)); return seen.get(k); };
  const rec = new Map([...x.milestones, ...x.changes].map(r => [r.id, r]));
  const row = r => ({ id: r.id, title: r.title, kind: r.kind, status: r.status, rank: r.rank, change: r.change, milestone: r.milestone, updated: r.updated, branch: r.branch, depends_on: r.depends_on, departures: r.departures, merge: r.status === 'accepted' ? stateOf(r.branch) : null, assurance: r.assurance, request: r.request, steps: { done: r.steps.done, total: r.steps.total }, screens: r.data.screens || [], howto: r.data.howto || [] });
  const all = [...x.milestones, ...x.changes].sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id)).map(row);
  // Milestones (R118) are listed apart, each with how many of its changes are accepted and how many are in each group of its page's bar (R285: the panels draw
  // the same groups from here, so the panel, the page and this board never disagree); the changes and slices carry their milestone.
  const rows = all.filter(r => r.kind !== 'milestone');
  const milestones = all.filter(r => r.kind === 'milestone').map(r => { const { id, title, status, rank, updated, branch } = r;
    const ch = rows.filter(r => r.milestone === id && !r.change); return { id, title, request: r.request, status, rank, updated, branch, changes: { accepted: ch.filter(r => r.status === 'accepted').length, total: ch.length }, groups: groupCounts(rows, ch) };
  });
  // The pulse: for every slice being built, the Dev registered for it and when it was last seen (the worker registry, R60). Silence is shown, not hidden.
  const reg = workersOf(repo, { now: () => new Date(now) });
  for (const r of rows.filter(x => x.status === 'building')) {
    const dev = reg.filter(w => w.slice === r.id && w.role === 'dev' && w.status === 'running').sort((a, b) => a.last_seen.localeCompare(b.last_seen)).pop();
    r.pulse = dev ? { dev: dev.id, last_seen: dev.last_seen, ago: ago(dev.last_seen, now), stale: (Date.parse(now) - Date.parse(dev.last_seen)) / 60000 > staleMinutes } : { dev: null };
  }
  const byId = new Map(rows.map(r => [r.id, r]));
  // Each change's priority and what it waits for (R133) are read in the index.
  for (const r of rows) { const i = rec.get(r.id); Object.assign(r, { priority: i.priority, waits_for: i.waits_for, abandoned_deps: i.abandoned_deps }); }
  // Now and Next (design/17 §3) are read in the index, computed there once (R144).
  const current = x.now; const next = x.next;
  const waiting = [];
  // The owner accepts features, not pieces (R70, R83, R249): a piece never waits on its own. A change whose pieces are all delivered, accepted or
  // abandoned (one at least delivered) is listed once to try and accept, with how many notes the reviews left on its pieces and the departures from
  // the prototype to decide; their text is in the summary to accept, never here. A change with no pieces is listed as before. Only what stops the
  // work (a piece still being built whose latest checkpoint went to a third round with findings open) is listed apart, as a decision; a delivered one got through.
  const parts = new Map(); for (const r of rows) if (r.change) parts.set(r.change, [...(parts.get(r.change) || []), r]);
  const evOf = new Map(x.evidence.map(e => [e.file, e]));
  const latest = r => { const f = rec.get(r.id).evidence; return f ? evOf.get(f) : null; };
  const stuck = new Map(); for (const r of rows) if (!['delivered', ...CLOSED].includes(r.status) && latest(r)?.reasons?.some(t => t.includes(ESCALATED))) { const t = byId.get(r.change) ?? r; stuck.set(t.id, t); }
  for (const t of stuck.values()) waiting.push({ kind: 'accept', text: `decide: ${t.title} [${t.id}]: the work stopped after several reviews and needs your decision`, ref: t.id, since: t.updated });
  const tail = (departures, notes) => { const t = [departures ? `${departures} departure${departures === 1 ? '' : 's'} from the prototype to decide` : null, notes ? `the reviews left ${notes} note${notes === 1 ? '' : 's'}` : null].filter(Boolean).join('; '); return t ? ` (${t})` : ''; };
  for (const r of rows) if (r.status === 'delivered' && !r.change && !parts.has(r.id)) waiting.push({ kind: 'accept', text: `try and accept: ${r.title} [${r.id}]${tail(r.departures, 0)}`, ref: r.id, since: r.updated });
  for (const [id, ps] of parts) {
    const c = byId.get(id); if (!c || CLOSED.includes(c.status)) continue;
    if (ps.every(p => ['delivered', ...CLOSED].includes(p.status)) && ps.some(p => p.status === 'delivered')) {
      const notes = ps.filter(p => p.status === 'delivered').reduce((n, p) => n + openNotes(latest(p), rec.get(p.id).data).length, 0);
      waiting.push({ kind: 'accept', text: `try and accept: ${c.title} [${c.id}]${tail(ps.reduce((n, p) => n + (p.departures || 0), c.departures || 0), notes)}`, ref: c.id, since: ps.map(p => p.updated).sort().pop() });
    }
  }
  for (const m of milestones) if (m.status === 'delivered') waiting.push({ kind: 'accept', text: `accept the milestone: ${m.title} [${m.id}]`, ref: m.id, since: m.updated });
  for (const b of batches.slice().sort((x, y) => x.id.localeCompare(y.id))) {
    const owner = byId.get(b.slice) ?? milestones.find(m => m.id === b.slice) ?? rows.find(r => rec.get(r.id).batches.includes(b.id));
    if (owner && CLOSED.includes(owner.status)) continue;
    for (const q of b.questions || []) if (q.status === 'open' && q.blocking) waiting.push({ kind: 'answer', text: `answer: ${named(q.situation, q.id)}${owner ? ` (for ${owner.title} [${owner.id}])` : ''}`, ref: q.id, since: owner?.updated ?? null });
  }
  // A branch is ready to merge when it exists, is not merged into main, and every slice that names it is accepted or abandoned (R28, R62: accepting is per slice, merging is per branch).
  for (const br of [...new Set(rows.filter(r => r.branch).map(r => r.branch))].sort()) {
    const own = rows.filter(r => r.branch === br && r.status !== 'abandoned');
    if (!own.length || own.some(r => r.status !== 'accepted') || stateOf(br).state !== 'pending') continue;
    waiting.push({ kind: 'merge', text: `merge branch ${br} into ${stateOf(br).trunk}: ${own.length} ${own.length === 1 ? 'slice' : 'slices'} accepted`, ref: br, since: own.map(r => r.updated).sort().pop() });
  }
  // The map of what was asked (design/17 §3a): what has nobody waits for the owner; an item covered by an abandoned change has nobody again.
  // A Must with nobody is its own line, before the others (R132); then the priorities Buddy proposed that wait for the owner (R136).
  const requests = requestTotals(asked, new Map(all.map(r => [r.id, r.status])));
  if (requests?.must.length) waiting.push({ kind: 'must', text: requestNobodyText(requests, { must: true }), ref: null, since: null });
  const nProposed = proposedPriorities(asked); if (nProposed) waiting.push({ kind: 'proposed', text: proposedPrioritiesText(nProposed), ref: null, since: null });
  // then the dependencies Buddy proposed that wait for the owner, as the index counted them (R148)
  const nDeps = x.proposed_dependencies ?? 0; if (nDeps) waiting.push({ kind: 'dependencies', text: proposedDependenciesText(nDeps), ref: null, since: null });
  const items = asked || []; const warned = orderWarningsText(items, requestOrder(items).warnings); if (warned) waiting.push({ kind: 'order', text: warned, ref: null, since: null });
  if (requests?.nobody.length) waiting.push({ kind: 'request', text: requestNobodyText(requests), ref: null, since: null });
  const nAssumed = batches.reduce((n, b) => n + (b.questions || []).filter(q => q.status === 'assumed').length + (b.assumed_defaults || []).filter(d => d.status === 'assumed').length, 0);
  if (nAssumed) waiting.push({ kind: 'assumed', text: `${nAssumed} assumed default(s) not confirmed`, ref: null, since: null });
  const ctx = path.join(docs, 'context.md');
  if (fs.existsSync(ctx)) { try { const rs = riskState(readContext(ctx)); if (!['confirmed', 'accepted-assumed'].includes(rs.state)) waiting.push({ kind: 'risk', text: `risk appetite: ${rs.message}`, ref: null, since: null }); } catch { /* an unreadable context is verify's finding, not the board's */ } }
  // the lines of the records of the profile's steps the owner has not confirmed (run-profile-steps): development waits for them
  for (const r of stepRecords(repo)) waiting.push({ kind: 'step', text: stepWaitingText(r), ref: r.record, since: null });
  const order = { accept: 0, merge: 1, answer: 2, step: 3, must: 4, proposed: 5, dependencies: 6, order: 7, request: 8, risk: 9, assumed: 10 };
  waiting.sort((a, b) => order[a.kind] - order[b.kind] || String(a.ref).localeCompare(String(b.ref)));
  // The decisions of a log that says what is built (Buddy's own repository, R110): how many are decided and how many are not built yet.
  const decisions = x.decisions.some(d => d.built) ? decisionTotals(x.decisions) : null;
  const discovery = current.length || milestones.some(m => m.status === 'building') ? null : discoveryStage(repo);
  return { now, current, discovery, next, milestones, slices: rows, waiting, view: groupWaiting(waiting, rows, milestones), requests, decisions };
}

// Several acceptances of one milestone are one line (R164): how many wait, since when, and the one way to see and answer them (the review of the
// milestone; acceptance stays per change). A change that needs a decision of the owner, not only an acceptance (an exception or a departure
// from the prototype), is named on its own under its milestone, so a group line never hides it. Questions, costly exceptions, priorities,
// dependencies and warnings are not acceptances and keep their own lines. Only the text view groups; `waiting` keeps every item.
export function groupWaiting(waiting, rows, milestones) {
  const byId = new Map(rows.map(r => [r.id, r])); const mil = id => (id ? milestones.find(m => m.id === id) : null);
  const isAccept = w => w.kind === 'accept' && byId.has(w.ref);
  const clean = w => isAccept(w) && w.text.startsWith('try and accept:') && !/ from the prototype to decide/.test(w.text);
  const key = w => byId.get(w.ref).milestone ?? null;
  const tally = new Map(); for (const w of waiting) if (clean(w)) tally.set(key(w), [...(tally.get(key(w)) || []), w]);
  const grouped = new Set([...tally].filter(([, ws]) => ws.length > 1).map(([k]) => k)); const seen = new Set(); const view = [];
  for (const w of waiting) {
    if (!isAccept(w) || !grouped.has(key(w))) { view.push(w); continue; }
    const k = key(w); if (seen.has(k)) continue; seen.add(k);
    const ws = tally.get(k); const m = mil(k); const oldest = ws.map(x => x.since).filter(Boolean).sort()[0] ?? null;
    const own = waiting.filter(x => isAccept(x) && key(x) === k && !clean(x));
    view.push({ kind: 'accept', ref: k, since: oldest, under: own, text: m
      ? `${m.title} [${m.id}]: ${ws.length} changes wait for your acceptance (see each and answer: buddy milestone review ${m.id})`
      : `Outside any milestone: ${ws.length} changes wait for your acceptance (see them: buddy slice list, then buddy slice accept-card <change>)` });
  }
  return view;
}

// "Save books [save-books] · step 2 of 5: Screen" and "Export the list [export-the-list] · ready": the title with its id beside it (R78).
export const currentText = c => `${c.title} [${c.id}]${c.step ? ` · step ${c.step.n} of ${c.step.total}: ${c.step.text}` : ''}`;
export const discText = (n, name = STAGES[n - 1]) => `Discovering the product: stage ${n} of 3 (${name})`;
export const nowLine = b => `Now: ${(b.current || []).map(currentText).join(' | ') || (b.discovery ? discText(b.discovery) : 'nothing is being built')}`;
// Next even when it waits, saying for what (R144): "Sort books [sort-books] · waits for Save books [save-books]"; else its state. A milestone
// whose turn has come waits for the owner (R147): "milestone Version 2 [v2] · waits for your go-ahead".
// The next piece of a change built in pieces names its change (R156): "Sort books [sort-books], a piece of Reading list [reading-list] · ready".
export const nextText = b => (!b.next ? 'nothing queued' : b.next.kind === 'milestone' ? `milestone ${b.next.title} [${b.next.id}] · waits for your go-ahead` : `${b.next.title} [${b.next.id}]${b.next.change ? `, a piece of ${b.next.change.title} [${b.next.change.id}]` : ''} · ${b.next.waits_for?.length ? `waits for ${b.next.waits_for.map(o => `${o.title} [${o.id}]`).join(', ')}` : b.next.status}`);
export const nextLine = b => `Next: ${nextText(b)}`;

export { latestEvidence, pieceExceptions };
export const pulseText = p => (!p ? null : p.dev ? (p.stale ? `STALLED? Dev ${p.dev} last seen ${p.ago} ago` : `Dev ${p.dev} seen ${p.ago} ago`) : 'no Dev registered');
const waitLine = (w, now) => (w.since ? `${w.text}  · ${age(w.since, now)}` : w.text);
// The priority before the title, "[Must] Save books"; what it waits for, each change by its title with its id beside it (R78).
export const titleText = r => (r.priority ? `[${r.priority[0].toUpperCase()}${r.priority.slice(1)}] ${r.title}` : r.title);
export const waitsText = r => [r.waits_for?.length ? `waits for: ${r.waits_for.map(o => `${o.title} [${o.id}]`).join(', ')}` : null,
  ...(r.abandoned_deps || []).map(o => `its dependency ${o.title} [${o.id}] was abandoned`)].filter(Boolean).join(' · ') || null;

export function boardText(b) {
  const cur = b.current || [];
  const out = [`BOARD  ${b.now.slice(0, 16).replace('T', ' ')} UTC`, '', ...(cur.length > 1 ? [`Now (${cur.length})`, ...cur.map(c => `  - ${currentText(c)}`)] : [nowLine(b)]), nextLine(b), '', (b.view ?? b.waiting).length ? `Waiting for you (${(b.view ?? b.waiting).length})` : 'Nothing is waiting for you.'];
  for (const w of b.view ?? b.waiting) { out.push(`  - ${waitLine(w, b.now)}`); for (const u of w.under || []) out.push(`      - ${waitLine(u, b.now)}`); }
  if (b.requests) out.push('', requestTotalsText(b.requests));
  if (b.decisions) out.push('', decisionsLine(b.decisions));
  const title = id => b.slices.find(x => x.id === id)?.title;
  const states = (slices, pad) => {
    for (const st of STATES) {
      const rs = slices.filter(r => r.status === st); if (!rs.length) continue;
      out.push('', `${pad}${st} (${rs.length})`);
      if (st === 'accepted') { for (const r of rs) out.push(`${pad}  ${r.id}  ${titleText(r)}  · ${[ASSURANCE[r.assurance], mergeText(r.merge)].filter(Boolean).join(' · ')}`); continue; }
      if (CLOSED.includes(st)) { out.push(`${pad}  ${rs.map(r => `${r.title} [${r.id}]`).join(', ')}`); continue; }
      for (const r of rs) out.push(`${pad}  ${r.id}  ${r.kind.padEnd(8)} ${[titleText(r), r.change ? `<${named(title(r.change), r.change)}>` : null, r.steps.total ? `[${r.steps.done}/${r.steps.total}]` : null, waitsText(r), `· ${age(r.updated, b.now)}`, pulseText(r.pulse)].filter(Boolean).join('  ')}`);
    }
  };
  // With milestones the board groups the changes under their milestone, then the backlog (R118); without one, the backlog is all there is.
  const ms = b.milestones || [];
  if (!ms.length) states(b.slices, '');
  else {
    for (const m of ms) {
      out.push('', `MILESTONE  ${m.id}  ${m.title}  · ${m.status} · ${m.changes.accepted} of ${m.changes.total} change(s) accepted${m.groups && m.groups.done < m.changes.total ? ` (${groupsText(m.groups)})` : ''}`);
      const rs = b.slices.filter(r => r.milestone === m.id); if (rs.length) states(rs, '  '); else out.push('  (no changes yet)');
    }
    const rest = b.slices.filter(r => !r.milestone); out.push('', `BACKLOG  ${rest.filter(r => !r.change).length} change(s) of no milestone`); states(rest, '  ');
  }
  if (!b.slices.length && !ms.length) out.push('', '(no slices)');
  return out.join('\n') + '\n';
}

// The page (live-board, AC3, AC8, AC12, AC14-AC16, AC18, AC19-AC21). Its own words are in one table, Spanish and English, both written into the page and
// switched by one script; with no script English shows. The titles and texts of the records are shown as written (A4), escaped and marked with their language.
// A text with a count says its plural in the table: {0?one|many} picks by the count in {0}.
const W = {
  title: ['Board', 'Tablero de Buddy'], gen: ['generated from the records, nothing here is narrated by the agent', 'generado desde los registros; nada aquí lo cuenta el agente'],
  waiting: ['Waiting for you ({0})', 'Espera por ti ({0})'], nothing: ['Nothing is waiting for you', 'Nada espera por ti'],
  now: ['Now', 'Ahora'], idle: ['nothing is being built', 'nadie está construyendo'], d1: ['Discovering the product: stage 1 of 3 (research and brief)', 'Descubriendo el producto: etapa 1 de 3 (investigación y brief)'], d2: ['Discovering the product: stage 2 of 3 (flows and wireframes)', 'Descubriendo el producto: etapa 2 de 3 (flujos y wireframes)'], d3: ['Discovering the product: stage 3 of 3 (prototype and its test)', 'Descubriendo el producto: etapa 3 de 3 (prototipo y su prueba)'], step: ['step {0} of {1}: {2}', 'paso {0} de {1}: {2}'],
  next: ['Next', 'Sigue'], queued: ['nothing queued', 'nada en cola'], nextMs: ['milestone {0} [{1}] · waits for your go-ahead', 'hito {0} [{1}] · espera tu visto bueno'],
  waitsFor: ['waits for: {0}', 'espera a: {0}'], waitsNext: ['waits for {0}', 'espera a {0}'], aband: ['its dependency {0} was abandoned', 'su dependencia {0} fue descartada'], pieceOf: ['a piece of {0}', 'una pieza de {0}'],
  overall: ['Progress by milestone', 'Avance por hito'], pct: ['accepted: {0} of {1} changes in the milestones', 'aceptados: {0} de {1} cambios en los hitos'],
  outside: ['outside the percentage', 'fuera del porcentaje'], chg: ['{0?change|changes}', '{0?cambio|cambios}'], state: ['State', 'Estado'],
  ms: ['Milestone', 'Hito'], accH: ['Accepted', 'Aceptados'], loose: ['Changes of no milestone', 'Cambios sin hito'], progress: ['Progress', 'Avance'],
  acc: ['{0} of {1} accepted', '{0} de {1} aceptados'], none: ['Nothing yet.', 'Nada por ahora.'], steps: ['{0} of {1} steps', '{0} de {1} pasos'], tasks: ['{0} of {1} tasks', '{0} de {1} tareas'], pieceNow: ['piece {0} of {1}', 'pieza {0} de {1}'], pcsBar: ['{0} of {1} delivered · {2} accepted', '{0} de {1} entregadas · {2} aceptadas'],
  pcsFold: ['See the {0} pieces', 'Ver las {0} piezas'], pieceWait: ['Delivered, waits for the rest', 'Entregada, espera al resto'],
  tag: ['building now', 'en construcción ahora'], stalled: ['STALLED? Dev last seen {0} ago', '¿ATASCADA? Dev visto hace {0}'],
  needOwner: ['Your turn: try and accept {0} {0?change|changes}.', 'Te toca probar y aceptar {0} {0?cambio|cambios}.'], needGo: ['Needs your go-ahead to start.', 'Necesita tu visto bueno para empezar.'],
  needAccept: ['Needs you to accept the milestone.', 'Necesita que aceptes el hito.'], needNone: ['Nothing from you for now.', 'Nada de ti por ahora.'],
  refining: ['Being defined', 'Por definir'], ready: ['Ready to start', 'Lista para empezar'], building: ['Being built', 'En construcción'], blocked: ['Blocked', 'Bloqueada'],
  rework: ['In rework', 'En retrabajo'], delivered: ['Ready for you to try', 'Para que la pruebes'], accepted: ['Accepted', 'Aceptada'], abandoned: ['Abandoned', 'Descartada'],
  m_refining: ['Not started', 'Sin empezar'], m_ready: ['Waiting for your go-ahead', 'Esperando tu visto bueno'], m_building: ['Being built', 'En construcción'],
  m_delivered: ['Waiting for your acceptance', 'Esperando tu aceptación'], m_accepted: ['Done', 'Hecho'],
  g_owner: ['Your turn', 'Te toca a ti'], g_agent: ['In progress', 'En marcha'], g_define: ['To define', 'Por definir'], g_done: ['Done', 'Hecho'],
  h_owner: ['Try them and accept, or say what is wrong.', 'Pruébalas y acéptalas, o di qué está mal.'], h_agent: ['Buddy and Dev are working on these.', 'Buddy y Dev trabajan en estas.'],
  h_define: ['Refined with you before they are built.', 'Se refinan contigo antes de construirse.'],
  recorded: ['accepted, recorded only', 'aceptada, solo registrada'], signed: ['accepted, signed', 'aceptada, firmada'], host: ['accepted, approved on the host', 'aceptada, aprobada en el host'],
  asked: ['you were asked {0} {0?time|times}; it waited for you {1}', 'te preguntó {0} {0?vez|veces}; te esperó {1}'], stagesT: ['Average time a change spent in each stage:', 'Tiempo medio de un cambio en cada etapa:'],
  procT: ['How the process is going', 'Cómo va el proceso'], procFor: ['Milestone in progress: {0}', 'Hito en curso: {0}'],
  mixT: ['Work mix, last {0} days ({1} lines)', 'Mezcla de trabajo, últimos {0} días ({1} líneas)'], routesT: ['Routes used, last {0} days', 'Rutas usadas, últimos {0} días'],
  mx_product: ['product', 'producto'], mx_tests: ['tests', 'pruebas'], mx_records: ['Buddy records', 'registros de Buddy'], mx_evidence: ['evidence', 'evidencia'], mx_process: ['process', 'proceso'],
  rt_feat: ['feature', 'funcionalidad'], rt_fix: ['fix', 'corrección'], rt_chore: ['chore', 'tarea'], rt_refactor: ['refactor', 'refactor'], rt_docs: ['docs', 'documentación'], rt_quick_fix: ['quick fix', 'arreglo rápido'],
  pcsBlocked: ['{0} blocked', '{0} bloqueadas'], pcsLeft: ['{0} abandoned, not counted', '{0} descartadas, no cuentan'],
  pathT: ['Path to the release', 'Camino hasta la entrega'], today: ['Today', 'Hoy'], youAct: ['You act', 'Actúas tú'], builtIn: ['Built in it', 'Se construye'], andMore: ['and {0} more', 'y {0} más'],
  todayN: ['{0} {0?thing waits|things wait} for you, in the box above', '{0} {0?cosa espera|cosas esperan} por ti, en el recuadro de arriba'],
  nothingNow: ['Nothing from you for now.', 'Nada de ti por ahora.'], pGo: ['Give the go-ahead to start it', 'Da el visto bueno para empezarlo'], pTry: ['Try and accept {0} {0?change|changes}', 'Prueba y acepta {0} {0?cambio|cambios}'],
  pAcc: ['Accept the milestone', 'Acepta el hito'], pNoCh: ['No changes defined yet', 'Aún sin cambios definidos'],
  lookT: ['Since you last looked', 'Desde la última vez que miraste'], lookSince: ['counting from {0}', 'contando desde {0}'], lkNone: ['Nothing changed.', 'Nada cambió.'],
  lk_delivered: ['Delivered: {0}', 'Entregado: {0}'], lk_accepted: ['Accepted: {0}', 'Aceptado: {0}'], lk_started: ['Started: {0}', 'Empezado: {0}'],
  ownT: ['Your test', 'Tu prueba'], ownH: ['What you try and accept for this group.', 'Lo que pruebas y aceptas de este grupo.'],
  ownHow: ['How to try it ({0})', 'Cómo probarlo ({0})'], ownNone: ['No way to try it has been written.', 'Aún no se escribió cómo probarlo.'], expect: ['See', 'Verás'],
  pause: ['Pause updates', 'Pausar actualización'], resume: ['Resume updates', 'Reanudar actualización'], hold: ['Not updating while you read', 'Sin actualizar mientras lees'],
  merged: ['merged into {0}', 'integrada en {0}'], pending: ['waiting to merge into {0}', 'esperando integrarse en {0}'], unknown: ['branch not found here', 'rama no encontrada aquí'],
};
// What waits for you is composed in English by the program; the common lines are put into Spanish here, any other keeps its English words.
const n1 = (n, one, many) => (n === '1' ? one : many);
export const ES = [[/^try and accept: /, 'prueba y acepta: '], [/^decide: /, 'decide: '], [/^accept the milestone: /, 'acepta el hito: '], [/^answer: /, 'responde: '],
  [/: the work stopped after several reviews and needs your decision$/, ': el trabajo se detuvo tras varias revisiones y necesita tu decisión'],
  [/^merge branch (.+) into (.+): (\d+) slices? accepted$/, (_, br, tr, n) => `integra la rama ${br} en ${tr}: ${n} ${n1(n, 'cambio aceptado', 'cambios aceptados')}`],
  [/: (\d+) changes wait for your acceptance \(see each and answer: /, ': $1 cambios esperan tu aceptación (míralos y responde: '],
  [/^Outside any milestone: (\d+) changes wait for your acceptance \(see them: /, 'Sin hito: $1 cambios esperan tu aceptación (míralos: '],
  [/(\d+) departures? from the prototype to decide/, (_, n) => `${n} ${n1(n, 'desviación', 'desviaciones')} del prototipo por decidir`],
  [/the reviews left (\d+) notes?/, (_, n) => `las revisiones dejaron ${n} ${n1(n, 'nota', 'notas')}`],
  [/^risk appetite: /, 'apetito de riesgo: '],
  [/(\d+) risk-appetite line\(s\) not confirmed by the owner and not accepted as assumed$/, (_, n) => `${n} ${n1(n, 'línea sin confirmar por el dueño ni aceptada como supuesta', 'líneas sin confirmar por el dueño ni aceptadas como supuestas')}`],
  [/the "([^"]+)" section has no line yet$/, 'la sección "$1" aún no tiene líneas'],
  [/the context has no "([^"]+)" section$/, 'el contexto no tiene sección "$1"'],
  [/the context names "([^"]+)" as its risk section \(risk_section in its header\), and (the section has no line yet|it has no section with that heading)$/, (_, name, why) => `el contexto nombra "${name}" como su sección de riesgo (risk_section en su encabezado), y ${why.startsWith('the') ? 'la sección aún no tiene líneas' : 'no tiene ninguna sección con ese título'}`],
  [/^(\d+)( Must)? of what you asked for (?:has|have) no destination yet: /, (_, n, m) => `${n}${m || ''} de lo que pediste aún no ${n1(n, 'tiene', 'tienen')} destino: `],
  [/ \| and (\d+) more\b/, ' | y $1 más']];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// The language of the records' own text (A4): the titles and texts of the records are shown as they were written, and marked, so that a page in the other language reads them right.
const RECORD_LANG = 'en';
const rec = s => `<span lang="${RECORD_LANG}">${esc(s)}</span>`;
class Safe { constructor(h) { this.h = h; } }
const recA = s => new Safe(rec(s));
// One text in both languages; the arguments are escaped here (a Safe one is already html), and a plural {0?one|many} is picked by its count. A text of the records goes in as an argument, never as a key.
const fill = (t, a) => t.replace(/\{(\d)\?([^|}]*)\|([^}]*)\}/g, (_, n, one, many) => (Number(a[n]) === 1 ? one : many)).replace(/\{(\d)\}/g, (_, n) => (a[n] instanceof Safe ? a[n].h : esc(a[n])));
const tx = (k, ...a) => W[k].map((t, i) => `<span data-l="${i ? 'es' : 'en'}">${fill(t, a)}</span>`).join('');
const both = (en, es) => `<span data-l="en">${esc(en)}</span><span data-l="es">${esc(es)}</span>`;
const GROUP = { refining: 'define', ready: 'agent', building: 'agent', blocked: 'agent', rework: 'agent', delivered: 'owner', accepted: 'done', abandoned: 'done' };
const GROUPS = ['owner', 'agent', 'define', 'done']; export const BARS = ['done', 'owner', 'agent', 'define'];   // the bars read left to right: done first, then your turn, then in progress, then to define
// How many of `list` (a milestone's changes) are in each group of the bar, by what each change is in (its pieces' state): the page's bar, `buddy board` and the panels (R285).
export const groupCounts = (rows, list) => Object.fromEntries(BARS.map(g => [g, list.filter(r => (GROUP[effState(rows, r)] ?? 'agent') === g).length]));
export const groupsText = g => BARS.filter(k => g[k]).map(k => `${g[k]} ${W['g_' + k][0].toLowerCase()}`).join(' · ');
// Every text meets 4.5:1 and every part of a bar 3:1 against what is behind it, in light and in dark (live-board AC16, the audit's S2, S3); the ink on the owner's colour is dark in dark mode.
const style = `:root{--bg:#f7f7f5;--card:#fff;--ink:#1d1d1f;--mute:#6b6b70;--line:#e4e4e0;--owner:#9a5100;--on-owner:#fff;--owner-bg:#fff4e5;--agent:#2461c4;--agent-bg:#eaf1fd;--define:#85858d;--define-bg:#eeeeec;--done:#23744a;--done-bg:#e8f5ee;--blocked:#c0392b}
@media (prefers-color-scheme:dark){:root{--bg:#151517;--card:#1f1f22;--ink:#ececef;--mute:#9a9aa2;--line:#323236;--owner:#ffa940;--on-owner:#151517;--owner-bg:#3a2a12;--agent:#6ea2ff;--agent-bg:#17263f;--define:#9a9aa2;--define-bg:#2a2a2e;--done:#5cc98a;--done-bg:#15301f;--blocked:#ff7b6b}}
html[lang=en] [data-l=es],html[lang=es] [data-l=en]{display:none}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 system-ui,sans-serif;overflow-wrap:anywhere}main{max-width:980px;margin:0 auto;padding:20px 16px 56px}
h1{font-size:22px;margin:0}h2,h3{margin:0}.top{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap}.sub,.k,.meta,.help,.empty{color:var(--mute);font-size:13px}.sub{margin:2px 0 16px}.k{margin:8px 0 0}
.ctl{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.lang{display:flex;gap:4px}.lang button,.pause{font:inherit;font-size:12px;min-height:24px;min-width:34px;padding:3px 10px;border:1px solid var(--line);border-radius:999px;background:var(--card);color:var(--ink);cursor:pointer;white-space:nowrap;overflow-wrap:normal}.lang button[aria-pressed=true]{background:var(--ink);color:var(--bg)}
.pause[data-state=run] [data-s=paused],.pause[data-state=paused] [data-s=run]{display:none}.hold{font-size:12px;color:var(--mute)}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(260px,100%),1fr));gap:12px;margin-bottom:16px}.box,.ms,.fold{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin-bottom:12px}.tiles .box{margin:0}
.box h2{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--mute);margin-bottom:6px}.box ul{margin:0;padding-left:18px}.box li{margin:3px 0}.box p{margin:0}
.box.owner{border-color:var(--owner);background:var(--owner-bg)}.box.owner h2{color:var(--owner)}.box.agent{border-color:var(--agent)}.box.agent h2{color:var(--agent)}
.seg{display:block;flex:1 1 0;height:12px;background:var(--define-bg);border-radius:3px;overflow:hidden}.seg i{display:block;height:100%;background:var(--done)}.bars{display:flex;gap:3px;margin:8px 0}
.vh{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}.nw{white-space:nowrap}
.legend{display:flex;gap:4px 14px;flex-wrap:wrap;font-size:12px;color:var(--mute)}
.ms header{display:flex;justify-content:space-between;gap:8px 12px;flex-wrap:wrap;align-items:flex-start}.ms h2{font-size:18px}.ms .kick{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--mute)}
.need{margin:0;font-size:13px;padding:3px 10px;border-radius:999px;background:var(--define-bg)}.need.owner{background:var(--owner-bg);color:var(--owner);font-weight:600}
.bar{display:flex;height:12px;border-radius:6px;overflow:hidden;margin:12px 0 6px;background:var(--define-bg)}.bar span{display:block}
.s-done,.dot.done{background:var(--done)}.s-owner,.dot.owner{background:var(--owner)}.s-agent,.dot.agent{background:var(--agent)}.s-define,.dot.define{background:var(--define)}.s-wait{background:var(--mute)}.dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:5px}
.groups{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(260px,100%),1fr));gap:12px;margin-top:14px;align-items:start}
.group{border-radius:10px;padding:10px 12px;background:var(--bg);border-left:4px solid var(--line)}.group.owner{background:var(--owner-bg);border-color:var(--owner)}.group.agent{border-color:var(--agent)}.group.define{border-color:var(--define)}.group.done{border-color:var(--done);grid-column:1/-1}
.group h3{font-size:14px;display:inline}.help{margin:2px 0 6px}
summary{cursor:pointer}summary.meta{display:list-item;margin-left:18px;color:var(--ink);text-decoration:underline}.fold>summary,.group.done>summary{display:list-item;margin-left:18px}ul.l{list-style:none;margin:8px 0 0;padding:0;display:grid;gap:6px}.fold ul.l,.group.done ul.l{grid-template-columns:repeat(auto-fit,minmax(min(260px,100%),1fr))}
.item{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:7px 10px}.item.now{box-shadow:0 0 0 2px var(--agent)}.row{display:flex;gap:4px 8px;flex-wrap:wrap;align-items:center;margin-top:3px}.wl{margin:3px 0 0;font-size:12px;color:var(--mute)}
.chip{font-size:11px;padding:1px 8px;border-radius:999px;font-weight:600}.chip.owner{background:var(--owner);color:var(--on-owner)}.chip.agent{background:var(--agent-bg);color:var(--agent)}.chip.define{background:var(--define-bg);color:var(--mute)}.chip.done{background:var(--done-bg);color:var(--done)}.meta.now{color:var(--agent);font-weight:600}
.mt{width:100%;border-collapse:collapse;margin-top:8px}.mt td,.mt th{padding:6px 6px 6px 0;border-top:1px solid var(--line);vertical-align:middle;font-size:14px;text-align:left}.mt th{font-size:12px;font-weight:600;color:var(--mute);border-top:0}.mt .bc{width:64px}.mt .n{text-align:right;white-space:nowrap}.mt .name{font-weight:600;overflow-wrap:normal}@media (max-width:420px){.mt .bc,.mt th:nth-child(3){display:none}}.mt .seg{flex:none;position:relative}.ms header>div{min-width:0;flex:1 1 260px}.ms header>.need{max-width:100%}.goal{margin:2px 0;font-size:14px}.pb{margin:6px 0 0}.pb .seg{margin-top:3px}
.bar.small{height:6px;margin:6px 0}.s-blocked{background:var(--blocked)}.own{margin-top:10px;border:1px solid var(--owner);background:var(--owner-bg);border-radius:8px;padding:8px 10px}.own h4{margin:0;font-size:13px;color:var(--owner)}.own ul,.own ol{margin:4px 0 0;padding-left:18px}.own li{margin:4px 0}.own p{margin:2px 0}
ol.path{list-style:none;margin:8px 0 0;padding:0;display:grid;gap:6px}ol.path>li{display:flex;gap:10px;padding:8px 10px;border-left:4px solid var(--line);border-radius:8px;background:var(--bg)}ol.path>li.owner{border-color:var(--owner);background:var(--owner-bg)}ol.path ul{margin:2px 0;padding-left:18px}ol.path p{margin:2px 0}ol.path>li>div{min-width:0;flex:1}.no{flex:none;width:22px;height:22px;border-radius:50%;background:var(--define-bg);text-align:center;font-weight:700;font-size:12px;line-height:22px}.owner>.no{background:var(--owner);color:var(--on-owner)}
.mix{display:flex;gap:4px 16px;flex-wrap:wrap;margin:0 0 6px}.item .meta{display:block;margin-top:3px}.item .row .meta{display:inline}.item summary.meta{display:list-item}`;
// The language and the time in the viewer's zone; then the reload: every 10 s, never while text is selected or a control (but the two top buttons) has focus, paused when the viewer says so
// (remembered like the language), with the open folds, the scroll and the focus put back after it.
const script = `(function(){var h=document.documentElement,L,T=document.querySelectorAll('time[datetime]');try{L=localStorage.getItem('buddy-lang')}catch(e){}if(L!=='es'&&L!=='en')L=/^es/i.test(navigator.language||'')?'es':'en';
function set(l){h.lang=l;document.title=h.getAttribute('data-title-'+l);var b=document.querySelectorAll('.lang button');for(var i=0;i<b.length;i++)b[i].setAttribute('aria-pressed',String(b[i].getAttribute('data-set')===l));
for(i=0;i<T.length;i++){var d=new Date(T[i].getAttribute('datetime'));if(!isNaN(d))try{T[i].textContent=d.toLocaleString(l,{dateStyle:'medium',timeStyle:'short'})}catch(e){}}}
var g=document.querySelector('.lang');g.hidden=false;g.addEventListener('click',function(e){var l=e.target.getAttribute('data-set');if(!l)return;set(l);try{localStorage.setItem('buddy-lang',l)}catch(x){}});set(L)})();
(function(){var K='buddy-place',P='buddy-pause',D=document.querySelectorAll('details'),F='a[href],button,summary,input,select,textarea,[tabindex]',B=document.querySelector('.pause'),H=document.querySelector('.hold'),off=false;try{off=localStorage.getItem(P)==='1'}catch(e){}
function save(){try{var o=[],a=document.activeElement;for(var i=0;i<D.length;i++)if(D[i].open)o.push(i);sessionStorage.setItem(K,JSON.stringify({o:o,x:scrollX,y:scrollY,f:a&&a!==document.body?[].indexOf.call(document.querySelectorAll(F),a):-1}))}catch(e){}}
try{var p=JSON.parse(sessionStorage.getItem(K)||'null');if(p){for(var i=0;i<D.length;i++)D[i].open=p.o.indexOf(i)>=0;scrollTo(p.x,p.y);var f=p.f>=0&&document.querySelectorAll(F)[p.f];if(f)f.focus({preventScroll:true})}}catch(e){}
function show(){B.setAttribute('data-state',off?'paused':'run')}B.hidden=false;show();B.addEventListener('click',function(){off=!off;try{localStorage.setItem(P,off?'1':'0')}catch(e){}H.hidden=true;show()});
addEventListener('pagehide',save);
setInterval(function(){H.hidden=true;if(off||document.hidden)return;var a=document.activeElement,s=getSelection();if((s&&String(s))||(a&&a!==document.body&&!a.closest('.ctl'))){H.hidden=false;return}save();location.reload()},10000)})();`;

// What a change is in, taken from its pieces: being built while any piece is, your turn only when all are delivered (or accepted), else its own state.
export function effState(rows, r) {
  const ps = rows.filter(p => p.change === r.id && p.status !== 'abandoned'); const has = (...s) => ps.some(p => s.includes(p.status)); if (!ps.length) return r.status;
  if (has('building', 'rework')) return 'building'; if (has('blocked')) return 'blocked';
  if (ps.every(p => ['delivered', 'accepted'].includes(p.status))) return has('delivered') ? 'delivered' : 'accepted'; return has('delivered', 'accepted') ? 'building' : r.status;
}

export function boardHtml(b, m) {
  // The measures (live-board AC7, AC10) come from `boardMeasures`; without them the page has no look-back and no process fold. Minutes and days read the same in both languages.
  const ownerMs = id => (m?.minutes.milestones || []).find(x => x.id === id);
  const top = b.slices.filter(r => !r.change); const byId = new Map(b.slices.map(r => [r.id, r]));
  const ttl = new Map([...b.slices, ...(b.milestones || [])].map(r => [`${r.title} [${r.id}]`, r.title]));
  const waitsEn = r => (r.waits_for?.length ? [tx('waitsFor', new Safe(r.waits_for.map(o => rec(o.title)).join(', ')))] : []).concat((r.abandoned_deps || []).map(o => tx('aband', recA(o.title))));   // titles only: no ids on a card (AC21)
  const mergeTx = m => (m && ['merged', 'pending', 'unknown'].includes(m.state) ? tx(m.state, m.trunk) : '');   // another state (none) says nothing: it was reading the word "Nothing yet" (the audit's m7)
  // a title in a line of what waits for you is marked with the records' language, wherever it stands in the line
  const marked = h => [...ttl].reduce((s, [k, t]) => s.split(esc(k)).join(`${rec(t)} [${esc(k.slice(t.length + 2, -1))}]`), h);
  const waitHtml = w => { const t = ES.reduce((s, [re, to]) => s.replace(re, to), w.text); const sfx = w.since ? `  · ${age(w.since, b.now)}` : ''; return `<li>${marked(both(w.text + sfx, t + sfx))}${w.under?.length ? `<ul>${w.under.map(waitHtml).join('')}</ul>` : ''}</li>`; };
  const view = b.view ?? b.waiting;
  const stepOf = c => (c.step ? tx('step', c.step.n, c.step.total, recA(c.step.text)) : '');
  const nextHtml = !b.next ? tx('queued') : b.next.kind === 'milestone' ? tx('nextMs', recA(b.next.title), b.next.id)
    : `${rec(b.next.title)} [${esc(b.next.id)}]${b.next.change ? `, ${tx('pieceOf', recA(`${b.next.change.title} [${b.next.change.id}]`))}` : ''} · ${b.next.waits_for?.length ? tx('waitsNext', recA(b.next.waits_for.map(o => `${o.title} [${o.id}]`).join(', '))) : tx(b.next.status in W ? b.next.status : 'ready')}`;
  const tiles = `<div class="tiles"><section class="box ${view.length ? 'owner' : ''}"><h2>${view.length ? tx('waiting', view.length) : tx('nothing')}</h2>${view.length ? `<ul>${view.map(waitHtml).join('')}</ul>` : ''}</section>
<section class="box agent"><h2>${tx('now')}</h2>${(b.current || []).length ? `<ul>${b.current.map(c => `<li>${rec(c.title)} [${esc(c.id)}]${c.step ? ` · ${stepOf(c)}` : ''}</li>`).join('')}</ul>` : `<p>${b.discovery ? tx('d' + b.discovery) : tx('idle')}</p>`}<h2 style="margin-top:10px">${tx('next')}</h2><p>${nextHtml}</p></section></div>`;
  // What changed since the owner last looked (AC20): from the digest's own reading of his last look, in his words; nothing when he never marked one.
  const lk = m?.looked; const shownLk = (lk?.items || []).slice(0, 8);
  const lookHtml = !lk ? '' : `<section class="box"><h2>${tx('lookT')}</h2><p class="meta">${tx('lookSince', new Safe(`<time datetime="${esc(lk.since)}">${esc(lk.since.slice(0, 16).replace('T', ' '))} UTC</time>`))}</p>${shownLk.length ? `<ul>${shownLk.map(i => `<li>${tx('lk_' + i.kind, recA(i.title))}</li>`).join('')}${lk.items.length > 8 ? `<li class="meta">${tx('andMore', lk.items.length - 8)}</li>` : ''}</ul>` : `<p>${tx('lkNone')}</p>`}</section>`;
  // The overall bar (AC18): each milestone as wide as its changes, filled by those accepted; the changes of no milestone apart, outside the percentage.
  const ms = b.milestones || []; const sum = k => ms.reduce((n, m) => n + m.changes[k], 0); const loose = top.filter(r => !r.milestone);
  const mstate = m => tx(W['m_' + m.status] ? 'm_' + m.status : m.status in W ? m.status : 'm_refining');
  const pct = sum('total') ? Math.round(100 * sum('accepted') / sum('total')) : 0; const fill_ = (n, t, label = '') => `<span class="seg"><i style="width:${t ? Math.round(100 * n / t) : 0}%"></i>${label ? `<span class="vh">${label}</span>` : ''}</span>`;
  const th = k => `<th scope="col">${tx(k)}</th>`;
  const overall = ms.length ? `<section class="box"><h2>${tx('overall')}</h2><p><b>${pct}%</b> <span class="meta">${tx('pct', sum('accepted'), sum('total'))}</span></p>
<table class="mt"><thead><tr>${th('ms')}${th('state')}${th('progress')}${th('accH')}</tr></thead><tbody>${ms.map(m => `<tr><td class="name">${rec(m.title)}</td><td>${mstate(m)}</td><td class="bc">${fill_(m.changes.accepted, m.changes.total, tx('acc', m.changes.accepted, m.changes.total))}</td><td class="n">${tx('acc', m.changes.accepted, m.changes.total)}</td></tr>`).join('')}
<tr><td class="name">${tx('loose')}</td><td>${tx('outside')}</td><td class="bc"></td><td class="n"><b>${loose.length}</b> ${tx('chg', loose.length)}</td></tr></tbody></table></section>` : '';
  const chip = (g, k) => `<span class="chip ${g}">${tx(k)}</span>`;
  const kids = id => b.slices.filter(p => p.change === id);
  const eff = r => effState(b.slices, r);
  const pchip = p => (p.status === 'delivered' ? chip('define', 'pieceWait') : chip(GROUP[p.status] ?? 'agent', p.status));
  const tasks = p => (p.steps.total ? `<span class="meta">${tx('tasks', p.steps.done, p.steps.total)}</span>` : '');
  const pieceBlock = ps => { const lv = ps.filter(p => p.status !== 'abandoned'); const n = lv.length; const gone = ps.length - n;   // an abandoned piece is out of the total (R246's review); a blocked one is shown as such
    const cnt = (...s) => lv.filter(p => s.includes(p.status)).length; const acc = cnt('accepted'); const del = cnt('delivered'); const blk = cnt('blocked'); const run = cnt('building', 'rework');
    const seg = [['done', acc], ['wait', del], ['agent', run], ['blocked', blk], ['define', n - acc - del - run - blk]].filter(([, k]) => k);
    const i = lv.findIndex(p => ['building', 'rework'].includes(p.status)); const p = lv[i];
    return (n ? `<div class="pb"><span class="meta">${tx('pcsBar', acc + del, n, acc)}${blk ? ' · ' + tx('pcsBlocked', blk) : ''}${gone ? ' · ' + tx('pcsLeft', gone) : ''}</span><div class="bar small" aria-hidden="true">${seg.map(([g, k]) => `<span class="s-${g}" style="flex:${k}"></span>`).join('')}</div></div>` : '')
      + (p ? `<div class="pb"><span class="meta now">${tx('now')}: ${tx('pieceNow', i + 1, n)} — ${rec(p.title)}</span>${p.steps.total ? `<br>${tasks(p)}${fill_(p.steps.done, p.steps.total)}` : ''}</div>` : '')
      + `<details class="pcs"><summary class="meta">${tx('pcsFold', ps.length)}</summary><ul class="l">${ps.map((q, j) => `<li class="item ${q.status === 'delivered' ? 'define' : GROUP[q.status] ?? 'agent'}"><b>${j + 1}. ${rec(q.title)}</b><div class="row">${pchip(q)}${tasks(q)}</div></li>`).join('')}</ul></details>`; };
  // A change's card: its title, its state, its tasks or its pieces, and what it waits for; nothing meant for developers (AC21).
  const item = r => { const st = eff(r); const g = GROUP[st] ?? 'agent'; const now = (b.current || []).some(c => c.id === r.id); const ps = kids(r.id);
    const acc = r.assurance ? `<span class="meta">${tx(r.assurance)}${mergeTx(r.merge) ? ' · ' + mergeTx(r.merge) : ''}</span>` : '';
    return `<li class="item ${g}${now ? ' now' : ''}"><b>${rec(titleText(r))}</b><div class="row">${chip(g, st)}${!ps.length && r.steps.total ? `<span class="meta">${tx('steps', r.steps.done, r.steps.total)}</span>` : ''}${now ? `<span class="meta now">${tx('tag')}</span>` : ''}${acc}${r.pulse?.stale ? `<span class="meta now">${tx('stalled', r.pulse.ago)}</span>` : ''}</div>${ps.length ? pieceBlock(ps) : ''}${waitsEn(r).length ? `<p class="wl">${waitsEn(r).join(' · ')}</p>` : ''}</li>`; };
  const of = (list, g) => list.filter(r => (GROUP[eff(r)] ?? 'agent') === g);
  const bar = list => { const n_ = groupCounts(b.slices, list); const seg = BARS.map(g => [g, n_[g]]).filter(([, n]) => n);
    return `<div class="bar" aria-hidden="true">${seg.map(([g, n]) => `<span class="s-${g}" style="flex:${n}"></span>`).join('')}</div><div class="legend">${seg.map(([g, n]) => `<span><i class="dot ${g}"></i>${n} ${tx('g_' + g).toLowerCase()}</span>`).join('')}</div>`; };
  // My own test (AC9): only in the group waiting for me, what I try and accept for each change, from the ways to try its criteria (its pieces' too).
  const ownTest = rs => { const ls = rs.filter(r => r.status !== 'abandoned'); if (!ls.length) return '';
    const ways = r => [...(r.howto || []), ...kids(r.id).flatMap(p => p.howto || [])];
    const one = r => { const w = ways(r); return `<li><b>${rec(r.title)}</b>${w.length ? `<details><summary class="meta">${tx('ownHow', w.length)}</summary><ol>${w.map(h => `<li>${rec(h.steps)} <i>${tx('expect')}: ${rec(h.expect)}</i></li>`).join('')}</ol></details>` : `<p class="meta">${tx('ownNone')}</p>`}</li>`; };
    return `<div class="own"><h4>${tx('ownT')}</h4><p class="help">${tx('ownH')}</p><ul>${ls.map(one).join('')}</ul></div>`; };
  // The path from today to the release (AC2): only with two or more milestones still ahead; "Today" points at what waits for me without repeating it, then each milestone not accepted, in order,
  // with what is built in it; the steps where I act (give the go-ahead, try and accept) are in my colour.
  const lives = ms.filter(m => m.status !== 'accepted');
  const pathStep = (n, owner, head, body) => `<li class="${owner ? 'owner' : ''}"><span class="no">${n}</span><div><b>${head}</b>${owner ? ` ${chip('owner', 'youAct')}` : ''}${body}</div></li>`;
  const pathHtml = lives.length < 2 ? '' : `<section class="box"><h2>${tx('pathT')}</h2><ol class="path">${[
    pathStep(1, view.length > 0, tx('today'), `<p class="meta">${view.length ? tx('todayN', view.length) : tx('nothingNow')}</p>`),
    ...lives.map((m, k) => { const list = top.filter(r => r.milestone === m.id && r.status !== 'abandoned' && r.status !== 'accepted'); const mine = of(list, 'owner').length;
      const acts = [m.status === 'ready' ? tx('pGo') : null, mine ? tx('pTry', mine) : null, m.status === 'delivered' ? tx('pAcc') : null].filter(Boolean);
      const built = list.slice(0, 4).map(r => `<li>${rec(r.title)}</li>`).join('') + (list.length > 4 ? `<li class="meta">${tx('andMore', list.length - 4)}</li>` : '');
      return pathStep(k + 2, acts.length > 0, `${rec(m.title)} <span class="meta">${mstate(m)}</span>`, `${acts.length ? `<ul class="act">${acts.map(a => `<li>${a}</li>`).join('')}</ul>` : ''}<p class="meta">${tx('builtIn')}:</p>${list.length ? `<ul>${built}</ul>` : `<p class="meta">${tx('pNoCh')}</p>`}`); })].join('')}</ol></section>`;
  const card = (m, open) => { const list = top.filter(r => r.milestone === m.id); const mine = of(list, 'owner').length;
    const need = mine ? tx('needOwner', mine) : m.status === 'ready' ? tx('needGo') : m.status === 'delivered' ? tx('needAccept') : tx('needNone');
    const groups = !open ? '' : `<div class="groups">${GROUPS.map(g => { const rs = of(list, g); if (!rs.length && g !== 'owner') return '';
      const body = (rs.length ? `<ul class="l">${rs.map(item).join('')}</ul>` : `<p class="empty">${tx('none')}</p>`) + (g === 'owner' ? ownTest(rs) : '');
      return g === 'done' ? `<details class="group done"><summary><h3>${tx('g_done')} <span class="meta">${rs.length}</span></h3></summary>${body}</details>`
        : `<section class="group ${g}"><h3>${tx('g_' + g)} <span class="meta">${rs.length}</span></h3><p class="help">${tx('h_' + g)}</p>${body}</section>`; }).join('')}</div>`;
    return `<article class="ms"><header><div><p class="kick">${tx('ms')}</p><h2>${rec(m.title)}</h2>${m.request ? `<p class="goal">${rec(m.request)}</p>` : ''}<p class="meta">${mstate(m)} · ${tx('acc', m.changes.accepted, m.changes.total)}</p></div><p class="need ${mine ? 'owner' : ''}">${need}</p></header>${bar(list)}${groups}</article>`; };
  const live = ms.filter(m => m.status !== 'accepted'); const current = live.find(m => ['building', 'delivered'].includes(m.status)) ?? live[0];
  const looseHtml = !ms.length ? `<ul class="l">${top.map(item).join('')}</ul>` : loose.length ? `<details class="fold"><summary><b>${tx('loose')}</b> <span class="meta">${loose.length}</span></summary><ul class="l">${loose.map(item).join('')}</ul></details>` : '';
  // How the process is going (AC10), folded at the end: for the milestone in progress the average time a change spent in each stage, how many times it asked me and how long it waited, then the work mix and the routes.
  const chs = current ? top.filter(r => r.milestone === current.id) : top;
  const avg = ['refining', 'ready', 'building', 'delivered'].map(k => { const v = chs.map(r => m?.stages?.[r.id]?.[k] || 0).filter(n => n > 0); return v.length ? [k, Math.round(v.reduce((a, c) => a + c, 0) / v.length)] : null; }).filter(Boolean);
  const mixOk = m?.work_mix?.total || Object.keys(m?.routes || {}).length; const asks = current && ownerMs(current.id)?.asked ? ownerMs(current.id) : null;
  const procHtml = !m || !(avg.length || asks || mixOk) ? '' : `<details class="fold"><summary><b>${tx('procT')}</b></summary>${current ? `<p class="meta">${tx('procFor', recA(current.title))}</p>` : ''}${avg.length ? `<p class="meta">${tx('stagesT')} ${avg.map(([k, n]) => `${tx(k)} <span class="nw">${span(n)}</span>`).join(' · ')}</p>` : ''}${asks ? `<p class="meta">${tx('asked', asks.asked, span(asks.waited_minutes))}</p>` : ''}${m.work_mix?.total ? `<h3 class="meta">${tx('mixT', m.work_mix.days, m.work_mix.total)}</h3><p class="mix">${['product', 'tests', 'records', 'evidence', 'process'].map(k => `<span><b>${m.work_mix.share[k]}%</b> ${tx('mx_' + k)}</span>`).join('')}</p>` : ''}${Object.keys(m.routes || {}).length ? `<p class="meta">${tx('routesT', m.work_mix.days)}: ${Object.entries(m.routes).filter(([, n]) => n > 0).map(([k, n]) => `${W['rt_' + k] ? tx('rt_' + k) : esc(k)} ${n}`).join(' · ')}</p>` : ''}</details>`;
  return `<!doctype html><html lang="en" data-title-en="Buddy board" data-title-es="Tablero de Buddy"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Buddy board</title><style>
${style}
</style></head><body><main><div class="top"><div><h1>${tx('title')}</h1><p class="sub"><time datetime="${esc(b.now)}">${esc(b.now.slice(0, 16).replace('T', ' '))} UTC</time> · ${tx('gen')}</p></div><div class="ctl"><span class="hold" role="status" hidden>${tx('hold')}</span><button type="button" class="pause" data-state="run" hidden><span data-s="run">${tx('pause')}</span><span data-s="paused">${tx('resume')}</span></button><div class="lang" hidden role="group" aria-label="Language / Idioma"><button type="button" data-set="en" aria-pressed="true">EN</button><button type="button" data-set="es" aria-pressed="false">ES</button></div></div></div>
${tiles}
${lookHtml}${pathHtml}
${overall}
${live.map(m => card(m, m === current)).join('\n')}
${looseHtml}${procHtml}</main><script>${script}</script></body></html>
`;
}

// The page of the open board, kept current (A1, A2 of live-board): a command that wrote a record calls this, and the page `.buddy/board.html` is rewritten
// only when it already exists (the owner asked for it once with `buddy board --out .buddy/board.html`). It never makes the command fail: a page that cannot be written stays as it was.
export function refreshBoardPage(repo) {
  try {
    const f = path.join(repo, BUDDY_LOCAL, 'board.html'); if (!fs.existsSync(f)) return false;
    const index = refreshIndex(repo).index; const b = loadBoard(repo, new Date().toISOString().slice(0, 19) + 'Z', { index });
    fs.writeFileSync(f, boardHtml(b, boardMeasures(repo, b, index))); return true;
  } catch { return false; }
}
