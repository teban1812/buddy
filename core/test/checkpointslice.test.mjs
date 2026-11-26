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

test('a clean checkpoint approves, reads the request from the slice, and delivers it', () => {
  const { d, id } = setup(); let seen = '';
  const r = run(d, id, { review: p => { seen = p; return clean(); } });
  assert.equal(r.decision, 'APPROVE'); assert.match(seen, /Do the thing the reader asked for/);
  assert.equal(readSlice(d, id).data.status, 'delivered'); assert.deepEqual(r.slice, { id, status: 'delivered' }); assert.match(r.text, /is now delivered/);
  // the evidence is versioned with the change (R87), not left in .buddy/
  assert.equal(path.dirname(r.evidenceFile), path.join(path.dirname(readSlice(d, id).file), 'evidence')); assert.match(path.basename(r.evidenceFile), /^evidence-\d{4}-\d{2}-\d{2}T\d{6}Z-[0-9a-f]{8}\.json$/);   // a short mark, not the run's name (R212)
  assert.equal(JSON.parse(fs.readFileSync(r.evidenceFile, 'utf8')).slice, id);
});
test('exceptions are shown and the slice is delivered all the same: open steps', () => {
  const { d, id } = setup({ steps: [{ text: 'Done', done: true }, { text: 'Not yet', done: false }] });
  const r = run(d, id); assert.equal(r.decision, 'NEEDS_HUMAN'); assert.match(r.text, /1 step\(s\) of the slice still open \(2\)/);
  assert.equal(readSlice(d, id).data.status, 'delivered');
});
test('a slice that is not building is refused and nothing changes', () => {
  const { d, id } = setup(); moveSlice(d, id, 'delivered');
  assert.throws(() => run(d, id), /needs a slice that is building; .* is delivered/);
  assert.equal(readSlice(d, id).data.status, 'delivered');
});
test('assumed defaults nobody confirmed are a reason', () => {
  const { d, id } = setup();
  const b = createBatch({ slice: id, questions: [{ situation: 'What order is the list in?', options: [{ label: 'Newest first', cost: 'none' }, { label: 'Oldest first', cost: 'none' }] }] }, { date: '2026-10-31' });
  assumeDefaults(b); writeBatchFile(path.join(d, 'docs', 'questions.md'), b);
  const file = readSlice(d, id).file; fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('request: Do the thing the reader asked for', `request: Do the thing the reader asked for\nbatches: [${b.id}]`));
  const r = run(d, id); assert.equal(r.decision, 'NEEDS_HUMAN'); assert.match(r.text, /1 assumed default\(s\) nobody has confirmed: What order is the list in/);
});
test('a risk appetite the owner has not confirmed is a reason; confirmed, or accepted as assumed, is not', WORKSHOP, () => {
  const ctx = fs.readFileSync(path.join(EXAMPLES, 'context.md'), 'utf8');
  const { d, id } = setup(); fs.writeFileSync(path.join(d, 'docs', 'context.md'), ctx);
  const r = run(d, id); assert.equal(r.decision, 'NEEDS_HUMAN'); assert.match(r.text, /risk appetite: 2 risk-appetite line\(s\) not confirmed/);
  const e = setup(); fs.writeFileSync(path.join(e.d, 'docs', 'context.md'), ctx.replaceAll('`assumed`', '`human 2026-10-30`'));
  assert.equal(run(e.d, e.id).decision, 'APPROVE');
  const f = setup(); fs.writeFileSync(path.join(f.d, 'docs', 'context.md'), ctx.replace('---\n', '---\nrisk_assumed_accepted: 2026-10-30\n'));
  assert.doesNotMatch(run(f.d, f.id).text, /risk appetite/);
});
test('without --slice the checkpoint behaves as before (request.txt, no slice signals)', () => {
  const { d } = setup(); fs.mkdirSync(path.join(d, '.buddy'), { recursive: true }); fs.writeFileSync(path.join(d, '.buddy', 'request.txt'), 'the old way');
  let seen = ''; const r = checkpoint({ repo: d, human: true, review: p => { seen = p; return clean(); } });
  assert.match(seen, /the old way/); assert.equal(r.slice, undefined);
});
test('Buddy\'s own records are not part of the change the checkpoint measures or the Reviewer reads', () => {
  const { d, id } = setup(); fs.writeFileSync(path.join(d, 'docs', 'questions.md'), '---\nschema: x\n---\nan index\n'); let seen = '';
  const r = run(d, id, { review: p => { seen = p; return clean(); } });
  const names = r.evidence.files.split('\n').map(l => l.split('\t')[1]).sort();
  assert.deepEqual(names, ['thing.js', 'thing.test.js']);                       // the slice file and the questions index are not in the evidence
  assert.match(r.evidence.diff_stat, /^2 files? changed/); assert.doesNotMatch(seen, /docs\/buddy|questions\.md/); assert.match(seen, /thing\.js/);
  assert.equal(readSlice(d, id).data.status, 'delivered');                       // and the slice record itself is still updated
});

// measure-slice-own-changes: the checkpoint measures from where the slice started, committed or not (R84, R88).
test('a slice records the commit it started building from, and keeps it when it comes back from rework', () => {
  const { d, id } = setup(); const head = G(d, 'rev-parse', 'HEAD').trim(); assert.equal(readSlice(d, id).data.base, head);
  commitAll(d, 'work'); moveSlice(d, id, 'delivered'); moveSlice(d, id, 'rework'); moveSlice(d, id, 'building');
  assert.equal(readSlice(d, id).data.base, head);
});
test('the checkpoint of a slice whose work is committed reviews and scans that work (AC1)', () => {
  const { d, id } = setup(); commitAll(d, `feat: the thing\n\nSlice: ${id}`); let seen = '';
  const r = run(d, id, { review: p => { seen = p; return clean(); } });
  assert.deepEqual(files(r), ['thing.js', 'thing.test.js']); assert.match(seen, /thing\.js/); assert.equal(r.evidence.scan.assertions_added, 1);
  assert.equal(r.evidence.base, readSlice(d, id).data.base); assert.equal(r.decision, 'APPROVE');
});
test('the changes of an earlier slice on the same branch are not counted as this slice\'s (AC2)', () => {
  const { d, id } = setup(); commitAll(d, `feat: the thing\n\nSlice: ${id}`); moveSlice(d, id, 'delivered');
  const b = startSlice({ repo: d, title: 'Another thing', request: 'Do another thing', criteria: ['It works'], excludes: ['Nothing beyond the criteria above'] }); moveSlice(d, b.id, 'ready'); moveSlice(d, b.id, 'building');
  fs.writeFileSync(path.join(d, 'other.js'), 'export const y = 2;\n'); commitAll(d, `feat: other\n\nSlice: ${b.id}`);
  fs.writeFileSync(path.join(d, 'other.test.js'), "import assert from 'node:assert';\nassert.equal(2, 2);\n");      // committed and uncommitted together
  assert.deepEqual(files(run(d, b.id)), ['other.js', 'other.test.js']);
});
test('a slice with no recorded start is measured from the parent of its first commit with its Slice trailer', () => {
  const { d, id } = setup(); const file = readSlice(d, id).file; fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^base: .*\n/m, ''));
  fs.writeFileSync(path.join(d, 'unrelated.txt'), 'not this slice\n'); G(d, 'add', 'unrelated.txt'); G(d, 'commit', '-qm', 'chore: something else'); const before = G(d, 'rev-parse', 'HEAD').trim();
  commitAll(d, `feat: the thing\n\nSlice: ${id}\nCo-Authored-By: t <t@t>`);
  const r = run(d, id); assert.equal(r.evidence.base, before); assert.deepEqual(files(r), ['thing.js', 'thing.test.js']);
});
test('--base overrides where the slice started; a base that is not a commit is refused', () => {
  const { d, id } = setup(); const done = commitAll(d, `feat: the thing\n\nSlice: ${id}`); fs.writeFileSync(path.join(d, 'extra.js'), 'export const z = 3;\n');
  assert.throws(() => run(d, id, { base: 'no-such-commit' }), /--base no-such-commit is not a commit/); assert.equal(readSlice(d, id).data.status, 'building');
  const r = run(d, id, { base: done }); assert.equal(r.evidence.base, done); assert.deepEqual(files(r), ['extra.js']);
});
test('a slice with no recorded start and no commit with its trailer is refused, and says to pass --base', () => {
  const { d, id } = setup(); const file = readSlice(d, id).file; fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^base: .*\n/m, ''));
  commitAll(d, 'feat: the thing without a trailer');
  assert.throws(() => run(d, id), /has no recorded start .* no commit carries the trailer "Slice: .*": pass --base/); assert.equal(readSlice(d, id).data.status, 'building');
});
test('a Slice line git does not read as a trailer is named, with the commit, instead of measuring nothing in silence', () => {
  const loose = `feat: the thing\n\nSlice: %ID%\n\nCo-Authored-By: t <t@t>`;   // a blank line between Slice and Co-Authored-By: git reads only the last paragraph
  const { d, id } = setup(); const h = commitAll(d, loose.replace('%ID%', id)).slice(0, 7);
  const said = new RegExp(`commit ${h} names Slice: ${id} but git does not read it as a trailer: put it in the last paragraph`);
  const r = run(d, id); assert.deepEqual(r.evidence.commits, []); assert.match(r.text, said); assert.match(r.text, /0 commit\(s\)[^\n]*because commit/);
  assert.match(r.evidence.slice_lines_not_trailers.join(), said);
  const e = setup(); const file = readSlice(e.d, e.id).file; fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^base: .*\n/m, ''));   // no recorded start either
  const h2 = commitAll(e.d, loose.replace('%ID%', e.id)).slice(0, 7);
  assert.throws(() => run(e.d, e.id), new RegExp(`no commit carries the trailer "Slice: ${e.id}"; commit ${h2} names Slice: ${e.id} but git does not read it as a trailer`));
  const ok = setup(); commitAll(ok.d, `feat: the thing\n\nSlice: ${ok.id}\nCo-Authored-By: t <t@t>`);   // the right layout: counted, and nothing said
  const r2 = run(ok.d, ok.id); assert.equal(r2.evidence.commits.length, 1); assert.doesNotMatch(r2.text, /does not read it as a trailer/); assert.equal(r2.evidence.slice_lines_not_trailers, undefined);
});
test('a database migration a tool generated does not stop the checkpoint as a skipped check, and the scan says it skipped it', () => {
  const PRAGMA = '#pra' + 'gma warning dis' + 'able 612, 618';   // assembled: the scan reads this file too
  const { d, id } = setup(); fs.mkdirSync(path.join(d, 'Migrations'));
  fs.writeFileSync(path.join(d, 'Migrations', '20261104_AddBooks.Designer.cs'), `// <auto-generated />\n${PRAGMA}\nnamespace App.Migrations {}\n`);
  commitAll(d, `feat: the thing\n\nSlice: ${id}`);
  const r = run(d, id); assert.equal(r.decision, 'APPROVE'); assert.deepEqual(r.evidence.scan.skip_markers_added, []);
  assert.match(r.text, /skipped as generated: 1 file\b/); assert.deepEqual(r.evidence.scan.skipped_generated, ['Migrations/20261104_AddBooks.Designer.cs']);
});

// Step 4: only the slice's own commits (its Slice trailer, or a name given with --trailer) and its uncommitted work are counted.
test('a commit without the slice\'s trailer made after it started is not counted, not even the lines it added to a file the slice also touched', () => {
  const { d, id } = setup(); fs.writeFileSync(path.join(d, 'README.md'), 'base\nslice line\n'); const mine = commitAll(d, `feat: the thing\n\nSlice: ${id}`);
  fs.writeFileSync(path.join(d, 'log.md'), 'a decision\n'); fs.writeFileSync(path.join(d, 'README.md'), 'base\nslice line\nother line\n');
  G(d, 'add', 'log.md', 'README.md'); G(d, 'commit', '-qm', 'docs: something of the coordinator');
  fs.writeFileSync(path.join(d, 'more.js'), 'export const w = 4;\n');                                                 // uncommitted and untracked
  let seen = ''; const r = run(d, id, { review: p => { seen = p; return clean(); } });
  assert.deepEqual(files(r), ['README.md', 'more.js', 'thing.js', 'thing.test.js']); assert.deepEqual(r.evidence.commits, [mine]);
  assert.equal(r.evidence.diff_stat, '4 files changed, 5 insertions(+)');                                          // the slice's 4 lines in README, thing.js and its test, plus the uncommitted one: not the coordinator's 'other line'
  assert.ok(seen.includes('+slice line') && !seen.includes('other line'), 'the reviewer reads the slice\'s patch, not the net change of the file');
  assert.equal(r.evidence.shared, undefined);
  assert.match(G(d, 'status', '--porcelain', '--', 'more.js'), /^\?\? more\.js/);                                     // nothing was staged in the real index
});
test('--trailer adds an old name of the slice, so its commits that cite that name are counted', () => {
  const { d, id } = setup(); commitAll(d, 'feat: the thing\n\nSlice: an-old-name\nCo-Authored-By: t <t@t>');
  fs.writeFileSync(path.join(d, 'extra.js'), 'export const z = 3;\n'); commitAll(d, `feat: more\n\nSlice: ${id}`);
  assert.deepEqual(files(run(d, id)), ['extra.js']);
  const { d: e, id: f } = setup(); commitAll(e, 'feat: the thing\n\nSlice: an-old-name'); fs.writeFileSync(path.join(e, 'extra.js'), 'export const z = 3;\n'); commitAll(e, `feat: more\n\nSlice: ${f}`);
  assert.deepEqual(files(run(e, f, { trailer: ['an-old-name'] })), ['extra.js', 'thing.js', 'thing.test.js']);
});
test('a base recorded after the slice\'s first commits is not where it started: the parent of its first commit is', () => {
  const { d, id } = setup(); const start = G(d, 'rev-parse', 'HEAD').trim(); commitAll(d, `feat: the thing\n\nSlice: ${id}`);
  fs.writeFileSync(path.join(d, 'log.md'), 'a decision\n'); const later = commitAll(d, 'docs: something of the coordinator');
  const file = readSlice(d, id).file; fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^base: .*$/m, `base: ${later}`));
  const r = run(d, id); assert.equal(r.evidence.base, start); assert.deepEqual(files(r), ['thing.js', 'thing.test.js']);
});

// guard-acceptance-in-checkpoint (R105): the slice's own commits and uncommitted work may tick steps in Buddy's records, never change a
// record's state or acceptance.
test('a commit of the slice that records an acceptance on another record stops the checkpoint and says so in plain words (AC1)', () => {
  const { d, id } = setup(); const b = other(d);
  edit(b.file, 'status: refining', 'status: accepted\naccepted:\n  by: owner\n  at: 2026-11-01T00:00:00Z\n  channel: cli\n  assurance: recorded');
  const h = commitAll(d, `feat: the thing\n\nSlice: ${id}`); const r = run(d, id);
  assert.equal(r.decision, 'NEEDS_HUMAN');
  assert.ok(r.text.includes(`a commit of this slice (${h.slice(0, 7)}) changed the state of ${b.id}: Another thing from refining to accepted`));
  assert.ok(r.text.includes(`a commit of this slice (${h.slice(0, 7)}) recorded an acceptance on ${b.id}: Another thing that the owner did not give through Buddy`));
  const rel = path.relative(d, b.file).split(path.sep).join('/');
  assert.deepEqual(r.evidence.records.changes.map(c => [c.file, c.field, c.where]), [[rel, 'status', h], [rel, 'accepted', h]]);
  assert.ok(r.evidence.records.compared.includes(rel)); assert.equal(readSlice(d, id).data.status, 'delivered');
});
test('a commit of the slice that changes its own record\'s state by hand is caught, even when a later commit puts it back (AC1)', () => {
  const { d, id } = setup(); commitAll(d, `feat: the thing\n\nSlice: ${id}`); const file = readSlice(d, id).file;
  edit(file, 'status: building', 'status: delivered'); const h = commitAll(d, `chore: deliver it\n\nSlice: ${id}`);
  edit(file, 'status: delivered', 'status: building'); commitAll(d, `chore: back to building\n\nSlice: ${id}`);
  const r = run(d, id); assert.equal(r.decision, 'NEEDS_HUMAN');
  assert.ok(r.text.includes(`a commit of this slice (${h.slice(0, 7)}) changed the state of ${id}: Do a thing from building to delivered`));
  assert.equal(r.evidence.records.changes.length, 1);
});
test('ticking steps in the slice\'s own record, committed or not, is not flagged (AC2)', () => {
  const { d, id } = setup({ steps: [{ text: 'One', done: true }, { text: 'Two', done: false }] });
  commitAll(d, `feat: the thing\n\nSlice: ${id}`);                   // carries the record's move to building, made by the CLI, with the tick
  stepSetIn(d, id, '2', true); const file = path.relative(d, readSlice(d, id).file).split(path.sep).join('/');
  const r = run(d, id); assert.equal(r.decision, 'APPROVE', r.text);
  assert.deepEqual(r.evidence.records.changes, []); assert.deepEqual(r.evidence.records.compared, [file]);
});
test('a state forged in the uncommitted work is caught', () => {
  const { d, id } = setup(); const b = other(d); commitAll(d, `feat: the thing\n\nSlice: ${id}`);
  edit(b.file, 'status: refining', 'status: ready');
  const r = run(d, id); assert.equal(r.decision, 'NEEDS_HUMAN');
  assert.ok(r.text.includes(`the uncommitted work of this slice changed the state of ${b.id}: Another thing from refining to ready`));
  assert.deepEqual(r.evidence.records.changes.map(c => c.where), ['uncommitted']);
});
