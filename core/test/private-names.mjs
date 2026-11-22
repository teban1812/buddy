// The names that must never reach Buddy's public copy live in the workshop, in tooling/private-names.txt, never in the plugin.
// This reads them when the file is there and returns null when it is not (in the public copy, where the guards that need them skip).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const NAMES_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'tooling', 'private-names.txt');
export const ABSENT = 'the list of private names lives in the workshop (tooling/private-names.txt), not in the public copy';

// Each line a regular expression matched as a whole word, ignoring case; one between slashes keeps its case. # starts a comment.
export function parseNames(text) {
  return text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(l => {
    const cased = l.length > 2 && l.startsWith('/') && l.endsWith('/');
    const source = cased ? l.slice(1, -1) : l;
    return { source, re: new RegExp(`\\b(?:${source})\\b`, cased ? '' : 'i') };
  });
}

export function privateNames(file = NAMES_FILE) {
  return fs.existsSync(file) ? parseNames(fs.readFileSync(file, 'utf8')) : null;
}

// The first name a line carries, or null.
export const nameIn = (names, line) => names.find(n => n.re.test(line))?.source ?? null;
