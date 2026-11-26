import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReviewerStream, filesOpened, reviewerPrompt, REVIEWER_TOOLS } from '../src/checkpoint.mjs';

const ev = o => JSON.stringify(o);
const stream = [
  ev({ type: 'system' }),
  ev({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/r/core/a.js' } }, { type: 'tool_use', name: 'Bash', input: { command: 'git show abc1234 -- b.js' } }, { type: 'tool_use', name: 'Grep', input: { pattern: 'x', path: '/r/docs' } }] } }),
  ev({ type: 'result', result: 'Done: {"does_what_was_asked": true, "weakens_or_hides_checks": false, "unspecified_decisions": [], "details": "ok"}', total_cost_usd: 0.4 }),
].join('\n');

test('the stream of a reviewer gives its verdict, its cost and what it opened', () => {
  const o = parseReviewerStream(stream);
  assert.equal(o.review.does_what_was_asked, true); assert.equal(o.cost, 0.4);
  assert.deepEqual(o.read, ['/r/core/a.js', '/r/docs']); assert.deepEqual(o.commands, ['git show abc1234 -- b.js']);
});
test('a stream that ends without a verdict is a failed review, never an approval', () => {
  const o = parseReviewerStream(ev({ type: 'result', result: 'I ran out of turns' }));
  assert.equal(o.review.does_what_was_asked, null); assert.match(o.review.details, /^reviewer failed: it answered "I ran out of turns"/);
});
test('a file counts as opened when it was read, or a git command named it or a commit of the slice', () => {
  const opened = parseReviewerStream(stream);
  assert.deepEqual(filesOpened(['core/a.js', 'b.js', 'c.js'], opened, '/r'), ['core/a.js', 'b.js']);
  assert.deepEqual(filesOpened(['c.js'], { read: [], commands: ['git show abc1234'] }, '/r', ['abc1234ffff']), ['c.js']);
  assert.deepEqual(filesOpened(['c.js'], { read: [], commands: ['git show deadbee'] }, '/r', ['abc1234ffff']), []);
});
test('the agent prompt orders the reviewer to open what was not shown and to read earlier decisions; the tools are read-only', () => {
  const p = reviewerPrompt('req', 'diff', { agent: true, notShown: [{ file: 'big.js', chars: 9 }] });
  assert.match(p, /INCOMPLETE[\s\S]*big\.js/); assert.match(p, /requirements-log/);
  assert.ok(!/INCOMPLETE/.test(reviewerPrompt('req', 'diff', { agent: true }))); assert.ok(!/investigate/.test(reviewerPrompt('req', 'diff')));
  assert.ok(REVIEWER_TOOLS.every(t => /^(Read|Grep|Glob|Bash\(git (show|diff|log):\*\))$/.test(t)));
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { reviewInputs } from '../src/checkpoint.mjs';
test('the reviewer is given what Dev was given: criteria, exclusions and the files of standards and context, and names what is broken (R128)', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-')); fs.mkdirSync(path.join(d, 'docs/standards/code'), { recursive: true });
  fs.writeFileSync(path.join(d, 'docs/context.md'), 'x'); fs.writeFileSync(path.join(d, 'docs/standards/code/naming.md'), 'x'); fs.writeFileSync(path.join(d, 'docs/standards/ORIGIN.md'), 'x'); fs.writeFileSync(path.join(d, 'docs/standards/code/a.png'), 'x');
  const g = reviewInputs(d, { criteria: [{ id: 'C1', text: 'It sorts' }], excludes: [{ id: 'X1', text: 'No export' }] });
  assert.deepEqual(g.files, ['docs/context.md', 'docs/standards/code/naming.md', 'docs/standards/ORIGIN.md']);
  const p = reviewerPrompt('req', 'diff', { agent: true, given: g });
  assert.match(p, /C1 {2}It sorts/); assert.match(p, /X1 {2}No export/); assert.match(p, /docs\/standards\/code\/naming\.md/); assert.match(p, /standards_broken/); assert.match(p, /open them/);
  assert.match(reviewerPrompt('req', 'diff', { given: g }), /not shown to you/); assert.ok(!/What Dev was given/.test(reviewerPrompt('req', 'diff')));
  assert.deepEqual(reviewInputs(fs.mkdtempSync(path.join(os.tmpdir(), 'ri-')), {}).files, []);
});

import { claudeReviewer } from '../src/checkpoint.mjs';
import { plan } from '../src/tools.mjs';
const CLAUDE_ONLY = (() => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rv-')); fs.mkdirSync(path.join(d, 'bin')); fs.writeFileSync(path.join(d, 'bin/claude'), '#!/bin/sh\n'); fs.chmodSync(path.join(d, 'bin/claude'), 0o755); return { PATH: path.join(d, 'bin'), BUDDY_HOME: path.join(d, 'home'), CLAUDE_PLUGIN_ROOT: '/x' }; })();
test('the reviewer gets its hand-over through standard input, and says why when it cannot start or ends without a verdict (R134)', () => {
  let call; const rv = claudeReviewer({ env: CLAUDE_ONLY, spawn: (cmd, args, o) => { call = { cmd, args, o }; return { status: 0, stdout: stream, stderr: '' }; } });
  const prompt = 'x'.repeat(40000); assert.equal(rv(prompt).does_what_was_asked, true);
  assert.equal(call.o.input, prompt); assert.ok(!call.args.includes(prompt) && call.args.includes('-p'));
  const nostart = claudeReviewer({ env: CLAUDE_ONLY, spawn: () => ({ error: { code: 'ENAMETOOLONG' } }) })('p');
  assert.equal(nostart.does_what_was_asked, null); assert.equal(nostart.details, 'the reviewer could not start: ENAMETOOLONG');
  const died = claudeReviewer({ env: CLAUDE_ONLY, spawn: () => ({ status: 1, stdout: '', stderr: 'starting\nError: not logged in\n' }) })('p');
  assert.equal(died.does_what_was_asked, null); assert.equal(died.details, 'the reviewer ended without a verdict (exit 1): starting | Error: not logged in');
});

test('the reviewer marks each decision nobody specified costly or not, and is told the assumptions the owner confirmed (R136)', () => {
  for (const p of [reviewerPrompt('req', 'diff'), reviewerPrompt('req', 'diff', { screens: 'S', divergences: [] })]) { assert.match(p, /"unspecified_decisions": \[\{"text": "\.\.\.", "costly": true\|false\}\]/); assert.match(p, /costly when it is hard to reverse or changes what the business sees/); }
  const g = reviewInputs(fs.mkdtempSync(path.join(os.tmpdir(), 'ri-')), { assumptions: [{ id: 'A1', text: 'One reader per book', if_otherwise: 'x', status: 'confirmed' }, { id: 'A2', text: 'English only', if_otherwise: 'y', status: 'proposed' }] });
  assert.deepEqual(g.assumptions, [{ id: 'A1', text: 'One reader per book' }]);
  const p = reviewerPrompt('req', 'diff', { given: g }); assert.match(p, /confirmed before building \(they were specified: never list them among the unspecified decisions\):\n  A1  One reader per book/); assert.doesNotMatch(p, /English only/);
});

test('the agent prompt tells the reviewer that the diff is the slice\'s patches and a line may have changed since: read the file as it is now before reporting', () => {
  const p = reviewerPrompt('req', 'diff', { agent: true });
  assert.match(p, /other work may have changed those lines since/); assert.match(p, /read the file as it is now \(Read\) and report it only if it still holds/);
  assert.ok(!/may have changed those lines/.test(reviewerPrompt('req', 'diff')), 'a reviewer with no tools is not told to read');
});

test('the reviewer is given the prototype\'s HTML and the PRD like Dev, and told that a screen it cannot see can still be read (R171)', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ri2-')); fs.mkdirSync(path.join(d, 'docs/inputs/prototype'), { recursive: true });
  fs.writeFileSync(path.join(d, 'docs/inputs/prototype/index.html'), '<h1>x</h1>'); fs.writeFileSync(path.join(d, 'docs/inputs/prd.md'), '# PRD'); fs.writeFileSync(path.join(d, 'docs/inputs/logo.png'), 'x');
  const g = reviewInputs(d, {}); assert.deepEqual(g.files, ['docs/inputs/prd.md', 'docs/inputs/prototype/index.html']);   // text and HTML, not the logo
  const p = reviewerPrompt('req', 'diff', { agent: true, given: g, screens: 'SCREENS' });
  assert.match(p, /docs\/inputs\/prototype\/index\.html/); assert.match(p, /You do not need to see a page to compare it: its HTML is in the prototype's files under docs\/inputs\/prototype\//);
  assert.match(p, /the PRD or the specification in docs\/inputs\/ describes it\. A screen is unverifiable only when none of them describes it/);
});

import { verdictIn } from '../src/checkpoint.mjs';
test('the verdict is found wherever the reviewer wrote it: alone, in a fence, among prose with braces, with strings that hold braces; and a failure says what it answered', () => {
  const v = { does_what_was_asked: true, weakens_or_hides_checks: false, unspecified_decisions: [{ text: 'a rule {x} nobody said', costly: false }], details: 'fine' };
  assert.deepEqual(verdictIn(JSON.stringify(v)), v);
  assert.deepEqual(verdictIn('```json\n' + JSON.stringify(v, null, 2) + '\n```'), v);
  assert.deepEqual(verdictIn(`I looked at the code {see core/src}. ${JSON.stringify(v)} Anything else in {braces} is a note.`), v);
  assert.deepEqual(verdictIn(`First try: {"other": 1}\nFinal: ${JSON.stringify(v)}`), v);
  assert.equal(verdictIn('I could not decide {sorry}'), null); assert.equal(verdictIn(''), null); assert.equal(verdictIn('{"does_what_was_asked": tru'), null);
  const stream = [JSON.stringify({ type: 'result', result: 'The review is done, notes {1}.\n' + JSON.stringify(v) + '\nEnd {of notes}', total_cost_usd: 0.1 })].join('\n');
  assert.equal(parseReviewerStream(stream).review.does_what_was_asked, true);
  const bad = parseReviewerStream(JSON.stringify({ type: 'result', result: 'I ran out of room before I could decide.' })); assert.equal(bad.review.does_what_was_asked, null); assert.match(bad.review.details, /^reviewer failed: it answered "I ran out of room before I could decide\."/);
});
test('AC2: the reviewer is told the index of normative documents is next to the standards, to resolve cited clauses through it and never fetch a link', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-')); fs.mkdirSync(path.join(d, 'docs/standards/general'), { recursive: true });
  fs.writeFileSync(path.join(d, 'docs/standards/general/security.md'), 'x');
  assert.doesNotMatch(reviewerPrompt('req', 'diff', { agent: true, given: reviewInputs(d, {}) }), /normative/);
  fs.writeFileSync(path.join(d, 'docs/standards/normative.md'), 'x');
  const g = reviewInputs(d, {}); assert.deepEqual(g.files, ['docs/standards/general/security.md', 'docs/standards/normative.md']);
  const p = reviewerPrompt('req', 'diff', { agent: true, given: g });
  assert.match(p, /docs\/standards\/normative\.md is the index of the normative documents/); assert.match(p, /SCS v2.0 clause 4.2/); assert.match(p, /never fetch a link/i); assert.match(p, /needs the document itself/);
});

test('AC1: parseReviewerStream parses Antigravity stream-json tool events (read_file, view_file, grep_search, find_by_name, run_command) and reads the verdict from result.response', () => {
  const agyStream = [
    ev({ event: 'step_update', step_update: { step_index: 1, state: 'ACTIVE', step_type: 'tool', tool_name: 'read_file', tool_info: { name: 'read_file', parameters: { Path: '/r/core/a.js' } } } }),
    ev({ event: 'step_update', step_update: { step_index: 1, state: 'DONE', step_type: 'tool', tool_name: 'read_file', tool_info: { name: 'read_file', parameters: { Path: '/r/core/a.js' }, output: 'ok' } } }),
    ev({ event: 'step_update', step_update: { step_index: 2, state: 'DONE', step_type: 'tool', tool_name: 'view_file', tool_info: { name: 'view_file', parameters: { AbsolutePath: '/r/core/b.js' } } } }),
    ev({ event: 'step_update', step_update: { step_index: 3, state: 'DONE', step_type: 'tool', tool_name: 'grep_search', tool_info: { name: 'grep_search', parameters: { SearchPath: '/r/docs' } } } }),
    ev({ event: 'step_update', step_update: { step_index: 4, state: 'DONE', step_type: 'tool', tool_name: 'find_by_name', tool_info: { name: 'find_by_name', parameters: { SearchDirectory: '/r/core/src' } } } }),
    ev({ event: 'step_update', step_update: { step_index: 5, state: 'DONE', step_type: 'tool', tool_name: 'run_command', tool_info: { name: 'run_command', parameters: { CommandLine: 'git show abc1234 -- c.js' } } } }),
    ev({ event: 'step_update', step_update: { step_index: 6, state: 'ERROR', step_type: 'tool', tool_name: 'read_file', tool_info: { name: 'read_file', parameters: { Path: '/r/core/missing.js' } } } }),
    ev({ event: 'result', result: { status: 'SUCCESS', response: 'Verdict:\n{"does_what_was_asked": true, "weakens_or_hides_checks": false, "unspecified_decisions": [], "details": "checked"}', duration_seconds: 4.2, num_turns: 2 } }),
  ].join('\n');
  const o = parseReviewerStream(agyStream);
  assert.equal(o.ended, true);
  assert.equal(o.review.does_what_was_asked, true);
  assert.deepEqual(o.read, ['/r/core/a.js', '/r/core/b.js', '/r/docs', '/r/core/src']);
  assert.deepEqual(o.commands, ['git show abc1234 -- c.js']);
  assert.deepEqual(filesOpened(['core/a.js', 'core/b.js', 'c.js', 'core/missing.js'], o, '/r'), ['core/a.js', 'core/b.js', 'c.js']);
  const noVerdict = parseReviewerStream(ev({ event: 'result', result: { status: 'SUCCESS', response: 'I could not finish' } }));
  assert.equal(noVerdict.ended, true); assert.equal(noVerdict.review.does_what_was_asked, null);
  assert.match(noVerdict.review.details, /^reviewer failed: it answered "I could not finish"/);
});
