import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { checkpoint } from '../src/checkpoint.mjs';
import { howtoSet, startSlice, moveSlice, stepAddTo, stepSetIn, readSlice } from '../src/slicestore.mjs';

export const EXAMPLES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'design', 'examples');
export const WORKSHOP = { skip: fs.existsSync(EXAMPLES) ? false : 'the design examples (docs/design/examples) are a workshop fixture, not in the public copy' };
export const G = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf8', stdio: 'pipe' });
export const clean = () => ({ does_what_was_asked: true, weakens_or_hides_checks: false, unspecified_decisions: [], details: 'fine' });

// A repository with a base commit, a validate script that passes, and a slice that is building.
export function setup({ steps = [{ text: 'Do it', done: true }], before } = {}) {
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
export const withHowto = (d, id) => { try { const s = readSlice(d, id); for (const c of s.data.criteria || []) if (!(s.data.howto || []).some(h => h.criterion === c.id)) howtoSet(d, id, c.id, { steps: 'Use it as a reader would', expect: 'It does what the criterion says' }); } catch { /* not being built: nothing to write */ } };
export const run = (d, id, extra = {}) => { if (!extra.noHowto) withHowto(d, id); return checkpoint({ repo: d, slice: id, review: clean, human: true, ...extra }); };
export const files = r => r.evidence.files.split('\n').filter(Boolean).map(l => l.split('\t')[1]).sort();
export const commitAll = (d, msg) => { G(d, 'add', '-A'); G(d, 'commit', '-qm', msg); return G(d, 'rev-parse', 'HEAD').trim(); };
export const other = d => {                                               // another change, opened and committed by the coordinator (no Slice trailer)
  const b = startSlice({ repo: d, title: 'Another thing', request: 'Do another thing', criteria: ['It works'], excludes: ['Nothing beyond the criteria above'] });
  G(d, 'add', 'docs'); G(d, 'commit', '-qm', 'chore(buddy): open another thing'); return b;
};
export const edit = (file, from, to) => { const t = fs.readFileSync(file, 'utf8'); assert.ok(t.includes(from)); fs.writeFileSync(file, t.replace(from, to)); };
export const counting = (d, exit = '') => { fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: 'x', scripts: { validate: `node -e "require('fs').appendFileSync('.git/validate-runs','x')${exit}"` } })); G(d, 'add', 'package.json'); G(d, 'commit', '-qm', 'chore: count the runs of validate'); };   // not the slice's work
export const runs = d => (fs.existsSync(path.join(d, '.git', 'validate-runs')) ? fs.readFileSync(path.join(d, '.git', 'validate-runs'), 'utf8').length : 0);
export const again = (d, id) => { moveSlice(d, id, 'rework'); moveSlice(d, id, 'building'); };
export const editedTest = d => {   // an existing test, committed before by another change, then changed by the slice with as many assertions
  fs.writeFileSync(path.join(d, 'old.test.js'), "import assert from 'node:assert';\nassert.equal(1, 1);\n"); G(d, 'add', 'old.test.js'); G(d, 'commit', '-qm', 'test: an older test');
  fs.writeFileSync(path.join(d, 'old.test.js'), "import assert from 'node:assert';\nassert.equal(2, 2);\n");
};
export const judged = (weakened, why = 'fine') => () => ({ ...clean(), edited_tests: [{ file: 'old.test.js', weakened, why }] });
