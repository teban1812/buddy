import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { plainWarnings, plainText, TERMS } from '../src/plainwords.mjs';

const CORE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUDDY = path.join(CORE, 'bin', 'buddy.mjs');
const marked = t => plainWarnings(t).map(w => `${w.kind}:${w.text}`);

test('paths, commands, code names and the listed terms are marked, each once, in the order they appear', () => {
  assert.deepEqual(marked('See docs/buddy/requests.md, then run buddy board and npm test.'), ['path:docs/buddy/requests.md', 'command:buddy board', 'command:npm test']);
  assert.deepEqual(marked('The file core\\src\\board.mjs and settings.json changed; git push is next; node core/bin/buddy.mjs too.'), ['path:core\\src\\board.mjs', 'path:settings.json', 'command:git push', 'command:node core/bin/buddy.mjs']);
  assert.deepEqual(marked('acceptCard refuses when unconfirmed_defaults or SLICE_ID are set'), ['code:acceptCard', 'code:unconfirmed_defaults', 'code:SLICE_ID']);
  assert.deepEqual(marked('The slice passed its checkpoint; the PR has two commits and the CI is green after a rebase of the JSON schema.'),
    ['term:slice', 'term:checkpoint', 'term:PR', 'term:commits', 'term:CI', 'term:rebase', 'term:JSON', 'term:schema']);
  assert.deepEqual(marked('Edit the front matter, mind the diff, the hook, the lint, the regex, YAML, stdin and stdout, then merge.').map(x => x.split(':')[1]),
    ['front matter', 'diff', 'hook', 'lint', 'regex', 'YAML', 'stdin', 'stdout', 'merge']);
  assert.equal(TERMS.length, 18);
});
test('plain business wording gets no warning: a committed team, a pr in lower case, an iPhone, a sliced cake are not marked', () => {
  assert.deepEqual(marked('Readers can save books to a list and remove them; the list is sorted by title.'), []);
  assert.deepEqual(marked('A committed team ships an iPhone screen, a sliced cake and a pr friendly page.'), []);
  assert.equal(plainText([]), 'No technical wording found.');
  assert.match(plainText(plainWarnings('Run buddy board')), /^1 word\(s\) the owner may not know[^\n]*\n  - a command: buddy board$/);
});
test('the command warns and never blocks: exit 0 with warnings, the text from the arguments or the standard input, --json', () => {
  const run = (args, input) => spawnSync(process.execPath, [BUDDY, 'plain', ...args], { encoding: 'utf8', input, timeout: 20000 });
  const a = run(['The', 'slice', 'is', 'in', 'docs/buddy/x.md']); assert.equal(a.status, 0); assert.match(a.stdout, /a technical term: slice\n  - a file path: docs\/buddy\/x\.md/);
  const b = run(['-'], 'Your list is ready to try.\n'); assert.equal(b.status, 0); assert.equal(b.stdout, 'No technical wording found.\n');
  const c = run(['--json', 'run npm test']); assert.equal(c.status, 0); assert.deepEqual(JSON.parse(c.stdout).map(w => w.kind), ['command']);
  const d = run([]); assert.equal(d.status, 2); assert.match(d.stderr, /usage: buddy plain/);
});
test('Buddy\'s instructions ask it to name things in plain words and to run the check before showing the owner a text', () => {
  const md = fs.readFileSync(path.join(CORE, 'agents', 'buddy.md'), 'utf8');
  assert.match(md, /never by Buddy's internal names/); assert.match(md, /`buddy plain -`/);
  assert.match(md, /Never put HTML in what you write to the owner/); assert.match(md, /separate several items in a cell with " · " or "; ", or use a list under the table/);
});
test('HTML tags are marked, opening and closing, with attributes, as one warning each, saying a terminal shows them as they are (R148)', () => {
  assert.deepEqual(marked('Save books<br>Sort books <b>now</b>, <p>then</p> <div class="note">x</div> <BR/> <br />'),
    ['html:<br>', 'html:<b>', 'html:</b>', 'html:<p>', 'html:</p>', 'html:<div class="note">', 'html:</div>', 'html:<BR/>', 'html:<br />']);
  assert.match(plainWarnings('a<br>b')[0].message, /^HTML, which a terminal shows as it is \(in a table cell separate the items with " · " or "; ", or use a list under the table\): <br>$/);
  assert.deepEqual(marked('Save <span>books</span> in docs/buddy/x.md'), ['html:<span>', 'html:</span>', 'path:docs/buddy/x.md']);   // with the other kinds, in order
  assert.deepEqual(marked('Sales grew 3 < 5 and 7 > 2; a -> b; <- back; << more >>'), []);   // comparisons and arrows are not tags
  const r = spawnSync(process.execPath, [BUDDY, 'plain', 'Save books<br>Sort books'], { encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 0); assert.match(r.stdout, /  - HTML, which a terminal shows as it is [^\n]*: <br>/);
});
