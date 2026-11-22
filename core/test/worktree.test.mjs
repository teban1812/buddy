import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { checkpoint } from '../src/checkpoint.mjs';
import { howtoSet, startSlice, moveSlice, stepAddTo, stepSetIn, readSlice } from '../src/slicestore.mjs';
import { loadBoard, boardText } from '../src/board.mjs';
import { digest, digestText, writeMark, readMark } from '../src/digest.mjs';
import { refreshIndex, indexFile, INDEX } from '../src/index.mjs';
import { writeHandover } from '../src/resume.mjs';
import { registerWorker, workers } from '../src/workers.mjs';
import { gitDir, buddyDir, isGitRepo } from '../src/gitdir.mjs';

// Buddy inside a git worktree (R146): there `.git` is a one-line file, and Buddy's folder is the worktree's own git folder, asked of git.
const NOW = '2026-11-04T12:00:00Z';
const G = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { cwd, encoding: 'utf8', stdio: 'pipe' });
const clean = () => ({ does_what_was_asked: true, weakens_or_hides_checks: false, unspecified_decisions: [], details: 'fine' });
const real = p => fs.realpathSync(p);
// A repository with a base commit and two worktrees of it, each on its own branch.
function repoWithWorktrees() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-')); const d = path.join(root, 'main'); fs.mkdirSync(d); G(d, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: 'x', scripts: { validate: 'node -e "0"' } })); fs.mkdirSync(path.join(d, 'docs'));
  fs.writeFileSync(path.join(d, 'docs', 'README.md'), 'docs\n'); fs.writeFileSync(path.join(d, 'README.md'), 'base\n'); G(d, 'add', 'package.json', 'README.md', 'docs/README.md'); G(d, 'commit', '-qm', 'base');
  const one = path.join(root, 'one'); const two = path.join(root, 'two');
  G(d, 'worktree', 'add', '-q', '-b', 'one', one); G(d, 'worktree', 'add', '-q', '-b', 'two', two);
  return { d, one, two };
}
function building(wt, title) {
  const s = startSlice({ repo: wt, title, request: 'Do the thing the reader asked for', criteria: ['It works'], excludes: ['Nothing beyond the criteria above'] });
  stepAddTo(wt, s.id, 'Do it'); moveSlice(wt, s.id, 'ready'); moveSlice(wt, s.id, 'building'); stepSetIn(wt, s.id, '1', true); howtoSet(wt, s.id, 'AC1', { steps: 'Use it', expect: 'It works' });
  fs.writeFileSync(path.join(wt, 'thing.js'), 'export const x = 1;\n'); fs.writeFileSync(path.join(wt, 'thing.test.js'), "import assert from 'node:assert';\nassert.equal(1, 1);\n"); return s.id;
}

test('in a worktree the checkpoint, the board, the digest, the index, the hand-overs and the workers work, in the worktree\'s own git folder', () => {
  const { d, one } = repoWithWorktrees(); assert.ok(fs.statSync(path.join(one, '.git')).isFile());
  const own = gitDir(one); assert.equal(real(own), real(path.join(d, '.git', 'worktrees', 'one'))); assert.equal(buddyDir(one), path.join(own, 'buddy')); assert.ok(isGitRepo(one));
  const id = building(one, 'Do a thing');
  const h = writeHandover(one, id, NOW); assert.equal(real(path.dirname(h)), real(path.join(own, 'buddy', 'handover')));         // Dev's hand-over
  const r = checkpoint({ repo: one, slice: id, review: clean, human: true });
  assert.equal(real(path.resolve(one, r.evidence.handover.dev.path)), real(h));                                                  // the checkpoint finds it there
  assert.deepEqual(r.evidence.reasons, []); assert.equal(r.decision, 'APPROVE'); assert.equal(readSlice(one, id).data.status, 'delivered');
  assert.equal(path.dirname(r.evidenceFile), path.join(path.dirname(readSlice(one, id).file), 'evidence'));        // evidence with the change, as in a plain repository
  assert.ok(fs.existsSync(path.resolve(one, r.evidence.handover.reviewer.path))); assert.equal(real(path.dirname(path.resolve(one, r.evidence.handover.reviewer.path))), real(path.join(own, 'buddy', 'handover')));
  assert.match(boardText(loadBoard(one, NOW)), /Do a thing/);
  writeMark(one, NOW); assert.equal(readMark(one), NOW); assert.ok(fs.existsSync(path.join(own, 'buddy', 'last-looked'))); assert.match(digestText(digest(one, NOW)), /^DIGEST /);
  const x = refreshIndex(one, { force: true }); assert.equal(x.file, indexFile(one)); assert.ok(fs.existsSync(path.join(own, 'buddy', 'index.json'))); assert.equal(x.index.changes[0].id, id);
  registerWorker(one, { slice: id, role: 'dev', id: 'agent-1' }); assert.deepEqual(workers(one).map(w => w.id), ['agent-1']);
  assert.ok(!fs.existsSync(path.join(d, '.git', 'buddy')));                                                        // nothing went to the main repository's folder
});

test('two worktrees of one repository keep their own index, marks and hand-overs; the plain repository keeps .git/buddy', () => {
  const { d, one, two } = repoWithWorktrees(); const a = building(one, 'First thing'); const b = building(two, 'Second thing');
  refreshIndex(one, { force: true }); refreshIndex(two, { force: true }); refreshIndex(d, { force: true });
  assert.notEqual(real(indexFile(one)), real(indexFile(two)));
  assert.deepEqual(JSON.parse(fs.readFileSync(indexFile(one), 'utf8')).changes.map(r => r.id), [a]);
  assert.deepEqual(JSON.parse(fs.readFileSync(indexFile(two), 'utf8')).changes.map(r => r.id), [b]);
  assert.equal(indexFile(d), path.join(d, INDEX)); assert.deepEqual(JSON.parse(fs.readFileSync(path.join(d, INDEX), 'utf8')).changes, []);   // plain: as before
  writeMark(one, NOW); assert.equal(readMark(two), null); assert.equal(readMark(d), null);
  const h1 = writeHandover(one, a, NOW); const h2 = writeHandover(two, b, NOW); assert.notEqual(real(path.dirname(h1)), real(path.dirname(h2)));
  assert.equal(gitDir(d), path.join(d, '.git')); assert.equal(buddyDir(d), path.join(d, '.git', 'buddy'));
  const none = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-none-')); assert.equal(gitDir(none), null); assert.equal(isGitRepo(none), false); assert.equal(buddyDir(none), path.join(none, '.git', 'buddy'));
});
