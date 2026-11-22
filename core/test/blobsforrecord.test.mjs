import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { blobsOf, blobsAsOwned, blobsForRecord } from '../src/evidence.mjs';

// R144 and the owner's decision of 2026-11-07: what the checkpoint records is what acceptance will compare, so a re-check after another change
// edited the same file does not disagree with its own acceptance.
function repoWith() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bfr-')); const sh = c => execSync(c, { cwd: d, encoding: 'utf8' }).trim();
  sh('git init -q && git config user.email a@b.c && git config user.name t');
  fs.writeFileSync(path.join(d, 'f.js'), 'one\n'); sh('git add f.js && git commit -qm "feat: first\n\nSlice: mine"');
  const mine = sh('git rev-parse HEAD'); const blobMine = sh('git rev-parse HEAD:f.js');
  fs.writeFileSync(path.join(d, 'f.js'), 'two\n'); sh('git add f.js && git commit -qm "feat: other work\n\nSlice: theirs"');
  return { d, sh, mine, blobMine, blobTheirs: sh('git rev-parse HEAD:f.js') };
}
const env = d => ({ ...process.env });

test('a committed file is recorded as of the slice\'s own last commit, not as another change left it', () => {
  const { d, mine, blobMine, blobTheirs } = repoWith();
  assert.equal(blobsOf(d, ['f.js'], env(d))['f.js'], blobTheirs, 'the working tree has the later work');
  assert.equal(blobsForRecord(d, ['f.js'], env(d), ['mine'], [mine])['f.js'], blobMine);
  assert.equal(blobsForRecord(d, ['f.js'], env(d), ['mine'], [mine])['f.js'], blobsAsOwned(d, ['f.js'], ['mine'], [mine])['f.js'], 'the same blob acceptance reads');
});

test('a file with work not yet committed is recorded as it is', () => {
  const { d, blobMine } = repoWith();
  fs.writeFileSync(path.join(d, 'f.js'), 'three\n'); execSync('git add f.js', { cwd: d });
  const rec = blobsForRecord(d, ['f.js'], env(d), ['mine'], [])['f.js'];
  assert.ok(rec && rec !== blobMine); assert.equal(rec, execSync('git rev-parse :f.js', { cwd: d, encoding: 'utf8' }).trim());
});

test('a file no commit of the slice touched is recorded as it is', () => {
  const { d, blobTheirs } = repoWith();
  assert.equal(blobsForRecord(d, ['f.js'], env(d), ['nobody'], [])['f.js'], blobTheirs);
});
