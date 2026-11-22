import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execSync } from 'node:child_process';
import { decideV0 } from '../src/decide.mjs';
import { verify } from '../src/verify.mjs';

const BUDDY = fileURLToPath(new URL('../bin/buddy.mjs', import.meta.url));
const run = (args, cwd) => spawnSync('node', [BUDDY, ...args], { encoding: 'utf8', cwd });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cli-'));

test('buddy help lists every command and exits 0; an unknown command exits 2', () => {
  const h = run(['help']); assert.equal(h.status, 0);
  for (const c of ['context', 'queue', 'scope', 'scan', 'decide', 'verify', 'checkpoint', 'view']) assert.match(h.stdout, new RegExp(`\\n  ${c} `));
  assert.equal(run(['nope']).status, 2);
});
const EXAMPLES = fileURLToPath(new URL('../../docs/design/examples', import.meta.url));
test('buddy verify forwards the exit code', () => {
  if (fs.existsSync(EXAMPLES)) { const ok = run(['verify', EXAMPLES]); assert.equal(ok.status, 0); assert.match(ok.stdout, /0 problem/); }   // the clean case needs the workshop's examples
  const d = tmp(); fs.writeFileSync(path.join(d, 'x.md'), '---\nschema: buddy/slice@1\nid: Bad_Id\n---\n');
  const bad = run(['verify', d]); assert.equal(bad.status, 1); assert.match(bad.stderr, /does not match/);
});
test('decide writes an ADR in MADR 4 that the verifier accepts; superseding marks the old one superseded by the new', () => {
  const d = tmp(); const base = { requested_by: 'owner', decided_by: 'human', context: 'c', options: 'a; b', outcome: 'a', reason: 'r', rules: [{ text: 'rule one', origin: 'human' }] };
  let n = 0; const rand = () => (n++).toString(16).padStart(4, '0');
  const one = decideV0({ ...base, title: 'First choice', consequences: 'Good, because simple.' }, d, { date: '2026-10-30', rand });
  assert.match(one.file, /^docs\/decisions\/D-2026-10-30-0000-first-choice\.md$/); assert.deepEqual(verify([d]).problems, []);
  const text = fs.readFileSync(path.join(d, one.file), 'utf8');   // MADR's front matter first, Buddy's fields beside it; its sections, the empty ones left out
  assert.match(text, /^---\nstatus: accepted\ndate: 2026-10-30\ndecision-makers: \[the Product Owner\]\nschema: buddy\/decision@0\nid: D-2026-10-30-0000\n/);
  assert.match(text, /---\n# First choice\n\n## Context and Problem Statement\n\nc\n\n## Considered Options\n\na; b\n\n## Decision Outcome\n\nChosen option: a, because r\n\n### Consequences\n\nGood, because simple\.\n$/);
  const two = decideV0({ ...base, title: 'Second choice', supersedes: [one.id], drivers: 'cost', confirmation: 'a test', pros_cons: '### a\n\nGood' }, d, { date: '2026-10-30', rand });
  assert.match(fs.readFileSync(path.join(d, one.file), 'utf8'), new RegExp(`\\nstatus: superseded by ${two.id}\\n`)); assert.deepEqual(verify([d]).problems, []);
  assert.match(fs.readFileSync(path.join(d, two.file), 'utf8'), /## Decision Drivers\n\ncost\n\n## Considered Options[\s\S]*### Confirmation\n\na test\n\n## Pros and Cons of the Options\n\n### a\n\nGood\n$/);
  const files = () => fs.readdirSync(path.join(d, 'docs/decisions')).length;
  assert.throws(() => decideV0({ ...base, title: 'Third', supersedes: [one.id] }, d), /First choice \[D-2026-10-30-0000\] is already superseded/);   // by its title
  assert.throws(() => decideV0({ ...base, title: 'Fourth', supersedes: ['D-2026-01-01-ffff'] }, d), /cannot supersede D-2026-01-01-ffff: there is no decision with that id/);
  assert.equal(files(), 2);                                                                  // a refused supersession writes nothing
  assert.throws(() => decideV0({ ...base, title: 'x', rules: [] }, d), /missing rules/);
  fs.writeFileSync(path.join(d, one.file), fs.readFileSync(path.join(d, one.file), 'utf8').replace(`superseded by ${two.id}`, 'superseded by D-2026-01-01-ffff'));
  assert.ok(verify([d]).problems.some(p => p.message === `superseded by ${two.id} but status is superseded by D-2026-01-01-ffff`));
});
test('buddy decide through the CLI writes to docs/decisions; the old numbered format is no longer written', () => {
  const d = tmp(); execSync('git init -q', { cwd: d });
  const common = ['--title', 'Keep a flag', '--requested-by', 'owner', '--context', 'c', '--options', 'a; b', '--outcome', 'a', '--reason', 'simple'];
  const v0 = run(['decide', ...common, '--decided-by', 'agent', '--rule', 'flags are enough|agent', '--built', 'not built', '--consulted', 'the architect'], d); assert.equal(v0.status, 0, v0.stderr); assert.match(v0.stdout, /wrote docs\/decisions\/D-/);
  const t = fs.readFileSync(path.join(d, v0.stdout.trim().slice(6)), 'utf8'); assert.match(t, /decision-makers: \[Buddy\]\nconsulted: \[the architect\]\n/); assert.match(t, /\nbuilt: not built\n/);
  const madr = run(['decide', '--format', 'madr', ...common], d); assert.equal(madr.status, 1); assert.match(madr.stderr, /--format is gone/);
  assert.deepEqual(fs.readdirSync(path.join(d, 'docs/decisions')).filter(f => /^\d{4}-/.test(f)), []);
  assert.equal(run(['decide', '--title', 't'], d).status, 1);
});
test('AC2: Buddy\'s instructions write an ADR, unasked, when the owner chooses between alternatives or confirms a costly decision, and say which file', () => {
  const md = fs.readFileSync(fileURLToPath(new URL('../agents/buddy.md', import.meta.url)), 'utf8');
  assert.match(md, /When the owner chooses between alternatives or confirms a costly decision nobody specified, write it at once with `buddy decide`/);
  assert.match(md, /tell them in one line which file holds it\. No program notices these moments: you do\./);
  assert.match(md, /`--supersedes <id>`\), which marks the old one replaced/); assert.match(md, /\| `buddy decide --title "<the decision>" --requested-by owner --decided-by human /);
  assert.doesNotMatch(md, /--format madr/);
});
test('buddy scan prints JSON for a range', () => {
  const d = tmp(); const g = c => execSync(`git -c user.name=t -c user.email=t@t ${c}`, { cwd: d });
  g('init -q -b main'); fs.writeFileSync(path.join(d, 'a.test.ts'), "it('a',()=>{expect(1).toBe(1)})\n"); g('add -A'); g('commit -q -m base'); fs.rmSync(path.join(d, 'a.test.ts')); g('add -A'); g('commit -q -m del');
  const r = run(['scan', d, 'HEAD~1', 'HEAD']); assert.equal(r.status, 0); assert.deepEqual(JSON.parse(r.stdout).deleted_tests, ['a.test.ts']);
});
