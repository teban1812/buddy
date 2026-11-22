// The owner's own effort, estimated from the conversation records Claude Code keeps (~/.claude/projects/<folder>/*.jsonl): for each message the owner wrote, the time to
// read what Buddy said last and to write the answer. It is not the time a question waited for them (that is `buddy minutes`'s other number): a night in between costs nothing,
// and a long answer to a long message costs what it takes. The speeds are assumptions, said in the output; they make a number to compare over time, not a stopwatch.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const READ_WPM = 200, TYPE_WPM = 40, READ_CAP_MIN = 5, TYPE_CAP_MIN = 5;
const words = t => (String(t ?? '').trim().match(/\S+/g) || []).length;
const textOf = c => (typeof c === 'string' ? c : Array.isArray(c) ? c.filter(p => p?.type === 'text').map(p => p.text).join('\n') : '');

// The .jsonl files of the folder of `repo` and of its subfolders (Claude Code names the records' folder after the working folder, every character that is not a letter or digit as -).
export function transcriptFiles(repo, { home = os.homedir(), dir } = {}) {
  const root = dir ?? path.join(home, '.claude', 'projects'); let names = [];
  try { names = fs.readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name); } catch { return []; }
  const enc = path.resolve(repo).replace(/[^a-zA-Z0-9]/g, '-');
  const mine = dir ? names.concat('') : names.filter(n => n === enc || n.startsWith(`${enc}-`));
  const out = [];
  for (const n of mine) { const d = n ? path.join(root, n) : root; try { for (const f of fs.readdirSync(d)) if (f.endsWith('.jsonl')) out.push(path.join(d, f)); } catch { /* unreadable folder */ } }
  return out.sort();
}

// A message the owner wrote while Buddy was working is not a user entry: it is kept as "queued", with its text and the time it was sent. The automatic notices (a background
// task finished, a reminder of the system) are queued the same way and are not the owner's.
const machineMade = t => /^\s*</.test(t) || /\[SYSTEM NOTIFICATION|task-notification|system-reminder/.test(t);
const key = t => String(t).replace(/\s+/g, ' ').trim().slice(0, 80);

// entries: parsed lines of the records. Returns { messages, minutes, first, last, days: { 'YYYY-MM-DD': { messages, minutes } } }.
export function ownerEffort(entries) {
  const seen = new Set(); const seq = []; const sent = new Set(); const queued = [];
  for (const e of entries) {
    if (!e || !e.timestamp || (e.uuid && seen.has(e.uuid))) continue; if (e.uuid) seen.add(e.uuid);
    if (e.type === 'user' && e.origin?.kind === 'human' && !e.isMeta) { const t = textOf(e.message?.content); if (t.trim()) { seq.push({ ts: e.timestamp, human: true, words: words(t) }); sent.add(key(t)); } }
    else if (e.type === 'queue-operation' && e.operation === 'enqueue' && typeof e.content === 'string' && e.content.trim() && !machineMade(e.content)) queued.push({ ts: e.timestamp, text: e.content });
    else if (e.type === 'assistant') { const t = textOf(e.message?.content); if (t.trim()) seq.push({ ts: e.timestamp, human: false, words: words(t) }); }
  }
  for (const q of queued) if (!sent.has(key(q.text))) { sent.add(key(q.text)); seq.push({ ts: q.ts, human: true, words: words(q.text) }); }   // written while Buddy worked, counted once
  seq.sort((a, b) => a.ts.localeCompare(b.ts));
  const days = {}; let readable = 0, messages = 0, minutes = 0, first = null, last = null;
  for (const x of seq) {
    if (!x.human) { readable = x.words; continue; }           // what Buddy said last, which the owner reads once
    const m = Math.min(READ_CAP_MIN, readable / READ_WPM) + Math.min(TYPE_CAP_MIN, x.words / TYPE_WPM); readable = 0;
    const day = x.ts.slice(0, 10); (days[day] ||= { messages: 0, minutes: 0 }); days[day].messages++; days[day].minutes += m;
    messages++; minutes += m; first ||= x.ts; last = x.ts;
  }
  for (const d of Object.values(days)) d.minutes = Math.round(d.minutes * 10) / 10;
  return { messages, minutes: Math.round(minutes * 10) / 10, first, last, days };
}

export function readEntries(files) {
  const out = [];
  for (const f of files) { let text = ''; try { text = fs.readFileSync(f, 'utf8'); } catch { continue; } for (const l of text.split('\n')) { if (!l.trim()) continue; try { out.push(JSON.parse(l)); } catch { /* a half-written line */ } } }
  return out;
}

const span = min => { const m = Math.round(min); return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`; };
// accepted: the dates ('YYYY-MM-DD...') when changes were accepted, to say how much of the owner's effort each one took.
export function effortLines(x, { files = 0, accepted = [] } = {}) {
  if (!x.messages) return [];
  const o = [`Your own effort, estimated from the conversation records on this machine (${files} file${files === 1 ? '' : 's'}, ${x.first.slice(0, 10)} to ${x.last.slice(0, 10)}):`];
  const busiest = Object.entries(x.days).sort((a, b) => b[1].minutes - a[1].minutes)[0];
  o.push(`  You wrote ${x.messages} message${x.messages === 1 ? '' : 's'}; reading what Buddy said and writing your answers took about ${span(x.minutes)} (the busiest day, ${busiest[0]}, about ${span(busiest[1].minutes)}).`);
  const inside = accepted.filter(d => d >= x.first.slice(0, 10) && d <= x.last.slice(0, 10)).length;
  if (inside) o.push(`  In that time ${inside} change${inside === 1 ? ' was' : 's were'} accepted: about ${span(x.minutes / inside)} of yours for each one.`);
  o.push(`  Estimated at ${READ_WPM} words a minute to read and ${TYPE_WPM} to write (at most ${READ_CAP_MIN} min to read and ${TYPE_CAP_MIN} to write a message); a night or a pause costs nothing. It does NOT include the time you spend trying the software or thinking away from the conversation, so it is a floor. Only the records on this machine are counted: copy the ones of another machine to a folder and give it with --transcripts.`);
  return o;
}
