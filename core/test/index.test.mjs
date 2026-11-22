import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execSync } from 'node:child_process';
import { startSlice, startMilestone, moveSlice, stepAddTo, stepSetIn, readSlice, reclassifyDecision } from '../src/slicestore.mjs';
import { createBatch, writeBatchFile } from '../src/queue.mjs';
import { addRequest, setRequest, setPriority } from '../src/requests.mjs';
import { buildIndex, refreshIndex, find, findText, readDecisions, indexText, INDEX } from '../src/index.mjs';
import { loadBoard } from '../src/board.mjs';

const BUDDY = fileURLToPath(new URL('../bin/buddy.mjs', import.meta.url));
const NOW = '2026-10-31T18:00:00Z';
function fixture() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ix-')); execSync('git init -q', { cwd: d }); let min = 0;
  const now = () => new Date(Date.UTC(2026, 9, 31, 8, min++, 30));
  const m = startMilestone({ repo: d, title: 'First release', request: 'r', criteria: ['Works'], excludes: ['Nothing beyond the criteria above'], now });
  for (const to of ['ready', 'building']) moveSlice(d, m.id, to, { now });                            // the owner's go-ahead (R147)
  const ch = startSlice({ repo: d, title: 'Reading list', request: 'Keep the books I want to read', criteria: ['The list shows every book I saved'], milestone: m.id, now });
  const a = startSlice({ repo: d, title: 'Save books', request: 'r', criteria: ['Works'], excludes: ['Nothing beyond the criteria above'], inChange: ch.id, now });
  stepAddTo(d, a.id, 'Storage', { now }); stepAddTo(d, a.id, 'Screen', { now }); for (const to of ['ready', 'building']) moveSlice(d, a.id, to, { now }); stepSetIn(d, a.id, '1', true, { now });
  const dir = path.join(path.dirname(readSlice(d, ch.id).file), 'evidence'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'evidence-2026-10-31T090000Z-run.json'), JSON.stringify({ when: '2026-10-31T09:00:00Z', slice: a.id, reasons: ['validate failed'], checks: { validate: 'failed' }, code_hash: 'abc' }));
  fs.writeFileSync(path.join(dir, 'evidence-2026-10-31T100000Z-run.json'), JSON.stringify({ when: '2026-10-31T10:00:00Z', slice: a.id, reasons: [], checks: { validate: 'passed' } }));
  const batch = createBatch({ slice: ch.id, questions: [{ situation: 'Which formát for the export?', blocking: true, options: [{ label: 'CSV', cost: 'none' }, { label: 'JSON', cost: 'none' }] }] }, { date: '2026-10-31', rand: () => 'f001' });
  writeBatchFile(path.join(d, 'docs', 'questions.md'), batch);
  const rq = addRequest(d, 'Export the reading list', 'PRD §2', { now }); setRequest(d, rq.id, { to: ch.id }, { now }); setPriority(d, rq.id, 'must', { now });
  fs.writeFileSync(path.join(d, 'docs', 'requirements-log.md'), '# Log\n\n| # | Date | Status | Requirement | Where |\n| :-- | :-- | :-- | :-- | :-- |\n| R1 | 2026-10-29 | decided | v1 is for one developer; the rest waits | `a.md` |\n| R2 | 2026-10-30 | decided | **The índice is rebuilt when a record changes** (the owner: "sí", a | b) | R1 |\n');
  return { d, m, ch, a, batch, rq };
}

test('one pass reads every kind of record: milestones, changes and pieces, requests, questions, evidence, decisions', () => {
  const { d, m, ch, a, batch, rq } = fixture(); const x = buildIndex(d, { now: () => new Date(NOW) });
  assert.equal(x.schema, 'buddy/index@1'); assert.equal(x.generated, NOW); assert.match(x.fingerprint, /^[0-9a-f]{16}$/);
  assert.deepEqual(x.milestones.map(r => r.id), [m.id]);
  const c = x.changes.find(r => r.id === ch.id); const p = x.changes.find(r => r.id === a.id);
  assert.equal(c.milestone, m.id); assert.equal(c.priority, 'must'); assert.deepEqual(c.criteria.map(k => k.text), ['The list shows every book I saved']);
  assert.equal(p.change, ch.id); assert.deepEqual(p.steps, { done: 1, total: 2, next: { n: 2, text: 'Screen' } }); assert.equal(p.status, 'building');
  assert.match(p.evidence, /evidence-2026-10-31T100000Z-run\.json$/);                                 // the latest of its folder
  const e = x.evidence.find(v => v.file.endsWith('T090000Z-run.json')); assert.deepEqual([e.slice, e.reasons, e.checks.validate, e.code_hash, e.files_hash], [a.id, ['validate failed'], 'failed', true, false]);
  assert.deepEqual(x.requests.map(r => [r.id, r.priority, r.to]), [[rq.id, 'must', ch.id]]);
  assert.deepEqual(x.batches.map(b => [b.id, b.slice, b.questions.map(q => [q.id, q.blocking, q.status])]), [[batch.id, ch.id, [[batch.questions[0].id, true, batch.questions[0].status]]]]);
  assert.deepEqual(x.decisions.map(r => [r.id, r.status, r.title, r.refs]), [['R1', 'decided', 'v1 is for one developer', '`a.md`'], ['R2', 'decided', 'The índice is rebuilt when a record changes', 'R1']]);
  assert.deepEqual(x.problems, []);
  assert.match(indexText(x), /1 milestone\(s\), 1 change\(s\), 1 piece\(s\), 1 request\(s\), 1 question\(s\), 2 checkpoint\(s\), 2 decision\(s\)$/);
});
test('the board is the same from the index it is given as from the files', () => {
  const { d } = fixture(); assert.deepEqual(loadBoard(d, NOW, { index: buildIndex(d) }), loadBoard(d, NOW));
});
test('the decisions nobody specified are read with the reclassifications the record keeps; the evidence file is not touched (R140)', () => {
  const { d, ch, a } = fixture(); const dir = path.join(path.dirname(readSlice(d, ch.id).file), 'evidence'); const name = 'evidence-2026-10-31T110000Z-run.json';
  fs.writeFileSync(path.join(dir, name), JSON.stringify({ when: '2026-10-31T11:00:00Z', slice: a.id, reasons: [], checks: { validate: 'passed' }, review: { unspecified_decisions: ['Titles are sorted ignoring case'] } }));
  const bytes = fs.readFileSync(path.join(dir, name));
  assert.deepEqual(buildIndex(d).evidence.find(e => e.file.endsWith(name)).unspecified.map(x => x.costly), [false]);
  reclassifyDecision(d, a.id, 1, 'costly');
  const e = buildIndex(d).evidence.find(v => v.file.endsWith(name)); assert.deepEqual(e.unspecified.map(x => [x.costly, x.by]), [[true, 'buddy']]);
  assert.ok(fs.readFileSync(path.join(dir, name)).equals(bytes));
});
test('the file is rebuilt only when a record changed, or with force; a record that does not read is named', () => {
  const { d, a } = fixture(); const one = refreshIndex(d); assert.equal(one.rebuilt, true); assert.ok(fs.existsSync(path.join(d, INDEX)));
  assert.equal(refreshIndex(d).rebuilt, false); assert.equal(refreshIndex(d, { force: true }).rebuilt, true);
  stepSetIn(d, a.id, '2', true); const two = refreshIndex(d); assert.equal(two.rebuilt, true); assert.equal(two.index.changes.find(r => r.id === a.id).steps.done, 2);
  fs.writeFileSync(path.join(d, 'docs', 'buddy', 'requests.md'), '---\nschema: buddy/requests@1\nitems: [\n---\n');
  assert.deepEqual(refreshIndex(d).index.problems.map(p => p.file), ['docs/buddy/requests.md']);
});
test('find: every word, case and accents aside, over titles and texts; one line per hit with where it lives', () => {
  const { d, ch, rq, batch } = fixture(); const x = buildIndex(d);
  assert.deepEqual(find(x, 'READING list').map(h => [h.kind, h.id]), [['change', ch.id], ['request', rq.id]]);
  assert.deepEqual(find(x, 'indice rebuilt').map(h => [h.kind, h.id, h.path]), [['decision', 'R2', 'docs/requirements-log.md']]);
  assert.deepEqual(find(x, 'format export').map(h => [h.kind, h.id]), [['question', batch.questions[0].id]]);
  assert.deepEqual(find(x, 'every book saved').map(h => h.id), [`${ch.id} AC1`]);
  assert.deepEqual(find(x, 'reading nowhere'), []); assert.equal(findText([]), 'nothing found');
  assert.match(findText(find(x, 'one developer')), /^decision  R1  v1 is for one developer  · docs\/requirements-log\.md$/);
});
test('the decisions of the log: the bold title, else the first sentence; a | inside the text stays in it', () => {
  assert.deepEqual(readDecisions('| R9 | 2026-11-01 | superseded by R10 | **A** then a | b. | `x` |').map(r => [r.status, r.title, r.text]), [['superseded by R10', 'A', '**A** then a | b.']]);
});
test('the CLI: buddy index, --json, and buddy find', () => {
  const { d, ch } = fixture(); const run = args => spawnSync('node', [BUDDY, ...args], { encoding: 'utf8', cwd: d });
  const i = run(['index']); assert.equal(i.status, 0, i.stderr); assert.match(i.stdout, /^index: 1 milestone\(s\).*\(rebuilt\)\n$/);
  assert.match(run(['index']).stdout, /\(up to date\)/); assert.equal(JSON.parse(run(['index', '--json']).stdout).schema, 'buddy/index@1');
  const f = run(['find', 'reading', 'list']); assert.equal(f.status, 0, f.stderr); assert.match(f.stdout, new RegExp(`^change    ${ch.id}  Reading list  · docs/buddy/`));
  assert.equal(JSON.parse(run(['find', 'reading', '--json']).stdout)[0].id, ch.id); assert.equal(run(['find']).status, 2);
});
test('a markdown file in a change\'s folder that is not a record (notes, a report) is ignored: list, board and index work as before (RQ2)', () => {
  const { d, ch, a } = fixture(); const run = args => spawnSync('node', [BUDDY, ...args], { encoding: 'utf8', cwd: d });
  const before = [readSlice(d, ch.id).data, readSlice(d, a.id).data, buildIndex(d, { now: () => new Date(NOW) }).changes];
  const dir = path.dirname(readSlice(d, ch.id).file);
  fs.writeFileSync(path.join(dir, 'notes.md'), '# Notes\n\nWhat I saw while building.\n');
  fs.writeFileSync(path.join(dir, 'qa-report.md'), '---\ntitle: QA report\n---\n# QA\n\nAll green.\n');
  assert.deepEqual([readSlice(d, ch.id).data, readSlice(d, a.id).data, buildIndex(d, { now: () => new Date(NOW) }).changes], before);
  const l = run(['slice', 'list']); assert.equal(l.status, 0, l.stderr); assert.match(l.stdout, new RegExp(`${ch.id} .*Reading list`)); assert.doesNotMatch(l.stdout, /notes|qa-report/);
  const b = run(['board']); assert.equal(b.status, 0, b.stderr);
  const i = run(['index']); assert.equal(i.status, 0, i.stderr); assert.match(i.stdout, /^index: 1 milestone\(s\), 1 change\(s\), 1 piece\(s\)/);
});

// read-everything-from-index (R148): the readers take the records from the index, a rebuild rereads only what changed, and the index reads
// the short summary each checkpoint writes beside its evidence.
import { ownerMinutes } from '../src/minutes.mjs';
import { resumeBrief, inFlight } from '../src/resume.mjs';
import { loadStory } from '../src/story.mjs';
import { acceptCard } from '../src/slicestore.mjs';
import { writeEvidence, summaryFileOf, evidenceSummary } from '../src/evidence.mjs';
import { verify } from '../src/verify.mjs';
const relTo = (d, f) => path.relative(d, f).split(path.sep).join('/');
test('minutes, resume, the accept card and the story view read the records from the index (AC1)', () => {
  const { d, ch, a } = fixture(); const x = buildIndex(d);
  assert.deepEqual(resumeBrief(d, a.id, NOW, { index: x }), resumeBrief(d, a.id, NOW)); assert.deepEqual(ownerMinutes(d, { index: x }), ownerMinutes(d));
  assert.equal(acceptCard(d, ch.id, { index: x }), acceptCard(d, ch.id)); const folder = path.dirname(readSlice(d, ch.id).file); assert.deepEqual(loadStory(folder, { index: x }), loadStory(folder));
  const y = JSON.parse(JSON.stringify(x)); const r = y.changes.find(c => c.id === a.id); r.data = { ...r.data, title: 'Seen in the index' }; const c = y.changes.find(v => v.id === ch.id); c.data = { ...c.data, title: 'Told by the index' };
  y.batches[0].assumed_defaults = [{ text: 'Only the index holds this', status: 'assumed' }];
  assert.equal(resumeBrief(d, a.id, NOW, { index: y }).title, 'Seen in the index'); assert.equal(inFlight(d, NOW, { index: y }).find(s => s.id === a.id).title, 'Seen in the index');
  assert.deepEqual(ownerMinutes(d, { index: y }).changes.map(v => v.title), ['Told by the index']);
  assert.equal(loadStory(folder, { index: y }).slice.title, 'Told by the index');
  assert.match(acceptCard(d, ch.id, { index: y }), /To accept, confirm what was assumed on your behalf \(1\):\n  1\. Only the index holds this/);
});
test('a rebuild rereads only the records that changed and drops the ones gone; force reads them all; the result is the same as a full build (AC2)', () => {
  const { d, a, ch } = fixture(); const at = () => new Date(NOW); const one = refreshIndex(d, { now: at }); assert.ok(one.reread.length >= 6, one.reread.join(', '));
  assert.deepEqual(refreshIndex(d).reread, []);                                                         // up to date: nothing is read
  stepSetIn(d, a.id, '2', true); const two = refreshIndex(d, { now: at });
  assert.deepEqual(two.reread, [relTo(d, readSlice(d, a.id).file)]); assert.equal(two.index.changes.find(r => r.id === a.id).steps.done, 2);
  assert.deepEqual(two.index, buildIndex(d, { now: at }));
  const gone = path.join(path.dirname(readSlice(d, ch.id).file), 'evidence', 'evidence-2026-10-31T090000Z-run.json'); fs.rmSync(gone);
  const three = refreshIndex(d, { now: at }); assert.deepEqual(three.reread, []); assert.equal(three.index.evidence.length, 1);
  assert.ok(!Object.keys(JSON.parse(fs.readFileSync(path.join(d, '.git', 'buddy', 'index-cache.json'), 'utf8')).files).includes(relTo(d, gone)));
  assert.equal(refreshIndex(d, { force: true }).reread.length, one.reread.length - 1);
});
test('the checkpoint\'s summary beside its evidence is what the index reads; older evidence is read whole; verify names a summary that does not match (AC3)', () => {
  const { d, ch, a } = fixture(); const dir = path.join(path.dirname(readSlice(d, ch.id).file), 'evidence'); const f = path.join(dir, 'evidence-2026-10-31T110000Z-run.json');
  const e = { when: '2026-10-31T11:00:00Z', slice: a.id, reasons: ['no tests added'], checks: { validate: 'passed' }, code_hash: 'c0de', files_hash: 'f1', validate_exit: 0, tests: 'full', review: { does_what_was_asked: true, weakens_or_hides_checks: false, unspecified_decisions: ['Titles sort ignoring case'], details: 'a long verdict' }, validate_tail: 'x'.repeat(4000), scan: { flagged: false } };
  writeEvidence(f, e); const s = JSON.parse(fs.readFileSync(summaryFileOf(f), 'utf8'));
  assert.deepEqual(s, evidenceSummary(e)); assert.deepEqual([s.slice, s.reasons, s.code_hash, s.files_hash, s.validate_exit, s.tests, s.review.does_what_was_asked], [a.id, ['no tests added'], 'c0de', true, 0, 'full', true]);
  assert.equal(s.validate_tail, undefined); assert.ok(fs.statSync(summaryFileOf(f)).size < fs.statSync(f).size / 4);
  const mine = () => verify([path.join(d, 'docs')]).problems.filter(p => /summary/.test(p.file)).map(p => p.message);
  assert.deepEqual(mine(), []);
  const x = buildIndex(d); assert.equal(x.evidence.length, 3, 'the summary is not evidence of its own'); assert.deepEqual(x.evidence.at(-1).unspecified.map(u => u.text), ['Titles sort ignoring case']);
  fs.writeFileSync(summaryFileOf(f), JSON.stringify({ ...s, reasons: ['read from the summary'] }));
  assert.deepEqual(buildIndex(d).evidence.find(v => v.file.endsWith('T110000Z-run.json')).reasons, ['read from the summary']);   // the summary, not the whole file
  assert.deepEqual(buildIndex(d).evidence.find(v => v.file.endsWith('T090000Z-run.json')).reasons, ['validate failed']);       // no summary: the whole file
  assert.deepEqual(mine(), ['does not match its evidence evidence-2026-10-31T110000Z-run.json: the checkpoint writes both; write it again from the evidence']);
  fs.rmSync(f); assert.deepEqual(mine(), ['a summary with no evidence beside it']);
});

// shorten-evidence-file-names (R212): a new file has a short name with no run or piece in it; the ones written before keep theirs, and every reader takes both.
import { evidenceName, latestEvidence, latestEvidenceFile } from '../src/evidence.mjs';
test('every reader of evidence finds a file under its short name for its piece, beside the ones written before under their old names', () => {
  const { d, ch, a } = fixture(); const dir = path.join(path.dirname(readSlice(d, ch.id).file), 'evidence'); const when = '2026-10-31T11:00:00.000Z';
  const name = evidenceName(when, a.id, 'r3'); assert.match(name, /^evidence-2026-10-31T110000Z-[0-9a-f]{8}\.json$/);
  writeEvidence(path.join(dir, name), { when, slice: a.id, reasons: ['no tests added'], checks: { validate: 'passed' }, code_hash: 'c0de' });
  const x = buildIndex(d); assert.deepEqual(x.problems, []);                                              // the index: the three, and the new one is the latest of its piece
  assert.deepEqual(x.evidence.map(e => path.posix.basename(e.file)), ['evidence-2026-10-31T090000Z-run.json', 'evidence-2026-10-31T100000Z-run.json', name]);
  assert.ok(x.changes.find(r => r.id === a.id).evidence.endsWith(`/${name}`)); assert.deepEqual(x.evidence.at(-1).reasons, ['no tests added']);
  assert.deepEqual(verify([path.join(d, 'docs')]).problems.filter(p => /evidence/.test(p.file)), []);
  assert.equal(latestEvidenceFile(dir, a.id).file, name); assert.deepEqual(latestEvidence(dir, a.id).reasons, ['no tests added']);   // the accept summary and the acceptance read these
  assert.deepEqual(loadBoard(d, NOW, { index: x }), loadBoard(d, NOW)); assert.deepEqual(ownerMinutes(d, { index: x }), ownerMinutes(d));
  assert.deepEqual(ownerMinutes(d).changes.find(c => c.id === ch.id).events.filter(e => e.kind === 'exception').map(e => e.from), ['2026-10-31T09:00:00Z', '2026-10-31T11:00:00Z']);   // one under an old name, one under the new
  moveSlice(d, a.id, 'delivered');                                                                          // the milestone review reads the index's list, checked above
  assert.match(JSON.stringify(loadBoard(d, NOW)), /no tests added/); assert.match(acceptCard(d, ch.id), /no tests added/);
  fs.rmSync(path.join(dir, name)); fs.rmSync(summaryFileOf(path.join(dir, name)));                         // without it, the latest is again the one written before
  assert.match(buildIndex(d).changes.find(r => r.id === a.id).evidence, /evidence-2026-10-31T100000Z-run\.json$/); assert.equal(latestEvidenceFile(dir, a.id).file, 'evidence-2026-10-31T100000Z-run.json');
});
