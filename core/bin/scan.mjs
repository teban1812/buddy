#!/usr/bin/env node
// usage: scan.mjs <repo> <from> [<to>]   prints the anti-gaming signals as JSON (exit 0; the checkpoint decides what to do with them)
import { scan } from '../src/scan.mjs';
const [repo, from, to] = process.argv.slice(2);
if (!repo || !from) { console.error('usage: scan.mjs <repo> <from> [<to>]'); process.exit(2); }
console.log(JSON.stringify(scan(repo, from, to)));
