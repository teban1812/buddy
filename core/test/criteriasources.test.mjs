import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// RQ5: before a change or a milestone starts, each criterion's source is studied and a missing one is asked at the start, in every project.
const buddy = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'agents', 'buddy.md'), 'utf8');

test('Buddy studies each criterion\'s source early: the instruction is in the milestone study and in the change\'s costly questions', () => {
  const milestone = buddy.split('\n').find(l => l.includes('Before presenting it, study every change of it'));
  const change = buddy.split('\n').find(l => l.startsWith('2. **Ask** the costly questions'));
  assert.match(milestone ?? '', /for each criterion where what it asks for comes from[\s\S]*costly question/);
  assert.match(change ?? '', /source[\s\S]*unknown is one, never discovered halfway through the build/);
  assert.ok(buddy.split(/\s+/).length < 5500 && buddy.split('\n').length < 115, 'buddy.md stays under its cap');
});
