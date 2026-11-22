// The core must behave like the M0 prototypes it consolidates. These tests run both on the same repositories and compare.
// They run only when the prototypes are present in the checkout (docs/spikes/m0/probes).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync, spawnSync } from 'node:child_process';
import { scan } from '../src/scan.mjs';
import { verifyMadr } from '../src/decide.mjs';
import { checkpoint } from '../src/checkpoint.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url)).replace(/[\\/]$/, '');
const PROBES = path.join(ROOT, 'docs/spikes/m0/probes');
const have = fs.existsSync(path.join(PROBES, 'antigaming/gaming-scan.mjs'));
// The parity tests drive the bash-era prototypes (bash stubs, cp -R, symlinks): they run on POSIX only; the core's own tests run everywhere.
const opts = { skip: process.platform === 'win32' ? 'parity tests need bash and POSIX tools' : have ? false : 'prototypes not present' };
const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), p));
const git = (cwd, c) => execSync(`git -c user.name=t -c user.email=t@t ${c}`, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const write = (d, f, t) => { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), t); };

function baseRepo() {
  const d = tmp('par-'); git(d, 'init -q -b main');
  write(d, 'validate.sh', '#!/bin/bash\necho validate ok\nexit 0\n'); write(d, 'package.json', '{"name":"x","scripts":{}}\n');
  write(d, 'src/a.ts', 'export const a = 1;\n'); write(d, 'tests/a.test.ts', "import { a } from '../src/a';\nit('a', () => { expect(a).toBe(1); expect(a).toEqual(1); });\n");
  write(d, 'tests/b.test.ts', "it('b', () => { expect(1).toBe(1); });\n");
  git(d, 'add -A'); git(d, 'commit -q -m "baseline"'); return d;
}
const copy = d => { const e = tmp('par-'); execSync(`cp -R ${d}/. ${e}/`); return e; };
function gamingChange(d) {
  fs.rmSync(path.join(d, 'tests/b.test.ts')); write(d, 'tests/a.test.ts', "it.skip('a', () => { expect(1).toBe(1); });\n"); write(d, 'package.json', '{"name":"x","scripts":{"t":"y"}}\n'); write(d, 'src/c.ts', 'export const c = 2; // eslint-disable-line\n');
}
function honestChange(d) { write(d, 'src/c.ts', 'export const c = 2;\n'); write(d, 'tests/c.test.ts', "import { c } from '../src/c';\nit('c', () => { expect(c).toBe(2); });\n"); }

// The prototype counted the lines removed from a deleted file against the file read before it (a test file showed -3 lines for -2 of its own);
// the core attributes them to the file that was deleted. Everything else is equal.
const sameScan = (mine, proto) => {
  const fix = l => l.map(x => x.replace(/ \(-\d+ lines\)$/, ''));
  // `skipped_generated` is newer than the prototype (the files that are generated are not scanned); with none generated it is empty
  const { skipped_generated, ...rest } = mine; assert.deepEqual(skipped_generated, []);
  assert.deepEqual({ ...rest, modified_existing_tests: fix(mine.modified_existing_tests) }, { ...proto, modified_existing_tests: fix(proto.modified_existing_tests) });
};
test('scan equals gaming-scan.mjs on a gaming change and on an honest one', opts, () => {
  for (const change of [gamingChange, honestChange]) {
    const d = baseRepo(); change(d); git(d, 'add -A'); git(d, 'commit -q -m change');
    const proto = JSON.parse(execSync(`node ${PROBES}/antigaming/gaming-scan.mjs ${d} HEAD~1 HEAD`, { encoding: 'utf8' }));
    sameScan(scan(d, 'HEAD~1', 'HEAD'), proto);
    write(d, 'src/d.ts', 'x\n'); git(d, 'add -A');   // staged tree against HEAD, the form the checkpoint uses
    sameScan(scan(d, 'HEAD'), JSON.parse(execSync(`node ${PROBES}/antigaming/gaming-scan.mjs ${d} HEAD`, { encoding: 'utf8' })));
  }
  assert.equal(scan(baseRepo(), 'HEAD').flagged, false);
});

// buddy decide no longer writes numbered files: the old ones are only read, and verifyMadr reads them as the prototype did.
test('verifyMadr equals buddy.mjs verify on the numbered files the prototype wrote', opts, () => {
  const a = tmp('mad-'), b = tmp('mad-'); const args = { title: 'Use a flag for archived books', 'requested-by': 'owner', context: 'ctx', options: 'a; b', outcome: 'a', reason: 'simple', consequences: 'none' };
  for (const d of [a, b]) git(d, 'init -q -b main');
  const argv = Object.entries(args).flatMap(([k, v]) => [`--${k}`, v]);
  const r = spawnSync('node', [`${PROBES}/buddycli/buddy.mjs`, 'decide', ...argv], { cwd: a, encoding: 'utf8' });
  const file = r.stdout.trim().replace(/^wrote /, ''); write(b, file, fs.readFileSync(path.join(a, file), 'utf8'));
  for (const d of [a, b]) { write(d, 'docs/decisions/0003-gap.md', '# x\n'); }
  const pv = spawnSync('node', [`${PROBES}/buddycli/buddy.mjs`, 'verify'], { cwd: a, encoding: 'utf8' });
  assert.equal(pv.status, 1); assert.deepEqual(verifyMadr({}, b).problems, pv.stderr.trim().split('\n'));
});

test('checkpoint equals buddy-v2.mjs final (same evidence, same decision text), with a stub reviewer on PATH', opts, () => {
  const bin = tmp('fakeclaude-'); const reply = JSON.stringify({ result: JSON.stringify({ does_what_was_asked: true, weakens_or_hides_checks: false, unspecified_decisions: ['one thing nobody specified'], details: 'looks fine' }), total_cost_usd: 0.001 });
  const stream = JSON.stringify({ type: 'result', ...JSON.parse(reply) });   // the prototype asks for json, the core for stream-json (R128)
  write(bin, 'claude', `#!/bin/bash\nif [[ " $* " == *" stream-json "* ]]; then cat <<'EOF'\n${stream}\nEOF\nelse cat <<'EOF'\n${reply}\nEOF\nfi\n`); fs.chmodSync(path.join(bin, 'claude'), 0o755);
  const home = tmp('home-'); fs.mkdirSync(path.join(home, 'Dev'), { recursive: true }); fs.symlinkSync(ROOT, path.join(home, 'Dev/Buddy-core'));
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: home };
  const savedPath = process.env.PATH; process.env.PATH = env.PATH;
  try {
    for (const [change, label] of [[honestChange, 'clean'], [gamingChange, 'gaming']]) {
      const a = baseRepo(); change(a); const b = copy(a);
      for (const d of [a, b]) { fs.mkdirSync(path.join(d, '.git/buddy'), { recursive: true }); write(d, '.git/buddy/request.txt', 'Add the c module with a test.'); write(d, 'notes.md', '## Assumptions made since checkpoint 0\nnone\n'); }
      const proto = spawnSync('node', [`${PROBES}/dotnet/buddy-v2.mjs`, 'final', '--run', 'par', '--notes', 'notes.md', '--human', '1'], { cwd: a, encoding: 'utf8', env });
      const mine = checkpoint({ repo: b, id: 'par', notes: fs.readFileSync(path.join(b, 'notes.md'), 'utf8'), human: true, log: path.join(home, 'log.md') });
      const ev = d => { const f = fs.readdirSync(path.join(d, '.git/buddy')).filter(x => /^evidence-.*\.json$/.test(x) && !/\.summary\.json$/.test(x)).sort().pop(); const e = JSON.parse(fs.readFileSync(path.join(d, '.git/buddy', f), 'utf8')); delete e.when; return e; };
      // `base` (what the checkpoint measured against) is newer than the prototype: it must be there, and every other field must still equal the prototype's.
      const mineEv = ev(b); assert.equal(mineEv.base, 'HEAD', label); delete mineEv.base;
      assert.deepEqual(Object.keys(mineEv.review_input).sort(), ['diff_chars', 'not_reviewed', 'not_shown', 'opened_by_the_reviewer', 'reviewer_opened', 'shown_chars'], label); delete mineEv.review_input; delete mineEv.review.opened;   // newer than the prototype: what the reviewer was given
      assert.match(mineEv.handover.reviewer.path, /^\.git\/buddy\/handover\/run-review-.*-par\.md$/, label); delete mineEv.handover;   // newer: the reviewer's hand-over file (R134)
      // newer than the prototype: the reviewer is asked with a green validate even when the scan has flags, and judges each flag (R216); the rounds are counted.
      // The prototype never asked the reviewer about a flag, so the program's added question to the reviewer (and what it says of a flag the stub did not judge) is the one difference.
      let mineText = mine.text.trim();
      if (label === 'gaming') {
        const unjudged = ' (the reviewer did not say whether it is justified)';
        assert.ok(!mineEv.review.not_run, 'the reviewer runs when only the scan is red (R216)');
        assert.ok(mineEv.reasons.pop().startsWith('the reviewer did not say whether editing')); const bare = r => r.split(unjudged).join('').replace(/^(skip\/ignore\/disable markers added): .*$/, '$1'); mineEv.reasons = mineEv.reasons.map(bare); delete mineEv.round;
        mineText = mineText.split('\n').filter(l => !l.startsWith('# - the reviewer did not say whether editing') && !l.startsWith('- the reviewer did not say whether editing')).map(l => bare(l.replace(/^- (?=skip)/, '')).replace(/^(?=skip\/)/, l.startsWith('- ') ? '- ' : '')).join('\n');
        mineEv.review = ev(a).review;
        mineText = mineText.replace(/DECISIONS NOBODY SPECIFIED[^\n]*\n[^\n]*\n/, m => m.replace(/\n- none\n/, '\n- one thing nobody specified\n'));
      } else delete mineEv.round;
      const protoEv = ev(a);
      // fields the core added after the prototype (the checks line, the code fingerprint, which tests ran, the scan's skipped generated files): the core has them, the prototype never will
      const NEWER = ['checks', 'code_hash', 'tests', 'environment']; for (const k of Object.keys(mineEv)) if (!(k in protoEv)) { assert.ok(NEWER.includes(k), `new field ${k} in the evidence: say here that it is newer than the prototype`); delete mineEv[k]; }
      assert.deepEqual(mineEv.scan.skipped_generated, []); delete mineEv.scan.skipped_generated; for (const e of [mineEv, protoEv]) e.scan.modified_existing_tests = e.scan.modified_existing_tests.map(x => x.replace(/ \(-\d+ lines\)$/, ''));   // see sameScan
      assert.deepEqual(mineEv, protoEv, label);
      // the one wording that is newer than the prototype: the diff line now says what it was measured from
      // and the sentence about committing: the prototype said to commit only after approval, which was wrong (R88)
      mineText = mineText.replace('ask for their decision. The work is committed by Dev when the slice closes, not after approval: what the owner decides is to accept it, have a finding fixed, or send it back.', 'ask for their decision, and commit only after they approve.');
      // and the guidance on the decisions nobody specified: the costly ones are now findings, the rest go to the accept card (R136)
      mineText = mineText.replace('the costly ones are findings above: bring them to the human in business language; the accept card shows the rest for the human to confirm; raise one to costly with buddy slice decision <slice> <n> costly; lowering one to cheap is for the owner, with --by owner):', 'translate them into business language, ask the human only about the costly ones and record the rest as assumed defaults to be reviewed):');
      // and the line that says which checks passed, newer than the prototype
      mineText = mineText.split('\n').filter(l => !/^checks: /.test(l)).join('\n');
      const noCount = t => t.replace(/\(-\d+ lines\)/g, '(- lines)');   // see sameScan
      assert.equal(noCount(mineText.replace('diff from HEAD:', 'diff:')), noCount(proto.stdout.trim()), label);
      assert.equal(mine.decision, label === 'clean' ? 'APPROVE' : 'NEEDS_HUMAN');
    }
  } finally { process.env.PATH = savedPath; }
});
