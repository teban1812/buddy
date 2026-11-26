import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { checkpoint } from '../src/checkpoint.mjs';
import { howtoSet, startSlice, startMilestone, moveChangeTo, moveSlice, stepAddTo, stepSetIn, readSlice, acceptCard } from '../src/slicestore.mjs';
import { createBatch, writeBatchFile, assumeDefaults } from '../src/queue.mjs';
import { EXAMPLES, WORKSHOP, G, clean, setup, withHowto, run, files, commitAll, other, edit, counting, runs, again, editedTest, judged } from './_checkpointslice.helper.mjs';
import { codeHash, currentEnvironment, sharedValidate, suiteGreen, SHARE_MAX_AGE_MS } from '../src/evidence.mjs';
import { runSuite } from '../src/suite.mjs';

// commit-project-at-birth (R144): the first slice of a repository whose first commit is the slice's own is measured from the empty tree.
import { emptyTree } from '../src/checkpoint.mjs';
test('a slice whose first commit is the repository\'s root is measured from git\'s empty tree, not refused', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cpr-')); G(d, 'init', '-q', '-b', 'main'); fs.mkdirSync(path.join(d, 'docs'));
  const s = startSlice({ repo: d, title: 'First thing', request: 'Do the first thing', criteria: ['It works'], excludes: ['Nothing beyond the criteria above'] });
  moveSlice(d, s.id, 'ready'); moveSlice(d, s.id, 'building'); assert.equal(readSlice(d, s.id).data.base, undefined);   // nothing to record: no commit yet
  fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: 'x', scripts: { validate: 'node -e "0"' } }));
  fs.writeFileSync(path.join(d, 'thing.js'), 'export const x = 1;\n'); G(d, 'add', 'package.json', 'thing.js'); G(d, 'commit', '-qm', `feat: the first thing\n\nSlice: ${s.id}`);
  const r = run(d, s.id);
  assert.equal(r.evidence.base, emptyTree(d)); assert.deepEqual(r.evidence.commits, [G(d, 'rev-parse', 'HEAD').trim()]);
  assert.deepEqual(files(r), ['package.json', 'thing.js']); assert.equal(r.slice.status, 'delivered');
  const e = setup(); assert.equal(run(e.d, e.id, { base: emptyTree(e.d) }).evidence.base, emptyTree(e.d));   // --base accepts the empty tree too
});

// fix-checks-from-field (R155): a red validate keeps the piece in building; a red validate runs once more, and a pass then names the unstable tests.
import { failedTestNames } from '../src/checkpoint.mjs';
// validate runs .git/v.cjs (outside the tree, so the code fingerprint does not move); the change of package.json is not the slice's work
const validateBy = (d, body) => { fs.writeFileSync(path.join(d, '.git', 'v.cjs'), body); fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: 'x', scripts: { validate: 'node .git/v.cjs' } })); G(d, 'add', 'package.json'); G(d, 'commit', '-qm', 'chore: validate by a script'); };
const COUNT = "const fs = require('fs'); const f = '.git/runs'; const n = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').length : 0; fs.appendFileSync(f, 'x');";
const flaky = (lines = ['not ok 1 - sorts the list', 'not ok 2 - keeps the order']) => `${COUNT} if (n % 2 === 0) { ${lines.map(l => `console.log(${JSON.stringify(l)});`).join(' ')} process.exit(1); }`;
const ran = d => (fs.existsSync(path.join(d, '.git', 'runs')) ? fs.readFileSync(path.join(d, '.git', 'runs'), 'utf8').length : 0);
test('a red validate leaves the piece in building, says so and keeps the evidence; once fixed it is checked again directly (AC1)', () => {
  const { d, id } = setup(); validateBy(d, `${COUNT} process.exit(1);`);
  const r = run(d, id); assert.equal(r.decision, 'NEEDS_HUMAN'); assert.equal(r.evidence.checks.validate, 'failed');
  assert.equal(readSlice(d, id).data.status, 'building'); assert.deepEqual(r.slice, { id, status: 'building' });
  assert.match(r.text, new RegExp(`SLICE: ${id}: the piece stays in building: fix what is red and run the checkpoint again`)); assert.doesNotMatch(r.text, /is now delivered/);
  assert.ok(fs.existsSync(r.evidenceFile), 'the evidence is written'); assert.equal(ran(d), 2, 'one rerun, never more (X1)'); assert.equal(r.evidence.validate_rerun, undefined);
  fs.writeFileSync(path.join(d, '.git', 'v.cjs'), 'process.exit(0);');                                   // fixed: no rework, no move by hand
  const r2 = run(d, id, { id: 'fixed' }); assert.equal(r2.decision, 'APPROVE', r2.text); assert.equal(readSlice(d, id).data.status, 'delivered'); assert.equal(r2.evidence.validate_reused, undefined);
});
test('a validate stopped for time is treated as red: the piece stays in building, and it is not rerun', () => {
  const { d, id } = setup(); validateBy(d, `${COUNT} setTimeout(() => {}, 20000);`);
  const r = run(d, id, { validateTimeout: 2 }); assert.match(r.text, /validate was stopped: it did not finish in time/);
  assert.equal(readSlice(d, id).data.status, 'building'); assert.equal(ran(d), 1, 'a slow machine is not a test that fails at random');
});
test('a validate without a script is not red: the piece is delivered as before', () => {
  const { d, id } = setup(); fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: 'x' })); G(d, 'add', 'package.json'); G(d, 'commit', '-qm', 'chore: no validate');
  const r = run(d, id); assert.equal(r.evidence.checks.validate, 'not run'); assert.equal(readSlice(d, id).data.status, 'delivered');
});
test('a test that fails and then passes on the one rerun is named as unstable in the evidence, the text and the accept card, never a clean green (AC4)', () => {
  const { d, id } = setup(); validateBy(d, flaky());
  const r = run(d, id); assert.equal(ran(d), 2);
  const rr = r.evidence.validate_rerun; assert.equal(rr.first_exit, 1); assert.deepEqual(rr.names, ['sorts the list', 'keeps the order']); assert.match(rr.first_tail, /not ok 1 - sorts the list/);
  assert.equal(r.evidence.validate_exit, 0); assert.equal(r.evidence.checks.validate, 'passed'); assert.deepEqual(r.evidence.reasons, [], 'a note, not a reason');
  assert.match(r.text, /checks: validate passed on a rerun \(unstable: sorts the list, keeps the order\) · scan passed/);
  assert.match(r.text, /NOTE: unstable test\(s\) to fix: sorts the list, keeps the order \(validate failed first, exit 1, and passed on its one rerun\)/);
  assert.equal(readSlice(d, id).data.status, 'delivered');
  assert.match(acceptCard(d, id), /Found by the checks, not exceptions by themselves \(1\):\n  unstable test\(s\) to fix: sorts the list, keeps the order/);
  again(d, id); const second = run(d, id, { id: 'again' });
  assert.equal(second.evidence.validate_reused, undefined, 'a pass on a rerun is never reused'); assert.equal(ran(d), 4); assert.ok(second.evidence.validate_rerun);
});
test('the unstable tests whose names cannot be read say so; a rerun that fails too is red as before', () => {
  const { d, id } = setup(); validateBy(d, flaky(['something went wrong']));
  const r = run(d, id); assert.deepEqual(r.evidence.validate_rerun.names, []); assert.equal(r.evidence.validate_rerun.names_readable, false);
  assert.match(r.text, /validate passed on a rerun \(unstable: names not readable\)/);
  const red = setup(); validateBy(red.d, `${COUNT} console.log('not ok 1 - always'); process.exit(1);`);
  const rr = run(red.d, red.id); assert.equal(ran(red.d), 2); assert.equal(rr.evidence.checks.validate, 'failed'); assert.equal(rr.evidence.validate_rerun, undefined); assert.match(rr.text, /validate failed/);
});
test('the names of failed tests are read from node --test, dotnet test and vitest output', () => {
  assert.deepEqual(failedTestNames('TAP version 13\n# Subtest: a\nok 1 - a\n    not ok 2 - sorts the list\nnot ok 3 - file.test.mjs # time=3'), ['sorts the list', 'file.test.mjs']);
  assert.deepEqual(failedTestNames('\x1b[31m✖ sorts the list (12.5ms)\x1b[39m\nℹ fail 1\n✖ failing tests:\n\n✖ sorts the list (12.5ms)\n  AssertionError'), ['sorts the list']);
  assert.deepEqual(failedTestNames('  Passed App.Tests.A [1 ms]\n  Failed App.Tests.Orders.Totals [12 ms]\nFailed!  - Failed: 1, Passed: 1'), ['App.Tests.Orders.Totals']);
  assert.deepEqual(failedTestNames(' FAIL  src/list.test.tsx > List > shows the rows\n   × shows the rows 1012ms'), ['src/list.test.tsx > List > shows the rows', 'shows the rows']);
  assert.deepEqual(failedTestNames('all good\n'), []);
});

// ask-only-what-matters (R157): the checkpoint takes its notes as text or from the standard input, so it is one command on its own.
test('the checkpoint\'s notes come from text, the standard input or a file that exists; never two of them, never a file that is not there', async () => {
  const { checkpointNotes } = await import('../src/checkpoint.mjs');
  assert.equal(checkpointNotes({ notesText: '## Assumptions\nnone' }), '## Assumptions\nnone');
  assert.equal(checkpointNotes({ notes: '-' }, { stdin: () => 'from stdin\n' }), 'from stdin\n');
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'notes-')), 'n.md'); fs.writeFileSync(f, 'from a file');
  assert.equal(checkpointNotes({ notes: f }), 'from a file'); assert.equal(checkpointNotes({}), '');
  assert.throws(() => checkpointNotes({ notes: f, notesText: 'x' }), /give the notes once/);
  assert.throws(() => checkpointNotes({ notes: path.join(path.dirname(f), 'missing.md') }), /does not exist; give the notes as text with --notes-text/);
  const BUDDY = fileURLToPath(new URL('../bin/buddy.mjs', import.meta.url));
  const r = spawnSync(process.execPath, [BUDDY, 'checkpoint', '--run', 'x', '--notes', 'missing.md'], { cwd: path.dirname(f), encoding: 'utf8' });
  assert.equal(r.status, 1); assert.match(r.stderr, /^refused: the notes file missing\.md does not exist/);
  const both = spawnSync(process.execPath, [BUDDY, 'checkpoint', '--run', 'x', '--notes', '-', '--notes-text', 'y'], { cwd: path.dirname(f), encoding: 'utf8', input: 'z' });
  assert.equal(both.status, 1); assert.match(both.stderr, /give the notes once/);
});

test('a file edited within a second of being committed, to the same size, is seen as changed by the fingerprint even when it is read later (git\'s racy case)', () => {
  const { d } = setup();
  fs.writeFileSync(path.join(d, 'same.js'), 'export const n = 1;\n'); G(d, 'add', 'same.js'); G(d, 'commit', '-qm', 'feat: same\n\nSlice: x');
  const before = codeHash(d);
  fs.writeFileSync(path.join(d, 'same.js'), 'export const n = 2;\n');                 // the same size, in the same second as the staging
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1300);                   // a checkpoint reads the tree a moment later
  assert.notEqual(codeHash(d), before, 'the edit is read from the content of the file, not from its size and its time');
});

// share-test-results (the owner chose on 2026-11-05): a green from another change is reused only while it is recent and was got with the same tools.
test('a green from another change is reused only if it is under 2 days old and was got with the same system and Node version', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-')); const now = new Date('2026-11-05T12:00:00Z'); const env = { platform: 'linux', node: 'v22.1.0' };
  const put = (name, over) => { const f = path.join(dir, `evidence-${name}.json`); fs.writeFileSync(f, JSON.stringify({ when: '2026-11-05T10:00:00.000Z', code_hash: 'abc', validate_exit: 0, tests: 'full', environment: env, ...over })); return f; };
  const find = (files, extra = {}) => { const refusals = []; const r = sharedValidate(dir, files, 'abc', 'full', { now, environment: env, refusals, ...extra }); return { r, refusals }; };
  const fresh = put('fresh', {}); const a = find([fresh]); assert.ok(a.r); assert.deepEqual(a.refusals, []);
  const old = put('old', { when: new Date(now - SHARE_MAX_AGE_MS - 1000).toISOString() }); const b = find([old]); assert.equal(b.r, null); assert.deepEqual(b.refusals, ['a green on the same code is older than 2 days']);
  assert.ok(find([put('edge', { when: new Date(now - SHARE_MAX_AGE_MS + 1000).toISOString() })]).r, 'just under 2 days is still good');
  for (const [name, over, why] of [['other-os', { environment: { platform: 'win32', node: 'v22.1.0' } }, /other tools/], ['other-node', { environment: { platform: 'linux', node: 'v20.0.0' } }, /other tools/], ['no-env', { environment: undefined }, /does not say which tools/]]) {
    const c = find([put(name, over)]); assert.equal(c.r, null, name); assert.match(c.refusals[0], why, name);
  }
  assert.ok(find([old, fresh]).r.file.endsWith('evidence-fresh.json'), 'an old one beside a good one does not stop the good one');
  // a result that was itself reused counts from the run that really happened, so a chain of reuses cannot keep a green alive
  const chain = put('chain', { when: '2026-11-05T11:00:00.000Z', environment: env, validate_reused: { from: 'x.json', when: new Date(now - SHARE_MAX_AGE_MS - 1000).toISOString(), slice: null, environment: env } });
  assert.equal(find([chain]).r, null); assert.match(find([chain]).refusals[0], /older than 2 days/);
  const chainEnv = put('chain-env', { when: '2026-11-05T11:00:00.000Z', environment: env, validate_reused: { from: 'x.json', when: '2026-11-05T09:00:00.000Z', slice: null, environment: { platform: 'win32', node: 'v22.1.0' } } });
  assert.equal(find([chainEnv]).r, null); assert.match(find([chainEnv]).refusals[0], /other tools/);
});
test('a checkpoint records the tools it ran with and says when it ran validate because an earlier green could not be shared', () => {
  const { d, id } = setup(); counting(d); const code = codeHash(d); const gb = path.join(d, '.buddy'); fs.mkdirSync(gb, { recursive: true });
  fs.writeFileSync(path.join(gb, 'evidence-other.json'), JSON.stringify({ when: new Date().toISOString(), code_hash: code, validate_exit: 0, tests: 'full', environment: { platform: 'plan9', node: 'v1.0.0' } }));
  const r = run(d, id); assert.deepEqual(r.evidence.environment, currentEnvironment()); assert.equal(runs(d), 1, 'validate ran');
  assert.deepEqual(r.evidence.validate_not_shared, ['a green on the same code was got with other tools (another system or Node version)']); assert.equal(r.evidence.validate_reused, undefined);
});

// accept-whole-suite (the owner chose on 2026-11-05, R173): acceptance asks for a green suite on the code as it is now, shared while recent and with the same tools.
test('the suite counts only if it passed on exactly this code, recently and with the same tools; a failing one is kept as evidence and never counts', () => {
  const { d } = setup(); const files = () => fs.readdirSync(path.join(d, '.buddy')).filter(f => /^evidence-.*-suite\.json$/.test(f)).map(f => path.join(d, '.buddy', f));
  assert.deepEqual(suiteGreen(d, []), { ok: false, why: 'it has not run on this code' });
  const ok = runSuite({ repo: d }); assert.equal(ok.passed, true); assert.match(ok.text, /The whole suite passes on the code as it is/); assert.equal(ok.evidence.code_hash, codeHash(d)); assert.deepEqual(ok.evidence.environment, currentEnvironment());
  assert.equal(suiteGreen(d, files()).ok, true);
  fs.writeFileSync(path.join(d, 'more.js'), 'export const m = 1;\n');                                                  // the code changes: the old run no longer counts
  assert.deepEqual(suiteGreen(d, files()), { ok: false, why: 'it has not run on this code' });
  const red = runSuite({ repo: d, validate: () => ({ status: 1, stdout: 'not ok 1', stderr: '' }) }); assert.equal(red.passed, false); assert.match(red.text, /The suite FAILS/);
  assert.equal(suiteGreen(d, files()).ok, false, 'a failing run is evidence, never a green');
  assert.equal(suiteGreen(d, files(), { now: new Date(Date.now() + 3 * 24 * 3600 * 1000) }).ok, false);
  const green = runSuite({ repo: d }); assert.equal(suiteGreen(d, files()).ok, true); assert.equal(suiteGreen(d, files(), { now: new Date(Date.now() + 3 * 24 * 3600 * 1000) }).why, 'a green on the same code is older than 2 days');
  assert.equal(suiteGreen(d, files(), { environment: { platform: 'plan9', node: 'v1' } }).ok, false);
});
test('buddy suite runs the project\'s suite from the command and says whether it passed', () => {
  const { d } = setup(); const BUDDY = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'buddy.mjs');
  const out = execFileSync(process.execPath, [BUDDY, 'suite'], { cwd: d, encoding: 'utf8' }); assert.match(out, /The whole suite passes on the code as it is/);
  assert.ok(fs.readdirSync(path.join(d, '.buddy')).some(f => /-suite\.summary\.json$/.test(f)));
});

test('a reviewer that gave no verdict is asked once more, and the cost of both asks is kept; if it still gives none, that is the finding', () => {
  const { d, id } = setup(); let n = 0;
  const flaky = () => { n++; return n === 1 ? { does_what_was_asked: null, weakens_or_hides_checks: null, unspecified_decisions: [], details: 'reviewer failed', cost: 0.1, opened: { read: [], commands: [] } } : { ...clean(), cost: 0.2, opened: { read: [], commands: [] } }; }; flaky.agent = true;
  const r = run(d, id, { review: flaky }); assert.equal(n, 2); assert.equal(r.decision, 'APPROVE', r.text); assert.equal(r.evidence.review.retried, true); assert.ok(Math.abs(r.evidence.review.cost - 0.3) < 1e-9);
  const { d: d2, id: id2 } = setup(); let m = 0; const dead = () => { m++; return { does_what_was_asked: null, weakens_or_hides_checks: null, unspecified_decisions: [], details: 'reviewer failed', opened: { read: [], commands: [] } }; }; dead.agent = true;
  const r2 = run(d2, id2, { review: dead }); assert.equal(m, 2, 'once more, not forever'); assert.match(r2.evidence.reasons.join('|'), /independent reviewer gave no verdict/);
  const { d: d3, id: id3 } = setup(); let k = 0; const fine = () => { k++; return { ...clean(), opened: { read: [], commands: [] } }; }; fine.agent = true;
  run(d3, id3, { review: fine }); assert.equal(k, 1, 'a reviewer that answered is not asked twice');
});

// reuse-checks-on-unchanged-content (the owner chose on 2026-11-05, R176): the reviewer's verdict also depends on the change's goal, and a green is reused within the
// same change only while it is recent and was got with the same tools.
test('the reviewer\'s verdict is reused only if the goal of the change is the same; a different way to try a criterion asks the reviewer again, and validate is still reused', () => {
  const { d, id } = setup(); counting(d); let asked = 0; const rv = () => { asked++; return clean(); };
  const first = run(d, id, { review: rv }); assert.equal(asked, 1); assert.match(first.evidence.goal_hash, /^[0-9a-f]{16}$/);
  moveSlice(d, id, 'rework'); moveSlice(d, id, 'building');
  const same = run(d, id, { review: rv, id: 'same' }); assert.equal(asked, 1, 'the same code and the same goal: the verdict stands'); assert.ok(same.evidence.review_reused); assert.equal(same.evidence.goal_hash, first.evidence.goal_hash);
  moveSlice(d, id, 'rework'); moveSlice(d, id, 'building'); howtoSet(d, id, 'AC1', { steps: 'Do it another way', expect: 'It does something else' });
  const other = run(d, id, { review: rv, id: 'other' }); assert.equal(asked, 2, 'the goal changed: the reviewer judges again'); assert.equal(other.evidence.review_reused, undefined); assert.ok(other.evidence.validate_reused, 'the code is the same: the suite is not run again'); assert.equal(runs(d), 1);
  assert.notEqual(other.evidence.goal_hash, first.evidence.goal_hash);
});
test('a green from an earlier check of the same change is reused only if it is under 2 days old and was got with the same tools', () => {
  for (const [why, change] of [['older than 2 days', e => { e.when = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(); }], ['other tools', e => { e.environment = { platform: 'plan9', node: 'v1.0.0' }; }], ['no tools said', e => { delete e.environment; }]]) {
    const { d, id } = setup(); counting(d); const first = run(d, id);
    for (const f of [first.evidenceFile, first.evidenceFile.replace(/\.json$/, '.summary.json')]) { const e = JSON.parse(fs.readFileSync(f, 'utf8')); change(e); fs.writeFileSync(f, JSON.stringify(e)); }
    moveSlice(d, id, 'rework'); moveSlice(d, id, 'building');
    const second = run(d, id, { id: 'again' }); assert.equal(runs(d), 2, `validate runs again when the earlier green is ${why}`); assert.equal(second.evidence.validate_reused, undefined, why);
    assert.ok((second.evidence.validate_not_shared || []).length === 1, why);
  }
});

// show-unrun-checks-honestly (the owner chose on 2026-11-05, R177): the reviewer judges every existing test the slice edited, one by one.
test('the reviewer is asked to judge each existing test the slice edited; no judgment, or a weakened one, is an exception', () => {
  const { d, id } = setup(); editedTest(d); let seen = '';
  const none = run(d, id, { review: p => { seen = p; return clean(); } });
  assert.match(seen, /## Existing tests this slice edited\n  old\.test\.js\nFor EACH one add to your JSON "edited_tests": \[\{"file": "<path>", "weakened": true\|false, "why": "<one sentence>"\}\]/);
  assert.equal(none.decision, 'NEEDS_HUMAN'); assert.match(none.evidence.reasons.join('|'), /the reviewer did not say whether editing old\.test\.js weakened it/);
  moveSlice(d, id, 'rework'); moveSlice(d, id, 'building');
  const weak = run(d, id, { review: judged(true, 'the expected value was changed to match the new code'), id: 'w' });
  assert.equal(weak.decision, 'NEEDS_HUMAN'); assert.match(weak.evidence.reasons.join('|'), /independent reviewer: editing an existing test weakened it \(old\.test\.js: the expected value was changed to match the new code\)/); assert.doesNotMatch(weak.evidence.reasons.join('|'), /did not say/);
  moveSlice(d, id, 'rework'); moveSlice(d, id, 'building');
  const ok = run(d, id, { review: judged(false), id: 'ok' }); assert.equal(ok.decision, 'APPROVE', ok.text); assert.deepEqual(ok.evidence.review.edited_tests, [{ file: 'old.test.js', weakened: false, why: 'fine' }]);
  const { d: d2, id: id2 } = setup(); let seen2 = ''; run(d2, id2, { review: p => { seen2 = p; return clean(); } }); assert.doesNotMatch(seen2, /Existing tests this slice edited/, 'nothing to judge when no existing test was edited');
});

// let-the-reviewer-judge-scan-flags (the owner, 2026-11-14, R216): a skip marker or a deleted test no longer keeps the reviewer from running.
test('with validate green the reviewer runs despite a skip marker and a deleted test, judges each, and only one it does not justify is a reason', () => {
  const MARK = 'thing.js: // eslint-disable-next-line no-console -- the command prints its answer';
  const flagged = d => {   // a test committed before by another change and deleted by the slice, and a silenced lint rule with its reason
    fs.writeFileSync(path.join(d, 'gone.test.js'), "import assert from 'node:assert';\nassert.equal(1, 1);\n"); G(d, 'add', 'gone.test.js'); G(d, 'commit', '-qm', 'test: an older test');
    fs.rmSync(path.join(d, 'gone.test.js')); fs.appendFileSync(path.join(d, 'thing.js'), '// eslint-disable-next-line no-console -- the command prints its answer\nconsole.log(x);\n');
  };
  const says = (gone, mark, why = 'the request removes it') => () => ({ ...clean(), scan_flags: [{ item: 'test deleted: gone.test.js', justified: gone, why }, ...(mark === undefined ? [] : [{ item: MARK, justified: mark, why: 'printing is the command' }])] });
  const { d, id } = setup(); flagged(d); let seen = ''; let asked = 0;
  const none = run(d, id, { review: p => { asked++; seen = p; return clean(); } });
  assert.equal(asked, 1, 'the reviewer ran'); assert.doesNotMatch(none.text, /reviewer not run/);
  assert.match(seen, /## Checks this slice silenced, and tests it deleted\n  thing\.js: \/\/ eslint-disable-next-line[^\n]*\n  test deleted: gone\.test\.js\nFor EACH one add to your JSON "scan_flags"/);
  const r0 = none.evidence.reasons.join('|');
  assert.match(r0, /tests deleted: gone\.test\.js \(the reviewer did not say whether it is justified\)/); assert.match(r0, /skip\/ignore\/disable markers added: thing\.js: [^|]*\(the reviewer did not say/); assert.equal(none.evidence.checks.scan, 'failed');
  moveSlice(d, id, 'rework'); moveSlice(d, id, 'building');
  const half = run(d, id, { review: says(true, false), id: 'h' }); const r1 = half.evidence.reasons.join('|');
  assert.doesNotMatch(r1, /tests deleted/); assert.match(r1, /skip\/ignore\/disable markers added: thing\.js: [^|]*\(the reviewer finds it not justified: printing is the command\)/);
  moveSlice(d, id, 'rework'); moveSlice(d, id, 'building');
  const ok = run(d, id, { review: says(true, true), id: 'ok' });
  assert.equal(ok.decision, 'APPROVE', ok.text); assert.equal(ok.evidence.checks.scan, 'passed'); assert.match(ok.text, /2 skip markers or deleted tests judged justified by the reviewer/);
  // a red validate still keeps the reviewer from running, and then each flag stays a reason as before
  const { d: d2, id: id2 } = setup(); flagged(d2); fs.writeFileSync(path.join(d2, 'package.json'), JSON.stringify({ name: 'x', scripts: { validate: 'node -e "process.exit(1)"' } }));
  let a2 = 0; const red = run(d2, id2, { review: () => { a2++; return says(true, true)(); } }); const r2 = red.evidence.reasons.join('|');
  assert.equal(a2, 0); assert.match(r2, /tests deleted: gone\.test\.js(\||$)/); assert.match(r2, /skip\/ignore\/disable markers added(\||$)/);
});

test('the owner\'s go-ahead on the slice\'s own milestone is not a change of someone else\'s record; another milestone moved by the slice still is', () => {
  const { d, id } = setup(); const m = startMilestone({ repo: d, title: 'Greeting', request: 'Greet', criteria: ['Greets'], excludes: ['Nothing else'] });
  moveSlice(d, m.id, 'ready'); moveSlice(d, m.id, 'building'); moveChangeTo(d, id, m.id);          // the go-ahead, uncommitted, before Dev's work
  const r = run(d, id); assert.doesNotMatch(r.evidence.reasons.join('|'), /changed the state of/, r.text);
  // another milestone moved to building by the slice's work is still someone else's record
  const m2 = startMilestone({ repo: d, title: 'Later', request: 'Later', criteria: ['Later'], excludes: ['Nothing else'] }); moveSlice(d, m2.id, 'ready'); moveSlice(d, m2.id, 'building');
  moveSlice(d, id, 'rework'); moveSlice(d, id, 'building');
  assert.match(run(d, id, { id: 'two' }).evidence.reasons.join('|'), /changed the state of later: Later from no record to building/);
});

// shorten-evidence-file-names (R212): the name of a new evidence file carries the time and a short mark made from the piece and the run, never
// their names, so a project built with Buddy clones on Windows under a deep folder.
test('a new evidence file has a name of at most 50 characters, its summary included, whatever the names of the piece and the run; two pieces checked in the same second do not share one', async () => {
  const { summaryFileOf, evidenceName } = await import('../src/evidence.mjs'); const now = () => new Date('2026-11-11T10:00:00.250Z');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cpn-')); G(d, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: 'x', scripts: { validate: 'node -e "0"' } })); fs.mkdirSync(path.join(d, 'docs')); G(d, 'add', '-A'); G(d, 'commit', '-qm', 'base');
  const ch = startSlice({ repo: d, title: 'Reading list', request: 'r', criteria: ['Works'], excludes: ['Sharing'] });
  const ids = ['Refuse acceptance on changed content of the list', 'Remove a book'].map(t => startSlice({ repo: d, title: t, request: 'Do it', criteria: ['Works'], excludes: ['Nothing beyond the criteria above'], inChange: ch.id }).id);
  for (const id of ids) { moveSlice(d, id, 'ready'); moveSlice(d, id, 'building'); }
  fs.writeFileSync(path.join(d, 'a.test.js'), "import assert from 'node:assert';\nassert.equal(1, 1);\n");
  const long = 'round-two-after-the-reviewer-asked-for-more-tests-on-the-list';
  const [one, two] = ids.map(id => run(d, id, { now, id: long }));                                   // the same second, the same run name, the same folder
  for (const r of [one, two]) {
    const name = path.basename(r.evidenceFile); assert.match(name, /^evidence-2026-11-11T100000Z-[0-9a-f]{8}\.json$/);
    assert.ok(path.basename(summaryFileOf(r.evidenceFile)).length <= 50, name); assert.ok(fs.existsSync(summaryFileOf(r.evidenceFile)));
  }
  assert.equal(path.dirname(one.evidenceFile), path.dirname(two.evidenceFile)); assert.notEqual(one.evidenceFile, two.evidenceFile);
  assert.deepEqual([one, two].map(r => JSON.parse(fs.readFileSync(r.evidenceFile, 'utf8')).slice), ids, 'each piece kept its own evidence');
  assert.notEqual(evidenceName('2026-11-11T10:00:00.250Z', ids[0], 'r1'), evidenceName('2026-11-11T10:00:00.250Z', ids[0], 'r2'));   // and two runs of one piece
  const suite = runSuite({ repo: d, now }); assert.equal(path.basename(suite.file), 'evidence-2026-11-11T100000Z-suite.json'); assert.ok(path.basename(summaryFileOf(suite.file)).length <= 50);
});
