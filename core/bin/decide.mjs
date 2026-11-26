#!/usr/bin/env node
// usage: decide.mjs --title .. --requested-by .. --decided-by human|agent --context .. --options .. --outcome .. --reason .. --rule "text|origin" [--rule ..]
//        [--slice <change>: the change it was taken for] [--supersedes id] [--question id] [--evidence ref] [--drivers ..] [--consequences ..] [--confirmation ..]
//        [--pros-cons ..] [--consulted who] [--informed who] [--built built|partly|"not built"|..] [--where ..]
// Writes an architecture decision record in MADR 4 to docs/decisions/ and marks the one it supersedes.
import { decideV0 } from '../src/decide.mjs';
import { recordApproval } from '../src/proc.mjs';
const a = process.argv.slice(2); const o = { rule: [], supersedes: [], question: [], consulted: [], informed: [] };
for (let i = 0; i < a.length; i += 2) { const k = a[i].replace(/^--/, ''); if (Array.isArray(o[k])) o[k].push(a[i + 1]); else o[k] = a[i + 1]; }
try {
  if (o.format) throw new Error('--format is gone: buddy decide writes MADR 4 records to docs/decisions/');
  const rules = o.rule.map(r => { const [text, origin = 'agent'] = r.split('|'); return { text, origin }; });
  const r = decideV0({ title: o.title, requested_by: o['requested-by'], decided_by: o['decided-by'], context: o.context, options: o.options, outcome: o.outcome, reason: o.reason, drivers: o.drivers,
    consequences: o.consequences, confirmation: o.confirmation, pros_cons: o['pros-cons'], consulted: o.consulted, informed: o.informed, built: o.built, where: o.where,
    slice: o.slice, supersedes: o.supersedes, questions: o.question, evidence: o.evidence, rules });
  console.log(`wrote ${r.file}`);
  if (o['decided-by'] === 'human') recordApproval(process.cwd(), [r.file, ...r.superseded], `decision ${r.id}: ${o.title}`);   // an ADR the owner decided is committed at once (R281)
} catch (e) { console.error(`error: ${e.message}`); process.exit(1); }
