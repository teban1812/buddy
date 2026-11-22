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

const EXAMPLES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'design', 'examples');
const WORKSHOP = { skip: fs.existsSync(EXAMPLES) ? false : 'the design examples (docs/design/examples) are a workshop fixture, not in the public copy' };
const G = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf8', stdio: 'pipe' });
const clean = () => ({ does_what_was_asked: true, weakens_or_hides_checks: false, unspecified_decisions: [], details: 'fine' });
// A repository with a base commit, a validate script that passes, and a slice that is building.
function setup({ steps = [{ text: 'Do it', done: true }], before } = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cps-')); G(d, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: 'x', scripts: { validate: 'node -e "0"' } })); fs.mkdirSync(path.join(d, 'docs'));
  fs.writeFileSync(path.join(d, 'README.md'), 'base\n'); G(d, 'add', '-A'); G(d, 'commit', '-qm', 'base');
  const s = startSlice({ repo: d, title: 'Do a thing', request: 'Do the thing the reader asked for', criteria: ['It works'], excludes: ['Nothing beyond the criteria above'] });
  steps.forEach(x => stepAddTo(d, s.id, x.text)); before?.(d, s.id);
  moveSlice(d, s.id, 'ready'); moveSlice(d, s.id, 'building');
  steps.forEach((x, i) => { if (x.done) stepSetIn(d, s.id, String(i + 1), true); });
  fs.writeFileSync(path.join(d, 'thing.js'), 'export const x = 1;\n'); fs.writeFileSync(path.join(d, 'thing.test.js'), "import assert from 'node:assert';\nassert.equal(1, 1);\n");
  return { d, id: s.id };
}
// Dev writes how to try each criterion while it builds (the milestone review, R174); the helper does it for the ones the test did not mean to leave out
const withHowto = (d, id) => { try { const s = readSlice(d, id); for (const c of s.data.criteria || []) if (!(s.data.howto || []).some(h => h.criterion === c.id)) howtoSet(d, id, c.id, { steps: 'Use it as a reader would', expect: 'It does what the criterion says' }); } catch { /* not being built: nothing to write */ } };
const run = (d, id, extra = {}) => { if (!extra.noHowto) withHowto(d, id); return checkpoint({ repo: d, slice: id, review: clean, human: true, ...extra }); };

test('a clean checkpoint approves, reads the request from the slice, and delivers it', () => {
  const { d, id } = setup(); let seen = '';
  const r = run(d, id, { review: p => { seen = p; return clean(); } });
  assert.equal(r.decision, 'APPROVE'); assert.match(seen, /Do the thing the reader asked for/);
  assert.equal(readSlice(d, id).data.status, 'delivered'); assert.deepEqual(r.slice, { id, status: 'delivered' }); assert.match(r.text, /is now delivered/);
  // the evidence is versioned with the change (R87), not left in .git/buddy/
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
  const { d } = setup(); fs.mkdirSync(path.join(d, '.git', 'buddy'), { recursive: true }); fs.writeFileSync(path.join(d, '.git', 'buddy', 'request.txt'), 'the old way');
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
const files = r => r.evidence.files.split('\n').filter(Boolean).map(l => l.split('\t')[1]).sort();
const commitAll = (d, msg) => { G(d, 'add', '-A'); G(d, 'commit', '-qm', msg); return G(d, 'rev-parse', 'HEAD').trim(); };
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
const other = d => {                                               // another change, opened and committed by the coordinator (no Slice trailer)
  const b = startSlice({ repo: d, title: 'Another thing', request: 'Do another thing', criteria: ['It works'], excludes: ['Nothing beyond the criteria above'] });
  G(d, 'add', 'docs'); G(d, 'commit', '-qm', 'chore(buddy): open another thing'); return b;
};
const edit = (file, from, to) => { const t = fs.readFileSync(file, 'utf8'); assert.ok(t.includes(from)); fs.writeFileSync(file, t.replace(from, to)); };
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

// hand-over-by-file (R119, R134): the reviewer's hand-over is a file under .git/buddy/handover/, given whole; the evidence says which and its fingerprint.
import crypto from 'node:crypto';
import { writeHandover } from '../src/resume.mjs';
const sha = t => crypto.createHash('sha256').update(t).digest('hex').slice(0, 16);
test('a hand-over longer than a Windows command line reaches the reviewer whole, from a file the evidence names with its fingerprint', () => {
  const { d, id } = setup(); const file = readSlice(d, id).file; const long = 'Do the thing the reader asked for ' + 'and more words '.repeat(3000);
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('request: Do the thing the reader asked for', `request: ${long.trim()}`));
  let seen = ''; const r = run(d, id, { review: p => { seen = p; return clean(); } });
  assert.ok(seen.length > 40000, `prompt of ${seen.length} characters`); assert.ok(seen.includes(long.trim()));
  const h = r.evidence.handover.reviewer; assert.match(h.path, new RegExp(`^\\.git/buddy/handover/${id}-review-.*\\.md$`));
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

// reuse-checks-on-unchanged-content (R75): the same code and tests as an earlier green evidence are not checked again.
import { codeHash, currentEnvironment, sharedValidate, suiteGreen, SHARE_MAX_AGE_MS } from '../src/evidence.mjs';
import { runSuite } from '../src/suite.mjs';
const counting = (d, exit = '') => { fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: 'x', scripts: { validate: `node -e "require('fs').appendFileSync('.git/validate-runs','x')${exit}"` } })); G(d, 'add', 'package.json'); G(d, 'commit', '-qm', 'chore: count the runs of validate'); };   // not the slice's work
const runs = d => (fs.existsSync(path.join(d, '.git', 'validate-runs')) ? fs.readFileSync(path.join(d, '.git', 'validate-runs'), 'utf8').length : 0);
const again = (d, id) => { moveSlice(d, id, 'rework'); moveSlice(d, id, 'building'); };
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
  const { d, id } = setup(); counting(d); const code = codeHash(d); const gb = path.join(d, '.git', 'buddy'); fs.mkdirSync(gb, { recursive: true });
  const whens = {}; const put = (name, e) => { whens[name] = new Date(Date.now() - (10 - name.length) * 60000).toISOString(); fs.writeFileSync(path.join(gb, `evidence-${name}.json`), JSON.stringify({ when: whens[name], environment: currentEnvironment(), code_hash: code, ...e })); };
  put('a', { validate_exit: 0, tests: 'scoped:thing' }); put('bb', { validate_exit: 1, tests: 'full' });
  const first = run(d, id, { id: 'first' }); assert.equal(runs(d), 1, 'a scoped or a red run is not reused'); assert.equal(first.evidence.validate_reused, undefined);
  const two = startSlice({ repo: d, title: 'Do another thing', request: 'r', criteria: ['It works'], excludes: ['Nothing beyond the criteria above'] });
  for (const to of ['ready', 'building']) moveSlice(d, two.id, to);
  fs.rmSync(path.join(path.dirname(first.evidenceFile)), { recursive: true }); put('ccc', { validate_exit: 0, validate_tail: 'ok' });   // a run without a change, before R148: full
  const second = run(d, two.id, { id: 'two' }); assert.equal(runs(d), 1); assert.deepEqual(second.evidence.validate_reused, { from: '.git/buddy/evidence-ccc.json', when: whens.ccc, slice: null, environment: currentEnvironment() });
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
  const { d, id } = setup(); counting(d); const code = codeHash(d); const gb = path.join(d, '.git', 'buddy'); fs.mkdirSync(gb, { recursive: true });
  fs.writeFileSync(path.join(gb, 'evidence-other.json'), JSON.stringify({ when: new Date().toISOString(), code_hash: code, validate_exit: 0, tests: 'full', environment: { platform: 'plan9', node: 'v1.0.0' } }));
  const r = run(d, id); assert.deepEqual(r.evidence.environment, currentEnvironment()); assert.equal(runs(d), 1, 'validate ran');
  assert.deepEqual(r.evidence.validate_not_shared, ['a green on the same code was got with other tools (another system or Node version)']); assert.equal(r.evidence.validate_reused, undefined);
});

// accept-whole-suite (the owner chose on 2026-11-05, R173): acceptance asks for a green suite on the code as it is now, shared while recent and with the same tools.
test('the suite counts only if it passed on exactly this code, recently and with the same tools; a failing one is kept as evidence and never counts', () => {
  const { d } = setup(); const files = () => fs.readdirSync(path.join(d, '.git', 'buddy')).filter(f => /^evidence-.*-suite\.json$/.test(f)).map(f => path.join(d, '.git', 'buddy', f));
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
  assert.ok(fs.readdirSync(path.join(d, '.git', 'buddy')).some(f => /-suite\.summary\.json$/.test(f)));
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
