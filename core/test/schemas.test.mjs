import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml, parseDocument } from '../src/frontmatter.mjs';
import { validate } from '../src/jsonschema-lite.mjs';
import { verify, contextStatements } from '../src/verify.mjs';
import { SLICE_ID } from '../src/ids.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EX = path.join(HERE, '..', '..', 'docs', 'design', 'examples');
const PB = path.join(HERE, '..', '..', 'docs', 'design', 'playbooks');
const WORKSHOP = { skip: fs.existsSync(EX) && fs.existsSync(PB) ? false : 'the design examples and playbooks (docs/design) are workshop fixtures, not in the public copy' };

// Copies the examples and playbooks to a temp dir, applies edits { file: fn(text) }, returns the problems.
function mutate(edits, extra = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-'));
  for (const dir of [EX, PB]) fs.cpSync(dir, d, { recursive: true });
  for (const [f, fn] of Object.entries(edits)) fs.writeFileSync(path.join(d, f), fn(fs.readFileSync(path.join(d, f), 'utf8')));
  for (const [f, text] of Object.entries(extra)) fs.writeFileSync(path.join(d, f), text);
  return verify([d], extra.opts).problems;
}
const has = (problems, re) => problems.some(p => re.test(`${p.where}: ${p.message}`));

test('front matter subset: maps, lists, inline lists, quotes', () => {
  const v = parseYaml('a: 1\nb: "x: y"\nc: [p, "q, r", s\'t]\nd:\n  - id: 1\n    k: v\n  - plain\ne: {}\nf: [ ]\ng:\n');
  assert.deepEqual(v, { a: 1, b: 'x: y', c: ['p', 'q, r', "s't"], d: [{ id: 1, k: 'v' }, 'plain'], e: {}, f: [], g: null });
});
test('front matter subset refuses what it does not support', () => {
  assert.throws(() => parseYaml('a: &x 1'), /unsupported/);
  assert.throws(() => parseYaml('a: 1\na: 2'), /duplicate key/);
  assert.throws(() => parseYaml('a:\n\tb: 1'), /tab/);
  assert.throws(() => parseYaml('a: "open'), /unterminated/);
  assert.throws(() => parseYaml('a: {x: 1}'), /flow maps/);
});
test('parseDocument reports a missing block instead of throwing', () => {
  assert.match(parseDocument('# no front matter').error, /no front matter/);
  const d = parseDocument('---\na: 1\n---\nbody');
  assert.equal(d.data.a, 1); assert.equal(d.body, 'body');
});
test('jsonschema-lite basics', () => {
  const s = { type: 'object', required: ['a'], additionalProperties: false, properties: { a: { type: 'integer', minimum: 1 }, b: { enum: ['x'] } } };
  assert.equal(validate(s, { a: 2 }).length, 0);
  assert.equal(validate(s, { a: 0, b: 'y', c: 1 }).length, 3);
  assert.match(validate(s, {})[0].message, /required/);
});
test('the shipped examples and both playbooks verify clean', WORKSHOP, () => {
  const r = verify([EX, PB]);
  assert.deepEqual(r.problems, []);
  assert.equal(r.count, 11);
});

test('context: untagged statement and human without a date', WORKSHOP, () => {
  const p = mutate({ 'context.md': t => t.replace('Individual readers, no accounts, no sharing. `human 2026-10-30`', 'Individual readers, no accounts.').replace('read. `human 2026-10-30`', 'read. `human`') });
  assert.ok(has(p, /no origin tag/)); assert.ok(has(p, /needs the date/));
});
test('context: the risk appetite must be human-confirmed on demand', WORKSHOP, () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-')); fs.copyFileSync(path.join(EX, 'context.md'), path.join(d, 'context.md'));
  assert.equal(verify([d]).problems.length, 0);
  const p = verify([d], { requireRiskConfirmed: true }).problems;
  assert.equal(p.length, 2); assert.match(p[0].message, /not human-confirmed/);
});
test('contextStatements reads origins and dates', () => {
  const s = contextStatements('## Risk appetite\n- High: data loss. `human 2026-01-02`\n- Low: polish. `assumed`\n- bare');
  assert.deepEqual(s.map(x => [x.origin, x.date]), [['human', '2026-01-02'], ['assumed', null], [null, null]]);
});

test('question: default must be an option, non-blocking needs a default, answered needs a human or delegated origin', WORKSHOP, () => {
  const p = mutate({ 'question-batch.md': t => t.replace('    default: hidden\n', '    default: nowhere\n').replace('origin: human', 'origin: assumed') });
  assert.ok(has(p, /default.*not one of the options/)); assert.ok(has(p, /origin human or delegated/));
  const q = mutate({ 'question-batch.md': t => t.replace('    default: hidden\n', '') });
  assert.ok(has(q, /needs a minimal default/));
});
test('question: an open question cannot carry an answer; a closed batch cannot hold an open question', WORKSHOP, () => {
  const p = mutate({ 'question-batch.md': t => t.replace('status: answered\n    recommended: warn-restore', 'status: open\n    recommended: warn-restore').replace('status: answered\nround', 'status: closed\nround') });
  assert.ok(has(p, /open question has an answer/)); assert.ok(has(p, /batch is closed but a question is still open/));
});
test('question: origin human cannot be recorded by the agent', WORKSHOP, () => {
  const p = mutate({ 'question-batch.md': t => t.replace('by: human\n      origin: human', 'by: agent\n      origin: human') });
  assert.ok(has(p, /origin human requires by human/));
});

test('decision: human origin requires a human decider; repo origin needs confidence and citation', WORKSHOP, () => {
  const p = mutate({ 'decision-new.md': t => t.replace('decided_by: human', 'decided_by: agent').replace('    confidence: high\n    cite: server/store.ts\n', '') });
  assert.ok(has(p, /requires decided_by human/)); assert.ok(has(p, /confidence tier/)); assert.ok(has(p, /citation/));
});
test('decision: supersession must be consistent and acyclic', WORKSHOP, () => {
  assert.ok(has(mutate({ 'decision-old.md': t => t.replace('status: superseded', 'status: accepted') }), /superseded by D-2026-10-30-2222 but status is accepted/));
  assert.ok(has(mutate({ 'decision-new.md': t => t.replace('[D-2026-10-30-1111]', '[D-2026-10-30-ffff]') }), /unknown decision/));
  const cyc = mutate({ 'decision-old.md': t => t.replace('rules:', 'supersedes: [D-2026-10-30-2222]\nrules:') });
  assert.ok(has(cyc, /cycle/));
});
test('ids: duplicates and malformed ids are reported', WORKSHOP, () => {
  const p = mutate({ 'decision-old.md': t => t.replace('D-2026-10-30-1111', 'D-2026-10-30-2222') });
  assert.ok(has(p, /duplicate decision id/));
  assert.ok(has(mutate({ 'slice.md': t => t.replace('archive-a-book', 'S-1') }), /does not match/));
  for (const bad of ['Archive-a-book', 'archive--a-book', '-archive', 'archive-', 'a'.repeat(41)]) assert.ok(has(mutate({ 'slice.md': t => t.replace('id: archive-a-book', `id: ${bad}`) }), /does not match/), bad);
});
test('every slice-id pattern in the schemas is the one in the code (R86), so they cannot drift', () => {
  const found = [];
  const walk = (x, at) => { if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) if (k === 'pattern' && /a-z0-9\]\+\(\?:-/.test(v)) found.push([at, v]); else walk(v, `${at}.${k}`); };
  for (const k of ['slice', 'question', 'decision', 'finding']) walk(JSON.parse(fs.readFileSync(path.join(HERE, '..', 'schemas', `${k}.schema.json`), 'utf8')), k);
  assert.deepEqual(found.map(f => f[0]), ['slice.properties.id', 'slice.properties.epic', 'slice.properties.depends_on.items', 'question.properties.slice', 'decision.properties.slice', 'finding.properties.slice']);
  for (const [at, p] of found) assert.equal(p, SLICE_ID.source, at);
});
test('slice: unknown references and an accepted slice with an open finding', WORKSHOP, () => {
  const p = mutate({ 'slice.md': t => t.replace('batches: [B-2026-10-30-c3d4]', 'batches: [B-2026-10-30-0000]') });
  assert.ok(has(p, /unknown question B-2026-10-30-0000/));
  const q = mutate({ 'finding.md': t => t.replace('status: accepted', 'status: open').replace(/disposition:[\s\S]*?Fine as it is\.\n/, '') });
  assert.ok(has(q, /slice is accepted but F-2026-10-30-9a8b is still open/));
});
test('finding: a needs-human finding is accepted only by the human; a program finding needs evidence', WORKSHOP, () => {
  const p = mutate({ 'finding.md': t => t.replace('by: human\n  at', 'by: rule\n  at').replace('evidence: .git/buddy/evidence-1.json\n', '') });
  assert.ok(has(p, /only be accepted by the human/)); assert.ok(has(p, /must point to its evidence/));
  assert.ok(has(mutate({ 'finding.md': t => t.replace('class: unconfirmed-default', 'class: made-up') }), /matches none/));
  assert.equal(mutate({ 'finding.md': t => t.replace('class: unconfirmed-default', 'class: x-custom') }).length, 0);
});

test('playbook: dangling references, a writing reviewer, no human role', WORKSHOP, () => {
  const p = mutate({ 'build-slice.playbook.md': t => t.replace('role: reviewer\n    purpose', 'role: ghost\n    purpose').replace('produces: [slice-record, view]', 'produces: [slice-record, nothing]').replace('triggers: [validate,', 'triggers: [bogus, validate,') });
  assert.ok(has(p, /unknown role ghost/)); assert.ok(has(p, /unknown artifact nothing/)); assert.ok(has(p, /bogus is neither/));
  const w = mutate({ 'build-slice.playbook.md': t => t.replace('may_write: nothing\n    independent', 'may_write: source\n    independent') });
  assert.ok(has(w, /may write nothing/));
  const h = mutate({ 'discovery-to-prd.playbook.md': t => t.replace('id: owner\n    kind: human', 'id: owner\n    kind: agent') });
  assert.ok(has(h, /needs a human role/));
});
test('playbook: a program check needs a command and every check must be used', WORKSHOP, () => {
  const p = mutate({ 'build-slice.playbook.md': t => t.replace('    run: buddy scope\n', '').replace('checks: [validate, tests-intact, no-skip-markers, protected-files, tests-added, scope-trace]', 'checks: [validate, tests-intact, no-skip-markers, protected-files, tests-added]') });
  assert.ok(has(p, /needs a run command/)); assert.ok(has(p, /never used by a stage/));
});
test('files without a Buddy schema are ignored; broken front matter is reported', WORKSHOP, () => {
  const p = mutate({}, { 'plain.md': '# just a note\n', 'broken.md': '---\nschema: buddy/slice@1\nid: "open\n---\n' });
  assert.equal(p.length, 1); assert.match(p[0].message, /unterminated/);
});
