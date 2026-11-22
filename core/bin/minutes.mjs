#!/usr/bin/env node
// usage: minutes.mjs [<change or milestone>] [--repo <dir>] [--json]
// How many times each change asked the owner something and how long it waited for them (time it waited for the owner, not their working
// time), all time, from what the records and their git history hold. With a change (or a piece of it), each of its events; with a milestone, its changes.
import { ownerMinutes, minutesLines } from '../src/minutes.mjs';
import { transcriptFiles, readEntries, ownerEffort, effortLines } from '../src/ownertime.mjs';
import { buildIndex } from '../src/index.mjs';
const a = process.argv.slice(2); const o = {}; const pos = [];
for (let i = 0; i < a.length; i++) if (a[i] === '--json') o.json = true; else if (a[i] === '--repo') o.repo = a[++i]; else if (a[i] === '--transcripts') o.transcripts = a[++i]; else if (a[i] === '--help') o.help = true; else pos.push(a[i]);
if (o.help) { console.log('usage: buddy minutes [<change or milestone>] [--repo <dir>] [--transcripts <folder>] [--json]'); process.exit(0); }
try {
  const only = pos[0]; const repo = o.repo || process.cwd(); const x = ownerMinutes(repo, { only });
  // the owner's own effort, from the conversation records (the other number below is how long things waited for them)
  const files = transcriptFiles(repo, { dir: o.transcripts }); const effort = ownerEffort(readEntries(files));
  const accepted = buildIndex(repo).changes.filter(c => !c.change && c.data?.accepted?.at).map(c => c.data.accepted.at.slice(0, 10));
  if (o.json) console.log(JSON.stringify({ ...x, effort: { ...effort, files: files.length, accepted_in_that_time: accepted.filter(d => effort.first && d >= effort.first.slice(0, 10) && d <= effort.last.slice(0, 10)).length } }, null, 1));
  else if (!x.changes.length) console.log([...effortLines(effort, { files: files.length, accepted }), ...(effort.messages ? [''] : []), `Nothing was asked of you${only ? ` in ${only}` : ''}: no question, acceptance or checkpoint exception on record.`].join('\n'));
  else console.log([...effortLines(effort, { files: files.length, accepted }), ...(effort.messages ? [''] : []), `Times you were asked, all time (time it waited for you, not your working time)`, ...minutesLines(x, { events: !!only && !x.milestones.some(m => m.id === only) })].join('\n'));
} catch (e) { console.error(`refused: ${e.message}`); process.exit(1); }
