// The map of what was asked (buddy/requests@1): one per project, docs/buddy/requests.md. Every requirement of the inputs (a line of the PRD,
// a screen of the prototype) is an item with an id (RQ1, RQ2...), its text, where it comes from, and its destination: covered by a change or
// milestone, excluded (by a change or milestone, or for a reason), deferred with its reason, or waiting for a question; an item with no
// destination has nobody yet, and the board and the digest count it. Nothing the owner asked for is lost in silence (design/17 §3a).
// An item may carry its priority (MoSCoW: must, should, could; Won't is what is excluded or deferred, never stored) and what it depends on
// (`depends_on`, each assumed by Buddy or the owner's word); `requestOrder` reads the order of the work from them (R132). A priority has its
// origin (R136): `prd` (stated by the PRD, `priority_why` its citation), `assumed` (proposed by Buddy, `priority_why` its reason, until the owner
// confirms or changes it) or `human` (the owner's word, never overwritten by Buddy); one with no origin was set before R136 and is the owner's.
// Ids never renumber and a removed id is never given again (`last`). Every write is verified and rolled back if the file would not verify.
import fs from 'node:fs';
import path from 'node:path';
import { parseDocument } from './frontmatter.mjs';
import { dumpDocument } from './yaml.mjs';
import { commitAll, listSlices, listMilestones } from './slicestore.mjs';
import { named } from './ids.mjs';

export const REQUESTS = 'docs/buddy/requests.md';
const stamp = now => now().toISOString().slice(0, 19) + 'Z';
const RQ = /^RQ[1-9]\d*$/;
export const DESTINATIONS = ['covered', 'excluded', 'deferred', 'waiting'];
export const PRIORITIES = ['must', 'should', 'could'];
export const ORIGINS = ['prd', 'assumed', 'human'];
const wont = it => ['excluded', 'deferred'].includes(it.destination);
// The priority in words: "Must", "Should", "Could"; "Won't" for what is excluded or deferred, whatever was marked; null when none.
export const priorityText = it => (wont(it) ? "Won't" : it.priority ? it.priority[0].toUpperCase() + it.priority.slice(1) : null);
export const priorityOrigin = it => (it.priority ? it.priority_origin ?? 'human' : null);
// The priority with its origin for `list` and the view: "Must · proposed", "Must · PRD", "Must" for the owner's; Won't carries no origin.
const priorityLabel = it => { const p = priorityText(it); const o = { prd: ' · PRD', assumed: ' · proposed' }[priorityOrigin(it)]; return p && p !== "Won't" && o ? p + o : p; };
// The priority, its origin and its why in one line, for `requests why` (AC3): "RQ1 Must, proposed by Buddy: the PRD calls it the core flow".
export function priorityWhyText(it) {
  if (!it.priority) return `${it.id} has no priority${wont(it) ? ` (read as Won't while ${destinationText(it)})` : ''}`;
  const by = { prd: 'from the PRD', assumed: 'proposed by Buddy', human: 'yours' }[priorityOrigin(it)];
  return `${it.id} ${priorityText(it) === "Won't" ? `${it.priority}, read as Won't while ${destinationText(it)}` : priorityText(it)}, ${by}${it.priority_why ? `: ${it.priority_why}` : ''}`;
}
export const dependsText = it => (it.depends_on?.length ? `depends on ${it.depends_on.map(x => x.origin === 'assumed' ? `${x.id} (assumed)` : x.id).join(', ')}` : null);
// One item in one line for `list`: [priority] text, source, what it depends on, destination.
export const itemText = it => [`${priorityLabel(it) ? `[${priorityLabel(it)}] ` : ''}${it.text}`, it.source, dependsText(it), destinationText(it)].filter(Boolean).join('  · ');

export function readRequests(repo) {
  const file = path.join(repo, REQUESTS);
  if (!fs.existsSync(file)) return { file, exists: false, data: { schema: 'buddy/requests@1', last: 0, items: [] } };
  const d = parseDocument(fs.readFileSync(file, 'utf8')); if (d.error) throw new Error(`${REQUESTS}: ${d.error}`);
  if (d.data.schema !== 'buddy/requests@1') throw new Error(`${REQUESTS} is not a map of what was asked (schema buddy/requests@1)`);
  return { file, exists: true, data: { ...d.data, items: (d.data.items || []).map(x => ({ ...x })) } };
}

// Where an item went, in words: "covered by export-csv", "excluded: not for the first release", "no destination yet".
export function destinationText(it) {
  switch (it.destination) {
    case 'covered': return `covered by ${it.to}`;
    case 'excluded': return it.to ? `excluded by ${it.to}` : `excluded: ${it.reason}`;
    case 'deferred': return `deferred: ${it.reason}`;
    case 'waiting': return `waiting for the answer to ${it.question}`;
    default: return 'no destination yet';
  }
}

export function requestsText(data) {
  // the destination stays last on its line: slice rename rewrites the "covered by <name>" that ends it
  const lines = data.items.map(it => `- **${it.id}** ${priorityLabel(it) ? `[${priorityLabel(it)}] ` : ''}${it.text} (${it.source}${dependsText(it) ? `; ${dependsText(it)}` : ''}): ${destinationText(it)}`);
  const body = `# What was asked\n\nGenerated view of the list above; the front matter is the source of truth. Change it with \`buddy requests add|set|priority|depend|undepend|confirm|remove\`. A priority marked proposed is Buddy's until you confirm or change it; PRD, taken from the PRD (\`buddy requests why <RQ id>\`).\n\n${lines.length ? lines.join('\n') : '(nothing yet)'}\n`;
  return dumpDocument({ schema: 'buddy/requests@1', updated: data.updated, last: data.last ?? 0, items: data.items }, body);
}

const oneLine = (text, what) => { if (!text || !String(text).trim() || /[\r\n\t]/.test(text)) throw new Error(`${what} is one line, not empty`); return String(text).trim(); };
function write(repo, r, now) { r.data.updated = stamp(now); commitAll(repo, [{ file: r.file, text: requestsText(r.data) }]); }
const rq = it => named(it.text, it.id);   // a request in a refusal: its text, its id beside it (R78)
const rqOf = (r, id) => { const it = r.data.items.find(x => x.id === id); return it ? rq(it) : id; };
function find(r, id) {
  const it = r.data.items.find(x => x.id === id);
  if (!it) throw new Error(`no request ${id}${r.data.items.length ? `; there are ${r.data.items[0].id} to ${r.data.items.at(-1).id}` : ': the map is empty'}`);
  return it;
}

export function addRequest(repo, text, source, { now = () => new Date() } = {}) {
  const r = readRequests(repo); const t = oneLine(text, 'the text'); const s = oneLine(source, 'where it comes from (--source)');
  const n = Math.max(r.data.last ?? 0, ...r.data.items.map(x => Number(x.id.slice(2)))) + 1;
  const item = { id: `RQ${n}`, text: t, source: s }; r.data.items.push(item); r.data.last = n;
  write(repo, r, now); return { ...item, file: r.file, created: !r.exists };
}

// Sets the destination of an item: exactly one of { to, excluded, deferred, waiting }. `excluded` names a change or milestone that leaves it
// out (the name of one that exists) or gives a reason. The names and the question must exist: verify refuses the write otherwise.
export function setRequest(repo, id, how = {}, { now = () => new Date() } = {}) {
  const given = ['to', 'excluded', 'deferred', 'waiting'].filter(k => how[k] !== undefined && how[k] !== true);
  if (given.length !== 1) throw new Error('say one destination: --to <change or milestone>, --excluded "<reason or change or milestone>", --deferred "<reason>" or --waiting <question id>');
  const r = readRequests(repo); if (!RQ.test(id || '')) throw new Error(`"${id}" is not a request id (RQ1, RQ2...)`);
  const it = find(r, id); for (const f of ['destination', 'to', 'reason', 'question']) delete it[f];
  const names = new Set([...listMilestones(repo), ...listSlices(repo)].map(s => s.data.id));
  const k = given[0]; const v = oneLine(how[k], `--${k}`);
  if (k === 'to') { if (!names.has(v)) throw new Error(`no change or milestone named ${v}`); Object.assign(it, { destination: 'covered', to: v }); }
  else if (k === 'excluded') Object.assign(it, names.has(v) ? { destination: 'excluded', to: v } : { destination: 'excluded', reason: v });
  else if (k === 'deferred') Object.assign(it, { destination: 'deferred', reason: v });
  else Object.assign(it, { destination: 'waiting', question: v });
  write(repo, r, now); return { ...it };
}

// An item is removed only while nobody has it (a mistake in the map) and nothing depends on it; one with a destination keeps its trace.
export function removeRequest(repo, id, { now = () => new Date() } = {}) {
  const r = readRequests(repo); const it = find(r, id);
  if (it.destination) throw new Error(`${rq(it)} already has a destination (${destinationText(it)}): a request that went somewhere is not removed; exclude or defer it instead`);
  const need = r.data.items.filter(x => (x.depends_on || []).some(d => d.id === id)).map(rq);
  if (need.length) throw new Error(`${need.join(' | ')} ${need.length === 1 ? 'depends' : 'depend'} on ${rq(it)}: undo that first (buddy requests undepend <RQ id> --on ${id})`);
  r.data.items = r.data.items.filter(x => x.id !== id); write(repo, r, now); return { ...it };
}

// The priority, independent of the destination: must, should, could, or none to clear it. Without `fromPrd` or `proposed` it is the owner's
// word (human; `why` optional). `fromPrd` is the PRD's citation (origin prd); `proposed` is Buddy's, with its reason in `why` (origin assumed).
// Neither overwrites the owner's priority; a proposal does not overwrite the PRD's; a newer PRD's does, and `was` says what it replaced.
export function setPriority(repo, id, priority, { fromPrd, proposed = false, why, now = () => new Date() } = {}) {
  if (![...PRIORITIES, 'none'].includes(priority)) throw new Error(`the priority is must, should, could or none, not "${priority}"`);
  const prd = fromPrd !== undefined && fromPrd !== null;
  if (prd && proposed) throw new Error('a priority comes from the PRD (--from-prd) or is proposed by Buddy (--proposed), not both');
  if (prd && why !== undefined) throw new Error('the citation of --from-prd is its why; --why is for --proposed or the owner\'s');
  if ((prd || proposed) && priority === 'none') throw new Error('only the owner clears a priority: none takes neither --from-prd nor --proposed');
  const w = prd ? oneLine(fromPrd, 'the citation of --from-prd') : why !== undefined ? oneLine(why, '--why') : undefined;
  if (proposed && !w) throw new Error('a proposed priority needs its reason: --why "<reason>"');
  const r = readRequests(repo); const it = find(r, id); const origin = priorityOrigin(it); const was = it.priority ? { priority: it.priority, priority_origin: origin, priority_why: it.priority_why } : null;
  const name = x => x.priority[0].toUpperCase() + x.priority.slice(1);
  if ((prd || proposed) && origin === 'human') throw new Error(`${rq(it)} is ${name(it)} by the owner's word: Buddy does not change it (only the owner does, with requests priority ${id} <priority>)`);
  if (proposed && origin === 'prd') throw new Error(`${rq(it)} is ${name(it)} from the PRD (${it.priority_why}): a proposal does not replace it; a newer PRD does (--from-prd) or the owner`);
  for (const f of ['priority', 'priority_origin', 'priority_why']) delete it[f];
  if (priority !== 'none') Object.assign(it, { priority, priority_origin: prd ? 'prd' : proposed ? 'assumed' : 'human' }, w ? { priority_why: w } : {});
  write(repo, r, now); return { ...it, was: prd && was?.priority_origin === 'prd' && (was.priority !== it.priority || was.priority_why !== it.priority_why) ? was : null };
}
// The owner confirms at once every priority Buddy proposed: each becomes theirs (human) and keeps its reason. Returns the ids confirmed.
export function confirmPriorities(repo, { now = () => new Date() } = {}) {
  const r = readRequests(repo); const left = r.data.items.filter(x => priorityOrigin(x) === 'assumed');
  for (const x of left) x.priority_origin = 'human';
  if (left.length) write(repo, r, now); return left.map(x => x.id);
}
export const proposedPriorities = items => (items || []).filter(x => priorityOrigin(x) === 'assumed').length;
export const proposedPrioritiesText = n => `${n} ${n === 1 ? 'priority' : 'priorities'} proposed by Buddy ${n === 1 ? 'waits' : 'wait'} for your confirmation (buddy requests confirm --priorities, or change the ones you disagree with)`;
// The line that waits for the owner while dependencies Buddy proposed are not confirmed (R148); the index counts them.
export const proposedDependenciesText = n => `${n} ${n === 1 ? 'dependency' : 'dependencies'} Buddy proposed ${n === 1 ? 'waits' : 'wait'} for your confirmation (buddy requests list to see them, then buddy requests confirm --dependencies, or confirm <RQ> one by one)`;
// The dependencies Buddy proposed that wait for the owner (R148): only those of a request still open, not excluded, deferred or covered by a
// change or milestone delivered or accepted (R162). `status`: the state of each change or milestone by name.
export const openRequest = (it, status = new Map()) => !wont(it) && !(it.destination === 'covered' && ['delivered', 'accepted'].includes(status.get(it.to)));
export const proposedDependencies = (items, status) => (items || []).filter(x => openRequest(x, status)).reduce((n, x) => n + (x.depends_on || []).filter(d => d.origin === 'assumed').length, 0);
// What an item depends on. Without `assumed` it is the owner's word (origin human), and an assumed one already there becomes human;
// Buddy's proposals are `assumed` until the owner confirms them. An unknown id or the item itself: verify refuses the write.
export function dependRequest(repo, id, on = [], { assumed = false, now = () => new Date() } = {}) {
  if (!on.length) throw new Error('say what it depends on: --on <RQ id>');
  const r = readRequests(repo); const it = find(r, id); const deps = it.depends_on || [];
  for (const d of on) { const was = deps.find(x => x.id === d); if (!was) deps.push({ id: d, origin: assumed ? 'assumed' : 'human' }); else if (!assumed) was.origin = 'human'; }
  it.depends_on = deps; write(repo, r, now); return { ...it };
}
export function undependRequest(repo, id, on = [], { now = () => new Date() } = {}) {
  if (!on.length) throw new Error('say what it no longer depends on: --on <RQ id>');
  const r = readRequests(repo); const it = find(r, id); const deps = it.depends_on || [];
  const not = on.filter(d => !deps.some(x => x.id === d));
  if (not.length) throw new Error(`${rq(it)} does not depend on ${not.map(d => rqOf(r, d)).join(', ')}${deps.length ? `; it depends on ${deps.map(x => rqOf(r, x.id)).join(', ')}` : ''}`);
  it.depends_on = deps.filter(x => !on.includes(x.id)); if (!it.depends_on.length) delete it.depends_on;
  write(repo, r, now); return { ...it };
}
// The owner confirms the dependencies Buddy proposed for an item: every assumed one becomes human.
export function confirmRequest(repo, id, { now = () => new Date() } = {}) {
  const r = readRequests(repo); const it = find(r, id); const left = (it.depends_on || []).filter(x => x.origin === 'assumed');
  if (!left.length) throw new Error(`${rq(it)} has no assumed dependency to confirm`);
  for (const x of left) x.origin = 'human';
  write(repo, r, now); return { ...it, confirmed: left.map(x => x.id) };
}

// The owner confirms at once every dependency Buddy proposed, on every request (R162): each becomes theirs (human). Returns, for each request
// that had any, its id, its text and the ids it depends on that were confirmed, each with its text.
export function confirmDependencies(repo, { now = () => new Date() } = {}) {
  const r = readRequests(repo); const by = new Map(r.data.items.map(x => [x.id, x])); const done = [];
  for (const it of r.data.items) {
    const left = (it.depends_on || []).filter(x => x.origin === 'assumed'); if (!left.length) continue;
    for (const x of left) x.origin = 'human';
    done.push({ id: it.id, text: it.text, on: left.map(x => ({ id: x.id, text: by.get(x.id)?.text ?? null })) });
  }
  if (done.length) write(repo, r, now); return done;
}
export const confirmedDependenciesText = done => {
  const n = done.reduce((k, x) => k + x.on.length, 0); const say = x => (x.text ? `${x.text} [${x.id}]` : x.id);
  return n ? `confirmed ${n} ${n === 1 ? 'dependency' : 'dependencies'} proposed by Buddy, now yours: ${done.map(x => `${say(x)} on ${x.on.map(say).join(', ')}`).join(' | ')}` : 'no dependency proposed by Buddy waits for confirmation';
};

export function listRequests(repo, { open = false } = {}) {
  const r = readRequests(repo); return { exists: r.exists, items: r.data.items.filter(x => !open || !x.destination) };
}

// The order of the work (R132): the requests not excluded or deferred, what others need first (a topological order of their dependencies),
// ties by effective priority (Must, Should, Could, none: its own or that of what needs it), then its own, then id. Warns of a request that depends on one of lower priority, of a dependency on an
// excluded or deferred request, and of a cycle, whose requests (and those that need them) go last in id order. Reads only.
export function requestOrder(items) {
  const RANK = { must: 0, should: 1, could: 2 }; const rank = it => RANK[it.priority] ?? 3; const num = it => Number(it.id.slice(2));
  const by = new Map(items.map(it => [it.id, it])); const open = items.filter(it => !wont(it)); const isOpen = new Set(open.map(x => x.id));
  const deps = it => (it.depends_on || []).map(d => d.id).filter(d => isOpen.has(d) && d !== it.id);
  const warnings = []; const word = it => priorityText(it) ?? 'no priority';
  for (const it of open) for (const d of it.depends_on || []) {
    const x = by.get(d.id); if (!x) continue;
    if (wont(x)) warnings.push(`${it.id} depends on ${x.id}, which is ${destinationText(x)}`);
    else if (it.priority && rank(x) > rank(it)) warnings.push(`${it.id} (${word(it)}) depends on ${x.id} (${word(x)}): it should be ${word(it)} too`);
  }
  // the effective priority: the highest of its own and that of every request that needs it, transitively, so a Must's dependency is not
  // left behind an unrelated Could (the warning above still asks the owner to raise the stored one)
  const needs = new Map(open.map(it => [it.id, []])); for (const it of open) for (const d of deps(it)) needs.get(d).push(it);
  const eff = new Map(open.map(it => { let best = rank(it); const seen = new Set([it.id]); const go = x => { for (const y of needs.get(x.id)) if (!seen.has(y.id)) { seen.add(y.id); best = Math.min(best, rank(y)); go(y); } }; go(it); return [it.id, best]; }));
  const placed = new Set(); const order = []; const cmp = (a, b) => eff.get(a.id) - eff.get(b.id) || rank(a) - rank(b) || num(a) - num(b);
  for (let next; (next = open.filter(it => !placed.has(it.id) && deps(it).every(d => placed.has(d))).sort(cmp)[0]);) { placed.add(next.id); order.push(next); }
  const left = open.filter(it => !placed.has(it.id)).sort((a, b) => num(a) - num(b));   // in a cycle, or needing one
  const reach = id => { const seen = new Set(); const go = x => { for (const d of deps(by.get(x))) if (!seen.has(d)) { seen.add(d); go(d); } }; go(id); return seen; };
  const reaches = new Map(left.map(it => [it.id, reach(it.id)])); const cycles = []; const inCycle = new Set();
  for (const it of left) {
    if (inCycle.has(it.id) || !reaches.get(it.id).has(it.id)) continue;
    const c = left.filter(x => reaches.get(it.id).has(x.id) && reaches.get(x.id).has(it.id)).map(x => x.id); c.forEach(x => inCycle.add(x)); cycles.push(c);
    warnings.push(`a cycle: ${c.join(', ')} depend on each other; they go last, in id order`);
  }
  return { order: [...order, ...left], warnings, cycles };
}

// The warnings of the order in one line for what waits for the owner (R133): the count and the first three, each request by its text with
// its id beside it (R78). Null when there is none.
export function orderWarningsText(items, warnings) {
  if (!warnings?.length) return null; const by = new Map((items || []).map(x => [x.id, x])); const n = warnings.length;
  const say = w => w.replace(/\bRQ[1-9]\d*\b/g, id => (by.has(id) ? `${by.get(id).text} [${id}]` : id));
  return `${n} ${n === 1 ? 'warning' : 'warnings'} in the order of what you asked for: ${warnings.slice(0, 3).map(say).join(' | ')}${n > 3 ? ` | and ${n - 3} more` : ''} (buddy requests order)`;
}
// What changed in the priorities and the dependencies between two versions of the map (R133): the priorities that differ by id (one absent
// has none) and the dependencies added or removed. Who said it (the origin) is not a change of the value.
export function mapChanges(before = [], after = []) {
  const pr = new Map(before.map(x => [x.id, x.priority ?? null])); const now = new Map(after.map(x => [x.id, x.priority ?? null]));
  const priorities = [...new Set([...pr.keys(), ...now.keys()])].filter(id => (pr.get(id) ?? null) !== (now.get(id) ?? null)).length;
  const edges = items => new Set(items.flatMap(x => (x.depends_on || []).map(d => `${x.id}>${d.id}`)));
  const a = edges(before); const b = edges(after); const dependencies = [...a].filter(e => !b.has(e)).length + [...b].filter(e => !a.has(e)).length;
  return { priorities, dependencies };
}
export function mapChangesText({ priorities: p, dependencies: d }) {
  if (!p && !d) return null;
  const parts = [p ? `${p} ${p === 1 ? 'priority' : 'priorities'}` : null, d ? `${d} ${d === 1 ? 'dependency' : 'dependencies'}` : null].filter(Boolean);
  return `Since you last looked: ${parts.join(' and ')} changed (buddy requests list)`;
}

// The totals the board and the digest show. `status`: the state of each change or milestone by name; an item covered by one that was
// abandoned has nobody any more. A Must with nobody is counted apart (`must`): the alarm. Null when there is no map (or it is empty).
export const orphaned = (it, status = new Map()) => !it.destination || (it.destination === 'covered' && status.get(it.to) === 'abandoned');
export function requestTotals(items, status = new Map()) {
  if (!items?.length) return null;
  const t = { total: items.length, covered: 0, excluded: 0, deferred: 0, waiting: 0, must: [], nobody: [] };
  for (const it of items) if (orphaned(it, status)) t[it.priority === 'must' ? 'must' : 'nobody'].push({ id: it.id, text: it.text }); else t[it.destination]++;
  return t;
}
export function requestTotalsText(t) {
  const parts = [`${t.covered} covered`, `${t.excluded} excluded`, `${t.deferred} deferred`, `${t.waiting} waiting for an answer`].filter(p => !p.startsWith('0 '));
  const lost = [...(t.must.length ? [`${t.must.length} Must without a destination yet (${t.must.map(x => x.id).join(', ')})`] : []), ...(t.nobody.length ? [`${t.nobody.length} without a destination yet`] : [])];
  return lost.length ? `What you asked for (${t.total}): ${[...parts, ...lost].join(', ')}` : `Everything you asked for has a destination (${t.total}): ${parts.join(', ')}`;
}
// The line that waits for the owner, at most three by their text: the Musts (`must`), or the others.
export function requestNobodyText(t, { must = false } = {}) {
  const list = must ? t.must : t.nobody; const n = list.length; const shown = list.slice(0, 3).map(x => `${x.text} [${x.id}]`);
  return `${n}${must ? ' Must' : ''} of what you asked for ${n === 1 ? 'has' : 'have'} no destination yet: ${shown.join(' | ')}${n > 3 ? ` | and ${n - 3} more (buddy requests list --open)` : ''}`;
}
