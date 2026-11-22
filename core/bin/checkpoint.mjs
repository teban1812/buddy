#!/usr/bin/env node
// usage (inside the repo): checkpoint.mjs [--slice <slice id>] [--base <commit>] [--trailer <old slice name>]... --run <id> (--notes <file> | --notes - | --notes-text "<text>") [--human 1] [--log <file>] [--navigator <script>] [--model <m>] [--validate-timeout <seconds>] [--review-anyway 1]
// The notes come from a file, from the standard input (--notes -) or as text (--notes-text), so the checkpoint is one command on its own (R157).
// With --slice the request is read from the slice record and the slice moves from building to delivered (it stays in building when validate is red); without it the request is read from .git/buddy/request.txt (written by the harness, not by the agent). Evidence goes to .git/buddy/.
// What is measured runs from --base, else from where the slice started building (its `base`, else the parent of its first commit with its
// `Slice:` trailer; neither and it is refused), else HEAD without a slice, to the working tree: committed or not. With a slice only its own changes count: the files touched by
// the commits since then whose `Slice:` trailer names it (or a name given with --trailer, repeatable, for commits that cite an old name of the
// slice) and its uncommitted work, read from their patches. The reviewer is a read-only agent (model: --model, default Sonnet) that must open what the diff could not show (R128).
import { checkpoint, checkpointNotes, claudeReviewer } from '../src/checkpoint.mjs';
const a = process.argv.slice(2); const o = {}; const trailer = []; for (let i = 0; i < a.length; i += 2) { const k = a[i].replace(/^--/, ''); if (k === 'trailer') trailer.push(a[i + 1]); else o[k] = a[i + 1]; }
let notes, r;
try { notes = checkpointNotes({ notes: o.notes, notesText: o['notes-text'] }); } catch (e) { console.error(`refused: ${e.message}`); process.exit(1); }
try { r = checkpoint({ repo: process.cwd(), id: o.run || 'run', notes, human: o.human === '1', slice: o.slice, base: o.base, trailer, log: o.log, navigator: o.navigator, validateTimeout: o['validate-timeout'] ? Number(o['validate-timeout']) : undefined, reviewAnyway: o['review-anyway'] === '1', review: claudeReviewer(o.model ? { model: o.model } : {}) }); }
catch (e) { console.error(`refused: ${e.message}`); process.exit(1); }
console.log(r.text); process.exit(r.exit);
