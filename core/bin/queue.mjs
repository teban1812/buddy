#!/usr/bin/env node
// usage:
//   queue.mjs new --in spec.json [--slice <id>] [--out <file>]  create a batch from a JSON spec (see src/queue.mjs createBatch); for a change, a slice
//                                                               or a milestone (--slice <name> or the spec's `slice`) it goes to the folder of the change
//                                                               or of the milestone as questions-<n>.md (R87, R118), otherwise to docs/questions.md
//   queue.mjs show <file>                                       print the cards
//   queue.mjs answer <file> --q <id> (--option <id> | --text <t> | --delegated)
//   queue.mjs assume <file>                                     proceed on the defaults of open non-blocking questions
//   queue.mjs confirm <file> (--q <id> [--option <id>] | --all)  the owner reviewed an assumed default (a question id, or <batch id>#<n> for a free-text one), or says ok to all of them
//   queue.mjs status <file>                                     exit 3 while a blocking question is open
//   queue.mjs analyse <file> [--request <t>] [--context <f>] [--model <m>] [--dry]   answer analysis; writes the follow-up batch next to <file>
//   queue.mjs defaults <file>...                                list assumed defaults nobody has confirmed (exit 1 if any)
import fs from 'node:fs';
import path from 'node:path';
import { confirmAllAssumed, loadBatchFile, createBatch, writeBatchFile, cards, answerQuestion, assumeDefaults, confirmAssumed, blockingOpen, unconfirmedDefaults, addAssumedDefaults } from '../src/queue.mjs';
import { analyseAnswers, buildAnalysisPrompt, claudeAsk } from '../src/analysis.mjs';
import { changeDirOf } from '../src/slicestore.mjs';
import { named } from '../src/ids.mjs';
import { recordApproval } from '../src/proc.mjs';

const argv = process.argv.slice(2); const cmd = argv.shift(); const pos = []; const o = {}; const flags = new Set(['delegated', 'dry', 'all']);
for (let i = 0; i < argv.length; i++) { if (argv[i].startsWith('--')) { const k = argv[i].slice(2); if (flags.has(k)) o[k] = true; else o[k] = argv[++i]; } else pos.push(argv[i]); }
const need = (v, what) => { if (!v) { console.error(`missing ${what}`); process.exit(2); } return v; };
try {
  if (cmd === 'new') {
    const spec = JSON.parse(fs.readFileSync(need(o.in, '--in'), 'utf8')); if (o.slice) spec.slice = o.slice;
    const dir = spec.slice ? changeDirOf(process.cwd(), spec.slice) : null;                // refuses a slice that does not exist: a batch is never linked to nothing
    let n = 1; while (dir && fs.existsSync(path.join(dir, `questions-${n}.md`))) n++;
    const file = o.out || (dir ? path.join(dir, `questions-${n}.md`) : 'docs/questions.md');
    const b = createBatch(spec); writeBatchFile(file, b); console.log(`wrote ${file} (${b.id})\n\n${cards(b)}`);
  } else if (cmd === 'show') console.log(cards(loadBatchFile(need(pos[0], '<file>'))));
  else if (cmd === 'answer') {
    const f = need(pos[0], '<file>'); const b = loadBatchFile(f);
    answerQuestion(b, need(o.q, '--q'), { option: o.option, text: o.text, delegated: !!o.delegated }); writeBatchFile(f, b); console.log(cards(b, { only: o.q })); recordApproval(process.cwd(), [f], `answer to ${o.q}`);
  } else if (cmd === 'assume') {
    const f = need(pos[0], '<file>'); const b = loadBatchFile(f); const applied = assumeDefaults(b);
    if (blockingOpen(b).length) { console.error(`blocking question(s) still open: ${blockingOpen(b).map(q => named(q.situation, q.id)).join(' | ')}`); process.exit(3); }
    writeBatchFile(f, b); console.log(`assumed defaults for: ${applied.join(', ') || '(none)'}`);
  } else if (cmd === 'confirm') {
    const f = need(pos[0], '<file>'); const b = loadBatchFile(f);
    if (o.all) { const ids = confirmAllAssumed(b); writeBatchFile(f, b); console.log(`confirmed ${ids.length} assumed default(s): ${ids.join(', ') || '(none)'}`); if (ids.length) recordApproval(process.cwd(), [f], `confirmation of the assumed defaults ${ids.join(', ')}`); }
    else { confirmAssumed(b, need(o.q, '--q (or --all)'), { option: o.option }); writeBatchFile(f, b); console.log(cards(b, { only: o.q })); recordApproval(process.cwd(), [f], `confirmation of the assumed default ${o.q}`); }
  } else if (cmd === 'status') {
    const b = loadBatchFile(need(pos[0], '<file>')); const bo = blockingOpen(b);
    console.log(bo.length ? `waiting for the human on ${bo.length} blocking question(s): ${bo.map(q => `${q.situation} [${q.id}]`).join(' | ')}` : `batch ${b.id}: ${b.status}`); process.exit(bo.length ? 3 : 0);
  } else if (cmd === 'analyse') {
    const f = need(pos[0], '<file>'); const b = loadBatchFile(f); const context = o.context ? fs.readFileSync(o.context, 'utf8') : '';
    if (o.dry) { console.log(buildAnalysisPrompt({ request: o.request, context, batch: b })); process.exit(0); }
    let cost = 0; const r = await analyseAnswers({ request: o.request, context, batch: b, ask: claudeAsk({ model: o.model, onCost: c => { cost += c; } }) });
    if (r.defaults.length) { addAssumedDefaults(b, r.defaults); writeBatchFile(f, b); }
    if (r.followupBatch) { const out = path.join(path.dirname(f), `${path.basename(f, '.md')}.round${r.followupBatch.round}.md`); writeBatchFile(out, r.followupBatch); console.log(`follow-up batch written to ${out}\n\n${cards(r.followupBatch)}`); }
    else console.log('No follow-up needed.');
    if (r.defaults.length) console.log(`\nAssumed defaults recorded for review:\n${r.defaults.map(d => '  - ' + d).join('\n')}`);
    for (const w of r.warnings) console.error('warning: ' + w);
    console.log(`(analysis cost ${cost.toFixed(4)} USD)`);
  } else if (cmd === 'defaults') {
    const list = unconfirmedDefaults(pos); for (const d of list) console.log(`${d.id}  ${d.text}`);
    console.log(`${list.length} assumed default(s) not confirmed by the human`); process.exit(list.length ? 1 : 0);
  } else { console.error('usage: queue.mjs new|show|answer|assume|confirm|status|analyse|defaults ...'); process.exit(2); }
} catch (e) { console.error(`error: ${e.message}`); process.exit(1); }
