#!/usr/bin/env node
// usage: find.mjs "<words>" [--repo <dir>] [--json]
// Finds a change, a piece, a milestone, a criterion, a request, a question or a decision by its words, through the index (R138): every word
// must be in it, case and accents aside. One line per hit: what it is, its id, its text and the file where it lives.
import { refreshIndex, find, findText } from '../src/index.mjs';
const a = process.argv.slice(2); const o = {}; const pos = []; for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) { const k = a[i].slice(2); o[k] = k === 'json' ? true : a[++i]; } else pos.push(a[i]);
if (!pos.join(' ').trim()) { console.error('usage: find.mjs "<words>" [--repo <dir>] [--json]'); process.exit(2); }
try {
  const hits = find(refreshIndex(o.repo || process.cwd()).index, pos.join(' '));
  console.log(o.json ? JSON.stringify(hits, null, 1) : findText(hits));
} catch (e) { console.error(`refused: ${e.message}`); process.exit(1); }
