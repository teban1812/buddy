import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { checkpoint } from '../src/checkpoint.mjs';
import { howtoSet, startSlice, startMilestone, moveChangeTo, moveSlice, stepAddTo, stepSetIn, readSlice } from '../src/slicestore.mjs';
import { createBatch, writeBatchFile, assumeDefaults } from '../src/queue.mjs';
import { EXAMPLES, WORKSHOP, G, clean, setup, withHowto, run, files, commitAll, other, edit, counting, runs, again } from './_checkpointslice.helper.mjs';

// reuse-checks-on-unchanged-content (R75): the same code and tests as an earlier green evidence are not checked again.
import { codeHash, currentEnvironment, sharedValidate, suiteGreen, SHARE_MAX_AGE_MS } from '../src/evidence.mjs';
import { runSuite } from '../src/suite.mjs';
test('the code fingerprint covers code and tests, committed or not, and leaves out records and documents', () => {
  const { d } = setup(); const h0 = codeHash(d);
  fs.writeFileSync(path.join(d, 'README.md'), 'changed\n'); fs.mkdirSync(path.join(d, 'sub')); fs.writeFileSync(path.join(d, 'sub', 'notes.md'), 'a note\n'); fs.writeFileSync(path.join(d, 'docs', 'guide.txt'), 'a document\n');
  G(d, 'add', 'README.md'); G(d, 'commit', '-qm', 'docs: readme');
  assert.equal(codeHash(d), h0);
  fs.writeFileSync(path.join(d, 'thing.js'), 'export const x = 2;\n'); assert.notEqual(codeHash(d), h0);
  fs.writeFileSync(path.join(d, 'thing.js'), 'export const x = 1;\n'); assert.equal(codeHash(d), h0);
  fs.writeFileSync(path.join(d, 'sub', 'new.test.js'), 'x\n'); assert.notEqual(codeHash(d), h0);   // an untracked test counts
  assert.match(G(d, 'status', '--porcelain'), /\?\? sub\//);                                         // nothing was staged
});
test('a second checkpoint on the same code and tests reuses validate and the reviewer\'s verdict, and says so (AC1)', () => {
  const { d, id } = setup(); counting(d); let asked = 0; const rv = () => { asked++; return { ...clean(), cost: 0.2 }; };
  const first = run(d, id, { review: rv }); assert.equal(first.decision, 'APPROVE', first.text); assert.equal(runs(d), 1); assert.equal(asked, 1);
  assert.equal(first.evidence.code_hash, codeHash(d)); assert.equal(first.evidence.validate_reused, undefined);
  again(d, id); fs.writeFileSync(path.join(d, 'docs', 'decision.md'), 'the owner said yes\n'); G(d, 'add', 'docs'); G(d, 'commit', '-qm', 'docs: a decision');   // records and documents only
  const second = run(d, id, { review: rv, id: 'again' }); const name = path.basename(first.evidenceFile);
  assert.equal(runs(d), 1, 'validate did not run again'); assert.equal(asked, 1, 'the reviewer was not asked again');
  assert.deepEqual(second.evidence.validate_reused, { from: name, when: first.evidence.when, slice: id, environment: currentEnvironment() }); assert.deepEqual(second.evidence.review_reused, { from: name, when: first.evidence.when });
  assert.equal(second.evidence.validate_exit, 0); assert.equal(second.evidence.checks.validate, 'passed'); assert.equal(second.evidence.review.cost, undefined); assert.equal(second.decision, 'APPROVE', second.text);
  assert.ok(second.text.includes(`validate: reused from ${name} (${first.evidence.when})`)); assert.ok(second.text.includes(`reviewer: reused from ${name} (${first.evidence.when})`));
  again(d, id); const third = run(d, id, { review: rv, id: 'third' });                                                  // reused twice: it names the evidence that ran it
  assert.deepEqual(third.evidence.validate_reused, { from: name, when: first.evidence.when, slice: id, environment: currentEnvironment() }); assert.equal(runs(d), 1);
  again(d, id); fs.writeFileSync(path.join(d, 'thing.js'), 'export const x = 2;\n');                                     // the code changed: everything runs
  const changed = run(d, id, { review: rv, id: 'changed' }); assert.equal(runs(d), 2); assert.equal(asked, 2); assert.equal(changed.evidence.validate_reused, undefined); assert.equal(changed.evidence.review_reused, undefined);
});
test('the reviewer runs again on the same code when the earlier one had findings or gave no verdict; a red validate is never reused', () => {
  const { d, id } = setup(); counting(d); const verdicts = [{ ...clean(), criteria_not_met: ['AC1: no'] }, { does_what_was_asked: null, weakens_or_hides_checks: null, unspecified_decisions: [], details: 'reviewer failed' }, clean()]; let asked = 0;
  const rv = () => verdicts[asked++];
  run(d, id, { review: rv }); again(d, id); const second = run(d, id, { review: rv, id: 'b' });
  assert.equal(asked, 2); assert.equal(runs(d), 1); assert.ok(second.evidence.validate_reused); assert.equal(second.evidence.review_reused, undefined);
  again(d, id); run(d, id, { review: rv, id: 'c' }); assert.equal(asked, 3, 'no verdict: asked again');
  const red = setup(); counting(red.d, '; process.exit(1)');
  // a red validate leaves the piece in building and runs once more each time (R155): checked again directly, two runs per checkpoint
  run(red.d, red.id); const r2 = run(red.d, red.id, { id: 'b' }); assert.equal(runs(red.d), 4); assert.equal(r2.evidence.validate_reused, undefined);
});

// share-test-results (R148): a green validate is reused by any slice on the same code whose tests it covers; the reviewer and the scan are not.
test('a second slice on the same code reuses the first one\'s green validate, names it, and still asks its own reviewer (AC1)', async () => {
  const { d, id } = setup(); counting(d); let asked = 0; const rv = () => { asked++; return clean(); };
  const first = run(d, id, { review: rv }); assert.equal(first.decision, 'APPROVE', first.text); assert.equal(runs(d), 1); assert.equal(first.evidence.tests, 'full');
  const { summaryFileOf, evidenceSummary } = await import('../src/evidence.mjs');   // the summary beside it, written in the same step (R148)
  assert.deepEqual(JSON.parse(fs.readFileSync(summaryFileOf(first.evidenceFile), 'utf8')), evidenceSummary(JSON.parse(fs.readFileSync(first.evidenceFile, 'utf8'))));
  const two = startSlice({ repo: d, title: 'Do another thing', request: 'r', criteria: ['It works'], excludes: ['Nothing beyond the criteria above'] }); stepAddTo(d, two.id, 'Do it');
  for (const to of ['ready', 'building']) moveSlice(d, two.id, to); stepSetIn(d, two.id, '1', true);
  const second = run(d, two.id, { review: rv, id: 'two' }); const from = path.relative(d, first.evidenceFile).split(path.sep).join('/');
  assert.equal(runs(d), 1, 'validate did not run again'); assert.equal(asked, 2, 'its own reviewer was asked');
  assert.deepEqual(second.evidence.validate_reused, { from, when: first.evidence.when, slice: id, environment: currentEnvironment() }); assert.equal(second.evidence.review_reused, undefined);
  assert.equal(second.evidence.tests, 'full'); assert.equal(second.evidence.checks.validate, 'passed'); assert.ok(second.evidence.scan, 'its own scan ran');
  assert.ok(second.text.includes(`validate: reused from ${from} (${first.evidence.when}, a check of ${id}): the code and tests are the same`), second.text);
  const three = startSlice({ repo: d, title: 'Change the code', request: 'r', criteria: ['It works'], excludes: ['Nothing beyond the criteria above'] });
  for (const to of ['ready', 'building']) moveSlice(d, three.id, to); fs.writeFileSync(path.join(d, 'thing.js'), 'export const x = 3;\n');   // the code changed: it runs
  const third = run(d, three.id, { review: rv, id: 'three' }); assert.equal(runs(d), 2); assert.equal(third.evidence.validate_reused, undefined);
});
test('a narrower run does not cover a full need; a full run without a change does; a red one never (AC2)', () => {
  const { d, id } = setup(); counting(d); const code = codeHash(d); const gb = path.join(d, '.buddy'); fs.mkdirSync(gb, { recursive: true });
  const whens = {}; const put = (name, e) => { whens[name] = new Date(Date.now() - (10 - name.length) * 60000).toISOString(); fs.writeFileSync(path.join(gb, `evidence-${name}.json`), JSON.stringify({ when: whens[name], environment: currentEnvironment(), code_hash: code, ...e })); };
  put('a', { validate_exit: 0, tests: 'scoped:thing' }); put('bb', { validate_exit: 1, tests: 'full' });
  const first = run(d, id, { id: 'first' }); assert.equal(runs(d), 1, 'a scoped or a red run is not reused'); assert.equal(first.evidence.validate_reused, undefined);
  const two = startSlice({ repo: d, title: 'Do another thing', request: 'r', criteria: ['It works'], excludes: ['Nothing beyond the criteria above'] });
  for (const to of ['ready', 'building']) moveSlice(d, two.id, to);
  fs.rmSync(path.join(path.dirname(first.evidenceFile)), { recursive: true }); put('ccc', { validate_exit: 0, validate_tail: 'ok' });   // a run without a change, before R148: full
  const second = run(d, two.id, { id: 'two' }); assert.equal(runs(d), 1); assert.deepEqual(second.evidence.validate_reused, { from: '.buddy/evidence-ccc.json', when: whens.ccc, slice: null, environment: currentEnvironment() });
});

// refuse-acceptance-on-changed-content (R71): acceptance rests on evidence about the files it covers, as they are now.
test('accepting is refused when the slice\'s own code or tests changed after the checkpoint, naming the files (AC1)', () => {
  const { d, id } = setup(); const r = run(d, id);
  assert.deepEqual(Object.keys(r.evidence.own_files), ['thing.js', 'thing.test.js']); assert.match(r.evidence.files_hash, /^[0-9a-f]{16}$/);
  fs.writeFileSync(path.join(d, 'thing.test.js'), "import assert from 'node:assert';\nassert.equal(2, 2);\n");
  assert.throws(() => moveSlice(d, id, 'accepted', { by: 'owner' }), new RegExp(`^Error: Do a thing \\[${id}\\]: the code changed after the last check \\(${r.evidence.when}\\): run the checkpoint again\\. Changed: thing\\.test\\.js$`));
  assert.equal(readSlice(d, id).data.status, 'delivered');
  fs.rmSync(path.join(d, 'thing.js')); assert.throws(() => moveSlice(d, id, 'accepted', { by: 'owner' }), /Changed: thing\.js, thing\.test\.js$/);   // a file removed is a change too
  fs.writeFileSync(path.join(d, 'thing.js'), 'export const x = 1;\n'); fs.writeFileSync(path.join(d, 'thing.test.js'), "import assert from 'node:assert';\nassert.equal(1, 1);\n");   // put back as checked
  assert.equal(moveSlice(d, id, 'accepted', { by: 'owner' }).data.status, 'accepted');
});
// A field pilot: a bare 40-hex blob beside a path holding "Auth" or "token" is what gitleaks' generic-api-key takes for a key, and the evidence is committed.
test('the evidence writes each file\'s blob as blob:<id>, and acceptance reads it and evidence written before without the prefix', () => {
  const { d, id } = setup(); const r = run(d, id);
  for (const v of Object.values(r.evidence.own_files)) assert.match(v, /^blob:[0-9a-f]{40}$/);
  const raw = fs.readFileSync(r.evidenceFile, 'utf8'); assert.deepEqual(JSON.parse(raw).own_files, r.evidence.own_files);
  fs.writeFileSync(r.evidenceFile, raw.replace(/"blob:([0-9a-f]{40})"/g, '"$1"'));   // as written before
  fs.writeFileSync(path.join(d, 'thing.js'), 'export const x = 9;\n'); assert.throws(() => moveSlice(d, id, 'accepted', { by: 'owner' }), /Changed: thing\.js$/);
  fs.writeFileSync(path.join(d, 'thing.js'), 'export const x = 1;\n'); assert.equal(moveSlice(d, id, 'accepted', { by: 'owner' }).data.status, 'accepted');
});
test('a change elsewhere in the repository after the checkpoint does not block acceptance; a change to one of the slice\'s own files does', () => {
  const { d, id } = setup(); run(d, id); commitAll(d, `feat: the thing\n\nSlice: ${id}`);
  const b = startSlice({ repo: d, title: 'Later thing', request: 'Built after', criteria: ['It works'], excludes: ['Nothing beyond the criteria above'] }); moveSlice(d, b.id, 'ready'); moveSlice(d, b.id, 'building');
  fs.writeFileSync(path.join(d, 'later.js'), 'export const l = 1;\n'); fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: 'x', version: '2.0.0', scripts: { validate: 'node -e "0"' } }));
  commitAll(d, `feat: later\n\nSlice: ${b.id}`);                                                                     // the next change of the milestone, built before the owner came back
  assert.throws(() => moveSlice(d, id, 'accepted', { by: 'owner' }), /the whole test suite has not passed on the code as it is now \(it has not run on this code\): run it once with buddy suite/);   // the code elsewhere changed: the suite must be green on it (R173)
  assert.equal(runSuite({ repo: d }).passed, true);
  assert.equal(moveSlice(d, id, 'accepted', { by: 'owner' }).data.status, 'accepted');
  const e = setup(); run(e.d, e.id); commitAll(e.d, `feat: the thing\n\nSlice: ${e.id}`);
  fs.writeFileSync(path.join(e.d, 'thing.js'), 'export const x = 3;\n'); commitAll(e.d, `fix: the slice changes its own file again\n\nSlice: ${e.id}`);
  assert.throws(() => moveSlice(e.d, e.id, 'accepted', { by: 'owner' }), /run the checkpoint again\. Changed: thing\.js$/);
});
// R144: acceptance reads the slice's files as of its own last commits, so the next change's work on the same files never blocks it.
test('another slice\'s commit or uncommitted edit to the same file does not block acceptance; the slice\'s own later commit does', () => {
  const { d, id } = setup(); run(d, id); commitAll(d, `feat: the thing\n\nSlice: ${id}`);
  const b = startSlice({ repo: d, title: 'Next thing', request: 'Built while the owner is away', criteria: ['It works'], excludes: ['Nothing beyond the criteria above'] }); moveSlice(d, b.id, 'ready'); moveSlice(d, b.id, 'building');
  fs.writeFileSync(path.join(d, 'thing.js'), 'export const x = 2;\n'); commitAll(d, `feat: next\n\nSlice: ${b.id}`);                 // the next change commits on the same file
  fs.writeFileSync(path.join(d, 'thing.test.js'), "import assert from 'node:assert';\nassert.equal(3, 3);\n");                     // and goes on, uncommitted, on both
  fs.writeFileSync(path.join(d, 'thing.js'), 'export const x = 4;\n');
  assert.equal(runSuite({ repo: d }).passed, true);                                                                                // the suite on the code as it is now (R173)
  assert.equal(moveSlice(d, id, 'accepted', { by: 'owner' }).data.status, 'accepted');
  const e = setup(); run(e.d, e.id); commitAll(e.d, `feat: the thing\n\nSlice: ${e.id}`);
  fs.writeFileSync(path.join(e.d, 'thing.test.js'), "import assert from 'node:assert';\nassert.equal(5, 5);\n"); G(e.d, 'add', 'thing.test.js'); G(e.d, 'commit', '-qm', `test: one more\n\nSlice: ${e.id}\nCo-Authored-By: t <t@t>`);
  assert.throws(() => moveSlice(e.d, e.id, 'accepted', { by: 'owner' }), /run the checkpoint again\. Changed: thing\.test\.js$/);
});
test('recording an acceptance, an answer or a document after the checkpoint does not invalidate it (AC2)', () => {
  const { d, id } = setup(); fs.writeFileSync(path.join(d, 'notes.md'), 'slice notes\n'); const r = run(d, id); commitAll(d, `feat: the thing\n\nSlice: ${id}`);
  assert.ok(!('notes.md' in r.evidence.own_files), 'documents are not in what the acceptance covers');
  fs.writeFileSync(path.join(d, 'notes.md'), 'slice notes, edited\n'); fs.writeFileSync(path.join(d, 'docs', 'answer.md'), 'the owner answered\n'); fs.writeFileSync(path.join(d, 'CHANGELOG.md'), '# 1.0\n');
  commitAll(d, 'docs: record the answer');
  const b = other(d); edit(b.file, 'Do another thing', 'Do another thing, said better');                                // another record changed and not committed
  assert.equal(moveSlice(d, id, 'accepted', { by: 'owner' }).data.status, 'accepted');
});
test('a change in pieces covers the union of its pieces\' files: accepted when they are as checked, refused when one changed', () => {
  const mk = () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cpa-')); G(d, 'init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: 'x', scripts: { validate: 'node -e "0"' } })); fs.mkdirSync(path.join(d, 'docs')); G(d, 'add', '-A'); G(d, 'commit', '-qm', 'base');
    const ch = startSlice({ repo: d, title: 'Reading list', request: 'r', criteria: ['Works'], excludes: ['Sharing'] });
    const ids = ['Save books', 'Remove a book'].map(t => startSlice({ repo: d, title: t, request: 'Do it', criteria: ['Works'], excludes: ['Nothing beyond the criteria above'], inChange: ch.id }).id);
    for (const [i, id] of ids.entries()) { moveSlice(d, id, 'ready'); moveSlice(d, id, 'building'); fs.writeFileSync(path.join(d, `p${i}.test.js`), "import assert from 'node:assert';\nassert.equal(1, 1);\n"); run(d, id, { id: `p${i}` }); commitAll(d, `feat: piece ${i}\n\nSlice: ${id}`); }
    return { d, ch, ids };
  };
  const ok = mk(); assert.equal(readSlice(ok.d, ok.ch.id).data.status, 'delivered'); fs.writeFileSync(path.join(ok.d, 'unrelated.js'), 'export const u = 1;\n');
  assert.equal(runSuite({ repo: ok.d }).passed, true);
  assert.equal(moveSlice(ok.d, ok.ch.id, 'accepted', { by: 'owner' }).data.status, 'accepted');
  const no = mk(); fs.writeFileSync(path.join(no.d, 'p0.test.js'), "import assert from 'node:assert';\nassert.equal(0, 0);\n"); commitAll(no.d, `fix: piece 0 again\n\nSlice: ${no.ids[0]}`);   // the piece's own later commit
  assert.throws(() => moveSlice(no.d, no.ch.id, 'accepted', { by: 'owner' }), /^Error: Reading list \[reading-list\]: the code changed after the last check \([^)]+, of Save books \[save-books\]\): run the checkpoint again\. Changed: p0\.test\.js$/);
  assert.ok(no.ids.every(id => readSlice(no.d, id).data.status === 'delivered'));
});

// The scan fails only on what is a reason of the checkpoint; an existing test that changed is for the reviewer to look at (R76).
const editedTest = d => {   // an existing test, committed before by another change, then changed by the slice with as many assertions
  fs.writeFileSync(path.join(d, 'old.test.js'), "import assert from 'node:assert';\nassert.equal(1, 1);\n"); G(d, 'add', 'old.test.js'); G(d, 'commit', '-qm', 'test: an older test');
  fs.writeFileSync(path.join(d, 'old.test.js'), "import assert from 'node:assert';\nassert.equal(2, 2);\n");
};
const judged = (weakened, why = 'fine') => () => ({ ...clean(), edited_tests: [{ file: 'old.test.js', weakened, why }] });
test('a scan flagged only for an existing test that changed reads passed, with a note, and its results are reused', () => {
  const { d, id } = setup(); editedTest(d); const r = run(d, id, { review: judged(false) });
  assert.equal(r.evidence.scan.flagged, true); assert.deepEqual(r.evidence.scan.modified_existing_tests.map(x => x.replace(/ \(.*$/, '')), ['old.test.js']);
  assert.equal(r.decision, 'APPROVE', r.text); assert.equal(r.evidence.checks.scan, 'passed');
  assert.match(r.text, /checks: validate passed · scan passed \(1 existing test changed, each judged by the reviewer as not weakened\) · /);
  again(d, id); const second = run(d, id, { id: 'again', review: judged(false) }); assert.ok(second.evidence.validate_reused, 'a passed scan allows reuse'); assert.ok(second.evidence.review_reused);
});
test('an approved checkpoint never shows a check as failed; a failed check never approves', () => {
  const scenarios = [
    ['clean', () => {}, clean], ['an existing test changed', editedTest, clean],
    ['a protected file', d => fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: 'x', dependencies: { left: '1.0.0' }, scripts: { validate: 'node -e "0"' } })), clean],
    ['a red validate', d => fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: 'x', scripts: { validate: 'node -e "process.exit(1)"' } })), clean],
    ['a flawed change', () => {}, () => ({ ...clean(), weakens_or_hides_checks: true, details: 'x' })],
  ];
  for (const [what, arrange, review] of scenarios) {
    const { d, id } = setup(); arrange(d); const r = run(d, id, { review });
    const failed = Object.entries(r.evidence.checks).filter(([, v]) => v === 'failed').map(([k]) => k);
    if (r.decision === 'APPROVE') { assert.deepEqual(failed, [], `${what}: approved with ${failed.join(', ')} failed`); assert.doesNotMatch(r.text, /failed/, what); }
    else assert.ok(r.evidence.reasons.length, what);
    if (failed.length) assert.equal(r.decision, 'NEEDS_HUMAN', what);
  }
});

import { acceptCard, assumeAdd, assumeSet, reclassifyDecision } from '../src/slicestore.mjs';
import { pieceExceptions, latestEvidence, withReclassified, unspecifiedOf } from '../src/evidence.mjs';
const said = list => () => ({ ...clean(), unspecified_decisions: list });
test('a costly decision nobody specified is a reason in the owner\'s terms; a cheap one is not, and waits on the accept card (R114, R136)', () => {
  const { d, id } = setup();
  const r = run(d, id, { review: said([{ text: 'Deleted books cannot be recovered', costly: true }, { text: 'The list shows 20 books per page', costly: false }, 'Titles are sorted ignoring case']) });
  assert.equal(r.decision, 'NEEDS_HUMAN'); assert.deepEqual(r.evidence.reasons, ['costly decision nobody specified: Deleted books cannot be recovered']);
  assert.match(r.text, /- \(costly\) Deleted books cannot be recovered\n- The list shows 20 books per page\n- Titles are sorted ignoring case/);
  const card = acceptCard(d, id);
  assert.match(card, /Costly decisions nobody specified, exceptions for you to decide \(1\):\n  1\. Deleted books cannot be recovered/);
  assert.match(card, /Decisions nobody announced, taken while building \(2\): confirm them, or ask to change one:\n  2\. The list shows 20 books per page\n  3\. Titles are sorted ignoring case/);
  assert.doesNotMatch(card, /Nothing was assumed/); assert.match(card, /Reply "ok" to confirm all/);
  // reclassifying: the costly one becomes cheap (the owner's call) and leaves the exceptions; a cheap one becomes costly (Buddy may raise one)
  const dir = path.join(path.dirname(readSlice(d, id).file), 'evidence');
  // Buddy may not lower one to cheap; the owner may, and the card says so (R139)
  const cli = (...a) => spawnSync(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'buddy.mjs'), 'slice', 'decision', id, ...a, '--repo', d], { encoding: 'utf8' });
  let c = cli('1', 'cheap'); assert.equal(c.status, 1); assert.match(c.stderr, /refused: only the owner lowers a decision to cheap/);
  c = cli('1', 'cheap', '--by', 'owner'); assert.equal(c.status, 0, c.stderr); assert.match(c.stdout, /decision 1 of [^ ]+ is now cheap, by the owner: Deleted books/);
  assert.throws(() => reclassifyDecision(d, id, 1, 'cheap'), /only the owner lowers a decision to cheap/); assert.throws(() => reclassifyDecision(d, id, 1, 'cheap', { by: 'buddy' }), /--by takes only owner/);
  const evFile = path.join(dir, fs.readdirSync(dir).find(f => /^evidence-/.test(f))); const bytes = fs.readFileSync(evFile);
  const latest = () => latestEvidence(dir, id, undefined, readSlice(d, id).data.reclassified);   // read with the record's reclassifications (R140)
  assert.equal(reclassifyDecision(d, id, 1, 'cheap', { by: 'owner' }).by, 'owner'); assert.deepEqual(pieceExceptions({}, latest()), []);
  assert.equal(latest().reclassified['1'].by, 'owner');
  // the record keeps it, naming the evidence; the evidence is byte for byte what the checkpoint wrote (R140)
  assert.deepEqual(readSlice(d, id).data.reclassified.map(({ at, ...x }) => x), [{ evidence: path.basename(evFile), n: 1, costly: false, by: 'owner' }, { evidence: path.basename(evFile), n: 1, costly: false, by: 'owner' }]);
  assert.ok(fs.readFileSync(evFile).equals(bytes), 'the evidence file is unchanged'); assert.equal(latestEvidence(dir, id).reclassified, undefined);
  assert.doesNotMatch(acceptCard(d, id), /Costly decisions/); assert.match(acceptCard(d, id), /taken while building \(3\)[^\n]*\n  1\. Deleted books cannot be recovered   \(you lowered it to cheap\)\n  2\. The list shows 20 books per page\n/);
  assert.equal(reclassifyDecision(d, id, 3, 'costly').by, 'buddy'); assert.deepEqual(pieceExceptions({}, latest()), ['costly decision nobody specified: Titles are sorted ignoring case']);
  assert.ok(fs.readFileSync(evFile).equals(bytes), 'the evidence file is still unchanged');
  assert.throws(() => reclassifyDecision(d, id, 9, 'cheap', { by: 'owner' }), /no decision 9 .*there are: 1 \(Deleted/); assert.throws(() => reclassifyDecision(d, id, 1, 'pricey'), /costly or cheap/);
});
test('a checkpoint that reuses the review reads its reclassifications from the record; an evidence of before R140 is still read (R140)', () => {
  const { d, id } = setup(); const rv = said([{ text: 'Deleted books cannot be recovered', costly: true }, 'Titles are sorted ignoring case']);
  const first = run(d, id, { review: rv }); const name = path.basename(first.evidenceFile); const dir = path.dirname(first.evidenceFile);
  reclassifyDecision(d, id, 1, 'cheap', { by: 'owner' }); reclassifyDecision(d, id, 2, 'costly');
  again(d, id); const second = run(d, id, { review: rv, id: 'again' });
  assert.deepEqual(second.evidence.review_reused, { from: name, when: first.evidence.when });
  assert.deepEqual(second.evidence.reasons, ['costly decision nobody specified: Titles are sorted ignoring case']); assert.equal(second.evidence.reclassified, undefined);
  // reclassifying on the newer evidence names the evidence its review came from, so every checkpoint that reuses it reads the same
  reclassifyDecision(d, id, 2, 'cheap', { by: 'owner' }); assert.equal(readSlice(d, id).data.reclassified.pop().evidence, name);
  assert.deepEqual(pieceExceptions({}, latestEvidence(dir, id, undefined, readSlice(d, id).data.reclassified)), []);
  // an evidence that kept a reclassification itself (round 1 of R136) is still read, and the record's entry wins over it
  const old = { ...JSON.parse(fs.readFileSync(first.evidenceFile, 'utf8')), reclassified: { 1: { costly: false, by: 'owner', at: '2026-11-01T00:00:00Z' } } };
  assert.deepEqual(unspecifiedOf(withReclassified(old, name, [])).map(x => x.costly), [false, false]);
  assert.deepEqual(unspecifiedOf(withReclassified(old, name, [{ evidence: name, n: 1, costly: true, by: 'buddy', at: '2026-11-02T00:00:00Z' }])).map(x => x.costly), [true, false]);
  assert.deepEqual(unspecifiedOf(withReclassified(old, 'evidence-other.json', [{ evidence: name, n: 2, costly: true, by: 'buddy', at: '2026-11-02T00:00:00Z' }])).map(x => x.costly), [false, false]);
});
test('with only cheap decisions nobody specified the checkpoint approves, and the card never says nothing was assumed', () => {
  const { d, id } = setup(); const r = run(d, id, { review: said(['The list shows 20 books per page']) });
  assert.equal(r.decision, 'APPROVE'); const card = acceptCard(d, id);
  assert.match(card, /Decisions nobody announced, taken while building \(1\)/); assert.doesNotMatch(card, /Nothing was assumed/);
  const e = setup(); run(e.d, e.id); assert.match(acceptCard(e.d, e.id), /Nothing was assumed on your behalf\. Try it, then accept\./);
});
test('the assumptions confirmed before building reach the reviewer, and the card shows them apart (R136)', () => {
  const { d, id } = setup({ before: (d, id) => { assumeAdd(d, id, 'A book belongs to one reader', 'sharing books needs a new data model'); assumeAdd(d, id, 'English only', 'translations are a new change'); assumeSet(d, id, 'A1', 'confirmed', { by: 'owner' }); } });
  let seen = ''; run(d, id, { review: p => { seen = p; return said(['Titles are sorted ignoring case'])(); } });
  assert.match(seen, /Assumptions the Product Owner confirmed before building[^\n]*\n  A1  A book belongs to one reader/); assert.doesNotMatch(seen, /English only/);
  const card = acceptCard(d, id);
  assert.match(card, /What you confirmed before building \(1\):\n  A1  A book belongs to one reader/);
  assert.match(card, /Announced before building and not confirmed by you yet \(1\):\n  A2  English only; if it is otherwise: translations are a new change/);
  assert.match(card, /Decisions nobody announced, taken while building \(1\)/);
  assert.ok(card.indexOf('What you confirmed') < card.indexOf('Decisions nobody announced'));
});
