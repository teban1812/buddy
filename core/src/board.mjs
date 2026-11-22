// Radiators R1 (board) and R3 (waiting for you): docs/design/11-information-radiators.md. A radiator is a pure function of
// the files and an injected clock: no model, no network, no system clock inside, stable ordering, no locale.
// board = f(records under docs/, now), the records read once into the index (R138). Reads only; it never writes a record.
import fs from 'node:fs';
import path from 'node:path';
import { buildIndex } from './index.mjs';
import { readContext, riskState, stepRecords, stepWaitingText } from './context.mjs';
import { branchState } from './proc.mjs';
import { workers as workersOf } from './workers.mjs';
import { latestEvidence, pieceExceptions, exceptionsText } from './evidence.mjs';
import { named } from './ids.mjs';
import { decisionTotals, decisionsLine } from './decisions.mjs';
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
export function loadBoard(repo, now, { staleMinutes = 30, index } = {}) {
  const x = index ?? buildIndex(repo); const docs = path.join(repo, 'docs'); const batches = x.batches; const asked = x.requests;
  // Where a branch stands is read from git once per branch, not once per slice: every git call is a process, and on a machine that scans each one it is seconds.
  const seen = new Map(); const stateOf = br => { const k = br ?? ''; if (!seen.has(k)) seen.set(k, branchState(repo, br)); return seen.get(k); };
  const rec = new Map([...x.milestones, ...x.changes].map(r => [r.id, r]));
  const row = r => ({ id: r.id, title: r.title, kind: r.kind, status: r.status, rank: r.rank, change: r.change, milestone: r.milestone, updated: r.updated, branch: r.branch, depends_on: r.depends_on, departures: r.departures, merge: r.status === 'accepted' ? stateOf(r.branch) : null, assurance: r.assurance, steps: { done: r.steps.done, total: r.steps.total } });
  const all = [...x.milestones, ...x.changes].sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id)).map(row);
  // Milestones (R118) are listed apart, each with how many of its changes are accepted; the changes and slices carry their milestone.
  const rows = all.filter(r => r.kind !== 'milestone');
  const milestones = all.filter(r => r.kind === 'milestone').map(({ id, title, status, rank, updated, branch }) => {
    const ch = rows.filter(r => r.milestone === id && !r.change); return { id, title, status, rank, updated, branch, changes: { accepted: ch.filter(r => r.status === 'accepted').length, total: ch.length } };
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
  // The owner accepts features, not pieces (R70, R83): a delivered piece whose latest checkpoint found nothing and that has no departure to
  // decide waits as delivered and asks nothing; one with an exception is listed with it; a change whose pieces are all delivered, accepted or
  // abandoned (one at least delivered) is listed once to try and accept. A change with no pieces is listed as before.
  const parts = new Map(); for (const r of rows) if (r.change) parts.set(r.change, [...(parts.get(r.change) || []), r]);
  const evOf = new Map(x.evidence.map(e => [e.file, e]));
  for (const r of rows) if (r.status === 'delivered') {
    if (r.change) {
      const f = rec.get(r.id).evidence; const exc = pieceExceptions(r, f ? evOf.get(f) : null);
      if (exc.length) waiting.push({ kind: 'accept', text: `look at: ${r.title} [${r.id}], a piece of ${byId.get(r.change)?.title ?? r.change}: ${exceptionsText(exc)}`, ref: r.id, since: r.updated });
    } else if (!parts.has(r.id)) waiting.push({ kind: 'accept', text: `try and accept: ${r.title} [${r.id}]${r.departures ? ` (${r.departures} departure${r.departures === 1 ? '' : 's'} from the prototype to decide)` : ''}`, ref: r.id, since: r.updated });
  }
  for (const [id, ps] of parts) {
    const c = byId.get(id); if (!c || CLOSED.includes(c.status)) continue;
    if (ps.every(p => ['delivered', ...CLOSED].includes(p.status)) && ps.some(p => p.status === 'delivered')) waiting.push({ kind: 'accept', text: `try and accept: ${c.title} [${c.id}]`, ref: c.id, since: ps.map(p => p.updated).sort().pop() });
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
    waiting.push({ kind: 'merge', text: `merge branch ${br} into ${stateOf(br).trunk}: ${own.length} slice(s) accepted`, ref: br, since: own.map(r => r.updated).sort().pop() });
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
  return { now, current, next, milestones, slices: rows, waiting, view: groupWaiting(waiting, rows, milestones), requests, decisions };
}

// Several acceptances of one milestone are one line (R164): how many wait, since when, and the one way to see and answer them (the review of the
// milestone; acceptance stays per change). A change that needs a decision of the owner, not only an acceptance (an exception or a departure
// from the prototype), is named on its own under its milestone, so a group line never hides it. Questions, costly exceptions, priorities,
// dependencies and warnings are not acceptances and keep their own lines. Only the text view groups; `waiting` keeps every item.
export function groupWaiting(waiting, rows, milestones) {
  const byId = new Map(rows.map(r => [r.id, r])); const mil = id => (id ? milestones.find(m => m.id === id) : null);
  const isAccept = w => w.kind === 'accept' && byId.has(w.ref);
  const clean = w => isAccept(w) && w.text.startsWith('try and accept:') && !/ from the prototype to decide\)$/.test(w.text);
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
export const nowLine = b => `Now: ${(b.current || []).map(currentText).join(' | ') || 'nothing is being built'}`;
// Next even when it waits, saying for what (R144): "Sort books [sort-books] · waits for Save books [save-books]"; else its state. A milestone
// whose turn has come waits for the owner (R147): "milestone Version 2 [v2] · waits for your go-ahead".
// The next piece of a change built in pieces names its change (R156): "Sort books [sort-books], a piece of Reading list [reading-list] · ready".
export const nextText = b => (!b.next ? 'nothing queued' : b.next.kind === 'milestone' ? `milestone ${b.next.title} [${b.next.id}] · waits for your go-ahead` : `${b.next.title} [${b.next.id}]${b.next.change ? `, a piece of ${b.next.change.title} [${b.next.change.id}]` : ''} · ${b.next.waits_for?.length ? `waits for ${b.next.waits_for.map(o => `${o.title} [${o.id}]`).join(', ')}` : b.next.status}`);
export const nextLine = b => `Next: ${nextText(b)}`;

export { latestEvidence, pieceExceptions, exceptionsText };
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
      out.push('', `MILESTONE  ${m.id}  ${m.title}  · ${m.status} · ${m.changes.accepted} of ${m.changes.total} change(s) accepted`);
      const rs = b.slices.filter(r => r.milestone === m.id); if (rs.length) states(rs, '  '); else out.push('  (no changes yet)');
    }
    const rest = b.slices.filter(r => !r.milestone); out.push('', `BACKLOG  ${rest.filter(r => !r.change).length} change(s) of no milestone`); states(rest, '  ');
  }
  if (!b.slices.length && !ms.length) out.push('', '(no slices)');
  return out.join('\n') + '\n';
}

// The groups of the page: one per milestone, then the backlog; one group without a heading when there is no milestone (R118).
const groups = b => !(b.milestones || []).length ? [{ head: null, slices: b.slices }]
  : [...b.milestones.map(m => ({ head: `Milestone: ${m.title} · ${m.status} · ${m.changes.accepted} of ${m.changes.total} change(s) accepted`, slices: b.slices.filter(r => r.milestone === m.id) })), { head: 'Backlog: changes of no milestone', slices: b.slices.filter(r => !r.milestone) }];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export function boardHtml(b) {
  const title = id => b.slices.find(x => x.id === id)?.title;
  const col = (st, slices) => { const rs = slices.filter(r => r.status === st); return `<section class="col ${st === 'blocked' ? 'blocked' : ''}"><h2>${st} <span class="k">${rs.length}</span></h2>${rs.map(r => `<div class="card"><b>${esc(titleText(r))}</b><p class="k">${esc(r.id)} · ${esc(r.kind)}${r.change ? ` · ${esc(title(r.change) ?? r.change)}` : ''}${r.steps.total ? ` · ${r.steps.done}/${r.steps.total} steps` : ''}${r.assurance ? ` · ${esc([ASSURANCE[r.assurance], mergeText(r.merge)].filter(Boolean).join(' · '))}` : ''} · ${age(r.updated, b.now)}</p>${waitsText(r) ? `<p class="k w">${esc(waitsText(r))}</p>` : ''}</div>`).join('') || '<p class="k">—</p>'}</section>`; };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Buddy board</title><style>
:root{--bg:#fafaf7;--fg:#1d1d1b;--mut:#6b6b66;--card:#fff;--line:#e3e2dc;--warn:#b25e00}
@media (prefers-color-scheme:dark){:root{--bg:#161614;--fg:#ecebe6;--mut:#9a9992;--card:#1f1f1c;--line:#34332e;--warn:#e5a04a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}main{max-width:1100px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:var(--mut);margin:0 0 8px}.k{color:var(--mut);font-size:13px;margin:2px 0 0}
.now{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px 16px;margin:12px 0 0}.now ul,.now p{margin:0 0 8px}
.wait{background:var(--card);border:1px solid var(--warn);border-radius:10px;padding:8px 16px;margin:12px 0 20px}.wait li{margin:4px 0}
.group{font-size:15px;letter-spacing:0;text-transform:none;color:var(--fg);margin:24px 0 10px}.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}.col{min-width:0}.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px 12px;margin:0 0 8px}.blocked .card{border-color:var(--warn)}.w{color:var(--warn)}
</style></head><body><main><h1>Board</h1><p class="k">${esc(b.now.slice(0, 16).replace('T', ' '))} UTC · generated from the records, nothing here is narrated by the agent</p>
<div class="now"><h2>Now</h2>${(b.current || []).length ? `<ul>${b.current.map(c => `<li>${esc(currentText(c))}</li>`).join('')}</ul>` : '<p>nothing is being built</p>'}<h2>Next</h2><p>${esc(nextText(b))}</p></div>
${b.waiting.length ? `<div class="wait"><h2>Waiting for you (${b.waiting.length})</h2><ul>${b.waiting.map(w => `<li>${esc(waitLine(w, b.now))}</li>`).join('')}</ul></div>` : '<div class="wait"><h2>Nothing is waiting for you</h2></div>'}${b.requests ? `<p class="k">${esc(requestTotalsText(b.requests))}</p>` : ''}${b.decisions ? `<p class="k">${esc(decisionsLine(b.decisions))}</p>` : ''}
${groups(b).map(g => `${g.head ? `<h2 class="group">${esc(g.head)}</h2>` : ''}<div class="cols">${STATES.map(st => col(st, g.slices)).join('')}</div>`).join('\n')}</main></body></html>
`;
}
