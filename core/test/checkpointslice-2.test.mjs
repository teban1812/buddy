import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { checkpoint, claudeReviewer } from '../src/checkpoint.mjs';
import { howtoSet, startSlice, startMilestone, moveChangeTo, moveSlice, stepAddTo, stepSetIn, readSlice } from '../src/slicestore.mjs';
import { createBatch, writeBatchFile, assumeDefaults } from '../src/queue.mjs';
import { EXAMPLES, WORKSHOP, G, clean, setup, withHowto, run, files, commitAll, other, edit, counting, runs, again } from './_checkpointslice.helper.mjs';

test('a change larger than the reviewer\'s window: no approval unless the reviewer opened what it was not shown (R128)', () => {
  const { d, id } = setup(); fs.writeFileSync(path.join(d, 'big.js'), `export const big = [\n${'  1,\n'.repeat(9000)}];\n`); fs.writeFileSync(path.join(d, 'small.js'), 'export const s = 1;\n');
  const blind = run(d, id);                                  // a reviewer that only reads the prompt
  assert.equal(blind.decision, 'NEEDS_HUMAN'); assert.match(blind.text, /the reviewer did not see all of the work: it saw \d+ of \d+ characters of the diff and did not open big\.js/);
  assert.ok(blind.evidence.review_input.not_shown.some(n => n.file === 'big.js'));
  const { d: d2, id: id2 } = setup(); fs.writeFileSync(path.join(d2, 'big.js'), `export const big = [\n${'  1,\n'.repeat(9000)}];\n`);
  let prompt = ''; const agent = (p) => { prompt = p; return { ...clean(), opened: { read: ['big.js', 'thing.js', 'thing.test.js'].map(f => path.join(d2, f)), commands: [] } }; }; agent.agent = true;
  const sighted = run(d2, id2, { review: agent });
  assert.ok(!/did not see all/.test(sighted.text), sighted.text); assert.match(prompt, /INCOMPLETE[\s\S]*big\.js/);
  assert.ok(sighted.evidence.review_input.opened_by_the_reviewer.includes('big.js')); assert.equal(sighted.evidence.review.opened, undefined);
  const { d: d3, id: id3 } = setup(); fs.writeFileSync(path.join(d3, 'big.js'), `export const big = [\n${'  1,\n'.repeat(9000)}];\n`);
  const lazy = (p) => ({ ...clean(), opened: { read: [], commands: [] } }); lazy.agent = true;
  assert.match(run(d3, id3, { review: lazy }).text, /did not open big\.js/);
});

test('AC2: in Antigravity, a diff past the inline limit names left-out files and approves once stream-json proves every required file was opened; otherwise it flags unseen work', () => {
  const mkAgy = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-env-')); const bin = path.join(dir, 'bin'); fs.mkdirSync(bin); fs.writeFileSync(path.join(bin, 'agy'), '#!/bin/sh\nprintf "gemini-4-neon-high\\tNeon\\n"\n'); fs.chmodSync(path.join(bin, 'agy'), 0o755); return { PATH: bin, BUDDY_HOME: path.join(dir, 'home'), BUDDY_TOOL: 'agy' }; };
  const agyEnv = mkAgy();
  const verdict = JSON.stringify(clean());
  // Case 1: agy opens big.js via read_file in stream-json
  const { d, id } = setup(); fs.writeFileSync(path.join(d, 'big.js'), `export const big = [\n${'  1,\n'.repeat(9000)}];\n`);
  let prompt1 = '';
  const rv1 = claudeReviewer({ env: agyEnv, model: 'gemini-4-neon-high', spawn: (_cmd, args) => {
    prompt1 = args.find(a => a.startsWith('-p='))?.slice(3) || '';
    const stdout = [
      JSON.stringify({ event: 'step_update', step_update: { step_index: 1, state: 'DONE', step_type: 'tool', tool_name: 'read_file', tool_info: { name: 'read_file', parameters: { Path: path.join(d, 'big.js') } } } }),
      JSON.stringify({ event: 'step_update', step_update: { step_index: 2, state: 'DONE', step_type: 'tool', tool_name: 'view_file', tool_info: { name: 'view_file', parameters: { AbsolutePath: path.join(d, 'thing.js') } } } }),
      JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: verdict } }),
    ].join('\n');
    return { status: 0, stdout, stderr: '' };
  } });
  const r1 = run(d, id, { review: rv1 });
  assert.equal(rv1.agent, true);
  assert.match(prompt1, /INCOMPLETE[\s\S]*big\.js/);
  assert.equal(r1.decision, 'APPROVE', r1.text);
  assert.ok(!/did not see all/.test(r1.text), r1.text);
  assert.ok(r1.evidence.review_input.opened_by_the_reviewer.includes('big.js'));
  // Case 2: agy does NOT open big.js -> checkpoint still flags that the reviewer did not see all of the work
  const { d: d2, id: id2 } = setup(); fs.writeFileSync(path.join(d2, 'big.js'), `export const big = [\n${'  1,\n'.repeat(9000)}];\n`);
  let calls = 0;
  const rv2 = claudeReviewer({ env: agyEnv, model: 'gemini-4-neon-high', spawn: () => {
    calls++;
    return { status: 0, stdout: JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: verdict } }), stderr: '' };
  } });
  const r2 = run(d2, id2, { review: rv2 });
  assert.equal(r2.decision, 'NEEDS_HUMAN');
  assert.match(r2.text, /the reviewer did not see all of the work:.*did not open big\.js/);
  assert.equal(calls, 2, 'agent mode asks once more when a required file was not opened');
});

test('a standard the reviewer says is broken, or a criterion not met, is an exception; the files it was given are in the evidence (R128)', () => {
  const { d, id } = setup(); fs.mkdirSync(path.join(d, 'docs/standards'), { recursive: true }); fs.writeFileSync(path.join(d, 'docs/standards/code.md'), '# must: no globals\n');
  let seen = ''; const r = run(d, id, { review: p => { seen = p; return { ...clean(), standards_broken: ['docs/standards/code.md: uses a global'], criteria_not_met: ['C1: it does not sort'] }; } });
  assert.equal(r.decision, 'NEEDS_HUMAN'); assert.match(r.text, /breaks the standards \(docs\/standards\/code\.md: uses a global\)/); assert.match(r.text, /criteria not met \(C1: it does not sort\)/);
  assert.ok(seen.includes('docs/standards/code.md') && seen.includes('It works') && seen.includes('Nothing beyond the criteria above'));
  assert.ok(r.evidence.review_input.given_files.includes('docs/standards/code.md')); assert.equal(r.evidence.review_input.criteria, 1);
});

test('with validate red the reviewer is not asked, and the evidence says so', () => {
  const { d, id } = setup(); fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: 'x', scripts: { validate: 'node -e "process.exit(1)"' } }));
  let asked = 0; const r = run(d, id, { review: () => { asked++; return clean(); } });
  assert.equal(asked, 0); assert.equal(r.evidence.review.not_run, true);
  assert.match(r.text, /validate failed/); assert.match(r.text, /independent reviewer not run/);
});
test('the third round with findings still open goes to the owner; each round is counted in the evidence', () => {
  const { d, id } = setup(); const flawed = () => ({ ...clean(), weakens_or_hides_checks: true, details: 'a mock replaces the behaviour' });
  const rounds = [];
  for (let i = 1; i <= 3; i++) {
    const r = run(d, id, { review: flawed, id: `r${i}` }); rounds.push(r.evidence.round);
    assert.equal(/round 3 with findings still open/.test(r.text), i === 3, `round ${i}`);
    if (i < 3) moveSlice(d, id, 'rework'), moveSlice(d, id, 'building');
  }
  assert.deepEqual(rounds, [1, 2, 3]);
});

test('a piece counts its own review rounds, not its siblings\' (R247)', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cpr-')); G(d, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: 'x', scripts: { validate: 'node -e "0"' } })); fs.mkdirSync(path.join(d, 'docs')); G(d, 'add', '-A'); G(d, 'commit', '-qm', 'base');
  const ch = startSlice({ repo: d, title: 'Reading list', request: 'r', criteria: ['Works'], excludes: ['Sharing'] });
  const [a, b] = ['Save books', 'Remove a book'].map(t => startSlice({ repo: d, title: t, request: 'Do it', criteria: ['Works'], excludes: ['Nothing beyond the criteria above'], inChange: ch.id }).id);
  for (const id of [a, b]) { moveSlice(d, id, 'ready'); moveSlice(d, id, 'building'); }
  fs.writeFileSync(path.join(d, 'a.test.js'), "import assert from 'node:assert';\nassert.equal(1, 1);\n");
  const flawed = () => ({ ...clean(), weakens_or_hides_checks: true, details: 'a mock replaces the behaviour' });
  const rounds = id => [1, 2, 3].map(i => { const r = run(d, id, { review: flawed, id: `${id}${i}` }); const out = [r.evidence.round, /with findings still open/.test(r.text)]; if (i < 3) moveSlice(d, id, 'rework'), moveSlice(d, id, 'building'); return out; });
  assert.deepEqual(rounds(a), [[1, false], [2, false], [3, true]]);
  assert.deepEqual(rounds(b), [[1, false], [2, false], [3, true]], 'the second piece starts at round 1 and escalates at its own third round');
});

test('a validate that does not finish is stopped with a message, everything it started ends, and it is an exception (R128 basics)', { skip: process.platform === 'win32' && 'the process-tree check uses POSIX signals' }, () => {
  const { d, id } = setup();
  fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: 'x', scripts: { validate: 'node slow.js' } }));
  fs.writeFileSync(path.join(d, 'slow.js'), `import { spawn } from 'node:child_process'; import fs from 'node:fs';
const c = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' }); fs.writeFileSync('child.pid', String(c.pid)); setTimeout(() => {}, 60000);\n`);
  fs.writeFileSync(path.join(d, '.gitignore'), 'child.pid\n');
  let asked = 0; const t0 = Date.now(); const r = run(d, id, { validateTimeout: 2, review: () => { asked++; return clean(); } });
  assert.ok(Date.now() - t0 < 20000, 'it did not wait the full minute'); assert.equal(r.evidence.validate_exit, 124);
  assert.match(r.text, /validate was stopped: it did not finish in time/); assert.match(r.evidence.validate_tail, /stopped after 2 seconds/); assert.equal(asked, 0);
  const pid = Number(fs.readFileSync(path.join(d, 'child.pid'), 'utf8'));
  const alive = () => { try { process.kill(pid, 0); } catch { return false; } try { return !/^\d+ \(.*\) Z/.test(fs.readFileSync(`/proc/${pid}/stat`, 'utf8')); } catch { return true; } };   // a zombie nobody reaped is ended
  assert.equal(alive(), false, 'the process validate started was ended');
});

test('the checkpoint never tells Dev to hold the commit until the owner approves (R88)', () => {
  const { d, id } = setup(); const r = run(d, id, { review: () => ({ ...clean(), weakens_or_hides_checks: true, details: 'x' }) });
  assert.equal(r.decision, 'NEEDS_HUMAN'); assert.ok(!/commit only after/i.test(r.text)); assert.match(r.text, /committed by Dev when the slice closes/);
});

test('a reviewer that left files unopened is asked once more for those files; if it still does not open them, no approval', () => {
  const big = d => fs.writeFileSync(path.join(d, 'big.js'), `export const big = [\n${'  1,\n'.repeat(9000)}];\n`);
  const all = d => ['big.js', 'thing.js', 'thing.test.js'].map(f => path.join(d, f));
  const { d, id } = setup(); big(d); const prompts = [];
  const lazyThenGood = p => { prompts.push(p); return prompts.length === 1 ? { ...clean(), opened: { read: [], commands: [] } } : { ...clean(), details: 'read it all', cost: 0.1, opened: { read: all(d), commands: [] } }; }; lazyThenGood.agent = true;
  const r = run(d, id, { review: lazyThenGood });
  assert.equal(prompts.length, 2); assert.match(prompts[1], /Your first answer[\s\S]*big\.js/); assert.ok(!/did not see all/.test(r.text), r.text); assert.equal(r.evidence.review.details, 'read it all');
  const { d: d2, id: id2 } = setup(); big(d2); let calls = 0; const never = () => { calls++; return { ...clean(), opened: { read: [], commands: [] } }; }; never.agent = true;
  assert.match(run(d2, id2, { review: never }).text, /did not open big\.js/); assert.equal(calls, 2, 'asked once more, not forever');
});

test('a record that only moved to another folder is not a change of state; a marker that something later took out is not left in place', () => {
  const { d, id } = setup(); const b = other(d); const m = startMilestone({ repo: d, title: 'Version 1', request: 'The first version', criteria: ['Released'], excludes: ['Nothing else'] });
  G(d, 'add', 'docs'); G(d, 'commit', '-qm', 'chore(buddy): open version 1');
  moveChangeTo(d, b.id, m.id);                                    // the record changes place, nothing else
  const NV = '--no-' + 'verify'; fs.writeFileSync(path.join(d, 'hook.sh'), `git commit ${NV}\n`);
  const first = commitAll(d, `feat: the thing\n\nSlice: ${id}`);
  const moved = run(d, id); assert.ok(!moved.text.includes('changed the state of'), moved.text);
  assert.ok(moved.evidence.scan.skip_markers_added.some(x => x.startsWith('hook.sh')), 'still in place: flagged');
  fs.writeFileSync(path.join(d, 'hook.sh'), 'git commit\n'); G(d, 'add', 'hook.sh'); G(d, 'commit', '-qm', 'fix: coordinator removes the hook flag');   // not a commit of the slice
  moveSlice(d, id, 'rework'); moveSlice(d, id, 'building');
  const gone = run(d, id); assert.deepEqual(gone.evidence.scan.skip_markers_added, []); assert.equal(gone.evidence.scan.flagged, false);
});

test('only the files that carry risk must be opened: documentation the reviewer did not open is listed as not reviewed, not an exception', () => {
  const { d, id } = setup(); fs.writeFileSync(path.join(d, 'guide.md'), `# Guide\n${'text line\n'.repeat(5000)}`); fs.writeFileSync(path.join(d, 'big.js'), `export const big = [\n${'  1,\n'.repeat(4000)}];\n`);
  let prompt = ''; const agent = p => { prompt = p; return { ...clean(), opened: { read: [], commands: [] } }; }; agent.agent = true;
  const r = run(d, id, { review: agent });
  assert.ok(r.evidence.review_input.not_shown.some(n => n.file === 'guide.md')); assert.deepEqual(r.evidence.review_input.not_reviewed, ['guide.md']);
  assert.ok(!/did not see all/.test(r.text), r.text); assert.match(prompt, /carry little risk[^]*guide\.md/); assert.ok(!/MUST open[^.]*guide\.md/.test(prompt));
  const { d: d2, id: id2 } = setup(); fs.writeFileSync(path.join(d2, 'a.js'), `export const a = [\n${'  1,\n'.repeat(9000)}];\n`); fs.writeFileSync(path.join(d2, 'b.js'), `export const b = [\n${'  2,\n'.repeat(9000)}];\n`);
  const lazy = () => ({ ...clean(), opened: { read: [], commands: [] } }); lazy.agent = true;
  assert.match(run(d2, id2, { review: lazy }).text, /did not open a\.js[^|]*b\.js/);   // source is never optional
});

// review-by-risk-and-consistent-rounds: the same content must get the same verdict; when it does not, the reviewer investigates why.
const twoRounds = (second, { investigate }) => {
  const { d, id } = setup(); const asked = [];
  const reviewer = p => { asked.push(p); if (/SAME content/.test(p)) return { ...investigate(), opened: { read: [], commands: [] } };
    return asked.filter(x => !/SAME content/.test(x)).length === 1 ? { ...clean(), criteria_not_met: ['AC1: it never asks'], opened: { read: [path.join(d, 'thing.js')], commands: [] } } : { ...second, opened: { read: [path.join(d, 'thing.js'), path.join(d, 'README.md')], commands: [] } }; };
  reviewer.agent = true;
  const first = run(d, id, { review: reviewer }); moveSlice(d, id, 'rework'); moveSlice(d, id, 'building');
  return { d, id, first, second: run(d, id, { review: reviewer, id: 'again' }), asked };
};
test('the same content with a different verdict: the reviewer investigates, the cause is recorded, and an explained finding that does not hold does not reach the owner', () => {
  const { first, second, asked } = twoRounds(clean(), { investigate: () => ({ cause: 'different_files_read', holds: 'this', finding_holds: false, explanation: 'the first round never read README.md, which says Buddy asks' }) });
  assert.equal(first.decision, 'NEEDS_HUMAN'); assert.match(first.text, /criteria not met/);
  assert.equal(second.decision, 'APPROVE', second.text);               // the finding was explained and does not hold: nothing reaches the owner
  const c = second.evidence.consistency; assert.equal(c.cause, 'different_files_read'); assert.equal(c.explained, true); assert.deepEqual(c.only_now, ['README.md']); assert.equal(c.earlier.verdict, 'criteria'); assert.equal(c.now.verdict, 'clean');
  assert.equal(c.set_aside, undefined);                                // the round now was the clean one: nothing to set aside
  assert.equal(asked.filter(p => /SAME content/.test(p)).length, 1); assert.match(asked.at(-1), /Files it opened: thing\.js/);
  assert.equal(second.evidence.content_hash, first.evidence.content_hash);
});
test('if the investigation says the finding holds, or finds no cause, the difference reaches the owner', () => {
  const holds = twoRounds(clean(), { investigate: () => ({ cause: 'different_reading_of_a_criterion', holds: 'earlier', finding_holds: true, explanation: 'the plain command never asks' }) }).second;
  assert.match(holds.text, /previous round's finding holds[^]*never asks/);
  const unknown = twoRounds(clean(), { investigate: () => ({ cause: 'unknown', holds: 'neither', finding_holds: false, explanation: 'cannot tell' }) }).second;
  assert.match(unknown.text, /did not find why \(cannot tell\)/); assert.equal(unknown.evidence.consistency.explained, false);
});
// Code another commit changed (no Slice trailer): the slice's own content is the same, the code fingerprint is not, so nothing is reused (R75).
const elsewhere = d => { fs.writeFileSync(path.join(d, 'elsewhere.js'), 'export const e = 1;\n'); G(d, 'add', 'elsewhere.js'); G(d, 'commit', '-qm', 'chore: another change'); };
test('no investigation when the content changed since the previous round, or when the verdicts agree', () => {
  const { d, id } = setup(); let n = 0; const rv = p => { n += /SAME content/.test(p) ? 100 : 1; return { ...clean(), opened: { read: [], commands: [] } }; }; rv.agent = true;
  run(d, id, { review: rv }); moveSlice(d, id, 'rework'); moveSlice(d, id, 'building'); elsewhere(d);
  run(d, id, { review: rv, id: 'x' }); assert.equal(n, 2);                                   // same content, same verdict: nothing to investigate
  moveSlice(d, id, 'rework'); moveSlice(d, id, 'building'); fs.writeFileSync(path.join(d, 'more.js'), 'export const m = 1;\n');      // the content changed
  const differs = run(d, id, { review: Object.assign(() => ({ ...clean(), criteria_not_met: ['AC1: x'], opened: { read: [], commands: [] } }), { agent: true }), id: 'y' });
  assert.equal(differs.evidence.consistency, undefined); assert.match(differs.text, /criteria not met/);    // a different verdict on different content is just a verdict
});
test('a finding that appears on identical content and the investigation says does not hold is set aside, and kept in the evidence', () => {
  const { d, id } = setup(); let calls = 0;
  const rv = p => { if (/SAME content/.test(p)) return { cause: 'chance', holds: 'earlier', finding_holds: false, explanation: 'the file it flagged does not do that', opened: { read: [], commands: [] } };
    return calls++ === 0 ? { ...clean(), opened: { read: [], commands: [] } } : { ...clean(), weakens_or_hides_checks: true, details: 'a mock', opened: { read: [], commands: [] } }; };
  rv.agent = true; run(d, id, { review: rv }); moveSlice(d, id, 'rework'); moveSlice(d, id, 'building'); elsewhere(d);
  const r = run(d, id, { review: rv, id: 'b' });
  assert.equal(r.decision, 'APPROVE', r.text); assert.equal(r.evidence.consistency.set_aside.weakens_or_hides_checks, true); assert.equal(r.evidence.review.weakens_or_hides_checks, false);
});

test('a protected file that changed does not stop the reviewer; it is still listed for the owner; --review-anyway runs it whatever is red', () => {
  const { d, id } = setup(); fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: 'x', dependencies: { left: '1.0.0' }, scripts: { validate: 'node -e "0"' } }));
  let asked = 0; const r = run(d, id, { review: () => { asked++; return clean(); } });
  assert.equal(asked, 1, 'the reviewer ran'); assert.match(r.text, /protected files modified: package\.json/); assert.ok(!/reviewer not run/.test(r.text));
  const { d: d2, id: id2 } = setup(); fs.writeFileSync(path.join(d2, 'package.json'), JSON.stringify({ name: 'x', scripts: { validate: 'node -e "process.exit(1)"' } }));
  let a2 = 0; const red = run(d2, id2, { review: () => { a2++; return clean(); } }); assert.equal(a2, 0); assert.match(red.text, /reviewer not run[^]*--review-anyway/);
  const { d: d3, id: id3 } = setup(); fs.writeFileSync(path.join(d3, 'package.json'), JSON.stringify({ name: 'x', scripts: { validate: 'node -e "process.exit(1)"' } }));
  let a3 = 0; const forced = run(d3, id3, { review: () => { a3++; return clean(); }, reviewAnyway: true }); assert.equal(a3, 1); assert.match(forced.text, /validate failed/); assert.equal(forced.evidence.review.not_run, undefined);
});

// hand-over-by-file (R119, R134): the reviewer's hand-over is a file under .buddy/handover/, given whole; the evidence says which and its fingerprint.
import crypto from 'node:crypto';
import { writeHandover } from '../src/resume.mjs';
const sha = t => crypto.createHash('sha256').update(t).digest('hex').slice(0, 16);
test('a hand-over longer than a Windows command line reaches the reviewer whole, from a file the evidence names with its fingerprint', () => {
  const { d, id } = setup(); const file = readSlice(d, id).file; const long = 'Do the thing the reader asked for ' + 'and more words '.repeat(3000);
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('request: Do the thing the reader asked for', `request: ${long.trim()}`));
  let seen = ''; const r = run(d, id, { review: p => { seen = p; return clean(); } });
  assert.ok(seen.length > 40000, `prompt of ${seen.length} characters`); assert.ok(seen.includes(long.trim()));
  const h = r.evidence.handover.reviewer; assert.match(h.path, new RegExp(`^\\.buddy/handover/${id}-review-.*\\.md$`));
  assert.equal(fs.readFileSync(path.join(d, h.path), 'utf8'), seen); assert.equal(h.sha256, sha(seen)); assert.equal(r.evidence.handover.dev, undefined);
});
test('the evidence names Dev\'s latest hand-over of the slice and its fingerprint', () => {
  const { d, id } = setup(); writeHandover(d, id, '2026-11-01T10:00:00Z'); const last = writeHandover(d, id, '2026-11-02T10:00:00Z');
  const r = run(d, id); const h = r.evidence.handover.dev;
  assert.equal(path.join(d, h.path), last); assert.equal(h.sha256, sha(fs.readFileSync(last, 'utf8')));
});
test('a reviewer that could not start is a finding with its cause, never a pass', () => {
  const { d, id } = setup();
  const r = run(d, id, { review: () => ({ does_what_was_asked: null, weakens_or_hides_checks: null, unspecified_decisions: [], details: 'the reviewer could not start: ENAMETOOLONG' }) });
  assert.equal(r.decision, 'NEEDS_HUMAN'); assert.match(r.text, /FINDINGS:[^]*- independent reviewer gave no verdict: the reviewer could not start: ENAMETOOLONG/);
});
// R83: the change of a piece is delivered with its last open piece, by the checkpoint that delivers it.
test('the checkpoint that delivers the last open piece of a change delivers the change too; an earlier piece leaves it as it is', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cpf-')); G(d, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: 'x', scripts: { validate: 'node -e "0"' } })); fs.mkdirSync(path.join(d, 'docs')); G(d, 'add', '-A'); G(d, 'commit', '-qm', 'base');
  const ch = startSlice({ repo: d, title: 'Reading list', request: 'r', criteria: ['Works'], excludes: ['Sharing'] });
  const ids = ['Save books', 'Remove a book'].map(t => startSlice({ repo: d, title: t, request: 'Do it', criteria: ['Works'], excludes: ['Nothing beyond the criteria above'], inChange: ch.id }).id);
  for (const id of ids) { moveSlice(d, id, 'ready'); moveSlice(d, id, 'building'); }
  fs.writeFileSync(path.join(d, 'a.test.js'), "import assert from 'node:assert';\nassert.equal(1, 1);\n");
  const one = run(d, ids[0]); assert.equal(one.slice.status, 'delivered'); assert.equal(one.change, undefined); assert.equal(readSlice(d, ch.id).data.status, 'refining');
  const two = run(d, ids[1]); assert.deepEqual(two.change, { id: ch.id, status: 'delivered' }); assert.equal(readSlice(d, ch.id).data.status, 'delivered');
  assert.match(two.text, /CHANGE: Reading list \[reading-list\] is now delivered: every piece of it is delivered, accepted or abandoned/);
});
import { pieceSize, SIZE_ADVICE } from '../src/checkpoint.mjs';
// R83: the size of a piece is advised, never enforced.
test('a piece that changed more than about 400 lines gets an advice to split it next time, in the text and the evidence, and is not blocked', () => {
  const { d, id } = setup(); fs.writeFileSync(path.join(d, 'big.js'), Array.from({ length: 450 }, (_, i) => `export const x${i} = ${i};`).join('\n') + '\n');
  fs.writeFileSync(path.join(d, 'package-lock.json'), Array.from({ length: 900 }, (_, i) => `"l${i}"`).join('\n') + '\n');
  const r = run(d, id); assert.equal(r.decision, 'APPROVE'); assert.equal(r.slice.status, 'delivered');
  const lines = 450 + 1 + 2;   // big.js, thing.js and thing.test.js; the lock file does not count
  assert.deepEqual(r.evidence.size_advice, { lines, about: SIZE_ADVICE, text: `this piece changed ${lines} lines, more than about 400: next time consider splitting it` });
  assert.match(r.text, new RegExp(`ADVICE: this piece changed ${lines} lines, more than about 400: next time consider splitting it`));
  assert.ok(!r.evidence.reasons.some(x => /lines/.test(x)));
  const small = setup(); const s = run(small.d, small.id); assert.equal(s.evidence.size_advice, undefined); assert.doesNotMatch(s.text, /ADVICE/);
});
test('the size of a piece counts added and removed lines, without lock files and generated files', () => {
  const f = (file, add, del = 0) => ({ file, add, del });
  assert.deepEqual(pieceSize([f('src/a.js', 300, 101)]), { lines: 401, advice: 'this piece changed 401 lines, more than about 400: next time consider splitting it' });
  assert.deepEqual(pieceSize([f('src/a.js', 300, 100)]), { lines: 400, advice: null });
  assert.equal(pieceSize([f('src/a.js', 10), f('package-lock.json', 5000), f('web/yarn.lock', 900), f('Cargo.lock', 9), f('pnpm-lock.yaml', 9), f('web/dist/app.js', 800), f('a.min.js', 80), f('a.js.map', 70)]).lines, 10);
});

// show-unrun-checks-honestly (R76): every check of the evidence reads passed, failed, not run or not applicable.
test('every check of the evidence reads passed, failed, not run or not applicable, in the evidence and the text', () => {
  const { d, id } = setup(); const r = run(d, id);
  assert.deepEqual(r.evidence.checks, { validate: 'passed', scan: 'passed', acceptance_guard: 'passed', reviewer: 'passed', prototype_departures: 'not applicable' });
  assert.match(r.text, /checks: validate passed · scan passed · acceptance guard passed · reviewer passed · prototype departures not applicable/);
  const red = setup(); fs.writeFileSync(path.join(red.d, 'package.json'), JSON.stringify({ name: 'x', scripts: { validate: 'node -e "process.exit(1)"' } }));
  const rr = run(red.d, red.id); assert.equal(rr.evidence.checks.validate, 'failed'); assert.equal(rr.evidence.checks.reviewer, 'not run'); // package.json changed: the scan flags a protected file
  assert.match(rr.text, /checks: validate failed · scan failed · acceptance guard passed · reviewer not run · prototype departures not applicable/);
  const none = setup(); fs.writeFileSync(path.join(none.d, 'package.json'), JSON.stringify({ name: 'x' }));
  const rn = run(none.d, none.id); assert.equal(rn.evidence.checks.validate, 'not run'); assert.equal(rn.decision, 'NEEDS_HUMAN'); assert.match(rn.text, /validate did not run: no validate\.sh and no npm validate script found/);
  const mute = setup(); const rm = run(mute.d, mute.id, { review: () => ({ does_what_was_asked: null, weakens_or_hides_checks: null, unspecified_decisions: [], details: 'reviewer failed' }) });
  assert.equal(rm.evidence.checks.reviewer, 'not run');
  const flawed = setup(); assert.equal(run(flawed.d, flawed.id, { review: () => ({ ...clean(), weakens_or_hides_checks: true, details: 'x' }) }).evidence.checks.reviewer, 'failed');
  const forged = setup(); const b = other(forged.d); edit(b.file, 'status: refining', 'status: ready'); assert.equal(run(forged.d, forged.id).evidence.checks.acceptance_guard, 'failed');
  const loose = setup(); fs.writeFileSync(path.join(loose.d, 'gone.test.js'), 'x\n'); G(loose.d, 'add', 'gone.test.js'); G(loose.d, 'commit', '-qm', 'a test'); fs.rmSync(path.join(loose.d, 'gone.test.js'));
  assert.equal(run(loose.d, loose.id).evidence.checks.scan, 'failed');
});
