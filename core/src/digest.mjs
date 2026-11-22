// Radiator R10, the digest: what changed since the Product Owner last looked (R65). There is no way to reach an absent person, so this is
// what Buddy answers when they ask "how are things going?". A pure function of the records, the checkpoint evidence, the worker registry,
// `since` and an injected clock. Reading it writes nothing; `--mark` (writeMark) is the only write and is the caller's explicit choice.
// Without an activity log (Q76) it reports the present state of what changed (by the slice's `updated`), not each transition.
import fs from 'node:fs';
import path from 'node:path';
import { loadBoard, ago, pulseText, nowLine, nextLine } from './board.mjs';
import { workers } from './workers.mjs';
import { buildIndex } from './index.mjs';
import { requestTotalsText, readRequests, mapChanges, mapChangesText, REQUESTS } from './requests.mjs';
import { parseDocument } from './frontmatter.mjs';
import { git } from './proc.mjs';
import { named } from './ids.mjs';
import { settledRecords } from './settle.mjs';
import { ownerMinutes, minutesLines } from './minutes.mjs';
import { buddyDir, isGitRepo } from './gitdir.mjs';

const markFile = repo => path.join(buddyDir(repo), 'last-looked');
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
export const readMark = repo => { try { const t = fs.readFileSync(markFile(repo), 'utf8').trim(); return TIME.test(t) ? t : null; } catch { return null; } };
export function writeMark(repo, now) {
  if (!isGitRepo(repo)) throw new Error('not a git repository: the marker lives in .git/buddy/');
  fs.mkdirSync(path.dirname(markFile(repo)), { recursive: true }); fs.writeFileSync(markFile(repo), now + '\n');
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

export function digest(repo, now, { since, staleMinutes, index } = {}) {
  const x = index ?? buildIndex(repo); const from = since ?? readMark(repo); const b = loadBoard(repo, now, { staleMinutes, index: x });
  const after = t => !from || Date.parse(t) > Date.parse(from);
  const changed = b.slices.filter(r => after(r.updated)).map(r => ({ id: r.id, title: r.title, kind: r.kind, status: r.status, steps: r.steps, ago: ago(r.updated, now), pulse: r.pulse ?? null, merge: r.merge ?? null }));
  // checkpoint evidence, as the index read it: in each change folder (R87), wherever it lives (R118), and in .git/buddy/ for checkpoints run without a change
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
  return { now, since: from ?? null, first: !from, current: b.current, next: b.next, waiting: b.waiting, view: b.view, requests: b.requests ?? null, requests_changed, changed, checkpoints, workers_finished: finished, stalled, settled, minutes };
}

const t16 = t => t.slice(0, 16).replace('T', ' ');
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
  return o.join('\n') + '\n';
}
