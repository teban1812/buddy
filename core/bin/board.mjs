#!/usr/bin/env node
// usage: board.mjs [--repo <dir>] [--now <ISO time>] [--out board.html] [--json]
// Radiators R1 (board) and R3 (waiting for you), computed from the records only. `now` is a parameter so the same files give the same bytes.
import fs from 'node:fs';
import { loadBoard, boardText, boardHtml } from '../src/board.mjs';
import { boardMeasures } from '../src/digest.mjs';
import { refreshIndex } from '../src/index.mjs';
import { bringTools, bringReport } from '../src/toolfiles.mjs';
import { missingPanelReport } from '../src/tools.mjs';
const a = process.argv.slice(2); const o = {}; for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) { const k = a[i].slice(2); o[k] = k === 'json' ? true : a[++i]; }
const now = o.now || new Date().toISOString().slice(0, 19) + 'Z';
if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(now)) { console.error('--now must look like 2026-10-31T18:00:00Z'); process.exit(2); }
const repo = o.repo || process.cwd(); const { index } = refreshIndex(repo);   // the index of the records, rebuilt from what changed and left up to date (R138, R148)
const b = loadBoard(repo, now, { index });
if (o.out) { fs.writeFileSync(o.out, boardHtml(b, boardMeasures(repo, b, index))); console.log(`wrote ${o.out}`); } else if (o.json) console.log(JSON.stringify(b, null, 1));
else console.log(boardText(b).trimEnd() + bringReport(bringTools(repo)) + missingPanelReport());   // picking the project up: a tool found here whose files are missing gets them (never over what exists)
