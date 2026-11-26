import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { FAST_TESTS, FULL_TESTS, DEEP_TESTS, testsCover, suiteGreen } from '../src/evidence.mjs';
import { validateCommand, runValidate } from '../src/proc.mjs';
import { runSuite } from '../src/suite.mjs';
import { checkpoint } from '../src/checkpoint.mjs';
import { startMilestone, startSlice, moveSlice, stepAddTo, stepSetIn, howtoSet } from '../src/slicestore.mjs';
import { inputs as recordInputs } from '../src/index.mjs';

const BUDDY = fileURLToPath(new URL('../bin/buddy.mjs', import.meta.url));
const G = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf8', stdio: 'pipe' });
const clean = () => ({ does_what_was_asked: true, weakens_or_hides_checks: false, unspecified_decisions: [], details: 'fine' });

function mkRepo(scripts) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'levels-'));
  G(d, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: 'x', scripts }));
  fs.mkdirSync(path.join(d, 'docs'));
  fs.writeFileSync(path.join(d, 'README.md'), 'x\n');
  G(d, 'add', '-A');
  G(d, 'commit', '-qm', 'base');
  return d;
}

test('testsCover: deep covers all, full covers full and fast, fast covers fast only, scoped covers only itself', () => {
  assert.equal(FAST_TESTS, 'fast');
  assert.equal(FULL_TESTS, 'full');
  assert.equal(DEEP_TESTS, 'deep');
  assert.equal(testsCover(DEEP_TESTS, DEEP_TESTS), true);
  assert.equal(testsCover(DEEP_TESTS, FULL_TESTS), true);
  assert.equal(testsCover(DEEP_TESTS, FAST_TESTS), true);
  assert.equal(testsCover(FULL_TESTS, DEEP_TESTS), false);
  assert.equal(testsCover(FULL_TESTS, FULL_TESTS), true);
  assert.equal(testsCover(FULL_TESTS, FAST_TESTS), true);
  assert.equal(testsCover(FAST_TESTS, DEEP_TESTS), false);
  assert.equal(testsCover(FAST_TESTS, FULL_TESTS), false);
  assert.equal(testsCover(FAST_TESTS, FAST_TESTS), true);
  assert.equal(testsCover('scoped:a', FAST_TESTS), false);
  assert.equal(testsCover('scoped:a', FULL_TESTS), false);
  assert.equal(testsCover('scoped:a', 'scoped:a'), true);
});

test('validateCommand and runValidate: fast uses validate, full uses validate:full with fallback to validate, deep uses validate:deep without fallback', () => {
  const both = mkRepo({
    validate: 'node -e "console.log(\'ran-fast\')"',
    'validate:full': 'node -e "console.log(\'ran-full\')"',
    'validate:deep': 'node -e "console.log(\'ran-deep\')"',
  });
  assert.equal(validateCommand(both, 'fast').label, 'npm run validate');
  assert.equal(validateCommand(both, 'full').label, 'npm run validate:full');
  assert.equal(validateCommand(both, 'deep').label, 'npm run validate:deep');
  assert.match(runValidate(both, { level: 'fast' }).stdout, /ran-fast/);
  assert.match(runValidate(both, { level: 'full' }).stdout, /ran-full/);
  assert.match(runValidate(both, { level: 'deep' }).stdout, /ran-deep/);

  const single = mkRepo({ validate: 'node -e "console.log(\'ran-only\')"' });
  assert.equal(validateCommand(single, 'full').label, 'npm run validate');
  assert.match(runValidate(single, { level: 'full' }).stdout, /ran-only/);
  assert.equal(validateCommand(single, 'deep'), null);
  const miss = runValidate(single, { level: 'deep' });
  assert.equal(miss.status, 127);
  assert.equal(miss.missing, true);
  assert.match(miss.stderr, /validate:deep/);
});

test('two-level project: checkpoint and change acceptance rest on fast; milestone acceptance refuses on fast and passes after buddy suite runs validate:full', () => {
  const d = mkRepo({
    validate: 'node -e "require(\'fs\').appendFileSync(\'.git/runs\', \'fast\\n\')"',
    'validate:full': 'node -e "require(\'fs\').appendFileSync(\'.git/runs\', \'full\\n\')"',
  });
  const log = () => (fs.existsSync(path.join(d, '.git/runs')) ? fs.readFileSync(path.join(d, '.git/runs'), 'utf8').trim().split('\n').filter(Boolean) : []);
  const m = startMilestone({ repo: d, title: 'Release 1', name: 'r1', request: 'Ship it', criteria: ['Done'], excludes: ['Nothing else'] });
  moveSlice(d, m.id, 'ready');
  moveSlice(d, m.id, 'building');

  const c = startSlice({ repo: d, title: 'Add feature', request: 'Add it', criteria: ['It works'], excludes: ['Nothing else'], milestone: m.id });
  stepAddTo(d, c.id, 'Build it');
  moveSlice(d, c.id, 'ready');
  moveSlice(d, c.id, 'building');
  fs.writeFileSync(path.join(d, 'feat.js'), 'export const f = 1;\n');
  fs.writeFileSync(path.join(d, 'feat.test.js'), "import assert from 'node:assert';\nassert.equal(1, 1);\n");
  stepSetIn(d, c.id, '1', true);
  howtoSet(d, c.id, 'AC1', { steps: 'Run feat', expect: 'It works' });

  const cp = checkpoint({ repo: d, slice: c.id, review: clean, human: true });
  assert.equal(cp.decision, 'APPROVE', cp.text);
  assert.equal(cp.evidence.tests, FAST_TESTS);
  assert.deepEqual(log(), ['fast']);

  // Change acceptance succeeds on fast green evidence on the same code
  assert.equal(moveSlice(d, c.id, 'accepted', { by: 'owner' }).data.status, 'accepted');

  // Milestone acceptance refuses because only fast ran, not full
  moveSlice(d, m.id, 'delivered');
  assert.throws(
    () => moveSlice(d, m.id, 'accepted', { by: 'owner' }),
    /the whole test suite has not passed on the code as it is now.*buddy suite/
  );

  // buddy suite runs validate:full and records full evidence; milestone acceptance then passes
  const suite = runSuite({ repo: d });
  assert.equal(suite.passed, true);
  assert.equal(suite.evidence.tests, FULL_TESTS);
  assert.deepEqual(log(), ['fast', 'full']);
  assert.equal(suiteGreen(d, recordInputs(d).evidence, { need: FULL_TESTS }).ok, true);
  assert.equal(moveSlice(d, m.id, 'accepted', { by: 'owner' }).data.status, 'accepted');

  // A later checkpoint on the same code reuses the full green from buddy suite without re-running validate
  const c2 = startSlice({ repo: d, title: 'Docs only', request: 'Add docs', criteria: ['Docs exist'], excludes: ['Nothing else'] });
  stepAddTo(d, c2.id, 'Write docs');
  moveSlice(d, c2.id, 'ready');
  moveSlice(d, c2.id, 'building');
  stepSetIn(d, c2.id, '1', true);
  howtoSet(d, c2.id, 'AC1', { steps: 'Read docs', expect: 'Docs exist' });
  const cp2 = checkpoint({ repo: d, slice: c2.id, review: clean, human: true, id: 'c2' });
  assert.ok(cp2.evidence.validate_reused, 'full green from buddy suite is reused by a checkpoint needing fast');
  assert.equal(cp2.evidence.tests, FULL_TESTS);
  assert.deepEqual(log(), ['fast', 'full']);
});

test('single-level project (no validate:full): checkpoint records full and milestone acceptance passes on it without re-running', () => {
  const d = mkRepo({ validate: 'node -e "0"' });
  const m = startMilestone({ repo: d, title: 'Release 1', name: 'r1', request: 'Ship it', criteria: ['Done'], excludes: ['Nothing else'] });
  moveSlice(d, m.id, 'ready');
  moveSlice(d, m.id, 'building');
  const c = startSlice({ repo: d, title: 'Add feature', request: 'Add it', criteria: ['It works'], excludes: ['Nothing else'], milestone: m.id });
  stepAddTo(d, c.id, 'Build it');
  moveSlice(d, c.id, 'ready');
  moveSlice(d, c.id, 'building');
  fs.writeFileSync(path.join(d, 'feat.js'), 'export const f = 1;\n');
  fs.writeFileSync(path.join(d, 'feat.test.js'), "import assert from 'node:assert';\nassert.equal(1, 1);\n");
  stepSetIn(d, c.id, '1', true);
  howtoSet(d, c.id, 'AC1', { steps: 'Run feat', expect: 'It works' });

  const cp = checkpoint({ repo: d, slice: c.id, review: clean, human: true });
  assert.equal(cp.evidence.tests, FULL_TESTS);
  moveSlice(d, c.id, 'accepted', { by: 'owner' });
  moveSlice(d, m.id, 'delivered');
  assert.equal(moveSlice(d, m.id, 'accepted', { by: 'owner' }).data.status, 'accepted');
});

test('buddy suite --deep: refuses cleanly without validate:deep, runs validate:deep when present and covers full and fast', () => {
  const noDeep = mkRepo({ validate: 'node -e "0"' });
  assert.throws(() => runSuite({ repo: noDeep, deep: true }), /validate:deep/);
  const cliFail = spawnSync(process.execPath, [BUDDY, 'suite', '--deep', '--repo', noDeep], { encoding: 'utf8' });
  assert.equal(cliFail.status, 1);
  assert.match(cliFail.stderr, /refused:.*validate:deep/);

  const withDeep = mkRepo({
    validate: 'node -e "console.log(\'fast\')"',
    'validate:full': 'node -e "console.log(\'full\')"',
    'validate:deep': 'node -e "console.log(\'deep-ok\')"',
  });
  const cliOk = spawnSync(process.execPath, [BUDDY, 'suite', '--deep', '--repo', withDeep], { encoding: 'utf8' });
  assert.equal(cliOk.status, 0, cliOk.stderr);
  assert.match(cliOk.stdout, /The deep suite passes on the code as it is/);
  const evFiles = recordInputs(withDeep).evidence;
  assert.equal(suiteGreen(withDeep, evFiles, { need: DEEP_TESTS }).ok, true);
  assert.equal(suiteGreen(withDeep, evFiles, { need: FULL_TESTS }).ok, true);
  assert.equal(suiteGreen(withDeep, evFiles, { need: FAST_TESTS }).ok, true);
});
