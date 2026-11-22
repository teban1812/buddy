#!/usr/bin/env node
// usage:
//   plain.mjs "<text>"     the words in a text meant for the Product Owner that they may not know: paths, commands, code names, technical terms, and HTML tags (R148)
//   plain.mjs -            the same for the text read from the standard input (a card, a summary)
//   --json                 the warnings as JSON
// It warns and never blocks: the exit code is 0 whatever it finds; 2 only when there is no text to read.
import fs from 'node:fs';
import { plainWarnings, plainText } from '../src/plainwords.mjs';

const USAGE = 'usage: buddy plain "<text meant for the owner>" [--json]\n       buddy plain - [--json]   (reads the text from the standard input)';
const argv = process.argv.slice(2); const json = argv.includes('--json'); const rest = argv.filter(a => a !== '--json');
if (!rest.length || rest[0] === '--help' || rest[0] === 'help') { (rest.length ? console.log : console.error)(USAGE); process.exit(rest.length ? 0 : 2); }
const text = rest.length === 1 && rest[0] === '-' ? fs.readFileSync(0, 'utf8') : rest.join(' ');
const w = plainWarnings(text);
console.log(json ? JSON.stringify(w, null, 1) : plainText(w));
