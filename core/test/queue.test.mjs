import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBatch, cards, answerQuestion, assumeDefaults, confirmAssumed, blockingOpen, writeBatchFile, loadBatchFile, unconfirmedDefaults, addAssumedDefaults } from '../src/queue.mjs';
import { analyseAnswers, parseAnalysis, buildAnalysisPrompt, LIMITS } from '../src/analysis.mjs';
import { verify } from '../src/verify.mjs';

let n = 0; const rand = () => (n++).toString(16).padStart(4, '0');
const spec = {
  slice: 'archive-a-book',
  questions: [
    { situation: 'A reader adds a title that is archived.', blocking: true, recommended: 'warn', options: [{ id: 'allow', label: 'Add silently', cost: 'two copies' }, { id: 'warn', label: 'Warn and offer restore', cost: 'one extra step' }] },
    { situation: 'Keep the add form visible in the archive view?', options: [{ id: 'hide', label: 'Hide it', cost: 'smallest change' }, { id: 'show', label: 'Keep it', cost: 'more layout work' }], default: 'hide' },
  ],
};
const mk = () => createBatch(spec, { date: '2026-10-30', rand });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'q-'));

test('createBatch assigns ids, option ids and defaults', () => {
  const b = mk();
  assert.match(b.id, /^B-2026-10-30-[0-9a-f]{4}$/); assert.match(b.questions[0].id, /^Q-2026-10-30-/);
  assert.equal(b.questions[1].default, 'hide'); assert.equal(b.questions[0].default, undefined);
  assert.equal(new Set([b.id, ...b.questions.map(q => q.id)]).size, 3);
});
test('createBatch refuses a question without costed options', () => {
  assert.throws(() => createBatch({ questions: [{ situation: 's', options: [{ label: 'a', cost: 'x' }] }] }), /at least two options/);
  assert.throws(() => createBatch({ questions: [{ situation: 's', options: [{ label: 'a', cost: 'x' }, { label: 'b' }] }] }), /label and a cost/);
});
test('cards show waiting, recommended and default, and the delegation sentence', () => {
  const t = cards(mk());
  assert.match(t, /waiting for you/); assert.match(t, /<- recommended/); assert.match(t, /your call/); assert.match(t, /I am waiting for you on 1 blocking/);
});
test('answers record origin; delegated uses the recommended option; the batch settles', () => {
  const b = mk();
  assert.throws(() => answerQuestion(b, b.questions[0].id, { option: 'nope' }), /not one of/);
  answerQuestion(b, b.questions[0].id, { delegated: true, at: '2026-10-30' });
  assert.deepEqual(b.questions[0].answer, { option: 'warn', by: 'human', origin: 'delegated', at: '2026-10-30' });
  assert.equal(blockingOpen(b).length, 0); assert.equal(b.status, 'open');
  assert.throws(() => answerQuestion(b, b.questions[0].id, { option: 'allow' }), /already answered/);
});
test('assumeDefaults records the agent as author with origin assumed; confirmAssumed turns it into a human answer', () => {
  const b = mk(); answerQuestion(b, b.questions[0].id, { option: 'warn' });
  assert.deepEqual(assumeDefaults(b), [b.questions[1].id]); assert.equal(b.status, 'answered');
  assert.deepEqual(b.questions[1].answer, { option: 'hide', by: 'agent', origin: 'assumed', at: new Date().toISOString().slice(0, 10) });
  confirmAssumed(b, b.questions[1].id, { option: 'show' }); assert.equal(b.questions[1].answer.origin, 'human'); assert.equal(b.status, 'closed');
});
test('delegating a blocking question without a recommendation is refused', () => {
  const b = createBatch({ questions: [{ situation: 's', blocking: true, options: [{ label: 'a', cost: 'x' }, { label: 'b', cost: 'y' }] }] }, { rand });
  assert.throws(() => answerQuestion(b, b.questions[0].id, { delegated: true }), /recommended or default/);
});
test('the written file parses, passes the verifier at every stage, and lists unconfirmed defaults', () => {
  const d = tmp(); const f = path.join(d, 'questions.md'); const slice = path.join(d, 'slice.md');
  fs.writeFileSync(slice, '---\nschema: buddy/slice@1\nid: archive-a-book\ntitle: t\nkind: feat\nstatus: refining\nrank: 1000\ncreated: 2026-10-30T09:00:00Z\nrequest: r\n---\n');
  const b = mk(); writeBatchFile(f, b);
  assert.deepEqual(verify([d]).problems, []);
  answerQuestion(b, b.questions[0].id, { option: 'warn' }); assumeDefaults(b); addAssumedDefaults(b, ['The list keeps its order.']); writeBatchFile(f, b);
  assert.deepEqual(verify([d]).problems, []);
  assert.deepEqual(loadBatchFile(f).questions[1].answer.origin, 'assumed');
  assert.equal(unconfirmedDefaults([f]).length, 2);
});
test('parseAnalysis drops malformed follow-ups and caps their number', () => {
  const j = { followups: [{ situation: 's', options: [{ label: 'a', cost: 'x' }, { label: 'b', cost: 'y' }] }, { situation: 'bad' }, ...Array(5).fill({ situation: 's', options: [{ label: 'a', cost: 'x' }, { label: 'b', cost: 'y' }] })], defaults_assumed: ['d', ''] };
  const a = parseAnalysis('here: ' + JSON.stringify(j));
  assert.equal(a.followups.length, LIMITS.maxFollowups); assert.equal(a.warnings.length, 1); assert.deepEqual(a.defaults_assumed, ['d']);
  assert.throws(() => parseAnalysis('no json'), /no JSON/);
});
test('analyseAnswers builds a blocking follow-up batch with a visible reason, and stops at the round limit', async () => {
  const b = mk(); answerQuestion(b, b.questions[0].id, { option: 'warn' }); assumeDefaults(b);
  const reply = JSON.stringify({ followups: [{ because: 'Because you answered "warn" ', situation: 'How are duplicates matched?', options: [{ id: 'a', label: 'Same title and author', cost: 'rarely wrong' }, { id: 'b', label: 'Same title only', cost: 'may warn wrongly' }], recommended: 'a', default: 'a' }], defaults_assumed: ['Matching ignores case.'] });
  let prompt; const r = await analyseAnswers({ request: 'Archive books', batch: b, ask: async p => { prompt = p; return reply; }, date: '2026-10-30' });
  assert.match(prompt, /Human's answer: warn\) Warn and offer restore/); assert.equal(r.followupBatch.round, 2);
  assert.equal(r.followupBatch.questions[0].blocking, true); assert.equal(r.followupBatch.questions[0].because, 'you answered "warn"');
  assert.deepEqual(r.defaults, ['Matching ignores case.']);
  const late = { ...b, round: LIMITS.maxRounds };
  const r2 = await analyseAnswers({ batch: late, ask: async () => reply });
  assert.equal(r2.followupBatch, null); assert.ok(r2.defaults.some(d => /round limit reached/.test(d))); assert.ok(r2.warnings.length);
});
test('buildAnalysisPrompt warns that assumed context is not evidence', () => {
  assert.match(buildAnalysisPrompt({ context: 'x `assumed`', batch: mk() }), /unconfirmed and are not evidence/);
});
test('answering one question prints that card and the status line, not the whole batch again', () => {
  const b = mk(); const q = b.questions[0].id; answerQuestion(b, q, { option: 'warn' });
  const only = cards(b, { only: q }); assert.equal((only.match(/^Q\d+ of /gm) || []).length, 1); assert.ok(only.includes(q)); assert.ok(!only.includes(b.questions[1].id));
  assert.match(only, /I am waiting for you|No blocking question|All questions/);                  // the status line stays
  assert.equal((cards(b).match(/^Q\d+ of /gm) || []).length, b.questions.length);                // the full view is still the default
});
test('a refusal names the question by its situation, its id beside it', () => {
  const b = mk(); const q = b.questions[0]; answerQuestion(b, q.id, { option: 'warn' });
  assert.throws(() => answerQuestion(b, q.id, { option: 'allow' }), e => e.message === `A reader adds a title that is archived. [${q.id}] is already answered`);
  assert.throws(() => confirmAssumed(b, q.id), e => e.message === `A reader adds a title that is archived. [${q.id}] is not an assumed default: it is answered`);
  // name-ids-in-refusals (R162): a question that is not in the batch is said in plain words, with the questions it has
  assert.throws(() => answerQuestion(b, 'Q-2026-01-01-ffff', { option: 'warn' }), e => e.message.startsWith(`there is no question Q-2026-01-01-ffff in this batch; its questions are: A reader adds a title that is archived. [${q.id}] | `));
  assert.throws(() => confirmAssumed(b, 'Q-2026-01-01-ffff'), /^Error: there is no question Q-2026-01-01-ffff in this batch/);
});
// name-ids-in-refusals (R162): queue assume refused while a blocking question is open names it by its situation, its id beside it.
test('queue assume refused names the blocking questions still open by their situation', async () => {
  const { spawnSync } = await import('node:child_process'); const { fileURLToPath } = await import('node:url');
  const b = mk(); const f = path.join(tmp(), 'questions.md'); writeBatchFile(f, b);
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('../bin/queue.mjs', import.meta.url)), 'assume', f], { encoding: 'utf8' });
  assert.equal(r.status, 3); assert.equal(r.stderr, `blocking question(s) still open: A reader adds a title that is archived. [${b.questions[0].id}]\n`);
});
// name-ids-in-refusals (R162): a batch file that is not there is said in plain words, naming the file, not as a system error.
test('a question batch file that does not exist is refused in plain words', async () => {
  const { spawnSync } = await import('node:child_process'); const { fileURLToPath } = await import('node:url');
  assert.throws(() => loadBatchFile('nope.md'), e => e.message === 'there is no question batch at nope.md: a batch is a file such as docs/questions.md');
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('../bin/queue.mjs', import.meta.url)), 'answer', 'nope.md', '--q', 'x'], { encoding: 'utf8' });
  assert.notEqual(r.status, 0); assert.match(r.stderr, /there is no question batch at nope\.md/); assert.doesNotMatch(r.stderr, /ENOENT/);
});
