// How many times each change asked the owner something and how long it waited for them (audit 2026-11-01: ceremony must earn its place).
// Read only from what the records and their git history already hold; nothing new is asked of the owner or stored (AC2). What is measured is
// the time something waited for the owner, not their working time: a question from its batch's creation to its answer, an acceptance from
// the moment the work was delivered (its latest checkpoint before the acceptance, else the commit that wrote `status: delivered`) to
// `accepted.at`, a checkpoint exception (evidence with reasons) from its time to the next move of that slice (its next checkpoint or its
// acceptance). An event without one of its dates is counted and its time left out. The time of a change or a milestone is the union of the
// waits of its questions and acceptances, so two things waiting at once count once. Checkpoint exceptions are not among the times the owner
// was asked nor in that time (R139): they are counted apart, with the union of their own waits for a decision. The model cost of Dev or the
// reviewer is not measured (X1). The records, the batches and the evidence are read from the index (R148).
import path from 'node:path';
import { readIndex } from './index.mjs';
import { git } from './proc.mjs';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ms = t => { if (typeof t === 'number') return t; if (t == null || t === '') return null; const s = String(t); const v = Date.parse(DAY.test(s) ? `${s}T00:00:00Z` : s); return Number.isNaN(v) ? null : v; };
// A time as the record holds it: a day stays a day (its resolution is the day), a time is given to the second.
const shown = t => (ms(t) == null ? null : DAY.test(String(t)) ? String(t) : new Date(ms(t)).toISOString().slice(0, 19) + 'Z');

// When the record in `file` last became delivered at or before `before`, from git: the latest commit whose diff touches `status: delivered`.
function deliveredInGit(repo, file, before) {
  const rel = path.relative(repo, file).split(path.sep).join('/');
  return git(['log', '--follow', '-G', '^status: delivered', '--format=%cI', '--', rel], repo).split('\n').map(ms).filter(t => t != null && t <= before).sort((a, b) => b - a)[0] ?? null;
}
// The evidence of a change folder (`dir`, relative to the repository), as the index summarised it, in the order of their names.
const readEvidence = (x, dir) => x.evidence.filter(e => e.file.startsWith(`${dir}/`) && !e.file.slice(dir.length + 1).includes('/') && e.slice);

// The events of one change and its pieces: [{ kind: question|acceptance|exception, what, from, to, minutes }] (times in ISO, minutes null when
// a date is missing).
function changeEvents(repo, x, change, pieces, batches) {
  const group = [change, ...pieces]; const ids = new Set(group.map(x => x.data.id)); const out = [];
  const add = (kind, what, f, t) => { const from = ms(f); const to = ms(t); out.push({ kind, what, from: shown(f), to: shown(t), minutes: from != null && to != null && to >= from ? Math.floor((to - from) / 60000) : null, ...(DAY.test(String(f)) || DAY.test(String(t)) ? { resolution: 'day' } : {}), _from: from, _to: to }); };
  for (const b of batches.filter(x => ids.has(x.data.slice) || group.some(r => (r.data.batches || []).includes(x.data.id)))) {
    for (const q of b.data.questions || []) add('question', q.id, q.created ?? b.data.created, q.answer?.by === 'human' ? q.answer.at : null);
  }
  const evs = change.folder ? readEvidence(x, path.posix.join(path.posix.dirname(change.rel), 'evidence')).filter(e => ids.has(e.slice)).map(e => ({ ...e, t: ms(e.when) })).filter(e => e.t != null) : [];
  // acceptances: the records accepted in one write (a change and its pieces) are one acceptance
  const accepted = new Map(); for (const r of group) { const at = ms(r.data.accepted?.at); if (r.data.accepted) { const k = at ?? `?${r.data.id}`; accepted.set(k, [...(accepted.get(k) || []), r]); } }
  for (const [k, rs] of accepted) {
    const at = typeof k === 'number' ? k : null; const these = new Set(rs.map(r => r.data.id));
    let from = at == null ? null : Math.max(-Infinity, ...evs.filter(e => these.has(e.slice) && e.t <= at).map(e => e.t));
    if (from === -Infinity) from = rs.map(r => deliveredInGit(repo, r.file, at)).filter(t => t != null).sort((a, b) => b - a)[0] ?? null;
    add('acceptance', rs.map(r => r.data.id).join(', '), shown(from), shown(at));
  }
  for (const e of evs.filter(e => (e.reasons || []).length)) {
    const later = evs.filter(x => x.slice === e.slice && x.t > e.t).map(x => x.t);
    const r = group.find(x => x.data.id === e.slice); const acc = ms(r?.data.accepted?.at);
    const next = [...later, ...(acc != null && acc >= e.t ? [acc] : [])].sort((a, b) => a - b)[0] ?? null;
    add('exception', e.slice, e.when, shown(next));
  }
  return out.sort((a, b) => (a._from ?? Infinity) - (b._from ?? Infinity) || a.kind.localeCompare(b.kind));
}

// The minutes of a union of waits: overlapping intervals count once.
function unionMinutes(events) {
  const iv = events.filter(e => e.minutes != null).map(e => [e._from, e._to]).sort((a, b) => a[0] - b[0]); let total = 0; let cur = null;
  for (const [a, b] of iv) { if (!cur || a > cur[1]) { if (cur) total += cur[1] - cur[0]; cur = [a, b]; } else cur[1] = Math.max(cur[1], b); }
  if (cur) total += cur[1] - cur[0];
  return Math.floor(total / 60000);
}
// the owner's own waits (questions, acceptances) and, apart, the checkpoint exceptions with their own union (R139)
const totals = events => {
  const own = events.filter(e => e.kind !== 'exception'); const exc = events.filter(e => e.kind === 'exception');
  return { asked: own.length, waited_minutes: unionMinutes(own), undated: own.filter(e => e.minutes == null).length,
    exceptions: exc.length, exceptions_waited_minutes: unionMinutes(exc), exceptions_undated: exc.filter(e => e.minutes == null).length };
};
const clean = e => { const { _from, _to, ...rest } = e; void _from; void _to; return rest; };

// Every change with its events and every milestone with its totals (all time). `since` (ISO) keeps the changes with an event that began or
// ended after it, and the milestones of those changes (their totals stay all time). `only`: a change, a piece (its change) or a milestone.
// `index`: the records as the index read them; without one it is read here.
const record = repo => r => ({ file: path.join(repo, r.file), rel: r.file, data: r.data, change: r.change, milestone: r.milestone, folder: r.folder });
export function ownerMinutes(repo, { since, only, index } = {}) {
  const x = index ?? readIndex(repo); const all = x.changes.map(record(repo)); const batches = x.batches.map(b => ({ data: b })); const milestones = x.milestones.map(record(repo));
  let changes = all.filter(r => !r.change).map(c => {
    const events = changeEvents(repo, x, c, all.filter(p => p.change === c.data.id), batches);
    return { id: c.data.id, title: c.data.title, milestone: c.milestone, ...totals(events), events };
  });
  if (only) {
    const m = milestones.find(x => x.data.id === only); const r = all.find(x => x.data.id === only);
    if (!m && !r) throw new Error(`no change or milestone ${only}`);
    changes = m ? changes.filter(c => c.milestone === only) : changes.filter(c => c.id === (r.change ?? r.data.id));
  }
  const byMilestone = new Map(); for (const c of changes) byMilestone.set(c.milestone, [...(byMilestone.get(c.milestone) || []), ...c.events]);
  const s = ms(since); const recent = c => s == null || c.events.some(e => (e._from != null && e._from > s) || (e._to != null && e._to > s));
  const listed = changes.filter(c => c.events.length && recent(c));
  const order = id => (id == null ? Infinity : milestones.findIndex(x => x.data.id === id));   // milestones by rank, the backlog last
  const groups = [...new Set(listed.map(c => c.milestone))].sort((a, b) => order(a) - order(b)).map(id => ({ id, title: id ? milestones.find(x => x.data.id === id)?.data.title ?? id : 'backlog', ...totals(byMilestone.get(id)) }));
  return { since: since ?? null, changes: listed.map(c => ({ ...c, events: c.events.map(clean) })), milestones: groups };
}

// How long each change was in each stage, in calendar minutes, from the dates its records hold (live-board AC2): the status of a change and of its
// pieces at each commit that touched them (one `git log` for all of them, so it stays cheap), and the status now from the record, at its `updated`
// when that is not committed yet. A change built in pieces is in the stage of its pieces (building if any is, else waiting for the owner if any is
// delivered, else ready, else being defined); accepted and abandoned end the count. { [change id]: { refining, ready, building, delivered } }.
const STAGE = { refining: 'refining', ready: 'ready', building: 'building', blocked: 'building', rework: 'building', delivered: 'delivered' };
export function stageTimes(repo, now, { index } = {}) {
  const x = index ?? readIndex(repo); const ev = new Map(); let t = null; let cur = null; let from = null;
  const out = git(['-c', 'core.quotePath=false', 'log', '--reverse', '--format=C %cI', '-G^status: ', '-p', '-U0', '-M', '--', 'docs/buddy'], repo);
  for (const l of out.split('\n')) {
    if (l.startsWith('C ')) t = ms(l.slice(2));
    else if (l.startsWith('rename from ')) from = l.slice(12);
    else if (l.startsWith('rename to ')) { const to = l.slice(10); if (from && ev.has(from)) { ev.set(to, [...(ev.get(to) || []), ...ev.get(from)]); ev.delete(from); } from = null; }
    else if (l.startsWith('+++ ')) cur = l.startsWith('+++ b/') ? l.slice(6) : null;
    else if (cur && t != null && l.startsWith('+status: ')) ev.set(cur, [...(ev.get(cur) || []), [t, l.slice(9).trim()]]);
  }
  const recs = x.changes; const end = ms(now); const result = {};
  const line = r => {
    const e = (ev.get(r.file) || []).filter((v, i, a) => !i || a[i - 1][1] !== v[1]); const status = r.data.status; const last = e[e.length - 1];
    const created = ms(r.data.created); if (e.length && created != null && created < e[0][0]) e[0] = [created, e[0][1]];
    if (!last || last[1] !== status) { const at = ms(last ? r.data.updated : r.data.created ?? r.data.updated); if (at != null && (!last || at > last[0])) e.push([at, status]); }
    return e;
  };
  for (const c of recs.filter(r => !r.change)) {
    const parts = recs.filter(p => p.change === c.data.id); const lines = [[c, line(c)], ...parts.map(p => [p, line(p)])];
    const steps = lines.flatMap(([r, e]) => e.map(([at, st]) => ({ at, id: r.data.id, st }))).sort((a, b) => a.at - b.at);
    const state = new Map(); const sum = { refining: 0, ready: 0, building: 0, delivered: 0 }; let was = null; let since = null;
    const stage = () => { const own = parts.some(p => state.has(p.data.id)) ? parts.filter(p => state.has(p.data.id)).map(p => state.get(p.data.id)) : [state.get(c.data.id)];
      if (own.every(v => v === 'accepted' || v === 'abandoned')) return null; return ['building', 'delivered', 'ready'].find(k => own.some(v => STAGE[v] === k)) ?? 'refining'; };
    const close = at => { if (was && since != null && at > since) sum[was] += Math.floor((at - since) / 60000); };
    for (const s of steps) { close(s.at); state.set(s.id, s.st); was = stage(); since = s.at; }
    if (end != null) close(end);
    result[c.data.id] = sum;
  }
  return result;
}

// "2 d 3 h", "5 h 20 min", "12 min".
export function span(min) {
  const d = Math.floor(min / 1440); const h = Math.floor((min % 1440) / 60); const m = min % 60;
  return d ? `${d} d${h ? ` ${h} h` : ''}` : h ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`;
}
const when = t => (t ? t.slice(0, 16).replace('T', ' ') : '?');
const times = n => `${n} time${n === 1 ? '' : 's'}`;
const undatedText = n => (n ? ` (${n} without a date)` : '');
export const changeLine = c => `  ${c.title} [${c.id}]: asked you ${times(c.asked)}; it waited for you ${span(c.waited_minutes)}${undatedText(c.undated)}`;
export const milestoneLine = m => `  ${m.id ?? 'backlog'}: you were asked ${times(m.asked)}; it waited for you ${span(m.waited_minutes)} in all${undatedText(m.undated)}`;
// the checkpoint exceptions, on their own line under a change or a milestone (R139); nothing when there were none
export const exceptionsLine = (x, pad) => (x.exceptions ? [`${pad}${x.exceptions} checkpoint exception${x.exceptions === 1 ? '' : 's'}, waited ${span(x.exceptions_waited_minutes)} for a decision${undatedText(x.exceptions_undated)}`] : []);

// The lines for the digest and for `buddy minutes`: each milestone's total, then its changes. `events` adds each event of a change.
export function minutesLines(x, { events = false } = {}) {
  const o = [];
  for (const m of x.milestones) {
    o.push(milestoneLine(m), ...exceptionsLine(m, '    '));
    for (const c of x.changes.filter(c => c.milestone === m.id)) {
      o.push(`  ${changeLine(c)}`, ...exceptionsLine(c, '        '));
      if (events) o.push(...c.events.map(e => `        ${e.kind.padEnd(10)} ${e.what}: ${when(e.from)} -> ${when(e.to)}${e.minutes == null ? ' (without a date)' : `, ${e.resolution === 'day' ? (e.minutes < 1440 ? 'the same day' : `${Math.floor(e.minutes / 1440)} d`) : span(e.minutes)}`}`));
    }
  }
  return o;
}
