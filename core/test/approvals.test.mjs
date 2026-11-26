// Every approval of the owner is committed as soon as it is recorded, and only the files it wrote (R281, commit-owner-approvals).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';
import { commitApproval } from '../src/proc.mjs';

const BUDDY = fileURLToPath(new URL('../bin/buddy.mjs', import.meta.url));
const buddy = (args, cwd) => spawnSync(process.execPath, [BUDDY, ...args], { encoding: 'utf8', cwd });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'approvals-'));
const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8' });
const write = (d, f, t) => { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), t); };
function repo() {
  const d = tmp(); git(['init', '-q'], d); git(['config', 'user.email', 't@example.com'], d); git(['config', 'user.name', 'T'], d); git(['config', 'core.hooksPath', '.nohooks'], d);
  for (const f of ['approved.md', 'dev-unstaged.js', 'dev-staged.js']) write(d, f, 'v1\n');
  git(['add', '.'], d); git(['commit', '-qm', 'chore: start'], d);
  write(d, 'dev-unstaged.js', 'dev work\n'); write(d, 'dev-staged.js', 'dev staged\n'); git(['add', 'dev-staged.js'], d); write(d, 'dev-new.js', 'new\n');   // Dev's work in progress
  return d;
}
const devUntouched = d => assert.equal(git(['status', '--porcelain'], d).split('\n').filter(l => /dev-/.test(l)).join('|'), 'M  dev-staged.js| M dev-unstaged.js|?? dev-new.js');

test('the helper commits only the files the approval wrote, a new one included; Dev\'s unstaged, staged and new files stay as they were', () => {
  const d = repo(); write(d, 'approved.md', 'approved\n'); write(d, 'docs/new-record.md', 'new\n');
  const r = commitApproval(d, ['approved.md', path.join(d, 'docs/new-record.md')], 'acceptance of save-books');
  assert.equal(r.committed, true); assert.deepEqual(r.files, ['approved.md', 'docs/new-record.md']);
  assert.equal(git(['log', '-1', '--format=%s'], d).trim(), "chore: record the owner's acceptance of save-books");
  assert.deepEqual(git(['show', '--name-only', '--format=', 'HEAD'], d).trim().split('\n'), ['approved.md', 'docs/new-record.md']);
  devUntouched(d); assert.equal(git(['diff', '--cached', '--', 'dev-staged.js'], d).includes('+dev staged'), true);
  assert.equal(commitApproval(d, ['approved.md'], 'again').nothing, true);   // nothing written since: no empty commit
});

test('outside a git repository the approval stays written and the helper says so, naming the files', () => {
  const d = tmp(); write(d, 'approved.md', 'approved\n');
  const r = commitApproval(d, ['approved.md'], 'acceptance of x');
  assert.equal(r.committed, false); assert.match(r.why, /not a git repository/); assert.deepEqual(r.files, ['approved.md']);
  assert.equal(fs.readFileSync(path.join(d, 'approved.md'), 'utf8'), 'approved\n');
});

test('a hook that refuses the commit leaves the approval written, nothing committed or left staged, and Dev\'s work as it was', () => {
  const d = repo(); write(d, '.nohooks/pre-commit', '#!/bin/sh\necho "the hook says no" >&2\nexit 1\n'); fs.chmodSync(path.join(d, '.nohooks/pre-commit'), 0o755);
  write(d, 'approved.md', 'approved\n'); write(d, 'docs/new-record.md', 'new\n'); const head = git(['rev-parse', 'HEAD'], d);
  const r = commitApproval(d, ['approved.md', 'docs/new-record.md'], 'acceptance of x');
  assert.equal(r.committed, false); assert.match(r.why, /the hook says no/); assert.deepEqual(r.files, ['approved.md', 'docs/new-record.md']);
  assert.equal(git(['rev-parse', 'HEAD'], d), head); assert.equal(fs.readFileSync(path.join(d, 'approved.md'), 'utf8'), 'approved\n');
  const st = git(['status', '--porcelain'], d); assert.match(st, /^ M approved\.md$/m); assert.match(st, /^\?\? docs\/$/m); devUntouched(d);
});

test('buddy commits the owner\'s approvals as each command records it, and says so; outside a repository it says the approval is not committed', () => {
  const d = repo(); const goal = ['--ac', 'A list is shown', '--exclude', 'Nothing beyond the criteria above'];
  assert.equal(buddy(['milestone', 'start', 'First release', '--request', 'Save books', '--name', 'mvp', ...goal], d).status, 0);
  const s = buddy(['start', 'Save books', '--request', 'Save books', '--name', 'save-books', '--milestone', 'mvp', ...goal], d); assert.equal(s.status, 0, s.stderr);
  assert.equal(buddy(['assume', 'save-books', 'Books are kept on this device', '--if-otherwise', 'they would be lost'], d).status, 0);
  const before = git(['rev-list', '--count', 'HEAD'], d);
  const c = buddy(['assume', 'save-books', 'confirm', 'A1', '--by', 'owner'], d); assert.equal(c.status, 0, c.stderr);
  assert.match(c.stderr, /committed the owner's approval \([0-9a-f]+\): docs\/buddy\/milestones\/.*save-books\/change\.md/);
  assert.equal(git(['log', '-1', '--format=%s'], d).trim(), "chore: record the owner's confirmation of A1 of save-books");
  assert.equal(Number(git(['rev-list', '--count', 'HEAD'], d)), Number(before) + 1); devUntouched(d);
  assert.match(git(['status', '--porcelain'], d), /\?\? docs\//);   // the milestone's own record, written by Buddy and not an approval, is not committed with it
  const g = buddy(['milestone', 'goal', 'mvp', 'Save and list books', '--by', 'owner'], d); assert.equal(g.status, 0, g.stderr);
  assert.equal(git(['log', '-1', '--format=%s'], d).trim(), "chore: record the owner's new goal of the milestone mvp");
  assert.deepEqual(git(['show', '--name-only', '--format=', 'HEAD'], d).trim().split('\n').map(f => path.basename(f)), ['milestone.md']);
  assert.equal(buddy(['step', 'add', 'save-books', 'Storage'], d).stderr, '');   // a record that is no approval is not committed
  assert.equal(buddy(['move', 'mvp', 'ready'], d).stderr, '');
  const go = buddy(['move', 'mvp', 'building'], d); assert.equal(go.status, 0, go.stderr); assert.match(go.stderr, /committed the owner's approval/);
  assert.equal(git(['log', '-1', '--format=%s'], d).trim(), "chore: record the owner's go-ahead for the milestone mvp and its plan"); devUntouched(d);
  fs.rmSync(path.join(d, '.git'), { recursive: true, force: true });
  const n = buddy(['milestone', 'goal', 'mvp', 'Save, list and sort books', '--by', 'owner'], d); assert.equal(n.status, 0, n.stderr);
  assert.match(n.stderr, /the owner's approval is recorded but not committed \(this folder is not a git repository\): commit only docs\/buddy\/milestones\/.*milestone\.md, or tell the owner/);
  assert.match(fs.readFileSync(path.join(d, 'docs/buddy/milestones', fs.readdirSync(path.join(d, 'docs/buddy/milestones'))[0], 'milestone.md'), 'utf8'), /Save, list and sort books/);
});

test('confirming a line of the context is committed at once', () => {
  const d = repo(); write(d, 'docs/context.md', '---\nschema: buddy/context@0\ntitle: T\n---\n# Context\n\n## Purpose\n- Keep the books `assumed`\n'); git(['add', 'docs/context.md'], d); git(['commit', '-qm', 'docs: context', '--', 'docs/context.md'], d);
  const r = buddy(['context', 'confirm', 'docs/context.md', '--line', '4'], d); assert.equal(r.status, 0, r.stderr);
  assert.match(git(['log', '-1', '--format=%s'], d), /^chore: record the owner's confirmation of line\(s\) 4 of docs\/context\.md/);
  assert.match(fs.readFileSync(path.join(d, 'docs/context.md'), 'utf8'), /Keep the books `human \d{4}-\d{2}-\d{2}`/); devUntouched(d);
});

test('settle leaves an approval\'s commit out: the owner gave it, there is nothing for him to look at', async () => {
  const { freeCommits } = await import('../src/settle.mjs');
  const d = repo(); const base = git(['rev-parse', 'HEAD'], d).trim(); write(d, 'docs/context.md', 'confirmed\n');
  assert.equal(commitApproval(d, ['docs/context.md'], 'confirmation of line(s) 4 of docs/context.md').committed, true);
  assert.deepEqual(freeCommits(d, base), []);
});

test('the go-ahead for a milestone commits its whole plan: its record, its changes, their questions and the map of what was asked; answering a question is committed at once', async () => {
  const { loadBatchFile } = await import('../src/queue.mjs');
  const d = repo(); const goal = ['--ac', 'A list is shown', '--exclude', 'Nothing beyond the criteria above'];
  for (const a of [['milestone', 'start', 'First release', '--request', 'Save books', '--name', 'mvp', ...goal], ['start', 'Save books', '--request', 'Save books', '--name', 'save-books', '--milestone', 'mvp', ...goal],
    ['requests', 'add', 'Save books', '--source', 'the brief']]) { const r = buddy(a, d); assert.equal(r.status, 0, r.stderr); }
  assert.equal(buddy(['requests', 'set', 'RQ1', '--to', 'save-books'], d).status, 0);
  write(d, 'spec.json', JSON.stringify({ questions: [{ situation: 'Currency?', options: [{ label: 'EUR', cost: 'none' }, { label: 'USD', cost: 'none' }] }] }));
  const n = buddy(['queue', 'new', '--in', 'spec.json', '--slice', 'save-books'], d); assert.equal(n.status, 0, n.stderr);
  const batch = path.relative(d, fs.readdirSync(path.join(d, 'docs/buddy/milestones'), { recursive: true }).map(f => path.join(d, 'docs/buddy/milestones', f)).find(f => /questions-1\.md$/.test(f)));
  const q = loadBatchFile(path.join(d, batch)).questions[0].id;
  const a = buddy(['queue', 'answer', batch, '--q', q, '--text', 'Euros only'], d); assert.equal(a.status, 0, a.stderr);
  assert.equal(git(['log', '-1', '--format=%s'], d).trim(), `chore: record the owner's answer to ${q}`);
  assert.deepEqual(git(['show', '--name-only', '--format=', 'HEAD'], d).trim().split('\n'), [batch]); devUntouched(d);
  assert.equal(buddy(['move', 'mvp', 'ready'], d).status, 0);
  const go = buddy(['move', 'mvp', 'building'], d); assert.equal(go.status, 0, go.stderr);
  assert.equal(git(['log', '-1', '--format=%s'], d).trim(), "chore: record the owner's go-ahead for the milestone mvp and its plan");
  const files = git(['show', '--name-only', '--format=', 'HEAD'], d).trim().split('\n').sort();
  assert.deepEqual(files.map(f => f.replace(/^docs\/buddy\/milestones\/[^/]+\//, '')).sort(), ['changes/' + fs.readdirSync(path.join(d, path.dirname(batch), '..'))[0] + '/change.md', 'milestone.md', 'docs/buddy/requests.md'].sort());
  assert.ok(!files.includes(batch));   // answered and committed already: nothing left of it to commit
  assert.deepEqual(git(['status', '--porcelain', '--', 'docs'], d), ''); devUntouched(d);   // no part of the plan is left uncommitted, and Dev's work is not in it
});
