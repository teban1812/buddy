import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { settle, freeCommits, settledRecords } from '../src/settle.mjs';
import { digest, digestText } from '../src/digest.mjs';

const G = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf8', stdio: 'pipe' });
const ok = () => ({ status: 0 }); const red = () => ({ status: 1 });
const commit = (d, msg, files) => { for (const [f, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); if (c === null) fs.rmSync(path.join(d, f)); else fs.writeFileSync(path.join(d, f), c); } G(d, 'add', '-A'); G(d, 'commit', '-qm', msg); return G(d, 'rev-parse', 'HEAD').trim(); };
function repo() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'st-')); G(d, 'init', '-q', '-b', 'main');
  commit(d, 'chore: base', { 'package.json': '{"name":"x","scripts":{"validate":"node -e 0"}}', 'src/a.js': 'export const a = 1;\n', 'src/a.test.js': "import assert from 'node:assert';\nassert.equal(1, 1);\n", 'README.md': 'x\n' });
  return d;
}

test('only the commits without a Slice trailer are settled, and the records of Buddy alone are not work', () => {
  const d = repo(); const base = G(d, 'rev-parse', 'HEAD').trim();
  commit(d, 'feat(core): a slice\'s work\n\nSlice: some-change', { 'src/b.js': 'export const b = 1;\n' });
  const free = commit(d, 'fix: the label', { 'README.md': 'x fixed\n' });
  commit(d, 'chore(buddy): records', { 'docs/buddy/backlog/2026-11-01-x/change.md': '---\nid: x\n---\n' });
  assert.deepEqual(freeCommits(d, base).map(c => c.hash), [free]);
});
test('a small correction with the checks green asks nothing of the owner, leaves a record outside docs/buddy and is not settled twice', () => {
  const d = repo(); commit(d, 'docs: reword the readme', { 'README.md': 'a better readme\n' });
  const r = settle({ repo: d, since: 'HEAD~1', validate: ok });
  assert.equal(r.settled, true); assert.equal(r.record.kind, 'small-correction'); assert.equal(r.record.needs_owner, false); assert.deepEqual(r.record.deviations, []);
  assert.match(r.text, /Nothing deviated/); assert.ok(fs.readdirSync(path.join(d, '.buddy/settled')).some(f => /^settled-.*\.json$/.test(f))); assert.ok(!fs.existsSync(path.join(d, 'docs/buddy')));
  const again = settle({ repo: d, validate: ok }); assert.equal(again.settled, false); assert.match(again.text, /Nothing to settle/);
  commit(d, 'style: tidy', { 'README.md': 'a better readme!\n' });
  assert.equal(settle({ repo: d, validate: ok }).settled, true, 'it goes on from where it settled');
});
test('behaviour changed without a test, a failing check, a deleted test or something specified: the owner has to look', () => {
  const d = repo(); const since = G(d, 'rev-parse', 'HEAD').trim();
  commit(d, 'fix: wrong value', { 'src/a.js': 'export const a = 2;\n' });
  const noTest = settle({ repo: d, since, validate: ok }); assert.equal(noTest.record.needs_owner, true); assert.match(noTest.record.deviations.join(), /behaviour changed without a test: src\/a\.js/);
  const s2 = G(d, 'rev-parse', 'HEAD').trim(); commit(d, 'fix: with its test', { 'src/a.js': 'export const a = 3;\n', 'src/b.test.js': "import assert from 'node:assert';\nassert.equal(3, 3);\n" });
  assert.equal(settle({ repo: d, since: s2, validate: ok }).record.needs_owner, false);
  const s3 = G(d, 'rev-parse', 'HEAD').trim(); commit(d, 'chore: broken', { 'README.md': 'y\n' });
  const broken = settle({ repo: d, since: s3, validate: red }); assert.equal(broken.record.needs_owner, true); assert.match(broken.text, /checks FAIL/); assert.equal(broken.settled, false);
  const s4 = G(d, 'rev-parse', 'HEAD').trim(); commit(d, 'chore: drop a test', { 'src/a.test.js': null });
  assert.match(settle({ repo: d, since: s4, validate: ok }).record.deviations.join(), /tests were deleted/);
  const s5 = G(d, 'rev-parse', 'HEAD').trim(); commit(d, 'docs: change what was specified', { 'docs/context.md': 'new purpose\n' });
  assert.match(settle({ repo: d, since: s5, validate: ok }).record.deviations.join(), /something specified was changed: docs\/context\.md/);
});
test('a feature, or a big one, has grown past a quick fix and should become a change', () => {
  const d = repo(); const since = G(d, 'rev-parse', 'HEAD').trim();
  commit(d, 'feat: a new screen', { 'src/screen.js': 'export const s = 1;\n', 'src/screen.test.js': "import assert from 'node:assert';\nassert.ok(true);\n" });
  const r = settle({ repo: d, since, validate: ok }); assert.equal(r.record.kind, 'grew'); assert.equal(r.record.needs_owner, true); assert.match(r.text, /should become a change/);
  const s2 = G(d, 'rev-parse', 'HEAD').trim(); commit(d, 'refactor: many lines', { 'src/big.js': 'line\n'.repeat(250) });
  assert.equal(settle({ repo: d, since: s2, validate: ok }).record.kind, 'grew');
});
test('the digest lists what was settled since the owner last looked, and which of it needs them', () => {
  const d = repo(); const since = G(d, 'rev-parse', 'HEAD').trim();
  commit(d, 'docs: reword', { 'README.md': 'z\n' }); settle({ repo: d, since, validate: ok });
  const s2 = G(d, 'rev-parse', 'HEAD').trim(); commit(d, 'fix: no test', { 'src/a.js': 'export const a = 9;\n' }); settle({ repo: d, since: s2, validate: ok });
  const dg = digest(d, '2099-01-01T00:00:00Z', { since: '2000-01-01T00:00:00Z' }); assert.equal(dg.settled.length, 2); assert.equal(dg.settled.filter(x => x.needs_owner).length, 1);
  const text = digestText(dg); assert.match(text, /Quick fixes settled \(2, 1 need your look\)/); assert.match(text, /nothing deviated/); assert.match(text, /behaviour changed without a test/);
  assert.equal(digest(d, '2099-01-01T00:00:00Z', { since: '2098-01-01T00:00:00Z' }).settled.length, 0, 'earlier settles are not news');
  assert.equal(settledRecords(d).length, 2);
});
test('the command settles with the real validate and prints what happened', () => {
  const d = repo(); commit(d, 'docs: reword', { 'README.md': 'q\n' });
  const out = execFileSync(process.execPath, [fileURLToPath(new URL('../bin/buddy.mjs', import.meta.url)), 'settle', '--since', 'HEAD~1'], { cwd: d, encoding: 'utf8' });
  assert.match(out, /SETTLED +1 commit\(s\)/); assert.match(out, /The checks pass/);
});

// fix-checks-from-field (R155, AC2): settle counts from the last settle, and each warning names the commit it comes from.
test('a settle counts only the commits since the last settle\'s recorded head; --since still overrides', () => {
  const d = repo(); const start = G(d, 'rev-parse', 'HEAD').trim();
  const ctx = commit(d, 'docs: the business context', { 'docs/context.md': 'purpose\n' });
  const first = settle({ repo: d, since: start, validate: ok }); assert.match(first.record.deviations.join(), /something specified was changed/);
  const rec = settledRecords(d).at(-1); assert.equal(rec.upto, ctx);
  fs.rmSync(path.join(d, '.buddy/settled/upto'));                                         // the record alone tells where the last settle stopped
  const fix = commit(d, 'style: the label', { 'README.md': 'x, clearer\n' }); commit(d, 'style: again', { 'README.md': 'x, clearer still\n' });
  const next = settle({ repo: d, validate: ok });
  assert.equal(next.record.from, ctx); assert.deepEqual(next.record.commits.map(c => c.subject), ['style: the label', 'style: again']); assert.deepEqual(next.record.deviations, [], 'the old commit\'s warning is not repeated');
  assert.ok(next.text.startsWith(`SETTLED  2 commit(s) made without a change since ${ctx.slice(0, 7)}: `), next.text); void fix;
  const all = settle({ repo: d, since: start, validate: ok }); assert.equal(all.record.commits.length, 3, '--since overrides');
});
test('each warning, and what made it grow, names the commit it comes from', () => {
  const d = repo(); const since = G(d, 'rev-parse', 'HEAD').trim();
  const spec = commit(d, 'docs: change the context', { 'docs/context.md': 'new purpose\n' });
  const code = commit(d, 'fix: wrong value', { 'src/a.js': 'export const a = 2;\n' });
  const feat = commit(d, 'feat: a new screen', { 'src/screen.js': 'export const s = 1;\n' });
  const r = settle({ repo: d, since, validate: ok });
  const dev = r.record.deviations.join('\n');
  assert.ok(dev.includes(`something specified was changed: docs/context.md (from ${spec.slice(0, 7)} "docs: change the context")`), dev);
  assert.ok(dev.includes(`behaviour changed without a test: src/a.js, src/screen.js (from ${code.slice(0, 7)} "fix: wrong value", ${feat.slice(0, 7)} "feat: a new screen")`), dev);
  assert.deepEqual(r.record.grew_from, [feat.slice(0, 7)]); assert.ok(r.text.includes(`grew past a quick fix: it adds a feature or is large (from ${feat.slice(0, 7)} "feat: a new screen")`), r.text);
  const s2 = G(d, 'rev-parse', 'HEAD').trim(); const big = commit(d, 'refactor: many lines', { 'src/big.js': 'line\n'.repeat(250) }); const small = commit(d, 'style: one line', { 'src/a.js': 'export const a = 3;\n' });
  const g = settle({ repo: d, since: s2, validate: ok }); assert.deepEqual(g.record.grew_from, [big.slice(0, 7), small.slice(0, 7)], 'the largest first');
});

// settle-only-on-green (R157): red checks settle nothing, and the size of a quick fix counts product code only.
test('when the checks fail nothing is settled: no record, no mark, and the next settle checks the same commits again', () => {
  const d = repo(); const start = G(d, 'rev-parse', 'HEAD').trim();
  const fix = commit(d, 'fix: the label', { 'src/a.js': 'export const a = 2;\n', 'src/a.test.js': "import assert from 'node:assert';\nassert.equal(2, 2);\n" });
  settle({ repo: d, since: start, validate: ok });   // the start of the story: a settle that was green
  const next = commit(d, 'fix: again', { 'src/a.js': 'export const a = 3;\n', 'src/a.test.js': "import assert from 'node:assert';\nassert.equal(3, 3);\n" });
  const red1 = settle({ repo: d, validate: red });
  assert.equal(red1.settled, false); assert.equal(red1.record.validate_exit, 1); assert.equal(red1.record.from, fix);
  assert.ok(red1.text.startsWith('NOT SETTLED  1 commit(s)'), red1.text); assert.match(red1.text, /nothing was marked settled: fix what fails and run buddy settle again/);
  assert.equal(settledRecords(d).length, 1, 'no record of a red settle'); assert.equal(fs.readFileSync(path.join(d, '.buddy/settled/upto'), 'utf8').trim(), fix, 'the mark did not move');
  const red2 = settle({ repo: d, validate: red }); assert.equal(red2.settled, false); assert.doesNotMatch(red2.text, /Nothing to settle/);
  const green = settle({ repo: d, validate: ok });
  assert.equal(green.settled, true); assert.deepEqual(green.record.commits.map(c => c.subject), ['fix: again']); assert.equal(green.record.upto, next);
  assert.match(settle({ repo: d, validate: ok }).text, /Nothing to settle/);
});
test('a red settle recorded before this fix does not count as settled: the next one starts where it started', () => {
  const d = repo(); const start = G(d, 'rev-parse', 'HEAD').trim();
  const head = commit(d, 'fix: the label', { 'src/a.js': 'export const a = 2;\n', 'src/a.test.js': "import assert from 'node:assert';\nassert.equal(2, 2);\n" });
  const dir = path.join(d, '.buddy/settled'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'settled-20261104T100000Z-old.json'), JSON.stringify({ when: '2026-11-04T10:00:00Z', from: start, upto: head, commits: [{ hash: head.slice(0, 7), subject: 'fix: the label' }], validate_exit: 1, kind: 'small-correction', deviations: [], needs_owner: true }));
  fs.writeFileSync(path.join(dir, 'upto'), head + '\n');
  const r = settle({ repo: d, validate: ok }); assert.equal(r.settled, true); assert.equal(r.record.from, start); assert.deepEqual(r.record.commits.map(c => c.subject), ['fix: the label']);
});
test('the command reports red checks, settles nothing and exits 1', () => {
  const d = repo(); fs.writeFileSync(path.join(d, 'package.json'), '{"name":"x","scripts":{"validate":"node -e \\"process.exit(3)\\""}}'); G(d, 'add', 'package.json'); G(d, 'commit', '-qm', 'chore: a validate that fails');
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('../bin/buddy.mjs', import.meta.url)), 'settle', '--since', 'HEAD~1'], { cwd: d, encoding: 'utf8' });
  assert.equal(r.status, 1, r.stderr); assert.match(r.stdout, /NOT SETTLED/); assert.match(r.stdout, /The checks FAIL/); assert.ok(!fs.existsSync(path.join(d, '.buddy/settled/upto')));
});
test('a small correction of a few dozen lines over several commits, with its tests and notes, has not grown past a quick fix', () => {
  const d = repo(); const since = G(d, 'rev-parse', 'HEAD').trim();
  // the field case: 4 commits and about 35 lines, touching code, tests, a note and the lock file
  commit(d, 'fix: the date is shown in the owner\'s time zone', { 'src/a.js': 'export const a = 1;\nexport const tz = "local";\n'.repeat(3), 'src/a.test.js': "import assert from 'node:assert';\nassert.equal(1, 1);\n".repeat(4) });
  commit(d, 'fix: the empty list says so', { 'src/list.js': 'export const empty = "No items yet";\n'.repeat(3), 'src/list.test.js': "import assert from 'node:assert';\nassert.ok(true);\n".repeat(3) });
  commit(d, 'docs: a note on time zones', { 'README.md': 'x\nTimes are local.\n', 'docs/notes/tz.md': 'Times are local.\n'.repeat(4) });
  commit(d, 'chore: the lock file', { 'package-lock.json': '{}\n'.repeat(40), 'src/Migrations/20261104_Init.Designer.cs': '// generated\n'.repeat(60) });
  const r = settle({ repo: d, since, validate: ok });
  assert.equal(r.record.commits.length, 4); assert.equal(r.record.kind, 'small-correction', r.text); assert.doesNotMatch(r.text, /grew past a quick fix/);
  assert.ok(r.record.product_lines < 20, `product lines: ${r.record.product_lines}`); assert.equal(r.record.product_files, 2);
});
test('the size of a quick fix is a stated limit of product code: above it, it grew, and the text says how large it is', async () => {
  const { QUICK_FIX_LINES, QUICK_FIX_FILES, isProductCode } = await import('../src/settle.mjs');
  assert.equal(QUICK_FIX_LINES, 150); assert.equal(QUICK_FIX_FILES, 5);
  for (const f of ['src/a.test.js', 'tests/x.js', 'Api.Tests/FooTests.cs', 'README.md', 'docs/x.md', 'package-lock.json', 'yarn.lock', 'dist/app.js', 'src/Migrations/1_Init.cs', 'src/Model.Designer.cs', 'app.min.js']) assert.equal(isProductCode(f), false, f);
  for (const f of ['src/a.js', 'src/Api/Program.cs', 'web/src/App.tsx', 'package.json']) assert.equal(isProductCode(f), true, f);
  const d = repo(); const s1 = G(d, 'rev-parse', 'HEAD').trim();
  commit(d, 'refactor: right at the limit', { 'src/big.js': 'line\n'.repeat(QUICK_FIX_LINES), 'src/big.test.js': 'line\n'.repeat(500) });
  assert.equal(settle({ repo: d, since: s1, validate: ok }).record.kind, 'small-correction', 'at the limit and with many test lines, still a quick fix');
  const s2 = G(d, 'rev-parse', 'HEAD').trim(); commit(d, 'refactor: one line past it', { 'src/big2.js': 'line\n'.repeat(QUICK_FIX_LINES + 1) });
  const over = settle({ repo: d, since: s2, validate: ok }); assert.equal(over.record.kind, 'grew');
  assert.match(over.text, new RegExp(`Its size: ${QUICK_FIX_LINES + 1} lines of product code in 1 file\\(s\\), more than a quick fix \\(up to ${QUICK_FIX_LINES} lines and ${QUICK_FIX_FILES} files`));
  const s3 = G(d, 'rev-parse', 'HEAD').trim(); commit(d, 'style: six files', Object.fromEntries([1, 2, 3, 4, 5, 6].map(i => [`src/f${i}.js`, `export const f${i} = 1;\n`])));
  assert.equal(settle({ repo: d, since: s3, validate: ok }).record.kind, 'grew', 'more than five files of product code');
  const s4 = G(d, 'rev-parse', 'HEAD').trim(); commit(d, 'style: five files', Object.fromEntries([1, 2, 3, 4, 5].map(i => [`src/g${i}.js`, `export const g${i} = 1;\n`])));
  assert.equal(settle({ repo: d, since: s4, validate: ok }).record.kind, 'small-correction', 'five files is still a quick fix');
});
