// `buddy settle` (R54, R91, R124): the commits made without a slice (a quick fix, a tweak, vibe work) are read after the fact. Nothing was asked
// while they were made; here they are classified, the checks run, and the owner is told only when something deviated. Small corrections leave
// no record in docs/buddy/ (R91): the evidence is kept in .buddy/settled/ and shown by the digest.
import fs from 'node:fs';
import path from 'node:path';
import { git, runValidate, APPROVAL } from './proc.mjs';
import { aggregate, shortstat, isDoc, isTestFile } from './patch.mjs';
import { analyse, RECORDS, generatedByName } from './scan.mjs';
import { buddyDir, ensureBuddyDir } from './gitdir.mjs';

const dir = repo => path.join(buddyDir(repo), 'settled');
const markFile = repo => path.join(dir(repo), 'upto');   // the head the last settle reached, kept beside its records
// How large a quick fix may be (R157): above QUICK_FIX_LINES lines or QUICK_FIX_FILES files of product code changed, it grew past one. Only
// product code counts: not tests, docs, lock files or generated files (a correction with its test and a note is still a few dozen lines).
export const QUICK_FIX_LINES = 150, QUICK_FIX_FILES = 5;
const LOCK = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|[^/]+\.lock)$/;
export const isProductCode = f => !isTestFile(f) && !isDoc(f) && !generatedByName(f) && !LOCK.test(f) && !/(^|\/)dist\//.test(f) && !/\.(min\.(js|css)|map)$/.test(f);
const EXCLUDE = [':!package-lock.json', ':!**/package-lock.json', ':!**/dist/**', ...RECORDS];
const LOGIC = /\.(m?[jt]sx?|cs|py|go|java|rb|php|rs|kt|swift)$/i;
const SPECIFIED = /^(docs\/inputs\/|docs\/standards\/|docs\/context\.md$)/;

// The commits of `since..HEAD` that carry no `Slice:` trailer and are not only Buddy's records nor an approval of the owner (R281), oldest first: [{ hash, type, subject, files }].
export function freeCommits(repo, since) {
  const out = git(['log', '--reverse', '--format=%H%x1f%s%x1f%(trailers:key=Slice,valueonly,separator=%x1f)%x1e', since ? `${since}..HEAD` : 'HEAD~1..HEAD'], repo);
  return out.split('\x1e').map(r => r.trim().split('\x1f')).filter(([h, , ...tr]) => h && !tr.some(t => t.trim())).map(([hash, subject]) => {
    const files = git(['show', '--name-only', '--format=', '--no-renames', hash], repo).split('\n').filter(Boolean);
    return { hash, subject, type: (/^(\w+)(\(.*\))?!?:/.exec(subject) || [, ''])[1], files };
  }).filter(c => c.files.length && !c.files.every(f => f.startsWith('docs/buddy/')) && !c.subject.startsWith(APPROVAL));
}

// Where a settle starts (R155): `since` when given, else the head the last settle recorded (its evidence in .buddy/settled/), else the
// mark of before, else only the last commit. Commits a settle already read are never read again, nor their warnings repeated. A settle whose
// checks failed (recorded only before R157) settled nothing: the next one starts where it started, and checks its commits again.
export function settledUpto(repo) {
  let mark = null; try { mark = fs.readFileSync(markFile(repo), 'utf8').trim() || null; } catch { /* none */ }
  const all = settledRecords(repo); const latest = all.filter(r => r.upto && r.when === all.at(-1)?.when);   // two settles in the same second: the mark tells which was last
  const last = latest.find(r => r.upto === mark) ?? latest.at(-1);
  if (last && last.validate_exit != null && last.validate_exit !== 0) return last.from ?? null;
  return last?.upto ?? mark;
}

export function settle({ repo = process.cwd(), since, now = () => new Date(), validate = runValidate } = {}) {
  const from = since ?? settledUpto(repo) ?? null;
  const commits = freeCommits(repo, from);
  const head = git(['rev-parse', 'HEAD'], repo).trim();
  if (!commits.length) return { settled: false, from, upto: head, text: 'Nothing to settle: every commit since then belongs to a change.' };
  const steps = commits.map(c => ({ origin: c.hash.slice(0, 7), patch: git(['-c', 'core.quotePath=false', 'show', '--format=', '--no-renames', '--patch', c.hash, '--', '.', ...EXCLUDE], repo) }));
  const files = aggregate(steps);
  const sc = analyse(files.map(f => ({ status: f.status, file: f.file })), files.flatMap(f => f.text.split('\n')), 'the commits made without a slice');
  const lines = files.reduce((n, f) => n + f.add + f.del, 0);
  const v = validate(repo);
  // Each warning names the commit(s) it comes from (R155): the commits whose patches touched the files it is about.
  const subject = new Map(commits.map(c => [c.hash.slice(0, 7), c.subject]));
  const fromText = hashes => { const u = [...new Set(hashes)].sort((a, b) => [...subject.keys()].indexOf(a) - [...subject.keys()].indexOf(b)); return u.length ? ` (from ${u.slice(0, 4).map(h => `${h} "${String(subject.get(h) ?? '').slice(0, 60)}"`).join(', ')}${u.length > 4 ? `, and ${u.length - 4} more` : ''})` : ''; };
  const of = names => files.filter(f => names.includes(f.file)).flatMap(f => f.origins);
  const deviations = [];
  if (sc.deleted_tests.length) deviations.push(`tests were deleted: ${sc.deleted_tests.join(', ')}${fromText(of(sc.deleted_tests))}`);
  if (sc.skip_markers_added.length) deviations.push(`a check was skipped or silenced${fromText(of(sc.skip_markers_added.map(m => m.slice(0, m.indexOf(': ')))))}`);
  if (sc.protected_modified.length) deviations.push(`protected files changed: ${sc.protected_modified.join(', ')}${fromText(of(sc.protected_modified))}`);
  if (sc.assertions_removed > sc.assertions_added) deviations.push(`there are fewer assertions than before${fromText(of(files.filter(f => isTestFile(f.file) && f.del).map(f => f.file)))}`);
  const specified = files.filter(f => SPECIFIED.test(f.file)).map(f => f.file);
  if (specified.length) deviations.push(`something specified was changed: ${specified.join(', ')}${fromText(of(specified))}`);
  const logic = files.filter(f => LOGIC.test(f.file) && !isTestFile(f.file) && !isDoc(f.file)); const tests = files.filter(f => isTestFile(f.file));
  const behaving = commits.filter(c => ['fix', 'feat', 'perf', 'refactor'].includes(c.type) && c.files.some(f => logic.some(l => l.file === f)));
  if (logic.length && !tests.length && behaving.length) deviations.push(`behaviour changed without a test: ${logic.map(f => f.file).slice(0, 4).join(', ')}${fromText(behaving.map(c => c.hash.slice(0, 7)))}`);
  const feats = commits.filter(c => c.type === 'feat').map(c => c.hash.slice(0, 7));
  const product = files.filter(f => isProductCode(f.file)); const productLines = product.reduce((n, f) => n + f.add + f.del, 0);
  const big = productLines > QUICK_FIX_LINES || product.length > QUICK_FIX_FILES;
  const grew = feats.length > 0 || big;
  // what made it grow: its feature commits, else (it is large) the commits by the lines of product code each changed, the largest first
  const size = h => aggregate([steps.find(x => x.origin === h)]).filter(f => isProductCode(f.file)).reduce((n, f) => n + f.add + f.del, 0);
  const grewFrom = !grew ? [] : feats.length ? feats : [...subject.keys()].filter(h => size(h) > 0).sort((a, b) => size(b) - size(a));
  const needsOwner = v.status !== 0 || deviations.length > 0 || grew;
  const record = { when: now().toISOString().slice(0, 19) + 'Z', from, upto: head, commits: commits.map(c => ({ hash: c.hash.slice(0, 7), subject: c.subject })), stat: shortstat(files), files: files.map(f => f.file), lines,
    product_lines: productLines, product_files: product.length,
    validate_exit: v.status, kind: grew ? 'grew' : 'small-correction', ...(grew ? { grew_from: grewFrom, grew_why: fromText(grewFrom).trim(), grew_big: big } : {}), deviations, needs_owner: needsOwner };
  // Red checks settle nothing (R157): no record and no mark, so the next settle reads the same commits and runs the checks again.
  if (v.status !== 0) return { settled: false, from, upto: head, record, text: settleText(record) };
  ensureBuddyDir(repo, 'settled');
  fs.writeFileSync(path.join(dir(repo), `settled-${record.when.replace(/[-:]/g, '')}-${head.slice(0, 7)}.json`), JSON.stringify(record, null, 1) + '\n');
  fs.writeFileSync(markFile(repo), head + '\n');
  return { settled: true, record, text: settleText(record) };
}

export function settleText(r) {
  const green = r.validate_exit === 0;
  const o = [`${green ? 'SETTLED' : 'NOT SETTLED'}  ${r.commits.length} commit(s) made without a change${r.from ? ` since ${String(r.from).slice(0, 7)}` : ''}: ${r.stat || 'no file changes'}`];
  o.push(green ? '  The checks pass.' : `  The checks FAIL (validate exit ${r.validate_exit}), so nothing was marked settled: fix what fails and run buddy settle again, and it checks these commits again.`);
  if (r.kind === 'grew') o.push(`  This grew past a quick fix: it adds a feature or is large${r.grew_why ? ` ${r.grew_why}` : ''}. It should become a change, even after the fact.`);
  if (r.grew_big) o.push(`  Its size: ${r.product_lines} lines of product code in ${r.product_files} file(s), more than a quick fix (up to ${QUICK_FIX_LINES} lines and ${QUICK_FIX_FILES} files; tests, docs, lock files and generated files do not count).`);
  for (const d of r.deviations) o.push(`  Needs your look: ${d}.`);
  if (!r.needs_owner) o.push('  Nothing deviated; it shows in the digest and asks nothing of you.');
  return o.join('\n');
}

// For the digest: the settled records after `after(when)`.
export function settledRecords(repo, after = () => true) {
  const d = dir(repo); if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter(f => /^settled-.*\.json$/.test(f)).map(f => { try { return JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')); } catch { return null; } }).filter(r => r?.when && after(r.when)).sort((a, b) => a.when.localeCompare(b.when));
}
