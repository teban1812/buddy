#!/usr/bin/env node
// usage: suite.mjs [--deep] [--repo <dir>] [--validate-timeout <seconds>]
// Runs the project's whole test suite (`validate:full`, falling back to `validate`) — or with `--deep`, `validate:deep` — once and keeps the result.
import { runSuite } from '../src/suite.mjs';
const a = process.argv.slice(2); const o = {};
for (let i = 0; i < a.length; i++) {
  if (a[i] === '--deep') o.deep = true;
  else if (a[i].startsWith('--')) o[a[i].slice(2)] = a[++i];
}
try { const r = runSuite({ repo: o.repo || process.cwd(), timeoutSec: o['validate-timeout'] ? Number(o['validate-timeout']) : undefined, deep: !!o.deep }); console.log(r.text); process.exit(r.passed ? 0 : 1); }
catch (e) { console.error(`refused: ${e.message}`); process.exit(1); }
