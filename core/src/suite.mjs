// `buddy suite`: runs the project's whole test suite once on the code as it is and keeps the result as evidence in .git/buddy/, where every acceptance finds it
// (acceptance asks for a green suite on the current code, so a change elsewhere cannot have broken what was checked). No reviewer, no scan: the suite alone.
import fs from 'node:fs';
import path from 'node:path';
import { git, runValidate } from './proc.mjs';
import { codeHash, currentEnvironment, writeEvidence, FULL_TESTS } from './evidence.mjs';

export function runSuite({ repo = process.cwd(), now = () => new Date(), validate = runValidate, timeoutSec } = {}) {
  const v = validate(repo, { timeoutSec });
  const tail = ((v.stdout || '') + (v.stderr || '')).split('\n').slice(-12).join('\n');
  const when = now().toISOString();
  const dir = path.join(git(['rev-parse', '--path-format=absolute', '--git-dir'], repo).trim() || path.join(repo, '.git'), 'buddy'); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `evidence-${when.slice(0, 19).replace(/:/g, '')}Z-suite.json`);
  const passed = v.status === 0;
  const e = { when, decision: 'SUITE', environment: currentEnvironment(), code_hash: codeHash(repo), validate_exit: v.status, validate_tail: tail, tests: FULL_TESTS, reasons: passed ? [] : [v.timedOut ? 'validate was stopped: it did not finish in time' : 'validate failed'], checks: { validate: v.missing ? 'not run' : passed ? 'passed' : 'failed' } };
  writeEvidence(file, e);
  return { passed, file, evidence: e, text: passed ? `The whole suite passes on the code as it is (${when.slice(0, 16).replace('T', ' ')} UTC). Every acceptance can use it for 2 days with the same tools.` : `The suite FAILS on the code as it is (exit ${v.status}).\n${tail}` };
}
