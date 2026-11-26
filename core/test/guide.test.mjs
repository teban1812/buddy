import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The developer's guide (docs/guide/) and the README (the public entry point) name only commands Buddy has, and every link in them resolves.
const CORE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.join(CORE, '..');
const GUIDE = path.join(ROOT, 'docs', 'guide');
const PAGES = ['README.md', 'overview.md', 'getting-started.md', 'discovery.md', 'working-alone.md', 'feedback.md', 'glossary.md', 'troubleshooting.md', 'commands.md'];
const docs = [...PAGES.map(p => path.join(GUIDE, p)), path.join(ROOT, 'README.md')].filter(f => fs.existsSync(f));
const read = f => fs.readFileSync(f, 'utf8');
const rel = f => path.relative(ROOT, f).split(path.sep).join('/');

const bin = read(path.join(CORE, 'bin', 'buddy.mjs'));
const commandBlock = /const COMMANDS = \{([\s\S]*?)\n\};/.exec(bin)[1];
const COMMANDS = new Set([...commandBlock.matchAll(/^ {2}([a-z-]+): /gm)].map(m => m[1]));
const aliasBlock = /const ALIAS = \{(.*?)\};/.exec(bin)[1];
const ALIAS = Object.fromEntries([...aliasBlock.matchAll(/'?([a-z-]+)'?: \['([a-z-]+)', '([a-z-]+)'\]/g)].map(m => [m[1], [m[2], m[3]]]));
// The usage of a command: the comment block at the head of its script and its usage strings.
const usage = cmd => { const s = read(path.join(CORE, 'bin', `${cmd}.mjs`)); return s.slice(0, s.search(/^import /m)) + (s.match(/usage:[^\n]*/g) || []).join('\n'); };
const SUBS = { slice: usage('slice'), context: usage('context') };

// `buddy <command> [<sub>]` as written in code (inline or in a block); prose such as "Buddy asks" is not a command.
function named(text) {
  const code = [...text.matchAll(/```[\s\S]*?```|`[^`\n]+`/g)].map(m => m[0]).join('\n');
  return [...code.matchAll(/\bbuddy(?:\.mjs)?[ \t]+([a-z][a-z-]*)(?:[ \t]+([a-z][a-z-]*))?/g)].map(m => ({ cmd: m[1], sub: m[2] }));
}

test('the guide has every page it lists', () => {
  for (const p of PAGES) assert.ok(fs.existsSync(path.join(GUIDE, p)), `docs/guide/${p} is missing`);
  const index = read(path.join(GUIDE, 'README.md'));
  for (const p of PAGES.slice(1)) assert.ok(index.includes(`](${p})`), `the guide's index does not link ${p}`);
});

test('every command the guide and the README name exists in Buddy, and so does each subcommand of slice and context', () => {
  const bad = []; let seen = 0;
  for (const f of docs) for (const { cmd, sub } of named(read(f))) {
    seen++;
    if (cmd === 'help') continue;
    const [c, s] = ALIAS[cmd] ? [ALIAS[cmd][0], ALIAS[cmd][1]] : [cmd, null];
    if (!COMMANDS.has(c)) { bad.push(`${rel(f)}: buddy ${cmd}`); continue; }
    if (s === 'milestone' && sub && !new RegExp(`milestone ${sub}\\b`).test(SUBS.slice)) bad.push(`${rel(f)}: buddy ${cmd} ${sub}`);
    else if (!s && SUBS[c] && sub && !new RegExp(`\\b${sub}\\b`).test(SUBS[c])) bad.push(`${rel(f)}: buddy ${cmd} ${sub}`);
  }
  assert.deepEqual(bad, [], 'commands the docs name that Buddy does not have');
  assert.ok(seen > 30, `only ${seen} commands found: the reading of the docs is broken`);
});

test('the check refuses a command Buddy does not have', () => {
  const found = named('Run `buddy frobnicate` and `buddy slice frobnicate`.');
  assert.deepEqual(found, [{ cmd: 'frobnicate', sub: undefined }, { cmd: 'slice', sub: 'frobnicate' }]);
  assert.ok(!COMMANDS.has('frobnicate') && !/\bfrobnicate\b/.test(SUBS.slice));
  assert.deepEqual(named('Buddy asks; buddy answers in prose.'), []);
});

test('every relative link in the guide and the README resolves, and so does its anchor', () => {
  const slug = h => h.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s/g, '-');
  const bad = [];
  for (const f of docs) for (const [, target] of read(f).matchAll(/\]\(([^)\s]+)\)/g)) {
    if (/^[a-z]+:/i.test(target)) continue;
    const [file, anchor] = target.split('#');
    const to = file ? path.resolve(path.dirname(f), file) : f;
    if (!fs.existsSync(to)) { bad.push(`${rel(f)}: ${target}`); continue; }
    if (anchor && to.endsWith('.md') && ![...read(to).matchAll(/^#+ (.+)$/gm)].some(m => slug(m[1]) === anchor)) bad.push(`${rel(f)}: ${target} (no such heading)`);
  }
  assert.deepEqual(bad, []);
});

test('the README gives a first start in at most five commands, and installs Buddy exactly as getting-started does', () => {
  const block = /## A first start[\s\S]*?```bash\n([\s\S]*?)```/.exec(read(path.join(ROOT, 'README.md')));
  assert.ok(block, 'the README has a first start with its commands');
  const lines = block[1].split('\n').filter(l => l.trim());
  assert.ok(lines.length <= 5, `${lines.length} commands`);
  const install = s => s.split('\n').filter(l => l.startsWith('claude plugin '));
  assert.deepEqual(install(block[1]), install(read(path.join(GUIDE, 'getting-started.md'))));
  assert.equal(install(block[1]).length, 2);
});
