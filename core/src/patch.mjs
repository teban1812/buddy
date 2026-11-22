// Reading unified patches (git show / git diff output): split by file, counted, aggregated across the commits of one slice, and cut by whole files
// for the reviewer. A slice is judged by its own commits' patches plus its uncommitted work, never by the net change of the files it touched
// (what other slices changed later in the same files is not its work; dogfooding 2026-11-02).

const HEADER = /^diff --git a\/(.+) b\/\1$/;

// Splits a patch into files: [{ file, status: 'A'|'M'|'D', text, add, del }]. Binary files and mode changes come with zero lines.
export function splitPatch(patch) {
  const files = []; let cur = null; let inHunk = false;
  for (const line of patch.split('\n')) {
    const h = HEADER.exec(line);
    if (h) { cur = { file: h[1], status: 'M', lines: [line], add: 0, del: 0 }; files.push(cur); inHunk = false; continue; }
    if (!cur) continue;
    cur.lines.push(line);
    if (!inHunk) { if (line.startsWith('new file mode')) cur.status = 'A'; else if (line.startsWith('deleted file mode')) cur.status = 'D'; else if (line.startsWith('@@')) inHunk = true; continue; }
    if (line.startsWith('@@')) continue;
    if (line.startsWith('+')) cur.add++; else if (line.startsWith('-')) cur.del++;
  }
  return files.map(f => ({ file: f.file, status: f.status, text: f.lines.join('\n').replace(/\n+$/, ''), add: f.add, del: f.del }));
}

// Joins the patches of several steps of one slice in order, [{ origin, patch }] (a commit id, then 'uncommitted'), into one entry per file.
// A file added and later deleted is not part of the work; added then modified stays added; modified then deleted is deleted.
export function aggregate(steps) {
  const by = new Map();
  for (const { origin, patch } of steps) for (const f of splitPatch(patch)) {
    const e = by.get(f.file);
    if (!e) { by.set(f.file, { file: f.file, status: f.status, text: f.text, add: f.add, del: f.del, origins: [origin] }); continue; }
    e.text += `\n${f.text}`; e.add += f.add; e.del += f.del; e.origins.push(origin);
    if (f.status === 'D') e.status = e.status === 'A' ? 'gone' : 'D';
  }
  return [...by.values()].filter(e => e.status !== 'gone').sort((a, b) => a.file.localeCompare(b.file));
}

export function shortstat(files) {
  const add = files.reduce((n, f) => n + f.add, 0), del = files.reduce((n, f) => n + f.del, 0);
  if (!files.length) return '';
  return [`${files.length} file${files.length === 1 ? '' : 's'} changed`, add ? `${add} insertion${add === 1 ? '' : 's'}(+)` : '', del ? `${del} deletion${del === 1 ? '' : 's'}(-)` : ''].filter(Boolean).join(', ');
}
export const nameStatus = files => files.map(f => `${f.status}\t${f.file}`).join('\n');

export const isDoc = f => /\.(md|txt|html?)$/i.test(f) || /^docs\//.test(f) || /^README/i.test(f);
export const isTestFile = f => /(^|\/)(tests?|__tests__|api\.Tests)\//i.test(f) || /\.(test|spec)\.[jt]sx?$/.test(f) || /Tests?\.cs$/.test(f);
const rank = f => (isDoc(f) ? 2 : isTestFile(f) ? 1 : 0);   // source first: it is what the review is about

// The diff the reviewer reads, in whole files: source, then tests, then docs, each group in path order, as many as fit in `cap` characters.
// A file that does not fit is left out whole (a later, smaller one may still fit); if even the first file is larger than the cap it is cut and says so.
// Returns { text, total, shown, notShown: [{ file, chars }], cut: boolean }; `text` ends with a line naming what the reviewer was not given.
export function reviewDiff(files, cap = 30000) {
  const order = [...files].sort((a, b) => rank(a.file) - rank(b.file) || a.file.localeCompare(b.file));
  const total = files.reduce((n, f) => n + f.text.length + 1, 0); let used = 0; const parts = []; const notShown = [];
  for (const f of order) {
    const size = f.text.length + 1;
    if (used + size <= cap) { parts.push(f.text); used += size; continue; }
    if (!parts.length && size > cap) { parts.push(`${f.text.slice(0, cap)}\n[this file's diff is cut here: ${f.text.length - cap} more characters]`); used += cap; notShown.push({ file: f.file, chars: f.text.length - cap, partly: true }); continue; }
    notShown.push({ file: f.file, chars: f.text.length });
  }
  const note = notShown.length ? `\n\n[NOT SHOWN TO YOU, over the size limit: ${notShown.map(n => `${n.file} (${n.chars} characters${n.partly ? ', the rest of it' : ''})`).join(', ')}. Judge only what you can see and say that you could not see the rest.]` : '';
  return { text: parts.join('\n') + note, total, shown: used, notShown, cut: notShown.length > 0 };
}
