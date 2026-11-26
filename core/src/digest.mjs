// Radiator R10, the digest: what changed since the Product Owner last looked (R65). There is no way to reach an absent person, so this is
// what Buddy answers when they ask "how are things going?". A pure function of the records, the checkpoint evidence, the worker registry,
// `since` and an injected clock. Reading it writes nothing; `--mark` (writeMark) is the only write and is the caller's explicit choice.
// Without an activity log (Q76) it reports the present state of what changed (by the slice's `updated`), not each transition.
import fs from 'node:fs';
import path from 'node:path';
import { loadBoard, ago, pulseText, nowLine, nextLine, effState } from './board.mjs';
import { workers } from './workers.mjs';
import { buildIndex } from './index.mjs';
import { requestTotalsText, readRequests, mapChanges, mapChangesText, REQUESTS } from './requests.mjs';
import { parseDocument } from './frontmatter.mjs';
import { git } from './proc.mjs';
import { named } from './ids.mjs';
import { settledRecords } from './settle.mjs';
import { ownerMinutes, minutesLines, stageTimes } from './minutes.mjs';
import { buddyDir, ensureBuddyDir, isGitRepo } from './gitdir.mjs';

const markFile = repo => path.join(buddyDir(repo), 'last-looked');
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
export const readMark = repo => { try { const t = fs.readFileSync(markFile(repo), 'utf8').trim(); return TIME.test(t) ? t : null; } catch { return null; } };
export function writeMark(repo, now) {
  if (!isGitRepo(repo)) throw new Error('not a git repository: the marker lives in .buddy/');
  ensureBuddyDir(repo); fs.writeFileSync(markFile(repo), now + '\n');
}

// What changed in the priorities and the dependencies since `since` (R133): the map now against its version in git at that time. Nothing
// new is stored; with no time, no history of the map then, or a map that does not read, it says nothing (null).
export function requestChanges(repo, since) {
  if (!since) return null;
  const at = git(['log', '-1', '--format=%H', `--before=${since}`, '--', REQUESTS], repo).trim(); if (!at) return null;
  try {
    const was = parseDocument(git(['show', `${at}:${REQUESTS}`], repo)); if (was.error || was.data?.schema !== 'buddy/requests@1') return null;
    return mapChanges(was.data.items || [], readRequests(repo).data.items);
  } catch { return null; }
}

const MIX_DAYS = 14;
const MIX_EVIDENCE = /^docs\/buddy\/(?:.*\/)?evidence\//;
const MIX_RECORDS = /^(docs\/buddy\/|docs\/questions[^/]*\.md$)/;
const MIX_PROCESS = /^(docs\/|\.(claude|agents|github|githooks|semgrep)\/|AGENTS\.md$|CLAUDE\.md$|azure-pipelines\.yml$|\.gitleaks\.toml$)/;
const MIX_TESTS = /(^|\/)tests?\/|\.(test|spec)\.[^/]+$/;
const resolveRename = p => (p.includes('{') && p.includes(' => ') ? p.replace(/\{[^{}]* => ([^{}]*)\}/g, '$1') : p.includes(' => ') ? p.split(' => ').pop() : p).replace(/\/+/g, '/').replace(/^\//, '');
const classifyWork = p => MIX_EVIDENCE.test(p) ? 'evidence' : MIX_RECORDS.test(p) ? 'records' : MIX_PROCESS.test(p) ? 'process' : MIX_TESTS.test(p) ? 'tests' : 'product';

// 14-day work mix from git log --numstat (R72, informational only: no thresholds or alarms).
function workMix(repo, from, until) {
  const lines = { product: 0, tests: 0, records: 0, evidence: 0, process: 0 };
  const out = isGitRepo(repo) ? git(['-c', 'core.quotePath=false', 'log', '--numstat', '--format=', `--since=${from}`, `--until=${until}`], repo) : '';
  for (const line of out.split(/\r?\n/)) {
    const [a, d, ...rest] = line.split('\t');
    if (!rest.length || a === '-' || d === '-') continue;
    const n = Number(a) + Number(d);
    if (!Number.isFinite(n) || n <= 0) continue;
    lines[classifyWork(resolveRename(rest.join('\t')))] += n;
  }
  const total = lines.product + lines.tests + lines.records + lines.evidence + lines.process;
  const pct = n => total ? Math.round((n / total) * 100) : 0;
  return { days: MIX_DAYS, total, lines, share: { product: pct(lines.product), tests: pct(lines.tests), records: pct(lines.records), evidence: pct(lines.evidence), process: pct(lines.process) } };
}

// The work mix of the last 14 days and the routes used in them, as the digest and the board's page both show them (one way to measure each).
function mixAndRoutes(repo, b, now) {
  const from14 = new Date(Date.parse(now) - MIX_DAYS * 86400e3).toISOString();
  const t0 = Date.parse(from14), t1 = Date.parse(now);
  const in14 = t => { const ms = Date.parse(t); return ms >= t0 && ms <= t1; };
  const routes = {};
  for (const r of b.slices) if (in14(r.updated)) routes[r.kind] = (routes[r.kind] ?? 0) + 1;
  const qf = settledRecords(repo, in14).length;
  if (qf) routes.quick_fix = qf;
  return { work_mix: workMix(repo, from14, now), routes };
}
// What the board's page adds to the board (live-board AC7, AC10, AC13): the owner's minutes, the time in each stage and the work mix, from the same
// functions as `buddy minutes` and `buddy digest`. Three git reads in all (status history, 14-day numstat, settled records).
// What changed since the owner last looked, in his words, for the page (live-board AC20): the changes whose own record or whose pieces moved after the mark `buddy digest --mark`
// wrote, each as delivered, accepted or started (a change in pieces is in the state of its pieces). Null when he never marked a look: there is no "since". Writing the page marks nothing.
export function sinceLooked(repo, b) {
  const from = readMark(repo); if (!from) return null;
  const after = t => Date.parse(t) > Date.parse(from);
  const kind = { delivered: 'delivered', accepted: 'accepted', building: 'started', rework: 'started' };
  const items = b.slices.filter(r => !r.change && [r, ...b.slices.filter(p => p.change === r.id)].some(x => after(x.updated)))
    .map(r => ({ kind: kind[effState(b.slices, r)], title: r.title, id: r.id })).filter(i => i.kind);
  return { since: from, items };
}
export const boardMeasures = (repo, b, index) => ({ minutes: ownerMinutes(repo, { index }), stages: stageTimes(repo, b.now, { index }), ...mixAndRoutes(repo, b, b.now), looked: sinceLooked(repo, b) });

export function digest(repo, now, { since, staleMinutes, index } = {}) {
  const x = index ?? buildIndex(repo); const from = since ?? readMark(repo); const b = loadBoard(repo, now, { staleMinutes, index: x });
  const after = t => !from || Date.parse(t) > Date.parse(from);
  const changed = b.slices.filter(r => after(r.updated)).map(r => ({ id: r.id, title: r.title, kind: r.kind, status: r.status, steps: r.steps, ago: ago(r.updated, now), pulse: r.pulse ?? null, merge: r.merge ?? null }));
  // checkpoint evidence, as the index read it: in each change folder (R87), wherever it lives (R118), and in .buddy/ for checkpoints run without a change
  const checkpoints = x.evidence.filter(e => e.when && after(e.when))
    .map(e => ({ when: e.when.slice(0, 19) + 'Z', slice: e.slice, exceptions: e.reasons.length, reasons: e.reasons })).sort((a, c) => a.when.localeCompare(c.when));
  // a slice named in the digest goes with its title (R78): the checkpoints and the workers carry the title of their slice
  const titleOf = id => b.slices.find(r => r.id === id)?.title ?? null;
  for (const c of checkpoints) c.title = c.slice ? titleOf(c.slice) : null;
  const finished = workers(repo, { now: () => new Date(now) }).filter(w => w.ended && after(w.ended)).map(w => ({ id: w.id, role: w.role, slice: w.slice, title: titleOf(w.slice), status: w.status }));
  const stalled = b.slices.filter(r => r.pulse?.stale).map(r => ({ id: r.id, title: r.title, dev: r.pulse.dev, ago: r.pulse.ago }));
  const settled = settledRecords(repo, after).map(r => ({ when: r.when, commits: r.commits.length, stat: r.stat, kind: r.kind, needs_owner: r.needs_owner, deviations: r.deviations, validate_exit: r.validate_exit }));
  const mapChanged = requestChanges(repo, from); const requests_changed = mapChanged && (mapChanged.priorities || mapChanged.dependencies) ? mapChanged : null;
  // how many times each change asked the owner and how long it waited for them: the changes with an event since the last look, and the
  // all-time total of their milestones
  const minutes = ownerMinutes(repo, { since: from ?? undefined, index: x });
  const { work_mix, routes } = mixAndRoutes(repo, b, now);
  return { now, since: from ?? null, first: !from, current: b.current, next: b.next, waiting: b.waiting, view: b.view, requests: b.requests ?? null, requests_changed, changed, checkpoints, workers_finished: finished, stalled, settled, minutes, work_mix, routes };
}

const t16 = t => t.slice(0, 16).replace('T', ' ');
const ROUTE_ORDER = ['feat', 'fix', 'chore', 'refactor', 'docs'];
const routeRank = k => k === 'quick_fix' ? 999 : (ROUTE_ORDER.indexOf(k) + 1 || 100);
export function digestText(d) {
  const o = [`DIGEST  ${t16(d.now)} UTC · ${d.first ? 'first look: everything is new' : `since ${t16(d.since)} UTC`}`, '', nowLine(d), nextLine(d), ''];
  const view = d.view ?? d.waiting;
  o.push(view.length ? `Waiting for you (${view.length})` : 'Nothing is waiting for you.', ...view.flatMap(w => [`  - ${w.text}`, ...(w.under || []).map(u => `      - ${u.text}`)]));
  if (d.requests) o.push('', requestTotalsText(d.requests));
  if (d.requests_changed) o.push(...(d.requests ? [] : ['']), mapChangesText(d.requests_changed));
  if (d.stalled.length) o.push('', `Possibly stalled (${d.stalled.length})`, ...d.stalled.map(s => `  - ${s.title} [${s.id}]: Dev ${s.dev} last seen ${s.ago} ago`));
  if (d.changed.length) o.push('', `Changed${d.first ? '' : ' since then'} (${d.changed.length})`, ...d.changed.map(c => `  ${c.id}  ${c.status.padEnd(9)} ${[c.title, c.steps.total ? `[${c.steps.done}/${c.steps.total}]` : null, `· ${c.ago} ago`, pulseText(c.pulse)].filter(Boolean).join('  ')}`));
  if (d.checkpoints.length) o.push('', `Checkpoints run (${d.checkpoints.length}, ${d.checkpoints.filter(c => c.exceptions).length} with exceptions)`, ...d.checkpoints.map(c => `  ${c.slice ? named(c.title, c.slice) : '(no slice)'}  ${c.exceptions ? `${c.exceptions} exception(s): ${c.reasons.slice(0, 2).join(' | ').slice(0, 140)}` : 'clean'}`));
  if (d.settled?.length) o.push('', `Quick fixes settled (${d.settled.length}, ${d.settled.filter(x => x.needs_owner).length} need your look)`, ...d.settled.map(x => `  ${x.commits} commit(s), ${x.stat || 'no files'}: ${x.needs_owner ? [x.validate_exit ? 'the checks fail' : null, x.kind === 'grew' ? 'it grew past a quick fix' : null, ...x.deviations].filter(Boolean).join('; ') : 'nothing deviated'}`));
  if (d.minutes?.changes.length) o.push('', `Times you were asked${d.first ? '' : ' since then'} (time it waited for you, not your working time)`, ...minutesLines(d.minutes));
  if (d.workers_finished.length) o.push('', 'Workers finished', ...d.workers_finished.map(w => `  ${w.role} ${w.id} ${w.status} (${named(w.title, w.slice)})`));
  if (!d.first && !d.requests_changed && !d.changed.length && !d.checkpoints.length && !d.workers_finished.length && !d.settled?.length) o.push('', 'Nothing changed since you last looked.');
  const mix = [];
  if (d.work_mix?.total > 0) {
    const s = d.work_mix.share;
    mix.push(`Work mix (last ${d.work_mix.days} days, ${d.work_mix.total} lines)`, `  product ${s.product}% · tests ${s.tests}% · Buddy records ${s.records}% · evidence ${s.evidence}% · process ${s.process}%`);
  }
  const routeList = Object.entries(d.routes || {}).filter(([, n]) => n > 0).sort(([a], [b]) => routeRank(a) - routeRank(b) || a.localeCompare(b));
  if (routeList.length) mix.push(`Routes used (last 14 days): ${routeList.map(([k, n]) => `${k === 'quick_fix' ? 'quick fix' : k} ${n}`).join(' · ')}`);
  if (mix.length) o.push('', ...mix);
  return o.join('\n') + '\n';
}
