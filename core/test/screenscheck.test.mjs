import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (p) => fs.readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');

test('the milestone review draws each covered screen beside its prototype before the owner tries the changes (AC1)', () => {
  const skill = read('../skills/milestone-review/SKILL.md');
  const step = skill.split('\n').find((l) => /^4\. /.test(l));
  assert.ok(step, 'a step draws the screens beside their prototype');
  assert.match(step, /docs\/inputs\/prototype/);
  assert.match(step, /your own browser/);
  assert.match(step, /what differs/);
  assert.match(step, /no browser/);
  assert.match(step, /skips this step/);
  for (const m of ['your own browser', 'Claude in Chrome', "Antigravity's browser", 'Playwright', 'the owner approves installing']) assert.ok(step.includes(m), m);
  for (const d of ['console errors', 'text cut or overlapping', 'overflow', 'states not shown', 'broken links']) assert.ok(step.includes(d), d);
  assert.match(step, /phone and desktop/);
  assert.match(step, /to Dev to be fixed/);
  assert.match(step, /before the owner tries it/);
  assert.match(step, /never blocked/);
  assert.ok(skill.indexOf('beside their prototype') < skill.indexOf('Take their reaction'));
  assert.ok(skill.indexOf('beside their prototype') < skill.indexOf('Read it to them'));
});

test('no checkpoint of a single change starts the application or a browser (AC2)', () => {
  const src = read('../src/checkpoint.mjs');
  assert.doesNotMatch(src, /playwright|puppeteer|chromium|webdriver|selenium|npm (run )?(start|dev)\b/i);
});
