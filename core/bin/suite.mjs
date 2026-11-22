#!/usr/bin/env node
// usage: suite.mjs [--repo <dir>] [--validate-timeout <seconds>]
// Runs the project's whole test suite once and keeps the result, so the owner's acceptances can rest on it (no reviewer is asked, nothing else is checked).
import { runSuite } from '../src/suite.mjs';
const a = process.argv.slice(2); const o = {}; for (let i = 0; i < a.length; i += 2) o[a[i].replace(/^--/, '')] = a[i + 1];
try { const r = runSuite({ repo: o.repo || process.cwd(), timeoutSec: o['validate-timeout'] ? Number(o['validate-timeout']) : undefined }); console.log(r.text); process.exit(r.passed ? 0 : 1); }
catch (e) { console.error(`refused: ${e.message}`); process.exit(1); }
