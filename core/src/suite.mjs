// `buddy suite`: runs the project's full test suite (`validate:full`, falling back to `validate`) — or with `--deep`, `validate:deep` —
// once on the code as it is and keeps the result as evidence in .buddy/, where milestone acceptance and every change acceptance find it.
// No reviewer, no scan: the suite alone (R173, R200, R239).
import path from 'node:path';
import { runValidate, hasNpmScript } from './proc.mjs';
import { ensureBuddyDir } from './gitdir.mjs';
import { codeHash, currentEnvironment, writeEvidence, FULL_TESTS, DEEP_TESTS } from './evidence.mjs';

export function runSuite({ repo = process.cwd(), now = () => new Date(), validate = runValidate, timeoutSec, deep = false } = {}) {
  const level = deep ? DEEP_TESTS : FULL_TESTS;
  if (deep && validate === runValidate && !hasNpmScript(repo, 'validate:deep')) {
    throw new Error('no validate:deep script in package.json: add a "validate:deep" script to package.json to run deep checks');
  }
  const v = validate(repo, { timeoutSec, level });
  if (deep && v.missing) throw new Error(v.stderr || 'no validate:deep script in package.json');
  const tail = ((v.stdout || '') + (v.stderr || '')).split('\n').slice(-12).join('\n');
  const when = now().toISOString();
  const dir = ensureBuddyDir(repo);
  const file = path.join(dir, `evidence-${when.slice(0, 19).replace(/:/g, '')}Z-${deep ? 'deep' : 'suite'}.json`);
  const passed = v.status === 0;
  const label = deep ? 'The deep suite' : 'The whole suite';
  const e = { when, decision: 'SUITE', environment: currentEnvironment(), code_hash: codeHash(repo), validate_exit: v.status, validate_tail: tail, tests: level, reasons: passed ? [] : [v.timedOut ? 'validate was stopped: it did not finish in time' : 'validate failed'], checks: { validate: v.missing ? 'not run' : passed ? 'passed' : 'failed' } };
  writeEvidence(file, e);
  return { passed, file, evidence: e, text: passed ? `${label} passes on the code as it is (${when.slice(0, 16).replace('T', ' ')} UTC). Every acceptance can use it for 2 days with the same tools.` : `${deep ? 'The deep suite' : 'The suite'} FAILS on the code as it is (exit ${v.status}).\n${tail}` };
}
