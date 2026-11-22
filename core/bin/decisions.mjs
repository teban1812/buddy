#!/usr/bin/env node
// usage: decisions.mjs [--state <state>] [--repo <dir>] [--json]
// The decisions of the requirements log, read through the index (R138), each with its id, title, whether it is built and where (R110).
import { refreshIndex } from '../src/index.mjs';
import { BUILT, decisionsText } from '../src/decisions.mjs';
const a = process.argv.slice(2); const o = {}; for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) { const k = a[i].slice(2); o[k] = k === 'json' ? true : a[++i]; }
if (o.state !== undefined && !BUILT.includes(o.state)) { console.error(`usage: decisions.mjs [--state ${BUILT.map(s => `"${s}"`).join('|')}] [--repo <dir>] [--json]`); process.exit(2); }
try {
  const ds = refreshIndex(o.repo || process.cwd()).index.decisions.filter(d => o.state === undefined || d.built === o.state);
  console.log(o.json ? JSON.stringify(ds.map(({ id, title, status, built, where }) => ({ id, title, status, built, where })), null, 1) : decisionsText(ds));
} catch (e) { console.error(`refused: ${e.message}`); process.exit(1); }
