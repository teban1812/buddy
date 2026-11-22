#!/usr/bin/env node
// usage: index.mjs [--repo <dir>] [--force] [--json]
// The index of the records (R138): every record read in one pass into .git/buddy/index.json, rebuilt only when a record changed.
// Prints one line with what it holds, or the index itself with --json.
import { refreshIndex, indexText } from '../src/index.mjs';
const a = process.argv.slice(2); const o = {}; for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) { const k = a[i].slice(2); o[k] = ['json', 'force'].includes(k) ? true : a[++i]; }
try {
  const r = refreshIndex(o.repo || process.cwd(), { force: !!o.force });
  console.log(o.json ? JSON.stringify(r.index, null, 1) : `${indexText(r.index)} (${r.rebuilt ? 'rebuilt' : 'up to date'})`);
} catch (e) { console.error(`refused: ${e.message}`); process.exit(1); }
