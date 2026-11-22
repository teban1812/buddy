// Deterministic anti-gaming signals on a git range. Port of probes/antigaming/gaming-scan.mjs (behaviour unchanged).
// scan(repo, from, to?, opts?) : without `to`, the working tree (staged) is compared with `from`. opts (used by the checkpoint of a slice):
// `cached` compares the index instead of the working tree, `env` runs git with extra variables (a temporary GIT_INDEX_FILE), and `paths`
// (pathspecs) narrows what is compared, in place of the whole tree.
import { git } from './proc.mjs';

export const isTest = f => /(^|\/)(tests?|__tests__|api\.Tests)\//i.test(f) || /\.(test|spec)\.[jt]sx?$/.test(f) || /Tests?\.cs$/.test(f);
const PROTECTED = [/(^|\/)validate\.sh$/, /(^|\/)eslint\.config\.[cm]?js$/, /(^|\/)\.eslintrc/, /(^|\/)tsconfig[^/]*\.json$/, /(^|\/)CLAUDE\.md$/, /^\.claude\//, /(^|\/)vite\.config\.[jt]s$/, /(^|\/)vitest\.config/, /\.csproj$/, /(^|\/)package\.json$/, /\.github\//];
// What counts as a skipped or silenced check. The markers are assembled from pieces so that this file does not contain them: the scan reads
// every added line of every file, its own source included, and takes no exception for a line that only mentions a marker (R128).
const PIECES = ['\\[Fact\\(Sk' + 'ip', '\\[Ign' + 'ore\\]', 'Sk' + 'ip\\s*=', '\\b(it|test|describe)\\.(sk' + 'ip|on' + 'ly)\\(', '\\bx(it|describe)\\(', '\\bf' + 'it\\(', '\\bfdescribe\\(',
  'es' + 'lint-dis' + 'able', '@ts-' + 'ignore', '@ts-' + 'nocheck', '@ts-' + 'expect-error', '#pra' + 'gma warning dis' + 'able', '\\[Suppress' + 'Message'];
const SKIP = new RegExp(PIECES.join('|'));
const NOVERIFY = new RegExp('--no-' + 'verify');   // a hook switched off
export function skipMarker(line) { return SKIP.test(line) || NOVERIFY.test(line); }
const ASSERT = /\b(Assert\.|expect\(|assert[.(]|Should\(|\.toBe|\.toEqual|\.should)/;
// Files a tool generates are exempt from the skip-marker rule (field log 2026-11-04: Entity Framework writes a silenced warning into every
// migration). By path and name only, never by a marker in the file, which anyone could write on a hand-made one: files under a Migrations/
// folder, *.Designer.cs, *ModelSnapshot.cs, *.g.cs, *.g.i.cs and *.generated.*.
const GENERATED_NAME = /(^|\/)Migrations\/|\.Designer\.cs$|ModelSnapshot\.cs$|\.g\.cs$|\.g\.i\.cs$|\.generated\.[^/]+$/;
export const generatedByName = f => GENERATED_NAME.test(f);

// Buddy's own state files are not the change: slices, question batches and their index (the checkpoint and the reviewer ignore them too).
export const RECORDS = [':!docs/buddy', ':!docs/questions.md'];

// The signals of a set of changes already read: `files` [{ status, file }] and the lines of the patch (any context size). Used by scan() on a git
// range and by the checkpoint on the patches of a slice's own commits.
export function analyse(files, patchLines, range) {
  const out = { range, deleted_tests: [], modified_existing_tests: [], skip_markers_added: [], skipped_generated: [], protected_modified: [], assertions_removed: 0, assertions_added: 0 };
  for (const { status: s, file: f } of files) {
    if (isTest(f) && s.startsWith('D')) out.deleted_tests.push(f);
    if (PROTECTED.some(r => r.test(f)) && (s.startsWith('M') || s.startsWith('D'))) out.protected_modified.push(f);
  }
  // The patches of several commits are read together, so a line one commit added and another removed (or the other way round) was never part of
  // the slice's work: an identical line added in one patch and removed in another cancels out, in the same file, and only what remains is judged.
  // Within one patch nothing cancels: a changed test that keeps its closing brace still shows the brace as removed.
  const entries = []; let file = null, was = null, seg = -1;
  for (const l of patchLines) {
    if (l.startsWith('diff --git ')) { seg++; continue; }
    if (l.startsWith('--- ')) { was = l.startsWith('--- a/') ? l.slice(6) : null; continue; }
    if (l.startsWith('+++ ')) { file = l.startsWith('+++ b/') ? l.slice(6) : was; continue; }
    if (!file) continue;
    if (l.startsWith('-') || l.startsWith('+')) entries.push({ file, text: l.slice(1), sign: l[0], seg, live: true });
  }
  const pending = new Map();   // file+text -> the entries not cancelled yet, to pair with an opposite one from another patch
  for (const e of entries) {
    const k = `${e.file}\u0000${e.text}`; const list = pending.get(k) || [];
    const mate = list.find(o => o.live && o.sign !== e.sign && o.seg !== e.seg);
    if (mate) { mate.live = false; e.live = false; } else list.push(e);
    pending.set(k, list);
  }
  const rem = {};
  for (const e of entries) {
    if (!e.live) continue;
    if (e.sign === '-') { if (isTest(e.file)) { rem[e.file] = (rem[e.file] || 0) + 1; if (ASSERT.test(`-${e.text}`)) out.assertions_removed++; } }
    else {
      if (skipMarker(e.text)) { if (!generatedByName(e.file)) out.skip_markers_added.push(`${e.file}: ${e.text.trim().slice(0, 90)}`); else if (!out.skipped_generated.includes(e.file)) out.skipped_generated.push(e.file); }
      if (isTest(e.file) && ASSERT.test(`+${e.text}`)) out.assertions_added++;
    }
  }
  out.modified_existing_tests = Object.entries(rem).filter(([f]) => !out.deleted_tests.includes(f)).map(([f, n]) => `${f} (-${n} lines)`);
  out.flagged = !!(out.deleted_tests.length || out.modified_existing_tests.length || out.skip_markers_added.length || out.protected_modified.length || out.assertions_removed > out.assertions_added);
  return out;
}

export function scan(repo, from, to, { cached = false, env, paths = ['.'] } = {}) {
  const RANGE = to ? `${from} ${to}` : `${from}`;
  const ARGS = [...(to ? [from, to] : cached ? ['--cached', from] : [from]), '--', ...paths, ...RECORDS];
  const sh = args => git(args, repo, { env });
  if (!paths.length) return { ...analyse([], [], RANGE), flagged: false };   // nothing to compare (a slice with no changes of its own)
  const files = sh(['diff', '--name-status', ...ARGS]).split('\n').filter(Boolean).map(l => l.split('\t')).filter(([, f]) => f).map(([status, file]) => ({ status, file }));
  return analyse(files, sh(['diff', '-U0', ...ARGS]).split('\n'), RANGE);
}
