// The checkpoint evidence a change folder keeps (R87, R88), read for what waits for the owner and for the feature's accept card (R83).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { git, copyIndex } from './proc.mjs';

// The fingerprint of the code (R71, R75): the files of the work as they are, committed or not, without Buddy's records and the documents
// (everything under docs/ and every *.md; .git/ is never in the index). Recording an acceptance, an answer or a document leaves it as it was.
// `env` names the index to read (GIT_INDEX_FILE): the checkpoint's temporary one, where the whole working tree is already added.
export const CODE_PATHS = ['.', ':!docs', ':!*.md'];
export const codeHashOf = (repo, env) => crypto.createHash('sha256').update(git(['-c', 'core.quotePath=false', 'ls-files', '-s', '--', ...CODE_PATHS], repo, { env })).digest('hex').slice(0, 16);
// The working tree now, read through a temporary copy of the index: untracked files count, nothing is staged. `fn` gets the env naming it.
function withTreeNow(repo, fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-ch-')); const index = path.join(tmp, 'index');
  try {
    copyIndex(repo, index);
    git(['add', '-A'], repo, { env: { GIT_INDEX_FILE: index } });
    return fn({ GIT_INDEX_FILE: index });
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
export const codeHash = repo => withTreeNow(repo, env => codeHashOf(repo, env));

// What an acceptance covers (R71): the files the slice's own work touched, without docs/ and *.md, each with the blob it has in the index
// `env` names (null: the file is gone). The checkpoint records them; acceptance compares them with the slice's own last commits (blobsAsOwned), so a change made
// elsewhere, or by later work on the same files, does not block it.
export const isCodeFile = f => !/^docs\//.test(f) && !/\.md$/i.test(f);
export function blobsOf(repo, files, env) {
  const out = Object.fromEntries(files.map(f => [f, null])); if (!files.length) return out;
  for (const line of git(['--literal-pathspecs', 'ls-files', '-s', '-z', '--', ...files], repo, { env }).split('\0')) { const m = line.match(/^\d+ ([0-9a-f]+) 0\t(.+)$/); if (m && m[2] in out) out[m[2]] = m[1]; }
  return out;
}
export const blobsNow = (repo, files) => withTreeNow(repo, env => blobsOf(repo, files, env));
// In the evidence each blob is written `blob:<id>`: a bare 40-hex id beside a path holding "auth" or "token" is what secret scanners
// (gitleaks' generic-api-key) take for a key, and the evidence is committed (a field pilot). Reading strips it; evidence written before has none.
export const blobsForEvidence = blobs => Object.fromEntries(Object.entries(blobs).map(([f, b]) => [f, b && `blob:${b}`]));
export const blobOfEvidence = b => (typeof b === 'string' ? b.replace(/^blob:/, '') : b);
// What acceptance compares (R144): each of `files` as of the slice's own last commit that touched it, reachable from HEAD; a commit is the
// slice's own when its `Slice:` trailer names one of `names` or it is among `commits` (those an evidence measured). Another change's commits
// and uncommitted work on the same files are not the slice's, so they never count. A file no own commit touched (work that was checked
// uncommitted and is still so) is read from the working tree, as before. Returns { file: blob, or null when the file is gone }.
export function blobsAsOwned(repo, files, names, commits = []) {
  if (!files.length) return {};
  const mine = new Set(commits); const at = new Map(); const out = {};
  const log = git(['--literal-pathspecs', '-c', 'core.quotePath=false', 'log', '--no-renames', '--name-only', '--format=%x1e%H%x1f%(trailers:key=Slice,valueonly,separator=%x1f)', 'HEAD', '--', ...files], repo);
  for (const rec of log.split('\x1e').slice(1)) {   // newest first: the first own commit that names a file is its last
    const [head, ...rest] = rec.split('\n'); const [h, ...slices] = head.split('\x1f').map(x => x.trim());
    if (!mine.has(h) && !slices.some(x => names.includes(x))) continue;
    for (const f of rest.map(x => x.trim()).filter(Boolean)) if (files.includes(f) && !at.has(f)) at.set(f, h);
  }
  const byCommit = new Map(); for (const [f, h] of at) byCommit.set(h, [...(byCommit.get(h) || []), f]);
  for (const [h, list] of byCommit) {
    for (const f of list) out[f] = null;
    for (const line of git(['--literal-pathspecs', '-c', 'core.quotePath=false', 'ls-tree', '-r', '-z', '--full-tree', h, '--', ...list], repo).split('\0')) { const m = line.match(/^\d+ blob ([0-9a-f]+)\t(.+)$/); if (m && m[2] in out) out[m[2]] = m[1]; }
  }
  const left = files.filter(f => !at.has(f));
  return { ...out, ...(left.length ? blobsNow(repo, left) : {}) };
}
// What the checkpoint records (R71, R144): each of `files` as acceptance will compare it later. A file with work not yet committed is recorded as it
// is (that work will be the slice's own commit); a file already committed is recorded as of the slice's own last commit that touched it, so a
// later commit of another change on the same file does not make a re-check of this slice disagree with its acceptance.
export function blobsForRecord(repo, files, env, names, commits = []) {
  const cur = blobsOf(repo, files, env); if (!files.length) return cur;
  const head = {}; for (const line of git(['--literal-pathspecs', 'ls-tree', '-r', '-z', '--full-tree', 'HEAD', '--', ...files], repo).split('\0')) { const m = line.match(/^\d+ blob ([0-9a-f]+)\t(.+)$/); if (m) head[m[2]] = m[1]; }
  const clean = files.filter(f => (head[f] ?? null) === cur[f]);
  return { ...cur, ...(clean.length ? blobsAsOwned(repo, clean, names, commits) : {}) };
}
// Which tests a validate run covered (R148, R200, R239): `fast` (validate at checkpoint and change acceptance), `full` (validate:full, or
// validate when no validate:full exists, required for milestone acceptance and release), or `deep` (validate:deep on demand). A deeper level
// covers every shallower one (`deep` covers `full` and `fast`; `full` covers `fast`); a scoped run covers only itself.
// Evidence of before R148 has no `tests`: every run then was full.
export const FAST_TESTS = 'fast';
export const FULL_TESTS = 'full';
export const DEEP_TESTS = 'deep';
export const testsOf = e => e?.tests ?? FULL_TESTS;
export const testsCover = (ran, need) => ran === DEEP_TESTS || (ran === FULL_TESTS && need !== DEEP_TESTS) || ran === need;
// A green validate any earlier check ran on the same code (R148), whatever its slice, or none: among `files` (the evidence files the index
// lists: every change folder and .buddy), the latest by time whose code fingerprint is `code`, whose validate passed and whose tests
// cover `need`. Only validate is shared: the reviewer's verdict and the diff scan judge each slice on its own. Returns { file, e } (`file`
// relative to the repository), or null.
// Each candidate is read from its summary when it has one; only the one chosen is read whole.
// A green from another change is reused only while it is recent and was got with the same tools (the system and the Node version): an old green, or one
// from another machine, could hide a failure that today's tools show. Each one left out says why in `refusals` (an array the caller passes).
export const SHARE_MAX_AGE_MS = 2 * 24 * 3600 * 1000;
export const currentEnvironment = () => ({ platform: process.platform, node: process.version });
const sameEnvironment = (a, b) => !!a && !!b && a.platform === b.platform && a.node === b.node;
// Whether the green of evidence `e` may still be reused: the run that really happened (a reused result counts from its origin) is under 2 days old and got with the same tools.
// null when it may, else the reason it may not (R168, R176).
export function reuseRefusal(e, { now = new Date(), environment = currentEnvironment() } = {}) {
  const ran = e.validate_reused ?? e; const env = e.validate_reused ? e.validate_reused.environment : e.environment;
  if (now - Date.parse(ran.when) > SHARE_MAX_AGE_MS) return 'a green on the same code is older than 2 days';
  if (!sameEnvironment(env, environment)) return env ? 'a green on the same code was got with other tools (another system or Node version)' : 'a green on the same code does not say which tools it was got with';
  return null;
}
// What defines the goal of a change, for deciding whether the reviewer's verdict still stands: its criteria, what it leaves out, the assumptions announced and how each criterion is tried.
export const goalHashOf = data => crypto.createHash('sha256').update(JSON.stringify({ c: data?.criteria || [], x: data?.excludes || [], a: (data?.assumptions || []).map(a => [a.id, a.text, a.if_otherwise]), h: data?.howto || [] })).digest('hex').slice(0, 16);
// Has the required test level passed on the code as it is now? (acceptance asks it, R173, R200, R239) It is the same search as sharing a result
// between changes: a green run covering `need` (default `full`), on exactly this code, under 2 days old and got with the same tools. { ok, from } or { ok: false, why }.
export function suiteGreen(repo, files, { need = FULL_TESTS, now = new Date(), environment = currentEnvironment() } = {}) {
  const refusals = []; const r = sharedValidate(repo, files, codeHash(repo), need, { now, environment, refusals });
  return r ? { ok: true, from: r.file, when: r.e.when ?? null, slice: r.e.slice ?? null } : { ok: false, why: refusals[0] ?? 'it has not run on this code' };
}
export function sharedValidate(repo, files, code, need = FULL_TESTS, { now = new Date(), environment = currentEnvironment(), refusals = [] } = {}) {
  let best = null;
  for (const f of files) {
    const e = readSummary(f); if (!e) continue;
    if (e.code_hash !== code || e.validate_exit !== 0 || e.validate_rerun || !testsCover(testsOf(e), need)) continue;   // passed only on its rerun: not shared (R155)
    const refused = reuseRefusal(e, { now, environment }); if (refused) { refusals.push(refused); continue; }   // a reused result counts from the run that really happened
    if (!best || String(e.when) > String(best.e.when)) best = { f, e };
  }
  if (!best) return null;
  try { return { file: path.relative(repo, best.f).split(path.sep).join('/'), e: JSON.parse(fs.readFileSync(best.f, 'utf8')) }; } catch { return null; }
}

// The files of the checkpoint evidence (R148): `evidence-<time>-<mark>.json`, and beside each one its short summary,
// `evidence-<time>-<mark>.summary.json`, written by the checkpoint in the same step from the same evidence (evidenceSummary), which the index
// and the search for a test result to reuse read instead of the whole file. verify reports a summary that does not match its evidence.
// The mark is 8 characters made from the piece and the run, never their names (R212): the name is 41 characters, 49 with its summary, so a
// path stays short on Windows, and two pieces checked in the same second do not share a file. The files of before carry the run's name and
// are read the same: every reader takes any `evidence-*.json`, in the order of the time in its name, and finds the piece inside the file.
export const evidenceName = (when, piece, run) => `evidence-${when.slice(0, 19).replace(/:/g, '')}Z-${crypto.createHash('sha256').update(`${piece ?? ''}
${run}`).digest('hex').slice(0, 8)}.json`;
export const EVIDENCE_FILE = /^evidence-(?!.*\.summary\.json$).*\.json$/;
export const summaryFileOf = f => f.replace(/\.json$/, '.summary.json');
const pickReview = r => (r ? Object.fromEntries(['does_what_was_asked', 'weakens_or_hides_checks', 'not_run', 'unspecified_decisions'].filter(k => r[k] !== undefined).map(k => [k, r[k]])) : null);
export const evidenceSummary = e => ({
  schema: 'buddy/evidence-summary@1', when: e.when ?? null, slice: e.slice ?? null, decision: e.decision ?? null, reasons: e.reasons || [], checks: e.checks || {},
  code_hash: e.code_hash ?? null, ...(e.goal_hash ? { goal_hash: e.goal_hash } : {}), ...(e.environment ? { environment: e.environment } : {}), files_hash: !!e.files_hash, validate_exit: e.validate_exit ?? null, ...(e.tests ? { tests: e.tests } : {}),
  review: pickReview(e.review), ...(e.review_reused ? { review_reused: e.review_reused } : {}), ...(e.validate_reused ? { validate_reused: e.validate_reused } : {}), ...(e.validate_rerun ? { validate_rerun: e.validate_rerun } : {}), ...(e.reclassified ? { reclassified: e.reclassified } : {}),
});
// The summary of evidence file `f`: its summary file when there is one that reads, else made from the whole file; null when neither reads.
export function readSummary(f) {
  try { return JSON.parse(fs.readFileSync(summaryFileOf(f), 'utf8')); } catch { /* none, or unreadable: the whole file */ }
  try { return evidenceSummary(JSON.parse(fs.readFileSync(f, 'utf8'))); } catch { return null; }
}
// Writes evidence `e` to `file` and its summary beside it, in one step.
export function writeEvidence(file, e) {
  fs.writeFileSync(file, JSON.stringify(e, null, 1) + '\n'); fs.writeFileSync(summaryFileOf(file), JSON.stringify(evidenceSummary(e), null, 1) + '\n');
}
export const filesHash = blobs => crypto.createHash('sha256').update(Object.keys(blobs).sort().map(f => `${f}\t${blobs[f]}`).join('\n')).digest('hex').slice(0, 16);

// The latest checkpoint evidence of slice `id` among the evidence files of a change folder (named by time, so the last by name is the latest);
// null when none was kept. `cache` keeps what a folder holds, read once per board. `reclassified` is the list the record of `id` keeps
// (R140): the evidence is returned with the reclassifications of its review read in (see withReclassified); the file is never changed.
export function latestEvidence(dir, id, cache = new Map(), reclassified) {
  if (!cache.has(dir)) cache.set(dir, fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => EVIDENCE_FILE.test(f)).sort().map(f => { try { return { file: f, e: JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) }; } catch { return null; } }).filter(Boolean) : []);
  const last = cache.get(dir).filter(x => x.e.slice === id).pop();
  return last ? withReclassified(last.e, last.file, reclassified) : null;
}
// The latest evidence file of slice `id` in `dir` (its name, and what it holds), or null.
export function latestEvidenceFile(dir, id) {
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => EVIDENCE_FILE.test(f)).sort().reverse() : [];
  for (const f of files) { try { const e = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); if (e.slice === id) return { file: f, e }; } catch { /* not evidence that reads */ } }
  return null;
}
// A reclassification is kept in the record, never in the evidence (R140): `{ evidence, n, costly, by, at }`, where `evidence` names the
// evidence file whose review holds decision n. A checkpoint that reused a review holds the same decisions, so it is matched by the
// evidence that review came from (`review_reused.from`). The evidence returned carries them in `reclassified`, over what an evidence of
// before R140 kept itself (still read); the latest entry for a number wins.
export const reviewFileOf = (file, ev) => ev?.review_reused?.from ?? file;
export function withReclassified(ev, file, list) {
  const key = reviewFileOf(file, ev); const mine = (list || []).filter(x => x.evidence === key);
  if (!ev || !mine.length) return ev;
  return { ...ev, reclassified: { ...(ev.reclassified || {}), ...Object.fromEntries(mine.map(x => [String(x.n), { costly: x.costly === true, by: x.by || 'buddy', at: x.at }])) } };
}
// What a delivered piece needs the owner for, in plain words: the reasons of its latest checkpoint and the departures from the prototype
// still to decide. No evidence at all is an exception too: nothing says the piece passed. Empty: the piece is clean.
// A check that did not run is never clean (R76): it is named first, and the reason that only repeats it is left out.
// A costly decision nobody specified is a reason (R114, R136), read again from the decisions so that Buddy's reclassification counts.
export function pieceExceptions(r, ev) {
  const unrun = notRun(ev).map(k => `${CHECK_NAMES[k]} did not run`);
  const reasons = (ev?.reasons || []).filter(x => !(unrun.length && x.startsWith('independent reviewer not run:')) && !x.startsWith(COSTLY));
  const costly = (ev?.unspecified ?? unspecifiedOf(ev)).filter(x => x.costly).map(costlyReason);   // the index's summary carries them read
  return [...(!ev ? ['no checkpoint evidence was kept for it'] : [...unrun, ...reasons, ...costly]), ...(r.departures ? [`${r.departures} departure${r.departures === 1 ? '' : 's'} from the prototype to decide`] : [])];
}

// The notes of a delivered piece that are still open (R250, RQ7): those of its latest checkpoint (the only one read), less what was settled after it:
// the stop-and-hand-it-over line (the piece is delivered), a way to try that is written now, and a way to try the reviewer found wanting that was rewritten
// after the checkpoint (the way keeps the time it was set, `at`; one set before that was kept, or with no time, stays open). `data` is the piece's record.
export const WAYS_UNPROVEN = 'independent reviewer: a way to try a criterion would not prove it (';
export function openNotes(ev, data) {
  const ways = new Map((data?.howto || []).map(h => [h.criterion, h])); const when = Date.parse(ev?.when);
  const settled = n => {
    if (n.includes(ESCALATED)) return true;
    const none = /^no way to try ([A-Z0-9, ]+) is written/.exec(n); if (none) return none[1].split(',').every(c => ways.has(c.trim()));
    if (!n.startsWith(WAYS_UNPROVEN)) return false;
    const ids = [...n.matchAll(/(?:\(|\| )(AC\d+):/g)].map(m => m[1]); return ids.length > 0 && ids.every(c => Date.parse(ways.get(c)?.at) > when);
  };
  return pieceExceptions({ departures: 0 }, ev).filter(n => !settled(n));
}

// What a checkpoint says apart, never a reason by itself (R155): the screens the reviewer could not compare with the prototype, and the tests
// that failed and then passed on validate's one rerun, to fix. -> ['unstable test(s) to fix: <names>', 'not verified by the reviewer: <screen: why>']
// A screen the reviewer could not verify: a line "screen: why", whether the reviewer wrote a line or an object { screen, why, how_to_verify }.
export const notVerifiedOf = review => (Array.isArray(review?.not_verified) ? review.not_verified.map(x => (x && typeof x === 'object' ? [x.screen, x.why].filter(Boolean).join(': ') : String(x ?? '')).trim()).filter(Boolean) : []);
// What would let a reviewer verify those screens next time, as the reviewer said it: ["screen: how"].
export const verifyHintsOf = review => (Array.isArray(review?.not_verified) ? review.not_verified.filter(x => x && typeof x === 'object' && String(x.how_to_verify ?? '').trim()).map(x => `${x.screen ? `${x.screen}: ` : ''}${String(x.how_to_verify).trim()}`) : []);
export const unstableOf = ev => (ev?.validate_rerun ? (ev.validate_rerun.names?.length ? ev.validate_rerun.names.join(', ') : 'names not readable') : null);
export const apartOf = ev => [...(unstableOf(ev) ? [`unstable test(s) to fix: ${unstableOf(ev)}`] : [])];   // a screen nobody could verify is an exception, not something said apart

// The decisions the reviewer found that nobody specified (R114, R136): [{ n, text, costly, reclassified? }]. The reviewer marks each costly
// (hard to reverse, or changing what the business sees) or not; the old plain-string form is read as not costly. `reclassified` (read in
// from the record by withReclassified, or kept by an evidence of before R140) holds the correction of the reviewer's mark, by number, and who made it (`buddy slice decision <id> <n> costly|cheap [--by owner]`): Buddy
// raises one to costly; only the owner lowers one to cheap (R139), and such a one is `lowered`.
export const COSTLY = 'costly decision nobody specified: ';
// The words the checkpoint ends its reasons with when a third round still has findings: the work stops until the owner decides (R249).
export const ESCALATED = 'hand the matter to the owner';
export const costlyReason = x => `${COSTLY}${x.text}`;
export const decisionsOf = review => (Array.isArray(review?.unspecified_decisions) ? review.unspecified_decisions : [])
  .map(d => (typeof d === 'string' ? { text: d, costly: false } : { text: String(d?.text ?? ''), costly: d?.costly === true })).filter(d => d.text.trim());
export const unspecifiedOf = ev => decisionsOf(ev?.review).map((d, i) => {
  const re = ev?.reclassified?.[String(i + 1)];
  return { n: i + 1, text: d.text, costly: re ? re.costly === true : d.costly, ...(re ? { reclassified: true, by: re.by || 'buddy' } : {}), ...(re && re.costly !== true && re.by === 'owner' ? { lowered: true } : {}) };
});
// The checks of a checkpoint (R76), each passed, failed, not run or not applicable; the words the owner reads for each.
export const CHECKS = ['validate', 'scan', 'acceptance_guard', 'reviewer', 'prototype_departures'];
const CHECK_NAMES = { validate: 'validate', scan: 'the scan', acceptance_guard: 'the acceptance guard', reviewer: 'the reviewer', prototype_departures: 'the check of departures from the prototype' };
export const notRun = ev => CHECKS.filter(k => ev?.checks?.[k] === 'not run');
// "validate passed · scan passed · reviewer not run ...": `notes` adds a word after a check (where its result was reused from).
export const checksText = (checks, notes = {}) => CHECKS.filter(k => checks[k]).map(k => `${k.replace(/_/g, ' ')} ${checks[k]}${notes[k] ? ` (${notes[k]})` : ''}`).join(' · ');
export const exceptionsText = (list, n = 3) => list.slice(0, n).map(x => String(x).slice(0, 160)).join('; ') + (list.length > n ? `; and ${list.length - n} more` : '');
