// Checks a commit message with the rules Buddy needs and nothing else to install (R121): the Conventional Commits header (the vocabulary and
// limits of config-conventional) and Buddy's two trailers (R31, R37). One file, so a commit costs one Node start and not hundreds of modules.
// Returns { ok, errors, warnings }; a line starting with # is a git comment and is ignored, as git does.
import fs from 'node:fs';
import path from 'node:path';
import { SLICE_ID } from './ids.mjs';

export const TYPES = ['build', 'chore', 'ci', 'docs', 'feat', 'fix', 'perf', 'refactor', 'revert', 'style', 'test'];
const TRAILER = /^([A-Za-z][A-Za-z0-9-]*):[ \t]+(\S.*)$/;
const HEADER = /^(\w*)(?:\((.*)\))?(!)?: (.*)$/;
const IGNORED = [/^Merge /, /^Revert "/, /^(fixup|squash|amend)! /];

// Trailers as git reads them: the last paragraph, every line `Token: value` (indented lines continue the value); the subject alone is never a block.
export function parseTrailers(raw = '') {
  const paras = raw.replace(/\r\n/g, '\n').split('\n').filter(l => !l.startsWith('#')).join('\n').trimEnd().split('\n\n');
  const block = (paras.length > 1 ? paras[paras.length - 1] : '').split('\n');
  const out = [];
  for (const l of block) {
    if (/^[ \t]+\S/.test(l) && out.length) { out[out.length - 1].value += ' ' + l.trim(); continue; }
    const m = TRAILER.exec(l); if (!m) return [];
    out.push({ key: m[1], value: m[2].trim() });
  }
  return out;
}
const last = (ts, key) => ts.filter(t => t.key.toLowerCase() === key.toLowerCase()).pop();

export function checkCommitMessage(raw, { cwd = process.cwd(), requireExisting = true } = {}) {
  const errors = [], warnings = [];
  const lines = String(raw).replace(/\r\n/g, '\n').split('\n').filter(l => !l.startsWith('#'));
  while (lines.length && !lines[0].trim()) lines.shift();
  const header = lines[0] ?? '';
  if (IGNORED.some(r => r.test(header))) return { ok: true, errors, warnings, ignored: true };
  if (!header.trim()) return { ok: false, errors: ['the message is empty'], warnings };
  if (header !== header.trim()) errors.push('the header must not start or end with spaces');
  if (header.length > 100) errors.push(`the header is ${header.length} characters; it must have at most 100`);
  const m = HEADER.exec(header.trim());
  if (!m || !m[1] || !m[4]) errors.push('the header is "type(scope): subject", for example "feat(core): add the thing"' + (m && !m[1] ? ' (no type)' : '') + (m && !m[4] ? ' (no subject)' : ''));
  const type = m?.[1] ?? '', subject = m?.[4] ?? '';
  if (type) {
    if (type !== type.toLowerCase()) errors.push(`the type "${type}" must be lowercase`);
    else if (!TYPES.includes(type)) errors.push(`the type "${type}" is not one of: ${TYPES.join(', ')}`);
  }
  if (subject && /^\p{Lu}/u.test(subject)) errors.push('the subject must start with a lowercase letter ("add the thing", not "Add the thing")');
  if (subject.endsWith('.')) errors.push('the subject must not end with a full stop');
  if (lines.length > 1 && lines[1].trim()) warnings.push('the body should be separated from the header by a blank line');
  const firstFooter = lines.findIndex((l, i) => i > 0 && TRAILER.test(l));
  if (firstFooter > 1 && lines[firstFooter - 1].trim() && !TRAILER.test(lines[firstFooter - 1]) && !/^[ \t]/.test(lines[firstFooter - 1])) warnings.push('the trailers should be separated from the body by a blank line');
  const trailers = parseTrailers(lines.join('\n'));
  if (type === 'feat') {
    const t = last(trailers, 'Slice');
    if (!t) warnings.push('a feat commit names its slice: add a trailer "Slice: <slice name>" (a new behaviour is a slice; if this is a correction use fix:)');
    else if (!SLICE_ID.test(t.value)) warnings.push(`"Slice: ${t.value}" is not a slice name (lowercase letters, digits and single hyphens)`);
    else if (requireExisting && ['docs/buddy/backlog', 'docs/buddy/milestones'].some(d => fs.existsSync(path.join(cwd, d)))) {
      const found = findSlice(cwd, t.value);
      if (!found) warnings.push(`slice ${t.value} has no record under docs/buddy/ (buddy start creates it)`);
      else if (found === 'abandoned') warnings.push(`slice ${t.value} is abandoned`);
    }
  }
  if (type === 'fix') {
    const t = last(trailers, 'Buddy-Fix');
    if (!t) errors.push('a fix commit says why it is a correction: add a trailer "Buddy-Fix: <what already states the behaviour it restores>"');
    else if (t.value.length < 4) errors.push('the Buddy-Fix reason is too short to say anything');
  }
  return { ok: !errors.length, errors, warnings };
}

// The state of the slice or change named `id`, read from the front matter of its record (docs/buddy/**/change.md or <id>.md), without loading the store.
function findSlice(cwd, id) {
  const root = path.join(cwd, 'docs', 'buddy'); const todo = [root]; const NAME = new RegExp(`^id:\\s*${id.replace(/[-]/g, '\\-')}\\s*$`, 'm');
  while (todo.length) {
    const dir = todo.pop(); let es; try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of es) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'evidence') todo.push(p); continue; }
      if (!e.name.endsWith('.md')) continue;
      const head = fs.readFileSync(p, 'utf8').slice(0, 2000);
      if (head.startsWith('---') && NAME.test(head)) return /^status:\s*abandoned\s*$/m.test(head) ? 'abandoned' : 'found';
    }
  }
  return null;
}
