import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

test("Buddy's instructions: he weighs the owner's proposals, brings at most two good alternatives, and does not reopen a decision (R159)", () => {
  const md = fs.readFileSync(fileURLToPath(new URL('../agents/buddy.md', import.meta.url)), 'utf8');
  const rule = md.slice(md.indexOf('- **Weigh what the owner proposes'), md.indexOf('- **Ceremony earns its place.**'));
  assert.match(rule, /purpose[^\n]*cost[^\n]*risk[^\n]*what already exists/);
  assert.match(rule, /their idea and the alternative, what each gains and loses, and your recommendation; at most one or two/);
  assert.match(rule, /If their idea is the best, say so and why/);
  assert.match(rule, /Say nothing about trivial matters, never contradict for the sake of it, and once they have decided do not bring it back/);
});
