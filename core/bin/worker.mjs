#!/usr/bin/env node
// usage: worker.mjs register --slice <id> --role dev|reviewer|other --id <runtime id> [--runtime claude-code|antigravity] [--pid N] [--session <id>]
//        worker.mjs seen --id <id>                       a sign of life (Dev calls it as it works)
//        worker.mjs finish --id <id> [--status done|stopped|lost]
//        worker.mjs list [--slice <id>] [--json]         [--repo <dir>] on every command
// The registry of the workers raised for a slice (R60). After a cut, Buddy asks each running worker by its id before raising another.
import { registerWorker, seenWorker, finishWorker, workers } from '../src/workers.mjs';
const a = process.argv.slice(2); const cmd = a.shift(); const o = {};
for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) { const k = a[i].slice(2); o[k] = k === 'json' ? true : a[++i]; }
const repo = o.repo || process.cwd(); const need = (v, w) => { if (!v) { console.error(`missing ${w}`); process.exit(2); } return v; };
try {
  if (cmd === 'register') { registerWorker(repo, { slice: need(o.slice, '--slice'), role: need(o.role, '--role'), id: need(o.id, '--id'), runtime: o.runtime, pid: o.pid ? Number(o.pid) : undefined, session: o.session }); console.log(`registered ${o.role} ${o.id} on ${o.slice}`); }
  else if (cmd === 'seen') { seenWorker(repo, need(o.id, '--id')); console.log(`seen ${o.id}`); }
  else if (cmd === 'finish') { finishWorker(repo, need(o.id, '--id'), o.status); console.log(`${o.id} ${o.status || 'done'}`); }
  else if (cmd === 'list') { const l = workers(repo, { slice: o.slice }); console.log(o.json ? JSON.stringify(l, null, 1) : l.length ? l.map(w => `${w.role.padEnd(8)} ${w.id}  ${w.status}${w.pid_state ? ` (pid ${w.pid_state})` : ''}  ${w.slice}  last seen ${w.age} ago`).join('\n') : 'No workers registered.'); }
  else { console.error('usage: worker.mjs register|seen|finish|list (see the header of this file)'); process.exit(2); }
} catch (e) { console.error(`refused: ${e.message}`); process.exit(1); }
