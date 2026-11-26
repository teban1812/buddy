#!/usr/bin/env node
// usage:
//   context.mjs check <file> [--require-risk-confirmed] [--json]   verify statement tags; with the flag, gate on the risk appetite (exit 1 when blocked)
//   context.mjs card <file>                                        the confirmation card for the owner
//   context.mjs confirm <file> (--all-risk | --line N)... [--text "corrected text" with one --line] [--by owner: needed on a step's record]
//   context.mjs approve <record> --by owner                        the owner approves a step's record whole, once every line is confirmed or decided
//   context.mjs accept-assumed <file>                              the owner chooses to go on with the risk appetite left assumed
//   context.mjs add --section "<section>" --text "<text>" [--assumed] [--file docs/context.md]   one statement, the owner's words (human, today) or drafted (assumed)
//   context.mjs intake --notes <file|text> [--out docs/context.md] [--facts <file>] [--model m] [--title t] [--dry]   draft or merge; everything drafted is assumed
import fs from 'node:fs';
import path from 'node:path';
import { readContext, riskState, contextCard, confirmStatements, acceptAssumed, draftContext, intakePrompt, parseIntake, suppressionSources, addStatement, isStepRecord, approveRecord } from '../src/context.mjs';
import { claudeAsk } from '../src/analysis.mjs';
import { recordApproval } from '../src/proc.mjs';

const argv = process.argv.slice(2); const cmd = argv.shift(); const pos = []; const o = { line: [] }; const flags = new Set(['require-risk-confirmed', 'json', 'all-risk', 'dry', 'assumed']);
for (let i = 0; i < argv.length; i++) { if (argv[i].startsWith('--')) { const k = argv[i].slice(2); if (flags.has(k)) o[k] = true; else if (k === 'line') o.line.push(argv[++i]); else o[k] = argv[++i]; } else pos.push(argv[i]); }
const file = pos[0];
try {
  if (cmd === 'check') {
    const ctx = readContext(file); const problems = [];
    if (!ctx.statements.length) problems.push('no statements found (bullets that end with an origin tag)');
    for (const s of ctx.statements) { if (!s.origin) problems.push(`line ${s.line}: no origin tag: "${s.text.slice(0, 50)}"`); else if (s.origin === 'human' && !s.date) problems.push(`line ${s.line}: a human-confirmed statement needs a date`); }
    const risk = riskState(ctx); const sup = suppressionSources(ctx);
    if (risk.state === 'missing' && risk.named) problems.push(risk.message);
    const gate = o['require-risk-confirmed'] && ['blocked', 'missing'].includes(risk.state);
    if (o.json) console.log(JSON.stringify({ problems, risk: { state: risk.state, message: risk.message, unconfirmed: risk.unconfirmed.map(s => ({ line: s.line, text: s.text, origin: s.origin })) }, usable_for_look_before_asking: sup.usable.length, stale: sup.stale.length }, null, 1));
    else { for (const p of problems) console.error(p); console.log(`risk appetite: ${risk.state} - ${risk.message}\nconfirmed statements usable to answer questions: ${sup.usable.length}${sup.stale.length ? `, stale (not usable until reconfirmed): ${sup.stale.length}` : ''}`); }
    process.exit(problems.length || gate ? 1 : 0);
  } else if (cmd === 'card') console.log(contextCard(readContext(file)));
  else if (cmd === 'confirm') {
    if (o.by != null && o.by !== 'owner') throw new Error(`--by takes only owner (got ${o.by})`);
    if (file && isStepRecord(file) && o.by !== 'owner') throw new Error(`${file} is the record of a step: only the Product Owner confirms or corrects its lines (--by owner), and only after he said so in the conversation`);
    const corrections = {}; if (o.text) { if (o.line.length !== 1) throw new Error('--text needs exactly one --line'); corrections[o.line[0]] = o.text; }
    const r = confirmStatements(fs.readFileSync(file, 'utf8'), { lines: o.line, allRisk: !!o['all-risk'], corrections }); fs.writeFileSync(file, r.text); console.log(`confirmed line(s): ${r.changed.join(', ') || '(none changed)'}`);
    if (r.changed.length) recordApproval(process.cwd(), [file], `confirmation of line(s) ${r.changed.join(', ')} of ${file}`);   // committed at once (R281)
  } else if (cmd === 'approve') {
    if (!file || !isStepRecord(file)) throw new Error(`${file || '(no file)'} is not the record of a step (named by record: in docs/steps/<step>/step.md); only a step's record is approved`);
    fs.writeFileSync(file, approveRecord(fs.readFileSync(file, 'utf8'), { by: o.by })); console.log(`approved by the owner: ${file}; any later edit needs a new approval`); recordApproval(process.cwd(), [file], `approval of ${file}`);
  } else if (cmd === 'add') {
    const f = o.file || file || 'docs/context.md';
    if (!fs.existsSync(f)) throw new Error(`there is no ${f} here; create the project first with: buddy init`);
    const r = addStatement(fs.readFileSync(f, 'utf8'), { section: o.section, statement: o.text, assumed: !!o.assumed });
    if (!r.added) { console.log(`already in "${r.section}", nothing changed`); process.exit(0); }
    fs.writeFileSync(f, r.text); console.log(`added to "${r.section}" in ${f}:\n  ${r.line}`);
  } else if (cmd === 'accept-assumed') { fs.writeFileSync(file, acceptAssumed(fs.readFileSync(file, 'utf8'))); console.log('recorded: the owner chose to go on with the risk appetite left assumed'); recordApproval(process.cwd(), [file], `choice to go on with the risk appetite of ${file} left assumed`); }
  else if (cmd === 'intake') {
    const out = o.out || 'docs/context.md'; const notes = fs.existsSync(o.notes || '') ? fs.readFileSync(o.notes, 'utf8') : (o.notes || '');
    if (!notes) throw new Error('--notes needs rough notes (text or a file)');
    const existing = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : null;
    const confirmed = existing ? readContext(out).statements.filter(s => s.origin === 'human').map(s => '- ' + s.text).join('\n') : '';
    const prompt = intakePrompt({ notes, facts: o.facts ? fs.readFileSync(o.facts, 'utf8') : '', existing: confirmed });
    if (o.dry) { console.log(prompt); process.exit(0); }
    let cost = 0; const spec = parseIntake(await claudeAsk({ model: o.model, onCost: c => { cost += c; } })(prompt));
    const text = draftContext(spec, { title: o.title || 'Business context', existing }); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, text);
    const ctx = readContext(out); console.log(`wrote ${out} (${ctx.statements.length} statements, none confirmed; cost ${cost.toFixed(4)} USD)\n\n${contextCard(ctx)}`);
  } else { console.error('usage: context.mjs check|card|confirm|approve|add|accept-assumed|intake ...'); process.exit(2); }
} catch (e) { console.error(`error: ${e.message}`); process.exit(1); }
