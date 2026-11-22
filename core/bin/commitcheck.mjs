#!/usr/bin/env node
// usage: commitcheck.mjs --edit <message file> [--repo <dir>]   (or the message on stdin)
// Checks a commit message with Buddy's own rules (Conventional Commits and the trailers) and exits 1 when it breaks them; warnings are printed and let it pass.
// It is what this repository's commit-msg hook runs, so no commitlint is needed (R121).
import fs from 'node:fs';
import { checkCommitMessage } from '../src/commitcheck.mjs';
const a = process.argv.slice(2); const o = {}; for (let i = 0; i < a.length; i += 2) o[a[i].replace(/^--/, '')] = a[i + 1];
const raw = o.edit ? fs.readFileSync(o.edit, 'utf8') : fs.readFileSync(0, 'utf8');
const r = checkCommitMessage(raw, { cwd: o.repo || process.cwd() });
for (const w of r.warnings) console.error(`⚠  ${w}`);
for (const e of r.errors) console.error(`✖  ${e}`);
if (!r.ok) { console.error('✖  the commit message breaks the rules; fix it and commit again'); process.exit(1); }
