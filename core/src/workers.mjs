// The registry of workers (Dev, the Reviewer, detached processes) raised for a slice, so that after a cut Buddy asks for each by its id
// before raising another one (R60). Local, append-only JSON lines at .git/buddy/workers.jsonl, written only by this module through the CLI.
// The id is the runtime's own (a Claude Code agent id, a session id); a pid, when there is one, lets the program say if the process still runs.
import fs from 'node:fs';
import path from 'node:path';
import { age } from './board.mjs';
import { SLICE_ID } from './ids.mjs';
import { buddyDir, isGitRepo } from './gitdir.mjs';

const ROLES = ['dev', 'reviewer', 'other'];
const STATUSES = ['done', 'stopped', 'lost'];
const stamp = now => now().toISOString().slice(0, 19) + 'Z';
const fileOf = repo => path.join(buddyDir(repo), 'workers.jsonl');

function append(repo, ev) {
  if (!isGitRepo(repo)) throw new Error('not a git repository: the worker registry lives in .git/buddy/');
  fs.mkdirSync(path.dirname(fileOf(repo)), { recursive: true }); fs.appendFileSync(fileOf(repo), JSON.stringify(ev) + '\n');
}

export function registerWorker(repo, { slice, role, id, runtime = 'claude-code', pid, session } = {}, { now = () => new Date() } = {}) {
  if (!SLICE_ID.test(slice || '')) throw new Error(`a worker belongs to a slice: ${slice} is not a slice id`);
  if (!ROLES.includes(role)) throw new Error(`role must be one of ${ROLES.join(', ')}`);
  if (!id || /\s/.test(id)) throw new Error('a worker needs the id the runtime gave it (no spaces)');
  if (pid !== undefined && !(Number.isInteger(pid) && pid > 0)) throw new Error('pid must be a positive integer');
  if (workers(repo, { now }).some(w => w.id === id)) throw new Error(`worker ${id} is already registered`);
  append(repo, { at: stamp(now), event: 'register', id, slice, role, runtime, ...(pid ? { pid } : {}), ...(session ? { session } : {}) });
}
export function seenWorker(repo, id, { now = () => new Date() } = {}) {
  if (!workers(repo, { now }).some(w => w.id === id)) throw new Error(`no worker ${id}`); append(repo, { at: stamp(now), event: 'seen', id });
}
export function finishWorker(repo, id, status = 'done', { now = () => new Date() } = {}) {
  if (!STATUSES.includes(status)) throw new Error(`status must be one of ${STATUSES.join(', ')}`);
  if (!workers(repo, { now }).some(w => w.id === id)) throw new Error(`no worker ${id}`); append(repo, { at: stamp(now), event: 'finish', id, status });
}

export const pidAlive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

// Folds the log into one record per worker. A worker with a pid that is not running any more, and that nobody finished, is `lost`.
export function workers(repo, { slice, now = () => new Date(), alive = pidAlive } = {}) {
  const f = fileOf(repo); if (!fs.existsSync(f)) return [];
  const by = new Map(); const at = stamp(now);
  for (const line of fs.readFileSync(f, 'utf8').split('\n').filter(Boolean)) {
    let e; try { e = JSON.parse(line); } catch { continue; }
    if (e.event === 'register') by.set(e.id, { id: e.id, slice: e.slice, role: e.role, runtime: e.runtime, pid: e.pid ?? null, session: e.session ?? null, started: e.at, last_seen: e.at, status: 'running', ended: null });
    else if (by.has(e.id)) { const w = by.get(e.id); if (e.event === 'seen') w.last_seen = e.at; else if (e.event === 'finish') { w.status = e.status; w.ended = e.at; } }
  }
  return [...by.values()].filter(w => !slice || w.slice === slice).map(w => {
    const running = w.status === 'running'; const pidState = w.pid ? (alive(w.pid) ? 'alive' : 'gone') : 'unknown';
    return { ...w, status: running && pidState === 'gone' ? 'lost' : w.status, pid_state: running ? pidState : null, age: age(w.last_seen, at) };
  });
}
