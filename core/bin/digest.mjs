#!/usr/bin/env node
// usage: digest.mjs [--repo <dir>] [--since <ISO time>] [--now <ISO time>] [--stale-minutes N] [--mark] [--json]
// Radiator R10: what changed since the Product Owner last looked. The PO cannot be notified when absent (R65), so this is the answer to
// "how are things going?". It reads only; with --mark it then records `now` as the last look (.buddy/last-looked). Without --since it starts from that mark.
import { digest, digestText, writeMark } from '../src/digest.mjs';
import { refreshIndex } from '../src/index.mjs';
const a = process.argv.slice(2); const o = {}; for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) { const k = a[i].slice(2); o[k] = ['json', 'mark'].includes(k) ? true : a[++i]; }
const T = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/; const now = o.now || new Date().toISOString().slice(0, 19) + 'Z'; const repo = o.repo || process.cwd();
for (const [k, v] of [['--now', now], ['--since', o.since]]) if (v && !T.test(v)) { console.error(`${k} must look like 2026-10-31T18:00:00Z`); process.exit(2); }
try {
  const { index } = refreshIndex(repo);   // the index of the records, rebuilt from what changed and left up to date (R138, R148)
  const d = digest(repo, now, { index, since: o.since, staleMinutes: o['stale-minutes'] ? Number(o['stale-minutes']) : undefined });
  console.log(o.json ? JSON.stringify(d, null, 1) : digestText(d).trimEnd());
  if (o.mark) writeMark(repo, now);
} catch (e) { console.error(`refused: ${e.message}`); process.exit(1); }
