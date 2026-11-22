#!/usr/bin/env node
// usage: settle.mjs [--since <commit>] [--repo <dir>] [--json]
// Settles the commits made without a slice since the last settle (or --since): classifies them, runs validate and the scan, keeps the record in
// .git/buddy/settled/ and says whether the owner has to look (R54). Small corrections leave no record in docs/buddy/ (R91).
// When validate fails nothing is settled and it exits 1 (R157): run it again once the checks pass.
import { settle } from '../src/settle.mjs';
const a = process.argv.slice(2); const o = {}; for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) { const k = a[i].slice(2); o[k] = k === 'json' ? true : a[++i]; }
try { const r = settle({ repo: o.repo || process.cwd(), since: o.since }); console.log(o.json ? JSON.stringify(r, null, 1) : r.text); if (r.record && !r.settled) process.exitCode = 1; }
catch (e) { console.error(`refused: ${e.message}`); process.exit(1); }
