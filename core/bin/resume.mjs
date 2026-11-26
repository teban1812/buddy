#!/usr/bin/env node
// usage: resume.mjs [<slice id>] [--repo <dir>] [--now <ISO time>] [--json | --handover]
// Without an id: the slices in flight (building, rework, blocked). With an id: the brief to relaunch Dev from the files (R53, R57);
// --handover writes it to .buddy/handover/ and prints the file's path, which Buddy gives Dev (R134).
import { resumeBrief, briefText, inFlight, writeHandover } from '../src/resume.mjs';
const a = process.argv.slice(2); const o = {}; const pos = [];
for (let i = 0; i < a.length; i++) { if (a[i].startsWith('--')) { const k = a[i].slice(2); o[k] = ['json', 'handover'].includes(k) ? true : a[++i]; } else pos.push(a[i]); }
const now = o.now || new Date().toISOString().slice(0, 19) + 'Z'; const repo = o.repo || process.cwd();
try {
  if (!pos[0]) {
    const l = inFlight(repo, now);
    console.log(o.json ? JSON.stringify(l, null, 1) : l.length ? l.map(s => `${s.id}  ${s.status.padEnd(9)} ${s.title}  [${s.steps_done}/${s.steps_total}]  · ${s.age}`).join('\n') : 'Nothing is in flight.');
  } else if (o.handover) console.log(writeHandover(repo, pos[0], now));
  else { const b = resumeBrief(repo, pos[0], now); console.log(o.json ? JSON.stringify(b, null, 1) : briefText(b).trimEnd()); }
} catch (e) { console.error(`refused: ${e.message}`); process.exit(1); }
