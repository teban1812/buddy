import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { startSlice, listSlices, readSlice, moveSlice, stepAddTo, stepSetIn, stepsOf } from '../src/slicestore.mjs';
import { verify } from '../src/verify.mjs';
import { createBatch, writeBatchFile } from '../src/queue.mjs';
import { addStep, setStep, parseSteps } from '../src/slice.mjs';
import { nameFromTitle, SLICE_NAME } from '../src/ids.mjs';

const BUDDY = fileURLToPath(new URL('../bin/buddy.mjs', import.meta.url));
const repo = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-')); fs.mkdirSync(path.join(d, 'docs')); return d; };
let tick = 0; const clock = () => () => new Date(Date.UTC(2026, 9, 31, 12, 0, tick++));
const mk = (d, extra = {}) => startSlice({ repo: d, title: 'Save books', request: 'A list', criteria: ['Shows saved books', 'Refuses duplicates'], excludes: ['Sharing the list'], now: clock(), ...extra });
const canon = d => verify([path.join(d, 'docs')], { canonical: true }).problems;

test('start writes a canonical, verifiable file, in refining, with ranks that grow', () => {
  const d = repo(); const a = mk(d); const b = mk(d, { title: 'Second' });
  assert.equal(a.id, 'save-books'); assert.equal(b.id, 'second'); assert.equal(a.data.status, 'refining'); assert.equal(a.data.rank, 1000); assert.equal(b.data.rank, 2000);
  assert.deepEqual(canon(d), []);
  assert.deepEqual(listSlices(d).map(s => s.data.title), ['Save books', 'Second']);
});
test('start refuses what does not verify and leaves nothing behind', () => {
  const d = repo();
  assert.throws(() => startSlice({ repo: d, title: 'x', request: 'y', inChange: 'no-such-slice' }), /no slice or change no-such-slice/);
  assert.throws(() => startSlice({ repo: d, title: 'x', request: 'y', kind: 'epic' }), /a change in several pieces is a change with slices/);
  assert.throws(() => startSlice({ repo: d, title: 'x', request: 'y', kind: 'story' }), /kind/);
  assert.throws(() => startSlice({ repo: d, title: '', request: 'y' }), /title/);
  assert.deepEqual(listSlices(d), []);
});
test('a slice is named from its title (R86, R89): lowercase, ASCII, hyphens, cut at a word boundary within 40, never on an empty word', () => {
  assert.deepEqual(nameFromTitle('Slices are named like OpenSpec changes'), { name: 'slices-are-named-like-openspec-changes', shortened: false });
  assert.deepEqual(nameFromTitle('One folder per change, named by date and name'), { name: 'one-folder-per-change-named-by-date', shortened: true });   // not "-and"
  assert.deepEqual(nameFromTitle('Move the list of books to the archive of'), { name: 'move-the-list-of-books-to-the-archive', shortened: true });
  assert.equal(nameFromTitle('Añadir la canción: ¡ya!').name, 'anadir-la-cancion-ya');
  assert.equal(nameFromTitle('Evidence you can trust, without paying for it twice (three pieces)').name, 'evidence-you-can-trust-without-paying');
  assert.equal(nameFromTitle('Supercalifragilisticexpialidociousandmorewords').name, 'supercalifragilisticexpialidociousandmor');   // one long word is cut
  assert.equal(nameFromTitle('日本語').name, 'slice');
  for (const t of ['Slices are named like OpenSpec changes', '  --Weird__ title!! ', 'x'.repeat(200), 'a b c d e f g h i j k l m n o p q r s t u v w x y z']) { const n = nameFromTitle(t).name; assert.match(n, SLICE_NAME); assert.ok(n.length <= 40); }
});
test('start: --name is checked against the rule and must be free; a proposed name takes -2, -3', () => {
  const d = repo();
  assert.equal(mk(d).id, 'save-books'); assert.equal(mk(d).id, 'save-books-2'); assert.equal(mk(d).id, 'save-books-3');
  const n = mk(d, { name: 'add-validate-command' }); assert.equal(n.id, 'add-validate-command'); assert.equal(n.proposed, false);
  assert.ok(fs.existsSync(path.join(d, 'docs/buddy/backlog/2026-10-31-add-validate-command/change.md')));
  assert.throws(() => mk(d, { name: 'add-validate-command' }), /the name add-validate-command is taken/);
  assert.throws(() => mk(d, { name: 'save-books' }), /taken/);                                      // a given name is never suffixed
  assert.equal(mk(d, { name: 'a'.repeat(40) }).id.length, 40);                                       // 40 is allowed, 41 is not (R89)
  const long = 'Supercalifragilisticexpialidociousandmorewords'; assert.equal(mk(d, { title: long }).id, 'supercalifragilisticexpialidociousandmor'); assert.equal(mk(d, { title: long }).id, 'supercalifragilisticexpialidociousandm-2');   // the suffix fits in 40
  for (const bad of ['Add-Validate', 'add_validate', 'add--validate', '-add', 'add-', '', 'a'.repeat(41), '../x']) assert.throws(() => mk(d, { name: bad }), /is not a slice name: lowercase letters, digits and single hyphens/, bad);
  assert.equal(listSlices(d).length, 7); assert.deepEqual(canon(d), []);
  const run = (...a) => spawnSync(process.execPath, [BUDDY, ...a, '--repo', d], { encoding: 'utf8' });
  const ok = run('start', 'Archive a book', '--request', 'r', '--name', 'archive'); assert.equal(ok.status, 0, ok.stderr); assert.match(ok.stdout, /^started archive \(feat, refining, rank 8000\)\n/);
  const prop = run('start', 'Archive a book', '--request', 'r'); assert.match(prop.stdout, /^started archive-a-book .*name proposed from the title\n/);
  const cut = run('start', 'One folder per change, named by date and name', '--request', 'r'); assert.match(cut.stdout, /^started one-folder-per-change-named-by-date .*name proposed from the title, shortened\n/);
  const bad = run('start', 'x', '--request', 'r', '--name', 'Bad Name'); assert.equal(bad.status, 1); assert.match(bad.stderr, /refused: "Bad Name" is not a slice name/);
});
test('a change is a folder named by date and name; --in adds its slices to the folder (R87)', () => {
  const d = repo(); const e = mk(d, { title: 'Reading list', criteria: [] });
  const dir = path.join(d, 'docs/buddy/backlog/2026-10-31-reading-list');
  assert.equal(e.file, path.join(dir, 'change.md')); assert.equal(e.change, null);
  assert.match(fs.readFileSync(e.file, 'utf8'), /## Steps\n\nSteps: planned when the change is ready\.\n$/);     // a record without steps says so
  const c = mk(d, { inChange: e.id }); const c2 = mk(d, { inChange: e.id, title: 'Remove a book' });
  assert.equal(c.file, path.join(dir, 'save-books.md')); assert.equal(c.change, 'reading-list'); assert.equal(c2.file, path.join(dir, 'remove-a-book.md'));
  assert.equal(readSlice(d, c.id).change, 'reading-list'); assert.equal(readSlice(d, c.id).data.epic, undefined);
  assert.match(fs.readFileSync(e.file, 'utf8'), /Steps: in the slices of this change\./);
  assert.match(fs.readFileSync(c.file, 'utf8'), /Steps: planned when the slice is ready\./);
  assert.deepEqual(listSlices(d).map(s => [s.data.id, s.change]), [['reading-list', null], ['save-books', 'reading-list'], ['remove-a-book', 'reading-list']]);
  assert.throws(() => mk(d, { inChange: c.id }), /Save books \[save-books\] is not a change .*it is a slice of Reading list \[reading-list\]/);
  assert.throws(() => stepAddTo(d, e.id, 'x'), /Reading list \[reading-list\] is a change in slices: add the step to one of them \(Remove a book \[remove-a-book\], Save books \[save-books\]\)/);
  stepAddTo(d, c.id, 'Storage'); assert.doesNotMatch(fs.readFileSync(c.file, 'utf8'), /planned when/);  // the first step replaces the word about steps
  const one = mk(d, { title: 'Export' }); stepAddTo(d, one.id, 'Write the file');
  assert.throws(() => mk(d, { inChange: one.id }), /Export \[export\] already has steps of its own/);
  assert.throws(() => mk(d, { name: 'save-books', title: 'Other' }), /taken/);                   // names are unique across the repository
  assert.deepEqual(canon(d), []);
});
test('steps: add, nest, number, tick, reopen', () => {
  const d = repo(); const s = mk(d);
  assert.equal(stepAddTo(d, s.id, 'Storage').num, '1'); assert.equal(stepAddTo(d, s.id, 'Screen').num, '2');
  assert.equal(stepAddTo(d, s.id, 'Empty state', { under: '2' }).num, '2.1'); assert.equal(stepAddTo(d, s.id, 'Saved (AC1)', { under: '2' }).num, '2.2');
  assert.equal(stepAddTo(d, s.id, 'Duplicates (AC2)').num, '3');
  assert.deepEqual(stepsOf(readSlice(d, s.id)).map(x => x.num), ['1', '2', '2.1', '2.2', '3']);
  assert.throws(() => stepSetIn(d, s.id, '1', true), /steps are ticked while the slice is being built \(building or rework\); .* is refining/);     // a plan is written in refining, ticked in building
  for (const to of ['ready', 'building']) moveSlice(d, s.id, to);
  assert.throws(() => stepSetIn(d, s.id, '2', true), /open sub-steps/);
  stepSetIn(d, s.id, '1', true); stepSetIn(d, s.id, '2.1', true);
  assert.deepEqual(stepsOf(readSlice(d, s.id)).filter(x => x.done).map(x => x.num), ['1', '2.1']);
  stepSetIn(d, s.id, '1', false); assert.equal(stepsOf(readSlice(d, s.id)).filter(x => x.done).length, 1);
  assert.throws(() => stepSetIn(d, s.id, '9', true), /no step 9/); assert.throws(() => stepAddTo(d, s.id, 'x', { under: '9' }), /no step 9/);
  assert.throws(() => stepAddTo(d, s.id, 'cites a ghost (AC7)'), /cites AC7/);
  assert.equal(stepsOf(readSlice(d, s.id)).length, 5);           // the refused add left no trace
  assert.deepEqual(canon(d), []);
});
test('step functions on a body without the section', () => {
  const r = addStep('# T\n', 'First'); assert.equal(r.num, '1'); assert.deepEqual(parseSteps(r.body).steps.map(x => x.text), ['First']);
  assert.match(setStep(r.body, '1', true), /\[x\] 1\. First/);
});
test('moves follow the table: legal ones pass, the rest say where one can go', () => {
  const d = repo(); const s = mk(d);
  assert.throws(() => moveSlice(d, s.id, 'accepted', { by: 'owner' }), /from refining it can go to: ready, abandoned/);
  assert.throws(() => moveSlice(d, s.id, 'nonsense'), /unknown state/);
  for (const to of ['ready', 'building', 'delivered']) moveSlice(d, s.id, to, { now: clock() });
  assert.equal(readSlice(d, s.id).data.status, 'delivered');
  assert.deepEqual(canon(d), []);
});
test('accepting: only the owner, only with every step done, and the record says who and when', () => {
  const d = repo(); const s = mk(d); stepAddTo(d, s.id, 'Only step');
  for (const to of ['ready', 'building', 'delivered']) moveSlice(d, s.id, to);
  assert.throws(() => moveSlice(d, s.id, 'accepted'), /only the Product Owner/);
  assert.throws(() => moveSlice(d, s.id, 'accepted', { by: 'owner' }), /still open/);
  assert.equal(readSlice(d, s.id).data.status, 'delivered');      // refused, rolled back
  moveSlice(d, s.id, 'rework'); moveSlice(d, s.id, 'building'); stepSetIn(d, s.id, '1', true); moveSlice(d, s.id, 'delivered');        // ticking happens while building
  assert.throws(() => stepSetIn(d, s.id, '1', false), /steps are ticked while the slice is being built/);
  moveSlice(d, s.id, 'accepted', { by: 'owner', now: clock() });
  const a = readSlice(d, s.id).data; assert.equal(a.status, 'accepted'); assert.equal(a.accepted.by, 'owner'); assert.match(a.accepted.at, /Z$/);
  moveSlice(d, s.id, 'rework');                                   // rework after acceptance is allowed and clears the record
  assert.equal(readSlice(d, s.id).data.accepted, undefined); assert.deepEqual(canon(d), []);
});
test('a change in slices cannot be accepted while a slice of it is open', () => {
  const d = repo(); const e = mk(d, { title: 'E' }); mk(d, { inChange: e.id });
  for (const to of ['ready', 'building', 'delivered']) moveSlice(d, e.id, to);
  assert.throws(() => moveSlice(d, e.id, 'accepted', { by: 'owner' }), /1 piece\(s\) of E \[e\] are not delivered yet: Save books \[save-books, refining\]/);   // refused before it reaches the verifier (R83)
});
test('blocking questions: ready refuses an open one; blocked needs one', () => {
  const d = repo(); const link = (id, batchId) => { const file = readSlice(d, id).file; fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('request: A list', `request: A list\nbatches: [${batchId}]`)); };
  const s = mk(d);
  const batch = createBatch({ slice: s.id, questions: [{ situation: 'What happens to a duplicate?', blocking: true, options: [{ label: 'Refuse', cost: 'none' }, { label: 'Allow', cost: 'two copies' }] }] }, { date: '2026-10-31' });
  writeBatchFile(path.join(d, 'docs', 'questions.md'), batch); link(s.id, batch.id);
  assert.throws(() => moveSlice(d, s.id, 'ready'), e => e.message.includes(`still open: What happens to a duplicate? [${batch.questions[0].id}]`));   // named by its text, id beside it (R78)
  // a question raised mid-build: unlinked at first, so blocking is refused; once the batch is linked, blocked is allowed
  const t = mk(d, { title: 'T' }); for (const to of ['ready', 'building']) moveSlice(d, t.id, to);
  assert.throws(() => moveSlice(d, t.id, 'blocked'), /no open blocking question/);
  link(t.id, batch.id); moveSlice(d, t.id, 'blocked'); assert.equal(readSlice(d, t.id).data.status, 'blocked');
  moveSlice(d, t.id, 'building'); assert.equal(readSlice(d, t.id).data.status, 'building');   // blocked -> building is legal; the verifier then no longer asks for the question
});
test('the CLI: start, step, status, move and verify --canonical, with the short forms', () => {
  const d = repo(); const run = (...a) => spawnSync(process.execPath, [BUDDY, ...a, '--repo', d], { encoding: 'utf8' });
  const s = run('start', 'Archive a book', '--request', 'Archive instead of delete', '--ac', 'Hidden from the list', '--exclude', 'Deleting for good'); assert.equal(s.status, 0, s.stderr);
  const id = JSON.parse(run('status', '--json').stdout)[0].id;
  assert.equal(run('step', 'add', id, 'Add the flag').status, 0);
  const early = run('step', 'done', id, '1'); assert.equal(early.status, 1); assert.match(early.stderr, /steps are ticked while the slice is being built/);
  assert.equal(run('move', id, 'ready').status, 0); assert.equal(run('move', id, 'building').status, 0); assert.equal(run('step', 'done', id, '1').status, 0);
  assert.match(run('status').stdout, /\[1\/1\]/);
  const bad = run('move', id, 'accepted', '--by', 'owner'); assert.equal(bad.status, 1); assert.match(bad.stderr, /refused: a slice cannot go from building to accepted/);
  assert.equal(run('move', id, 'delivered').status, 0);
  const v = spawnSync(process.execPath, [BUDDY, 'verify', path.join(d, 'docs'), '--canonical'], { encoding: 'utf8' }); assert.equal(v.status, 0, v.stdout + v.stderr);
  const file = path.join(d, 'docs/buddy/backlog', `${new Date().toISOString().slice(0, 10)}-${id}`, 'change.md'); fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('status: delivered', 'status:   delivered'));
  const v2 = spawnSync(process.execPath, [BUDDY, 'verify', path.join(d, 'docs'), '--canonical'], { encoding: 'utf8' }); assert.equal(v2.status, 1); assert.match(v2.stderr, /not in canonical form/);
  const v3 = spawnSync(process.execPath, [BUDDY, 'verify', path.join(d, 'docs')], { encoding: 'utf8' }); assert.equal(v3.status, 0);   // without the flag a hand edit that still verifies passes
});
test('a batch that names its slice counts as the slice\'s even when the slice does not list it (ready, blocked, checkpoint)', () => {
  const d = repo(); const s = mk(d); const t = mk(d, { title: 'T' });
  const spec = id => ({ slice: id, questions: [{ situation: 'May a book be deleted?', blocking: true, options: [{ label: 'Yes', cost: 'data loss' }, { label: 'No', cost: 'none' }] }] });
  const b = createBatch(spec(s.id), { date: '2026-10-31' }); writeBatchFile(path.join(d, 'docs', 'q1.md'), b);       // no `batches:` in the slice
  assert.throws(() => moveSlice(d, s.id, 'ready'), /blocking question\(s\) still open/);
  for (const to of ['ready', 'building']) moveSlice(d, t.id, to);
  assert.throws(() => moveSlice(d, t.id, 'blocked'), /no open blocking question/);
  const c = createBatch(spec(t.id), { date: '2026-10-31', rand: () => 'bbbb' }); writeBatchFile(path.join(d, 'docs', 'q2.md'), c);
  moveSlice(d, t.id, 'blocked'); assert.equal(readSlice(d, t.id).data.status, 'blocked');
});
import { loadBatchFile, assumeDefaults, addAssumedDefaults, confirmAllAssumed, confirmAssumed } from '../src/queue.mjs';
import { acceptCard } from '../src/slicestore.mjs';
test('accepting presents what was assumed and needs the Product Owner to confirm it (R59)', () => {
  const d = repo(); const s = mk(d); stepAddTo(d, s.id, 'Only step');
  const b = createBatch({ slice: s.id, questions: [{ situation: 'Order of the list?', options: [{ label: 'Newest first', cost: 'none' }, { label: 'Oldest first', cost: 'none' }] }] }, { date: '2026-10-31' });
  assumeDefaults(b); addAssumedDefaults(b, ['The list keeps its order.']); const f = path.join(d, 'docs', 'questions.md'); writeBatchFile(f, b);
  for (const to of ['ready', 'building']) moveSlice(d, s.id, to); stepSetIn(d, s.id, '1', true); moveSlice(d, s.id, 'delivered');
  assert.throws(() => moveSlice(d, s.id, 'accepted', { by: 'owner' }), /2 assumed default\(s\) the Product Owner has not confirmed: .*Order of the list/);
  const card = acceptCard(d, s.id); assert.match(card, /confirm what was assumed on your behalf \(2\)/); assert.match(card, /1\. .*Order of the list\?.*-> (Newest|Oldest) first.*\[Q-/); assert.match(card, /2\. The list keeps its order\.\s+\[B-.*#0\]/); assert.match(card, /AC1  Shows saved books/);
  // one question confirmed with a chosen option, the free-text default confirmed with its own id: both count
  const loaded = loadBatchFile(f); confirmAssumed(loaded, loaded.questions[0].id, { option: 'b' }); writeBatchFile(f, loaded);
  assert.throws(() => moveSlice(d, s.id, 'accepted', { by: 'owner' }), /1 assumed default\(s\)/);
  const l2 = loadBatchFile(f); confirmAssumed(l2, `${l2.id}#0`); writeBatchFile(f, l2);
  assert.match(acceptCard(d, s.id), /Nothing was assumed on your behalf/);
  moveSlice(d, s.id, 'accepted', { by: 'owner' }); assert.equal(readSlice(d, s.id).data.status, 'accepted');
  const done = loadBatchFile(f); assert.equal(done.questions[0].answer.origin, 'human'); assert.equal(done.assumed_defaults[0].status, 'confirmed'); assert.equal(done.assumed_defaults[0].by, 'human'); assert.equal(done.status, 'closed');
  assert.deepEqual(canon(d), []);
});
test('confirmAllAssumed says ok to everything assumed in the batch, and the CLI does the same with --all', () => {
  const b = createBatch({ questions: [{ situation: 'Q?', options: [{ label: 'a', cost: 'x' }, { label: 'b', cost: 'y' }] }] }, { date: '2026-10-31' }); assumeDefaults(b); addAssumedDefaults(b, ['x']);
  assert.equal(confirmAllAssumed(b).length, 2); assert.equal(b.status, 'closed'); assert.deepEqual(confirmAllAssumed(b), []);
  assert.throws(() => confirmAssumed(b, `${b.id}#0`), e => e.message === `x [${b.id}#0] is not an assumed default waiting for you: it is already confirmed`);
  assert.throws(() => confirmAssumed(b, 'B-2026-01-01-ffff#0'), e => e.message === 'there is no assumed default B-2026-01-01-ffff#0 in this batch');
  const d = repo(); const c = createBatch({ questions: [{ situation: 'Q?', options: [{ label: 'a', cost: 'x' }, { label: 'b', cost: 'y' }] }] }, { date: '2026-10-31' }); assumeDefaults(c); const f = path.join(d, 'docs', 'q.md'); writeBatchFile(f, c);
  const r = spawnSync(process.execPath, [BUDDY, 'queue', 'confirm', f, '--all'], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /confirmed 1 assumed default/);
  assert.equal(loadBatchFile(f).status, 'closed');
});
import { loadBoard, boardText, boardHtml } from '../src/board.mjs';
test('the acceptance records its channel and its assurance level: recorded, not signed (R61), and the board and the view say so', () => {
  const d = repo(); const s = mk(d); for (const to of ['ready', 'building', 'delivered']) moveSlice(d, s.id, to);
  assert.throws(() => moveSlice(d, s.id, 'accepted', { by: 'owner', channel: 'telepathy' }), /channel must be/);
  moveSlice(d, s.id, 'accepted', { by: 'owner', channel: 'chat', now: clock() });
  const a = readSlice(d, s.id).data.accepted; assert.equal(a.channel, 'chat'); assert.equal(a.assurance, 'recorded'); assert.deepEqual(canon(d), []);
  const text = boardText(loadBoard(d, '2026-10-31T18:00:00Z')); assert.match(text, new RegExp(`accepted \\(1\\)\\n  ${s.id}  Save books  · accepted, recorded only`));
  assert.match(boardHtml(loadBoard(d, '2026-10-31T18:00:00Z')), /accepted, recorded only/);
  const cli = mk(d, { title: 'B' }); for (const to of ['ready', 'building', 'delivered']) moveSlice(d, cli.id, to); moveSlice(d, cli.id, 'accepted', { by: 'owner' });
  assert.equal(readSlice(d, cli.id).data.accepted.channel, 'cli');                                   // the CLI is the default channel
  const r = spawnSync(process.execPath, [BUDDY, 'move', cli.id, 'rework', '--repo', d], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); assert.equal(readSlice(d, cli.id).data.accepted, undefined);
});
import { loadStory } from '../src/story.mjs';
test('a change folder holds its question batches (R87): queue new --slice writes there; decide --slice writes to docs/decisions and names the change', () => {
  const d = repo(); const e = mk(d, { title: 'Reading list', criteria: [] }); const s = mk(d, { inChange: e.id }); const dir = path.dirname(e.file);
  const spec = path.join(d, 'spec.json'); fs.writeFileSync(spec, JSON.stringify({ questions: [{ situation: 'Order?', options: [{ label: 'Newest', cost: 'none' }, { label: 'Oldest', cost: 'none' }] }] }));
  const at = (...a) => spawnSync(process.execPath, [BUDDY, ...a], { cwd: d, encoding: 'utf8' });
  assert.equal(at('queue', 'new', '--in', spec, '--slice', s.id).status, 0); assert.equal(at('queue', 'new', '--in', spec, '--slice', e.id).status, 0);
  assert.equal(loadBatchFile(path.join(dir, 'questions-1.md')).slice, s.id); assert.equal(loadBatchFile(path.join(dir, 'questions-2.md')).slice, e.id);
  const bad = at('queue', 'new', '--in', spec, '--slice', 'no-such-slice'); assert.equal(bad.status, 1); assert.match(bad.stderr, /no slice or change no-such-slice/);
  const dec = (...x) => at('decide', '--title', 'Store in a file', '--requested-by', 'owner', '--decided-by', 'human', '--context', 'c', '--options', 'a; b', '--outcome', 'a', '--reason', 'r', '--rule', 'one file|human', ...x);
  const one = dec('--slice', s.id); assert.equal(one.status, 0, one.stderr); assert.match(one.stdout, /wrote docs\/decisions\/D-/);
  const id = /(D-\d{4}-\d{2}-\d{2}-[0-9a-f]{4})/.exec(one.stdout)[1]; const file = path.join(d, one.stdout.trim().slice(6));
  assert.match(fs.readFileSync(file, 'utf8'), new RegExp(`\\nslice: ${s.id}\\n`));
  const two = dec('--slice', s.id, '--supersedes', id); assert.equal(two.status, 0, two.stderr);
  assert.match(fs.readFileSync(file, 'utf8'), new RegExp(`status: superseded by ${/(D-\d{4}-\d{2}-\d{2}-[0-9a-f]{4})/.exec(two.stdout)[1]}`));
  const old = path.join(dir, `${id.replace(/.{4}$/, 'beef')}-older.md`);                 // a record of the layout before: in the change folder, still read and superseded
  fs.writeFileSync(old, fs.readFileSync(file, 'utf8').replace(id, id.replace(/.{4}$/, 'beef')).replace(/^status: .*$/m, 'status: accepted'));
  assert.equal(dec('--supersedes', id.replace(/.{4}$/, 'beef')).status, 0); assert.match(fs.readFileSync(old, 'utf8'), /status: superseded by D-/);
  assert.equal(fs.readdirSync(path.join(d, 'docs/decisions')).length, 3);
  assert.deepEqual(canon(d), []);
  assert.equal(loadStory(dir).slice.id, e.id); const story = loadStory(dir, { slice: s.id });   // a change folder tells its change's story, its decisions included
  assert.equal(story.batches.length, 1); assert.deepEqual(story.decisions.map(x => x.data.status.replace(/D-.*/, 'D')).sort(), ['accepted', 'superseded by D', 'superseded by D']);
});
import { renameSlice } from '../src/slicestore.mjs';
test('rename a change: its folder keeps its date and takes the name, and every record that names it follows (R86, R87)', () => {
  const d = repo(); const e = mk(d, { title: 'Reading list', criteria: [] }); const s = mk(d, { inChange: e.id }); const other = mk(d, { title: 'Export', dependsOn: [e.id] });
  const dir = path.dirname(e.file); writeBatchFile(path.join(dir, 'questions-1.md'), createBatch({ slice: e.id, questions: [{ situation: 'Order?', options: [{ label: 'a', cost: 'x' }, { label: 'b', cost: 'y' }] }] }, { date: '2026-10-31' }));
  fs.mkdirSync(path.join(dir, 'evidence')); fs.writeFileSync(path.join(dir, 'evidence', 'evidence-1.json'), '{}\n');
  const r = renameSlice(d, e.id, 'book-list', { now: clock() }); const nd = path.join(d, 'docs/buddy/backlog/2026-10-31-book-list');
  assert.equal(r.file, path.join(nd, 'change.md')); assert.ok(!fs.existsSync(dir)); assert.ok(fs.existsSync(path.join(nd, 'evidence', 'evidence-1.json')));
  assert.equal(readSlice(d, 'book-list').data.id, 'book-list'); assert.equal(readSlice(d, s.id).change, 'book-list'); assert.equal(readSlice(d, s.id).file, path.join(nd, 'save-books.md'));
  assert.deepEqual(readSlice(d, other.id).data.depends_on, ['book-list']); assert.equal(loadBatchFile(path.join(nd, 'questions-1.md')).slice, 'book-list');
  assert.throws(() => readSlice(d, e.id), /no slice or change reading-list/); assert.deepEqual(canon(d), []);
});
test('rename a slice; refused after refining unless forced, refused on a bad or taken name, and a refused rename leaves everything as it was', () => {
  const d = repo(); const e = mk(d, { title: 'Reading list', criteria: [] }); const s = mk(d, { inChange: e.id }); const dir = path.dirname(e.file);
  writeBatchFile(path.join(dir, 'questions-1.md'), createBatch({ slice: s.id, questions: [{ situation: 'Order?', options: [{ label: 'a', cost: 'x' }, { label: 'b', cost: 'y' }] }] }, { date: '2026-10-31' }));
  renameSlice(d, s.id, 'keep-books'); assert.ok(fs.existsSync(path.join(dir, 'keep-books.md'))); assert.ok(!fs.existsSync(path.join(dir, 'save-books.md')));
  assert.equal(loadBatchFile(path.join(dir, 'questions-1.md')).slice, 'keep-books');
  assert.throws(() => renameSlice(d, 'keep-books', 'reading-list'), /the name reading-list is taken/); assert.throws(() => renameSlice(d, 'keep-books', 'Keep_Books'), /is not a slice name/);
  moveSlice(d, 'keep-books', 'ready'); assert.throws(() => renameSlice(d, 'keep-books', 'hold-books'), /Save books \[keep-books\] is ready: a change or slice is renamed only while it is refining/);
  const cli = spawnSync(process.execPath, [BUDDY, 'slice', 'rename', 'keep-books', 'hold-books', '--force', '--repo', d], { encoding: 'utf8' }); assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /renamed keep-books to hold-books: .*hold-books\.md\n  followed: .*questions-1\.md\nnote: keep-books was ready; the commits already made keep the old name keep-books/);
  const before = fs.readdirSync(dir).sort(); fs.writeFileSync(path.join(dir, 'questions-2.md'), fs.readFileSync(path.join(dir, 'questions-1.md'), 'utf8').replace(/^id: B-\S+/m, 'id: B-2026-10-31-0bad').replace(/^slice: hold-books/m, 'slice: ghost'));
  assert.throws(() => renameSlice(d, e.id, 'book-list'), /unknown slice ghost/);                // a problem under docs/buddy refuses the whole rename
  assert.ok(fs.existsSync(dir)); assert.ok(!fs.existsSync(path.join(d, 'docs/buddy/backlog/2026-10-31-book-list'))); assert.deepEqual(fs.readdirSync(dir).sort(), [...before, 'questions-2.md'].sort());
  assert.equal(readSlice(d, e.id).data.id, e.id);
});
import { goalAdd, goalSet, goalRemove } from '../src/slicestore.mjs';
import { READY_RULE_FROM } from '../src/slice.mjs';
test('criteria and exclusions: written at start, added, corrected and removed while refining, never renumbered, shown on the accept card (R94, R109)', () => {
  const d = repo(); const s = mk(d, { excludes: ['Sharing the list', 'Importing from a file'] });
  assert.deepEqual(readSlice(d, s.id).data.excludes, [{ id: 'X1', text: 'Sharing the list' }, { id: 'X2', text: 'Importing from a file' }]);
  assert.equal(goalAdd(d, s.id, 'criteria', 'Sorted by title').ref, 'AC3'); assert.equal(goalAdd(d, s.id, 'excludes', 'Covers').ref, 'X3');
  goalSet(d, s.id, 'criteria', 'AC2', 'Refuses a duplicate title'); goalRemove(d, s.id, 'excludes', 'X2');
  assert.equal(goalAdd(d, s.id, 'excludes', 'Printing').ref, 'X4');                                  // X3 kept its id when X2 went
  const data = readSlice(d, s.id).data;
  assert.deepEqual(data.criteria.map(c => c.text), ['Shows saved books', 'Refuses a duplicate title', 'Sorted by title']); assert.deepEqual(data.excludes.map(x => x.id), ['X1', 'X3', 'X4']);
  assert.throws(() => goalSet(d, s.id, 'criteria', 'AC9', 'x'), /no criterion AC9; there are: AC1 \(Shows saved books\), AC2 \(Refuses a duplicate title\), AC3 \(Sorted by title\)/);
  assert.throws(() => goalAdd(d, s.id, 'excludes', '  '), /one line, not empty/); assert.throws(() => goalAdd(d, s.id, 'excludes', 'a\nb'), /one line/);
  stepAddTo(d, s.id, 'Sort (AC3)'); assert.throws(() => goalRemove(d, s.id, 'criteria', 'AC3'), /AC3 \(Sorted by title\) is cited by step 1; change that step first/);
  for (const x of ['X1', 'X3', 'X4']) goalRemove(d, s.id, 'excludes', x); assert.equal(readSlice(d, s.id).data.excludes, undefined);   // an empty list leaves the record
  assert.equal(goalAdd(d, s.id, 'excludes', 'Nothing beyond the criteria above').ref, 'X1'); assert.deepEqual(canon(d), []);
  moveSlice(d, s.id, 'ready');
  for (const f of [() => goalAdd(d, s.id, 'criteria', 'More'), () => goalSet(d, s.id, 'excludes', 'X1', 'x'), () => goalRemove(d, s.id, 'criteria', 'AC1')])
    assert.throws(f, e => e.message.startsWith(`Save books [${s.id}] is ready: `) && e.message.includes('The goal is fixed when a change is ready; changing it is the owner\'s decision and goes back through refining') && !/\b[RQ]\d+\b/.test(e.message));
  moveSlice(d, s.id, 'building'); stepSetIn(d, s.id, '1', true); moveSlice(d, s.id, 'delivered');
  const card = acceptCard(d, s.id);
  assert.match(card, /You asked for:\n  AC1  Shows saved books\n[\s\S]*\n\nIt does not include:\n  X1  Nothing beyond the criteria above\n/);
});
test('the CLI: start --exclude, criteria and excludes add|edit|remove, refused after refining', () => {
  const d = repo(); const run = (...a) => spawnSync(process.execPath, [BUDDY, ...a, '--repo', d], { encoding: 'utf8' });
  const s = run('start', 'Archive a book', '--request', 'r', '--name', 'archive', '--ac', 'Hidden from the list', '--exclude', 'Deleting for good', '--exclude', 'Restoring'); assert.equal(s.status, 0, s.stderr);
  assert.deepEqual(readSlice(d, 'archive').data.excludes.map(x => x.text), ['Deleting for good', 'Restoring']);
  const add = run('criteria', 'add', 'archive', 'Shown in the archive'); assert.equal(add.status, 0, add.stderr); assert.match(add.stdout, /^added criterion AC2 to archive/);
  assert.match(run('criteria', 'edit', 'archive', 'AC2', 'Listed in the archive').stdout, /^corrected criterion AC2 of archive/);
  assert.match(run('excludes', 'remove', 'archive', 'X1').stdout, /^removed exclusion X1 from archive/);
  assert.match(run('excludes', 'add', 'archive', 'Search').stdout, /^added exclusion X3 to archive/);
  const j = JSON.parse(run('slice', 'excludes', 'edit', 'archive', 'X3', 'Searching the archive', '--json').stdout); assert.deepEqual(j.excludes.map(x => x.id), ['X2', 'X3']);
  assert.deepEqual(readSlice(d, 'archive').data.criteria.map(c => c.text), ['Hidden from the list', 'Listed in the archive']);
  const miss = run('criteria', 'edit', 'archive'); assert.equal(miss.status, 2); assert.match(miss.stderr, /missing <AC id>/);
  assert.equal(run('criteria', 'frob', 'archive').status, 2);
  assert.equal(run('move', 'archive', 'ready').status, 0);
  const late = run('excludes', 'add', 'archive', 'More'); assert.equal(late.status, 1); assert.match(late.stderr, /^refused: Archive a book \[archive\] is ready: what it does not include can be changed only while it is refining\. The goal is fixed when a change is ready/);
  assert.equal(run('move', 'archive', 'refining').status, 0); assert.equal(run('excludes', 'add', 'archive', 'More').status, 0);   // the owner's decision: back through refining
});
test('the ready rule: criteria, exclusions and no blocking question open, for every kind and for a change made of slices (R114)', () => {
  const d = repo();
  const none = mk(d, { title: 'Fix the sort', kind: 'fix', criteria: [], excludes: [] });
  assert.throws(() => moveSlice(d, none.id, 'ready'), e => e.message === `not ready: it has no acceptance criteria: say how it will be accepted with buddy criteria add ${none.id} "<text>"; it does not say what it leaves out: add that with buddy excludes add ${none.id} "<text>" ("Nothing beyond the criteria above" is a valid answer)`);
  goalAdd(d, none.id, 'criteria', 'Sorted by title');
  assert.throws(() => moveSlice(d, none.id, 'ready'), e => /^not ready: it does not say what it leaves out/.test(e.message) && !e.message.includes('criteria add'));
  goalAdd(d, none.id, 'excludes', 'Nothing beyond the criteria above'); moveSlice(d, none.id, 'ready'); assert.equal(readSlice(d, none.id).data.status, 'ready');
  const e = mk(d, { title: 'Reading list', criteria: [], excludes: [] }); mk(d, { inChange: e.id });   // a change of slices needs its own
  assert.throws(() => moveSlice(d, e.id, 'ready'), /not ready: it has no acceptance criteria/);
  const q = mk(d, { title: 'Q', criteria: [] });
  writeBatchFile(path.join(d, 'docs', 'q.md'), createBatch({ slice: q.id, questions: [{ situation: 'Keep or drop?', blocking: true, options: [{ label: 'Keep', cost: 'none' }, { label: 'Drop', cost: 'loss' }] }] }, { date: '2026-10-31' }));
  assert.throws(() => moveSlice(d, q.id, 'ready'), e => /^not ready: it has no acceptance criteria.*; blocking question\(s\) still open: Keep or drop\?/.test(e.message));   // everything missing at once
  assert.equal(readSlice(d, q.id).data.status, 'refining');
});
test('verify applies the ready rule to records opened from the cutoff on, and the older rule to those opened before', () => {
  assert.equal(READY_RULE_FROM, '2026-11-02');
  const d = repo(); const at = day => () => new Date(`${day}T12:00:00Z`);
  const strip = (id, field) => { const f = readSlice(d, id).file; fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(new RegExp(`^${field}:\\n(?:  - id: .*\\n    text: .*\\n)+`, 'm'), '')); };
  const problems = () => verify([path.join(d, 'docs')]).problems.map(p => `${path.basename(path.dirname(p.file))} ${p.where}: ${p.message}`);
  const newer = mk(d, { title: 'Newer', kind: 'fix', now: at('2026-11-02') }); const older = mk(d, { title: 'Older', now: at('2026-11-01') });
  const change = mk(d, { title: 'Newer change', now: at('2026-11-03') }); mk(d, { title: 'Its slice', inChange: change.id, now: at('2026-11-03') });
  for (const id of [newer.id, older.id, change.id]) moveSlice(d, id, 'ready');
  mk(d, { title: 'Draft', criteria: [], excludes: [], now: at('2026-11-05') });                            // refining: nothing asked yet
  assert.deepEqual(problems(), []);
  for (const id of [newer.id, older.id, change.id]) strip(id, 'excludes');
  strip(change.id, 'criteria');
  assert.deepEqual(problems().sort(), [
    '2026-11-02-newer excludes: a change that is ready needs to say what it does not include (at least one exclusion)',
    '2026-11-03-newer-change criteria: a change that is ready needs at least one acceptance criterion',
    '2026-11-03-newer-change excludes: a change that is ready needs to say what it does not include (at least one exclusion)',
  ]);   // the older record keeps the rule it was made under: it has criteria, so it passes
  strip(older.id, 'criteria'); assert.ok(problems().includes('2026-11-01-older criteria: a feat slice that is ready needs at least one acceptance criterion'));
});

test('a delivered change can be sent back to refining, with the owner\'s decision: its goal is edited and it goes through ready and building again (reopen-goal-after-finding)', () => {
  const d = repo(); const s = mk(d); stepAddTo(d, s.id, 'Only step');
  for (const to of ['ready', 'building']) moveSlice(d, s.id, to); stepSetIn(d, s.id, '1', true); moveSlice(d, s.id, 'delivered');
  assert.throws(() => goalAdd(d, s.id, 'excludes', 'Showing it in the board'), /only while it is refining/);
  moveSlice(d, s.id, 'rework'); moveSlice(d, s.id, 'refining');                                   // rework -> refining is how the goal is reopened
  const before = readSlice(d, s.id).data.excludes?.length || 0;
  const r = goalAdd(d, s.id, 'excludes', 'Showing it in the board'); assert.equal(readSlice(d, s.id).data.excludes.length, before + 1); assert.ok(r.ref);
  moveSlice(d, s.id, 'ready'); moveSlice(d, s.id, 'building');
  assert.equal(stepsOf(readSlice(d, s.id))[0].done, true, 'the work already done stays ticked'); moveSlice(d, s.id, 'delivered');
  assert.deepEqual(canon(d), []);
  assert.throws(() => moveSlice(d, s.id, 'refining'), /from delivered it can go to: accepted, rework, abandoned/);   // only through rework
});
import { deliverChangeOf, partsOf } from '../src/slicestore.mjs';
// A feature is a change in pieces (R70, R83): delivered with its last piece, shown on one card, accepted as a whole.
test('the accept card of a change in pieces: its criteria, the assumptions across its pieces, one line per piece, only the exceptions (R83)', () => {
  const d = repo(); const now = clock();
  const ch = startSlice({ repo: d, title: 'Reading list', request: 'r', criteria: ['Books can be kept'], excludes: ['Sharing'], now });
  const piece = t => { const p = startSlice({ repo: d, title: t, request: 'r', criteria: ['Works'], excludes: ['Nothing beyond the criteria above'], inChange: ch.id, now }); stepAddTo(d, p.id, 'Build', { now }); for (const to of ['ready', 'building']) moveSlice(d, p.id, to, { now }); stepSetIn(d, p.id, '1', true, { now }); return p.id; };
  const a = piece('Save books'), b = piece('Remove a book');
  const bt = createBatch({ slice: a, questions: [{ situation: 'Order of the list?', options: [{ label: 'Newest first', cost: 'none' }, { label: 'Oldest first', cost: 'none' }] }] }, { date: '2026-10-31' });
  assumeDefaults(bt); const f = path.join(d, 'docs', 'questions.md'); writeBatchFile(f, bt);
  const evDir = path.join(path.dirname(readSlice(d, ch.id).file), 'evidence'); fs.mkdirSync(evDir);
  fs.writeFileSync(path.join(evDir, 'evidence-2026-10-31T120000Z-run.json'), JSON.stringify({ when: '2026-10-31T12:00:00Z', slice: a, reasons: [] }));
  fs.writeFileSync(path.join(evDir, 'evidence-2026-10-31T130000Z-run.json'), JSON.stringify({ when: '2026-10-31T13:00:00Z', slice: b, reasons: ['validate failed'] }));
  moveSlice(d, a, 'delivered', { now }); assert.equal(deliverChangeOf(d, a, { now }), null);              // b is still building: the change waits
  assert.throws(() => moveSlice(d, ch.id, 'delivered'), /a change in pieces is delivered from refining with its last piece; 1 piece\(s\) are not delivered yet: Remove a book \[remove-a-book, building\]/);
  let card = acceptCard(d, ch.id);
  assert.match(card, /Not ready to accept: 1 piece\(s\) are not delivered yet: Remove a book \[remove-a-book, building\]/);
  moveSlice(d, b, 'delivered', { now }); assert.equal(deliverChangeOf(d, b, { now }).data.status, 'delivered');   // from refining, directly: its pieces carry the work
  card = acceptCard(d, ch.id);
  assert.match(card, /You asked for:\n  AC1  Books can be kept/); assert.match(card, /It does not include:\n  X1  Sharing/);
  assert.match(card, /Its pieces \(2 of 2 delivered, accepted or abandoned\):\n  delivered Save books \[save-books\]\n  delivered Remove a book \[remove-a-book\]/);
  assert.match(card, /Exceptions the checks found \(1 piece\(s\)\):\n  Remove a book \[remove-a-book\]: validate failed\n/); assert.doesNotMatch(card, /Save books \[save-books\]:/);   // the clean piece is not an exception
  assert.match(card, /confirm what was assumed on your behalf \(1\):\n  1\. .*Order of the list\?/); assert.doesNotMatch(card, /Not ready/); assert.doesNotMatch(card, /Steps|AC1  Works/);   // no summary of each piece
  assert.throws(() => moveSlice(d, ch.id, 'accepted', { by: 'owner' }), /1 assumed default\(s\) the Product Owner has not confirmed: .*Order of the list/);   // a piece's assumption stops the whole
  const l = loadBatchFile(f); confirmAllAssumed(l); writeBatchFile(f, l);
  moveSlice(d, b, 'rework', { now }); assert.throws(() => moveSlice(d, ch.id, 'accepted', { by: 'owner' }), /1 piece\(s\) of Reading list \[reading-list\] are not delivered yet: Remove a book \[remove-a-book, rework\]/);
  moveSlice(d, b, 'building', { now }); moveSlice(d, b, 'delivered', { now });
  const r = moveSlice(d, ch.id, 'accepted', { by: 'owner', channel: 'chat', now: () => new Date('2026-11-02T10:00:00Z') });
  assert.deepEqual(r.pieces, [a, b]);
  for (const id of [ch.id, a, b]) assert.deepEqual(readSlice(d, id).data.accepted, { by: 'owner', at: '2026-11-02T10:00:00Z', channel: 'chat', assurance: 'recorded' });
  assert.deepEqual(canon(d), []);
});
test('a change in pieces: only the owner accepts it, a refused acceptance writes nothing, and an abandoned piece stays abandoned', () => {
  const d = repo(); const ch = startSlice({ repo: d, title: 'Reading list', request: 'r', criteria: ['Works'], excludes: ['Sharing'] });
  const ids = ['One', 'Two'].map(t => startSlice({ repo: d, title: t, request: 'r', criteria: ['Works'], excludes: ['Nothing beyond the criteria above'], inChange: ch.id }).id);
  for (const to of ['ready', 'building', 'delivered']) moveSlice(d, ids[0], to); moveSlice(d, ids[1], 'abandoned');
  assert.equal(deliverChangeOf(d, ids[0]).data.status, 'delivered'); assert.equal(deliverChangeOf(d, ids[0]), null);   // already delivered: nothing to do
  assert.throws(() => moveSlice(d, ch.id, 'accepted'), /only the Product Owner accepts/);
  assert.equal(readSlice(d, ids[0]).data.status, 'delivered');
  moveSlice(d, ch.id, 'accepted', { by: 'owner' }); assert.deepEqual(partsOf(d, ch.id).map(x => x.data.status), ['accepted', 'abandoned']);
  assert.deepEqual(canon(d), []);
});

import { assumeAdd, assumeSet } from '../src/slicestore.mjs';
test('assumptions are announced before building: at most five, proposed, then confirmed or corrected (R136)', () => {
  const d = repo(); const s = mk(d);
  const a = assumeAdd(d, s.id, 'A book belongs to one reader', 'sharing books needs a new data model', { now: clock() });
  assert.deepEqual(a.entry, { id: 'A1', text: 'A book belongs to one reader', if_otherwise: 'sharing books needs a new data model', status: 'proposed' });
  assert.throws(() => assumeAdd(d, s.id, 'No if', ''), /what changes for the owner/); assert.throws(() => assumeAdd(d, s.id, 'two\nlines', 'x'), /one line/);
  for (const t of ['B', 'C', 'D', 'E']) assumeAdd(d, s.id, t, `if not ${t}`);
  assert.throws(() => assumeAdd(d, s.id, 'F', 'x'), /already announces 5 assumptions/);
  assert.throws(() => assumeSet(d, s.id, 'A2', 'corrected', { by: 'owner' }), /--criterion "<text>" or --exclude "<text>"/);   // a correction carries its text (R139)
  assert.throws(() => assumeSet(d, s.id, 'A2', 'corrected', { by: 'owner', criterion: 'x', exclude: 'y' }), /exactly one/);
  const c = assumeSet(d, s.id, 'A2', 'corrected', { by: 'owner', exclude: 'Books shared between readers' });
  assert.deepEqual(c.changed, ['A2']); assert.equal(c.correction, 'X2'); assert.equal(c.field, 'excludes');
  assert.deepEqual(readSlice(d, s.id).data.excludes.at(-1), { id: 'X2', text: 'Books shared between readers' });
  assert.equal(readSlice(d, s.id).data.assumptions[1].correction, 'X2');
  assert.throws(() => assumeSet(d, s.id, 'all', 'corrected', { by: 'owner' }), /one assumption at a time/); assert.throws(() => assumeSet(d, s.id, 'A9', 'confirmed', { by: 'owner' }), /no assumption A9; there are: A1/);
  assert.deepEqual(assumeSet(d, s.id, 'A1', 'confirmed', { by: 'owner' }).changed, ['A1']);
  moveSlice(d, s.id, 'ready'); const b = moveSlice(d, s.id, 'building');   // allowed, with the unconfirmed ones named
  assert.deepEqual(b.unconfirmed.map(x => x.id), ['A3', 'A4', 'A5']);
  assert.throws(() => assumeAdd(d, s.id, 'Late', 'x'), /is building: assumptions are announced before building/);
  assert.deepEqual(assumeSet(d, s.id, 'all', 'confirmed', { by: 'owner' }).changed, ['A3', 'A4', 'A5']);
  assert.deepEqual(readSlice(d, s.id).data.assumptions.map(x => x.status), ['confirmed', 'corrected', 'confirmed', 'confirmed', 'confirmed']);
  assert.equal(moveSlice(d, mk(d, { title: 'Other' }).id, 'ready').unconfirmed, undefined);
  assert.deepEqual(canon(d), []);
});
test('only the owner confirms or corrects an assumption, with by owner, as lowering a costly decision (RQ1, R139)', () => {
  const d = repo(); const s = mk(d); assumeAdd(d, s.id, 'One reader', 'x');
  assert.throws(() => assumeSet(d, s.id, 'all', 'confirmed'), /only the owner confirms or corrects an assumption/);
  assert.throws(() => assumeSet(d, s.id, 'A1', 'corrected', { criterion: 'Shared' }), /only the owner confirms or corrects an assumption/);
  assert.throws(() => assumeSet(d, s.id, 'A1', 'confirmed', { by: 'buddy' }), /--by takes only owner \(got buddy\)/);
  assert.equal(readSlice(d, s.id).data.assumptions[0].status, 'proposed'); assert.equal(readSlice(d, s.id).data.criteria.length, 2);   // nothing written
  assert.deepEqual(assumeSet(d, s.id, 'A1', 'confirmed', { by: 'owner' }).changed, ['A1']);
});
test('a correction becomes a criterion under the same rules: the vague-words warning, and only while refining (R139)', () => {
  const d = repo(); const s = mk(d); assumeAdd(d, s.id, 'One reader', 'x'); assumeAdd(d, s.id, 'English only', 'y');
  const c = assumeSet(d, s.id, 'A1', 'corrected', { by: 'owner', criterion: 'The list is fast for many readers' });
  assert.equal(c.correction, 'AC3'); assert.ok(c.vague.length); assert.equal(readSlice(d, s.id).data.criteria.at(-1).text, 'The list is fast for many readers');
  assert.deepEqual(readSlice(d, s.id).data.assumptions.map(a => [a.status, a.correction]), [['corrected', 'AC3'], ['proposed', undefined]]);
  moveSlice(d, s.id, 'ready');
  assert.throws(() => assumeSet(d, s.id, 'A2', 'corrected', { by: 'owner', criterion: 'Translated' }), /is ready: acceptance criteria can be changed only while it is refining/);
  assert.equal(readSlice(d, s.id).data.assumptions[1].status, 'proposed');   // nothing half-done
  assert.deepEqual(canon(d), []);
});
test('the verifier refuses more than five assumptions and an unknown status', () => {
  const d = repo(); const s = mk(d); assumeAdd(d, s.id, 'One', 'x');
  const f = readSlice(d, s.id).file; const text = fs.readFileSync(f, 'utf8');
  fs.writeFileSync(f, text.replace('status: proposed', 'status: maybe'));
  assert.match(verify([path.join(d, 'docs')]).problems.map(p => p.message).join('\n'), /unknown status maybe/);
  const six = [1, 2, 3, 4, 5, 6].map(n => `  - id: A${n}\n    text: T${n}\n    if_otherwise: O${n}\n    status: proposed`).join('\n');
  fs.writeFileSync(f, text.replace(/assumptions:\n[\s\S]*?status: proposed\n/, `assumptions:\n${six}\n`));
  assert.match(verify([path.join(d, 'docs')]).problems.map(p => p.message).join('\n'), /at most 5 assumptions .* there are 6/);
});
test('the CLI announces, confirms and warns when building with assumptions not confirmed', () => {
  const d = repo(); const s = mk(d); const B = (...a) => spawnSync(process.execPath, [BUDDY, 'slice', ...a, '--repo', d], { encoding: 'utf8' });
  let r = B('assume', s.id, 'English only', '--if-otherwise', 'translations are a new change'); assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /announced A1 on save-books \(proposed\): English only/);
  r = B('assume', s.id, 'Paper books only', '--if-otherwise', 'e-books need another screen'); assert.equal(r.status, 0, r.stderr);
  for (const a of [['confirm', 'all'], ['confirm', 'A1'], ['correct', 'A2', '--exclude', 'E-books'], ['confirm', 'A1', '--by', 'buddy']]) {   // only the owner answers (RQ1)
    r = B('assume', s.id, ...a); assert.equal(r.status, 1); assert.match(r.stderr, a.includes('--by') ? /--by takes only owner \(got buddy\)/ : /only the owner confirms or corrects an assumption/);
  }
  assert.deepEqual(readSlice(d, s.id).data.assumptions.map(x => x.status), ['proposed', 'proposed']); assert.equal(readSlice(d, s.id).data.excludes.length, 1);
  r = B('assume', s.id, 'confirm', 'A1', '--by', 'owner'); assert.match(r.stdout, /A1 confirmed for save-books/);
  r = B('assume', s.id, 'No if'); assert.equal(r.status, 2); assert.match(r.stderr, /--if-otherwise/);
  r = B('assume', s.id, 'correct', 'A2', '--by', 'owner'); assert.equal(r.status, 1); assert.match(r.stderr, /refused: say the correction of A2 in the same command/);
  r = B('assume', s.id, 'correct', 'A2', '--criterion', 'a', '--exclude', 'b', '--by', 'owner'); assert.equal(r.status, 1); assert.match(r.stderr, /exactly one/);
  B('assume', s.id, 'Audio books too', '--if-otherwise', 'y'); B('assume', s.id, 'Covers shown', '--if-otherwise', 'z');
  r = B('assume', s.id, 'correct', 'A3', '--exclude', 'Audio books', '--by', 'owner'); assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /A3 corrected for save-books, written as exclusion X2/);
  r = B('assume', s.id, 'correct', 'A4', '--criterion', 'Covers load fast', '--by', 'owner'); assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /A4 corrected for save-books, written as criterion AC3\nwarning: /);
  B('move', s.id, 'ready'); r = B('move', s.id, 'building'); assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /save-books is now building\nwarning: assumption A2 is not confirmed by the owner: Paper books only/);
});

import { reclassifyDecision } from '../src/slicestore.mjs';
test('a reclassification is written into the record, canonical, and the evidence stays byte for byte as it was (R140)', () => {
  const d = repo(); const s = mk(d); const dir = path.join(path.dirname(readSlice(d, s.id).file), 'evidence'); fs.mkdirSync(dir, { recursive: true });
  const name = 'evidence-2026-11-02T100000Z-run.json'; const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify({ when: '2026-11-02T10:00:00Z', slice: s.id, review: { unspecified_decisions: [{ text: 'Deleted books are gone', costly: true }] } }, null, 1) + '\n'); const bytes = fs.readFileSync(file);
  const r = reclassifyDecision(d, s.id, 1, 'cheap', { by: 'owner', now: () => new Date('2026-11-02T11:00:00Z') });
  assert.deepEqual([r.n, r.costly, r.by, r.evidence], [1, false, 'owner', name]); assert.equal(r.file, readSlice(d, s.id).file);
  assert.deepEqual(readSlice(d, s.id).data.reclassified, [{ evidence: name, n: 1, costly: false, by: 'owner', at: '2026-11-02T11:00:00Z' }]);
  assert.ok(fs.readFileSync(file).equals(bytes)); assert.deepEqual(canon(d), []);
});
