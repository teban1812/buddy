#!/usr/bin/env node
// usage: migrate.mjs [--map names.json] [--dry] [--repo <dir>] [--json]
// Moves the records of older layouts into today's: the flat layout of before R87 (docs/buddy/slices, docs/buddy/questions) into one folder
// per change in the backlog, renaming old ids with the map ({ "<old id>": "<name>" }) and rewriting every reference; and the backlog of
// before R118 (docs/buddy/changes/) to docs/buddy/backlog/, each folder whole, through git mv when git tracks it. All or nothing; --dry
// prints the moves without writing. A second run finds nothing.
import fs from 'node:fs';
import { migrate } from '../src/migrate.mjs';
const a = process.argv.slice(2); const o = {}; for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) { const k = a[i].slice(2); o[k] = ['json', 'dry'].includes(k) ? true : a[++i]; }
try {
  const r = migrate(o.repo || process.cwd(), { map: o.map ? JSON.parse(fs.readFileSync(o.map, 'utf8')) : {}, dry: !!o.dry });
  console.log(o.json ? JSON.stringify(r, null, 1) : r.nothing ? 'Nothing to migrate: no record is left in an older layout.'
    : [`${r.dry ? 'would move' : 'moved'} ${r.moves.length} record(s)${r.dry ? ' (dry run, nothing written)' : ''}:`, ...r.moves.map(m => m.from === m.to ? `  ${m.to} (references followed)` : `  ${m.from} -> ${m.to}`),
      ...(r.dry || !Object.keys(r.renamed || {}).length ? [] : ['note: the commits already made keep the old ids'])].join('\n'));
} catch (e) { console.error(`refused: ${e.message}`); process.exit(1); }
