import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseDocument } from '../src/frontmatter.mjs';
import { contextStatements, riskState, suppressionSources, confirmStatements, acceptAssumed, draftContext, contextCard, intakePrompt, parseIntake, approveRecord, recordFingerprint } from '../src/context.mjs';
import { verify } from '../src/verify.mjs';

const read = text => { const d = parseDocument(text); return { data: d.data, body: d.body, statements: contextStatements(d.body) }; };
const FXF = new URL('../../docs/design/examples/context.md', import.meta.url);
const WORKSHOP = { skip: fs.existsSync(FXF) ? false : 'the design examples (docs/design/examples) are a workshop fixture, not in the public copy' };
const FX = WORKSHOP.skip ? '' : fs.readFileSync(FXF, 'utf8');
const BIN = fileURLToPath(new URL('../bin/context.mjs', import.meta.url));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-'));

test('riskState: example has two assumed risk lines -> blocked; confirming them -> confirmed', WORKSHOP, () => {
  assert.equal(riskState(read(FX)).state, 'blocked');
  const r = confirmStatements(FX, { allRisk: true, date: '2026-10-31' });
  assert.equal(r.changed.length, 2);
  assert.equal(riskState(read(r.text)).state, 'confirmed');
  assert.match(r.text, /updated: 2026-10-31/);
});
test('accepting assumed is recorded in the front matter and lines stay assumed', WORKSHOP, () => {
  const t = acceptAssumed(FX, '2026-10-31');
  const c = read(t); assert.equal(c.data.risk_assumed_accepted, '2026-10-31'); assert.equal(riskState(c).state, 'accepted-assumed');
  assert.equal(riskState(c).unconfirmed.length, 2);
  assert.equal(acceptAssumed(t, '2026-11-01').match(/risk_assumed_accepted/g).length, 1);
});
test('a missing risk section is reported as missing', () => assert.equal(riskState(read('---\nschema: buddy/context@0\ntitle: t\nupdated: 2026-01-01\n---\n## Users\n- x `assumed`\n')).state, 'missing'));
test('confirm with a correction replaces the text and the tag; unknown lines are refused', WORKSHOP, () => {
  const lineNo = contextStatements(parseDocument(FX).body).find(s => /Medium cost/.test(s.text)).line;
  const r = confirmStatements(FX, { corrections: { [lineNo]: 'Medium cost: a reader cannot get a book back.' }, date: '2026-10-31' });
  assert.match(r.text, /- Medium cost: a reader cannot get a book back\. `human 2026-10-31`/);
  assert.throws(() => confirmStatements(FX, { lines: [1] }), /not a statement/);
});
test('approve-step-record: the owner approves a step\'s record whole; a second approval replaces the first and the fingerprint ignores the approval itself', () => {
  const REC = '---\nstep: prv-1\nupdated: 2026-01-01\n---\n# The record\n\n## Items\n- PRV1-01: Sign-in. Decided by the base application in src/app.mjs. `decided`\n- PRV1-02: Data. Answer: none. `assumed`\n';
  assert.throws(() => approveRecord(REC, { by: 'buddy' }), /only the Product Owner approves a step's record \(--by owner\)/);
  assert.throws(() => approveRecord(REC, { by: 'owner' }), /1 line\(s\) are not confirmed yet: line 5 \(PRV1-02\)/);
  const ok = confirmStatements(REC, { lines: [5], date: '2026-01-02' }).text;
  const a = approveRecord(ok, { by: 'owner', at: '2026-01-02T10:00:00Z' });
  assert.match(a, /^---\nstep: prv-1\nupdated: 2026-01-02\napproved_by: owner\napproved_at: 2026-01-02T10:00:00Z\napproved_sha: ([0-9a-f]{64})\n---\n# The record/);
  assert.equal(/approved_sha: (\S+)/.exec(a)[1], recordFingerprint(ok)); assert.equal(recordFingerprint(a), recordFingerprint(ok));
  const again = approveRecord(a, { by: 'owner', at: '2026-01-03T10:00:00Z' }); assert.equal(again.match(/approved_/g).length, 3); assert.match(again, /approved_at: 2026-01-03T10:00:00Z/);
  assert.notEqual(recordFingerprint(a.replace('Answer: none', 'Answer: some')), recordFingerprint(a));
});
test('confirm never rewrites a line that is already confirmed', WORKSHOP, () => {
  const r = confirmStatements(FX, { lines: contextStatements(parseDocument(FX).body).filter(s => s.origin === 'human').map(s => s.line), date: '2026-12-31' });
  assert.deepEqual(r.changed, []); assert.ok(r.text.includes('`human 2026-10-30`'));
});
test('suppression: only human statements, and stale ones stop counting', WORKSHOP, () => {
  const c = read(FX);
  assert.equal(suppressionSources(c, { today: '2026-11-01' }).usable.length, 3);
  const s = suppressionSources(c, { today: '2027-03-01' }); assert.equal(s.usable.length, 0); assert.equal(s.stale.length, 3);
});
test('draftContext: everything is assumed or unknown, never human; verifier passes; card lists the risk lines', () => {
  const t = draftContext({ purpose: ['A reading list'], users: ['Readers'], risk_appetite: [{ level: 'High', text: 'losing a reader\'s data' }, { level: 'Low', text: 'polish' }], unknowns: ['Do readers share lists?'], questions_for_owner: ['How many books does a heavy reader keep?'] }, { date: '2026-10-31' });
  const c = read(t); assert.ok(c.statements.every(s => s.origin === 'assumed' || s.origin === 'unknown')); assert.equal(riskState(c).state, 'blocked');
  const d = tmp(); fs.writeFileSync(path.join(d, 'context.md'), t); assert.deepEqual(verify([d]).problems, []);
  assert.match(contextCard(c), /High cost: losing a reader's data \.+ drafted \(assumed\)/);
});
test('draftContext on an existing file keeps confirmed lines byte for byte, adds only new items, removes nothing', WORKSHOP, () => {
  const t = draftContext({ users: ['Individual readers, no accounts, no sharing.', 'Readers who share lists with friends'], risk_appetite: [{ level: 'High', text: 'Losing or silently changing a reader\'s data.' }], questions_for_owner: ['Is sharing wanted?'] }, { existing: FX, date: '2026-10-31' });
  for (const l of FX.split('\n').filter(l => l.includes('`human '))) assert.ok(t.includes(l), l);
  assert.equal(t.split('\n').filter(l => /Individual readers, no accounts, no sharing/.test(l)).length, 1);
  assert.match(t, /- Readers who share lists with friends `assumed`/); assert.match(t, /## Questions for the owner\n- Is sharing wanted\? `unknown`/);
  assert.equal(contextStatements(parseDocument(t).body).filter(s => s.origin === 'human').length, 3);
  const d = tmp(); fs.writeFileSync(path.join(d, 'context.md'), t); assert.deepEqual(verify([d]).problems, []);
});
test('intake prompt carries the confirmed lines and the no-guessing rule; parseIntake needs JSON', () => {
  const p = intakePrompt({ notes: 'a reading list', existing: '- confirmed thing' }); assert.match(p, /confirmed thing/); assert.match(p, /never present a guess as a fact/);
  assert.throws(() => parseIntake('nothing'), /no JSON/);
});
test('CLI: check gates on the risk appetite and passes after confirm', WORKSHOP, () => {
  const d = tmp(); const f = path.join(d, 'context.md'); fs.writeFileSync(f, FX);
  const run = (...a) => spawnSync('node', [BIN, ...a], { encoding: 'utf8' });
  assert.equal(run('check', f).status, 0);
  const blocked = run('check', f, '--require-risk-confirmed'); assert.equal(blocked.status, 1); assert.match(blocked.stdout, /risk appetite: blocked/);
  assert.equal(run('accept-assumed', f).status, 0); assert.equal(run('check', f, '--require-risk-confirmed').status, 0);
  fs.writeFileSync(f, FX); assert.equal(run('confirm', f, '--all-risk').status, 0);
  const ok = run('check', f, '--require-risk-confirmed'); assert.equal(ok.status, 0); assert.match(ok.stdout, /risk appetite: confirmed/);
});

test('context add appends a statement at the end of its section, as the owner said it or assumed, and the file still checks', async () => {
  const { addStatement } = await import('../src/context.mjs');
  const { emptyContext } = await import('../src/init.mjs');
  const d = tmp(); const f = path.join(d, 'context.md'); fs.writeFileSync(f, emptyContext('shop', '2026-01-01'));
  const add = (...a) => spawnSync('node', [BIN, 'add', '--file', f, ...a], { encoding: 'utf8' });
  let r = add('--section', 'purpose and outcomes', '--text', 'Sell  fruit\nonline.'); assert.equal(r.status, 0, r.stderr);
  r = add('--section', 'Purpose and outcomes', '--text', 'Reach new buyers.', '--assumed'); assert.equal(r.status, 0, r.stderr);
  r = add('--section', 'Risk appetite', '--text', 'High cost: a lost order.'); assert.equal(r.status, 0, r.stderr);
  const text = fs.readFileSync(f, 'utf8'); const today = new Date().toISOString().slice(0, 10);
  assert.match(text, new RegExp(`## Purpose and outcomes\n- Sell fruit online\. \`human ${today}\`\n- Reach new buyers\. \`assumed\`\n\n## Users`));
  assert.match(text, new RegExp(`^updated: ${today}$`, 'm'));
  const ctx = read(text); assert.equal(riskState(ctx).state, 'confirmed');
  assert.deepEqual(ctx.statements.filter(s => s.section === 'Purpose and outcomes').map(s => [s.origin, s.date]), [['human', today], ['assumed', null]]);
  assert.equal(spawnSync('node', [BIN, 'check', f], { encoding: 'utf8' }).status, 0);
  const same = add('--section', 'Purpose and outcomes', '--text', 'Sell fruit online.'); assert.match(same.stdout, /nothing changed/); assert.equal(fs.readFileSync(f, 'utf8'), text);
  const bad = add('--section', 'Budget', '--text', 'x'); assert.equal(bad.status, 1); assert.match(bad.stderr, /Purpose and outcomes, Users, Constraints, Risk appetite, Unknowns/);
  assert.equal(add('--section', 'Users', '--text', '  ').status, 1);
  assert.throws(() => addStatement(text, { section: 'Users', statement: 'x `human 2026-01-01`' }), /origin tag/);
  assert.equal(fs.readFileSync(f, 'utf8'), text);
});
test('context add works on a file whose last section has no trailing newline, and refuses without a context file', async () => {
  const { addStatement } = await import('../src/context.mjs');
  const r = addStatement('---\nschema: buddy/context@0\ntitle: t\nupdated: 2026-01-01\n---\n## Unknowns', { section: 'Unknowns', statement: 'Who pays.', assumed: true, date: '2026-02-02' });
  assert.equal(r.text, '---\nschema: buddy/context@0\ntitle: t\nupdated: 2026-02-02\n---\n## Unknowns\n- Who pays. `assumed`\n');
  const d = tmp(); const none = spawnSync('node', [BIN, 'add', '--section', 'Users', '--text', 'x'], { encoding: 'utf8', cwd: d });
  assert.equal(none.status, 1); assert.match(none.stderr, /buddy init/);
});

// The context names its own risk section in its header (risk_section), so the program finds it whatever language its heading is in (R211).
const ES = '---\nschema: buddy/context@0\ntitle: Contexto del negocio de tienda\nupdated: 2026-01-01\nrisk_section: Apetito de riesgo\n---\n# Contexto del negocio\n\n## Usuarios\n- Las personas del almacén. `human 2026-01-01`\n\n## Apetito de riesgo\n- Costo alto: perder un pedido. `assumed`\n- Costo bajo: un texto mal escrito. `assumed`\n';
test('the risk section the header names is read whatever its heading says: state, confirm --all-risk and the sources of scope', async () => {
  const { riskSources } = await import('../src/context.mjs');
  assert.equal(riskState(read(ES)).state, 'blocked'); assert.equal(riskState(read(ES)).unconfirmed.length, 2);
  assert.deepEqual(riskSources(read(ES)).map(r => r.text), ['Costo alto: perder un pedido.', 'Costo bajo: un texto mal escrito.']);
  const r = confirmStatements(ES, { allRisk: true, date: '2026-01-02' }); assert.equal(r.changed.length, 2);
  assert.equal(riskState(read(r.text)).state, 'confirmed');
  const d = tmp(); fs.writeFileSync(path.join(d, 'context.md'), ES);
  assert.equal(verify([d]).problems.length, 0);
  const p = verify([d], { requireRiskConfirmed: true }).problems; assert.equal(p.length, 2); assert.match(p[0].message, /not human-confirmed/);
});
test('a context that names no risk section is read by the heading Risk appetite, and one that names another ignores that heading', () => {
  const en = '---\nschema: buddy/context@0\ntitle: t\nupdated: 2026-01-01\n---\n## Risk appetite\n- High cost: a lost order. `human 2026-01-01`\n';
  assert.equal(riskState(read(en)).state, 'confirmed');
  const other = en.replace('updated: 2026-01-01\n', 'updated: 2026-01-01\nrisk_section: Apetito de riesgo\n');
  const s = riskState(read(other)); assert.equal(s.state, 'missing'); assert.match(s.message, /"Apetito de riesgo"/);
});
test('a named risk section that does not exist or has no line is refused, naming it: context check and verify', () => {
  const run = f => spawnSync(process.execPath, [BIN, 'check', f], { encoding: 'utf8' });
  for (const text of [ES.replace('## Apetito de riesgo', '## Riesgos'), ES.replace(/- Costo .*\n/g, '')]) {
    const d = tmp(); const f = path.join(d, 'context.md'); fs.writeFileSync(f, text);
    const c = run(f); assert.equal(c.status, 1); assert.match(c.stderr, /"Apetito de riesgo"/); assert.match(c.stderr, /risk_section/);
    const p = verify([d]).problems; assert.equal(p.length, 1); assert.match(p[0].message, /"Apetito de riesgo"/);
  }
  const d = tmp(); const f = path.join(d, 'context.md'); fs.writeFileSync(f, ES);
  assert.equal(run(f).status, 0);
  const none = path.join(d, 'none.md'); fs.writeFileSync(none, '---\nschema: buddy/context@0\ntitle: t\nupdated: 2026-01-01\n---\n## Users\n- x `assumed`\n');
  assert.equal(run(none).status, 0, 'a context that names no risk section and has none yet is still only "missing", as a newborn one is');
});
test('context add finds a section and tells two statements apart in a language without Latin letters', async () => {
  const { addStatement } = await import('../src/context.mjs');
  const t = '---\nschema: buddy/context@0\ntitle: t\nupdated: 2026-01-01\n---\n## 目的\n\n## 利用者\n- 倉庫の担当者 `human 2026-01-01`\n';
  const r = addStatement(t, { section: '利用者', statement: '経理の担当者', date: '2026-01-02' });
  assert.equal(r.added, true); assert.equal(r.section, '利用者'); assert.match(r.text, /## 利用者\n- 倉庫の担当者 `human 2026-01-01`\n- 経理の担当者 `human 2026-01-02`/);
});
