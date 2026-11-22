import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from '../src/frontmatter.mjs';

const CORE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const skill = fs.readFileSync(path.join(CORE, 'skills', 'vibe', 'SKILL.md'), 'utf8');
const buddy = fs.readFileSync(path.join(CORE, 'agents', 'buddy.md'), 'utf8');

test('the vibe playbook is a skill of the plugin that says when to load it, keeps the standards and the commit check, and settles', () => {
  const d = parseDocument(skill); assert.equal(d.data.name, 'vibe'); assert.match(d.data.description, /fix a bug or adjust a screen fast/);
  for (const must of ['docs/context.md', 'must', 'buddy settle', 'commit check', 'Do not skip, silence or delete a check', 'no `Slice:` trailer', 'do not ask permission']) assert.ok(skill.toLowerCase().includes(must.toLowerCase()), must);
  assert.match(skill, /this is turning into a feature/i); assert.match(skill, /in a separate `test:` commit/);
});
test('Buddy tells a feature from a planned fix from a small correction, and a small correction opens no change', () => {
  const sec = buddy.slice(buddy.indexOf('## What the owner asks'), buddy.indexOf('## Milestones'));
  for (const must of ['A new feature', 'A planned fix', 'A small correction', 'no change at all', '`vibe` skill', 'buddy settle', 'inside that change']) assert.ok(sec.includes(must), must);
  assert.match(sec, /never make them pick from a menu/);
});
