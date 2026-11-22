import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execSync } from 'node:child_process';

const BUDDY = fileURLToPath(new URL('../bin/buddy.mjs', import.meta.url));
const VERSION = JSON.parse(fs.readFileSync(new URL('../.claude-plugin/plugin.json', import.meta.url), 'utf8')).version;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fb-'));
// A private home for each test, so the per-user config never touches the real one.
const run = (args, cwd, home, extra = {}) => {
  const env = { ...process.env, HOME: home, USERPROFILE: home, ...extra }; delete env.BUDDY_FACTORY; Object.assign(env, extra);
  return spawnSync('node', [BUDDY, ...args], { encoding: 'utf8', cwd, env });
};
const project = () => { const d = path.join(tmp(), 'acme-shop'); fs.mkdirSync(d); execSync('git init -q', { cwd: d }); fs.mkdirSync(path.join(d, 'src')); return d; };

test('without a factory, feedback refuses and says how to set it; nothing is written', () => {
  const home = tmp(); const p = project();
  const r = run(['feedback', 'it broke'], p, home); assert.equal(r.status, 1);
  assert.match(r.stderr, /buddy feedback --factory <path>/); assert.match(r.stderr, /BUDDY_FACTORY/);
  assert.deepEqual(fs.readdirSync(p).sort(), ['.git', 'src']);
});
test('--factory is remembered per user; a line goes to the factory field log with date, project and version, nothing into the project', () => {
  const home = tmp(); const factory = tmp(); const p = project();
  const set = run(['feedback', '--factory', factory], p, home); assert.equal(set.status, 0, set.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(home, '.buddy/config.json'), 'utf8')).factory, path.resolve(factory));
  const r = run(['feedback', 'init asked twice | odd'], path.join(p, 'src'), home); assert.equal(r.status, 0, r.stderr);
  const log = fs.readFileSync(path.join(factory, 'docs/field-log.md'), 'utf8');
  assert.match(log, /^# Field log/); assert.match(log, /\| Date \| Project \| Buddy \| What happened \|/);
  assert.match(log, new RegExp(`\\n\\| \\d{4}-\\d{2}-\\d{2} \\| acme-shop \\| ${VERSION.replace(/\./g, '\\.')} \\| init asked twice \\\\\\| odd \\|\\n$`));
  run(['feedback', 'second'], p, home);
  assert.equal(fs.readFileSync(path.join(factory, 'docs/field-log.md'), 'utf8').match(/^\| \d{4}/gm).length, 2);
  assert.deepEqual(fs.readdirSync(p).sort(), ['.git', 'src']); assert.deepEqual(fs.readdirSync(path.join(p, 'src')), []);
});
test('BUDDY_FACTORY wins over the config; empty text and a missing factory folder are refused', () => {
  const home = tmp(); const configured = tmp(); const env = tmp(); const p = project();
  run(['feedback', '--factory', configured], p, home);
  const r = run(['feedback', 'from env'], p, home, { BUDDY_FACTORY: env }); assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(env, 'docs/field-log.md'))); assert.ok(!fs.existsSync(path.join(configured, 'docs/field-log.md')));
  assert.equal(run(['feedback', '   '], p, home).status, 1);
  assert.equal(run(['feedback', '--factory', path.join(home, 'nope')], p, home).status, 1);
  const gone = run(['feedback', 'x'], p, home, { BUDDY_FACTORY: path.join(home, 'nope') }); assert.equal(gone.status, 1); assert.match(gone.stderr, /does not exist/);
});
