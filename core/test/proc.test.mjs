import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { git, runValidate } from '../src/proc.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'proc-'));
const G = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf8', stdio: 'pipe' });

test('git() takes an argument array, so pathspec exclusions work without a shell', () => {
  const d = tmp(); G(d, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(d, 'a.txt'), 'one\n'); fs.writeFileSync(path.join(d, 'package-lock.json'), '{}\n');
  G(d, 'add', '-A'); G(d, 'commit', '-qm', 'base');
  fs.writeFileSync(path.join(d, 'a.txt'), 'two\n'); fs.writeFileSync(path.join(d, 'package-lock.json'), '{"x":1}\n');
  const out = git(['diff', '--', '.', ':!package-lock.json'], d);
  assert.match(out, /a\.txt/); assert.doesNotMatch(out, /package-lock/);
});
test('git() returns an empty string on failure, and drops empty arguments', () => {
  const d = tmp();
  assert.equal(git(['log'], d), '');
  G(d, 'init', '-q', '-b', 'main'); assert.equal(git(['status', '--short', ''], d), '');
});
test('runValidate: the npm validate script alone (the path used where there is no bash)', () => {
  const d = tmp(); fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: 'x', scripts: { validate: 'node -e "console.log(\'ok\')"' } }));
  const r = runValidate(d); assert.equal(r.status, 0); assert.match(r.stdout, /ok/);
  fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: 'x', scripts: { validate: 'node -e "process.exit(3)"' } }));
  // A failure must read as a failure; the exact code is the npm script-shell's business (PowerShell turns a 3 into a 1).
  assert.notEqual(runValidate(d).status, 0);
});
test('runValidate: nothing to run is reported, not guessed', () => {
  const r = runValidate(tmp()); assert.equal(r.status, 127); assert.match(r.stderr, /no validate/);
});
test('runValidate: validate.sh is used where bash exists', { skip: process.platform === 'win32' && 'POSIX only' }, () => {
  const d = tmp(); fs.writeFileSync(path.join(d, 'validate.sh'), '#!/bin/bash\necho from-sh\nexit 0\n');
  const r = runValidate(d); assert.equal(r.status, 0); assert.match(r.stdout, /from-sh/);
});
