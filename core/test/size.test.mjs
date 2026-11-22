import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Buddy stays small (the owner's purpose, and R178 froze its growth on 2026-11-05): ceremony and machinery must earn their place, and growing into a framework is a design failure.
// This is not a measure of quality, it is a speed bump: past a budget the test fails and says so. To raise a number the owner decides it and the decision is recorded in the log;
// the agent building Buddy does not raise it on its own. The numbers were the state on 2026-11-05 plus a little room for fixes.
const CORE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUDGET = { lines: 7000, modules: 48, commands: 26 };   // lines raised from 6000 for 0.4.0 by the owner (R188)
const src = fs.readdirSync(path.join(CORE, 'src')).filter(f => f.endsWith('.mjs'));
const lines = src.reduce((n, f) => n + fs.readFileSync(path.join(CORE, 'src', f), 'utf8').split('\n').length, 0);
const commands = (/const COMMANDS = \{([\s\S]*?)\n\};/.exec(fs.readFileSync(path.join(CORE, 'bin', 'buddy.mjs'), 'utf8')) || [, ''])[1].split('\n').filter(l => /^  [a-z-]+: /.test(l)).length;
const WHY = 'Buddy grows past his budget only if the owner decides it (R185, R188). Record the decision in docs/requirements-log.md, then raise the number here.';

test('Buddy stays within its size budget: lines of source, modules and commands', () => {
  assert.ok(lines <= BUDGET.lines, `core/src has ${lines} lines; the budget is ${BUDGET.lines}. ${WHY}`);
  assert.ok(src.length <= BUDGET.modules, `core/src has ${src.length} modules; the budget is ${BUDGET.modules}. ${WHY}`);
  assert.ok(commands <= BUDGET.commands, `buddy has ${commands} commands; the budget is ${BUDGET.commands}. ${WHY}`);
  assert.ok(commands >= 20 && src.length >= 40, 'the counts themselves are being read right');
});
