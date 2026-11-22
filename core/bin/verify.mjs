#!/usr/bin/env node
// usage: verify.mjs <dir|file>... [--require-risk-confirmed] [--canonical] [--json]      schema, id, reference and state checks on Buddy files
//        verify.mjs --madr [--commit 1] [--expect N]                      legacy check of docs/decisions/NNNN-*.md against git (port of buddy.mjs verify)
import { verify } from '../src/verify.mjs';
import { verifyMadr } from '../src/decide.mjs';
const args = process.argv.slice(2);
if (args.includes('--madr')) {
  const o = {}; for (let i = 0; i < args.length; i++) if (args[i] === '--commit') o.commit = args[++i]; else if (args[i] === '--expect') o.expect = args[++i];
  const r = verifyMadr(o); if (r.problems.length) { console.error(r.problems.join('\n')); process.exit(1); } console.log(`ok: ${r.count} records`); process.exit(0);
}
const flags = args.filter(a => a.startsWith('--')); const paths = args.filter(a => !a.startsWith('--'));
if (!paths.length) { console.error('usage: verify.mjs <dir|file>... [--require-risk-confirmed] [--canonical] [--json] | --madr'); process.exit(2); }
const r = verify(paths, { requireRiskConfirmed: flags.includes('--require-risk-confirmed'), canonical: flags.includes('--canonical') });
if (flags.includes('--json')) console.log(JSON.stringify(r, null, 1));
else { for (const p of r.problems) console.error(`${p.file}: ${p.where}: ${p.message}`); console.log(`${r.count} Buddy file(s) checked, ${r.problems.length} problem(s)`); }
process.exit(r.problems.length ? 1 : 0);
