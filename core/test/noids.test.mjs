import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// The identifiers of Buddy's own construction (requirement R12, open question Q16, a design section, a lesson) stay in Buddy's repository: in a project
// built with Buddy they mean nothing. They may live in code comments; they may not appear in what Buddy shows or writes in a project: the text of the
// code (strings, help, refusals, cards, generated files), the instructions the agents and skills carry, and the schemas' words.
const CORE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ID = /\b(R|Q)\d{1,3}\b|\bdesign\/\d{2}|§\s*\d/;

// The text of the strings of a JavaScript source, comments and regular expressions left out.
export function strings(src) {
  const out = []; let i = 0, line = 1; const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; } i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c, start = line; let s = ''; i++;
      while (i < n && src[i] !== q) {
        if (src[i] === '\\') { s += src[i + 1]; i += 2; continue; }
        if (src[i] === '\n') line++;
        if (q === '`' && src[i] === '$' && src[i + 1] === '{') { let d = 1; i += 2; while (i < n && d) { if (src[i] === '{') d++; else if (src[i] === '}') d--; i++; } s += ' '; continue; }
        s += src[i]; i++;
      }
      out.push({ line: start, s }); i++; continue;
    }
    if (c === '/' && /[=(,:;!&|?{}\[]\s*$/.test(src.slice(Math.max(0, i - 3), i))) { i++; while (i < n && src[i] !== '/' && src[i] !== '\n') { if (src[i] === '\\') i++; i++; } i++; continue; }
    i++;
  }
  return out;
}
const files = (dir, ext) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? (e.name === 'node_modules' ? [] : files(path.join(dir, e.name), ext)) : ext.test(e.name) ? [path.join(dir, e.name)] : []);
const rel = p => path.relative(CORE, p).split(path.sep).join('/');

test('the scanner finds an id in a string and ignores comments and regular expressions', () => {
  const found = strings("// R12 in a comment\nconst a = 'see R12'; /* Q3 */ const re = /R\\d+/; const t = `x ${y} design/16`;").map(x => x.s);
  assert.deepEqual(found, ['see R12', 'x   design/16']); assert.ok(ID.test(found[0]) && ID.test(found[1]));
});
test('no id of Buddy\'s own construction in the text of the code that runs in a project', () => {
  const bad = [];
  for (const d of ['src', 'bin', 'hooks']) for (const f of files(path.join(CORE, d), /\.mjs$/)) for (const { line, s } of strings(fs.readFileSync(f, 'utf8'))) if (ID.test(s)) bad.push(`${rel(f)}:${line}: ${s.slice(0, 80)}`);
  assert.deepEqual(bad, []);
});
test('no id in the instructions of the agents and the skills, the library guide, nor in the words of the schemas', () => {
  const bad = [];
  for (const f of [...['agents', 'skills'].flatMap(d => files(path.join(CORE, d), /\.md$/)), path.join(CORE, 'LIBRARY-GUIDE.md')]) fs.readFileSync(f, 'utf8').split('\n').forEach((l, k) => { if (ID.test(l)) bad.push(`${rel(f)}:${k + 1}: ${l.slice(0, 80)}`); });
  const walk = (v, f, pth) => { if (typeof v === 'string') { if (ID.test(v)) bad.push(`${f} ${pth}: ${v.slice(0, 80)}`); } else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (k !== '$comment') walk(x, f, `${pth}/${k}`); };   // $comment is a comment, like one in code
  for (const f of files(path.join(CORE, 'schemas'), /\.json$/)) walk(JSON.parse(fs.readFileSync(f, 'utf8')), rel(f), '');
  assert.deepEqual(bad, []);
});
test('what the commands print has none either: the help and the usage of each command', () => {
  const BUDDY = path.join(CORE, 'bin', 'buddy.mjs');
  const help = spawnSync(process.execPath, [BUDDY, 'help'], { encoding: 'utf8' }).stdout; assert.doesNotMatch(help, ID);
  for (const cmd of ['init', 'slice', 'checkpoint', 'settle', 'digest', 'board', 'prototype', 'requests', 'queue']) { const r = spawnSync(process.execPath, [BUDDY, cmd, '--help'], { encoding: 'utf8', timeout: 20000 }); assert.doesNotMatch(`${r.stdout}${r.stderr}`, ID, cmd); }
});
