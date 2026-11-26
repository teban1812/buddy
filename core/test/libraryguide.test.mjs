import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { listProfiles, initProject } from '../src/init.mjs';
import { readContext } from '../src/context.mjs';

// The guide for library designers (core/LIBRARY-GUIDE.md) shows each component of a library with a minimal example. Each example is a fenced
// block after a marker naming the library file it is (<!-- file: questions/general.md -->), or the owner's answers (<!-- answers -->). This test
// assembles a library from them and runs Buddy's readers and one birth on it: an example Buddy would refuse fails here.
const CORE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const GUIDE = fs.readFileSync(path.join(CORE, 'LIBRARY-GUIDE.md'), 'utf8').replace(/\r\n/g, '\n');
const BLOCK = /<!-- (?:file: (\S+)|answers) -->\n```[a-z]*\n([\s\S]*?)\n```/g;
const blocks = [...GUIDE.matchAll(BLOCK)].map(m => ({ file: m[1] || null, text: `${m[2]}\n` }));
const FILES = Object.fromEntries(blocks.filter(b => b.file).map(b => [b.file, b.text]));
const ANSWERS = blocks.find(b => !b.file)?.text;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'guide-'));
const g = (cwd, c) => execSync(`git -c core.autocrlf=false -c user.name=t -c user.email=t@t ${c}`, { cwd, encoding: 'utf8' });

// Each component the guide must explain (AC1): its section's heading, and the library paths its examples must cover (AC2).
const COMPONENTS = {
  'library.json': ['library.json'],
  'The standards and their open values': ['standards/general/', 'standards/node-api/'],
  'The templates': ['templates/node-api/'],
  'The questions': ['questions/general.md', 'questions/node-api.md'],
  "The steps and each template's prefill": ['steps/', 'templates/node-api/docs/steps/'],
  'The normative documents': ['normative/index.md'],
  'The saved prompts': ['prompts/'],
};
const PARTS = ['**What it is.**|**What they are.**', '**Where it lives.**|**Where they live.**', '**Format', '**When Buddy reads', '**What he copies into the project.**', '**What he refuses.**', '**Example.**'];
const section = h => { const at = GUIDE.indexOf(`\n## ${h}\n`); assert.ok(at >= 0, `the guide has no section "${h}"`); const end = GUIDE.indexOf('\n## ', at + 1); return GUIDE.slice(at, end < 0 ? undefined : end); };

test('AC1, AC2: the guide opens with what a library is for and explains each component, with what Buddy does with it and an example', () => {
  assert.match(GUIDE.split('\n## ')[0], /The agent knows how to program, but it does not know your process\. The library defines the process, and Buddy runs it\./);
  assert.match(section('What a library cannot change'), /never accepts or signs for the owner/);
  for (const [h, paths] of Object.entries(COMPONENTS)) {
    const s = section(h);
    for (const p of PARTS) assert.ok(p.split('|').some(x => s.includes(x)), `"${h}" says nothing under ${p}`);
    const shown = [...s.matchAll(/<!-- file: (\S+) -->/g)].map(m => m[1]);
    for (const p of paths) assert.ok(shown.some(f => f.startsWith(p)), `"${h}" has no example of ${p}`);
  }
  assert.ok(ANSWERS, 'the guide shows an answers file');
});

test('AC2: a library assembled from the guide\'s examples is read and gives birth to a project without a refusal', () => {
  const lib = tmp(); g(lib, 'init -q');
  for (const [f, text] of Object.entries(FILES)) { fs.mkdirSync(path.dirname(path.join(lib, f)), { recursive: true }); fs.writeFileSync(path.join(lib, f), text); }
  g(lib, 'add -A'); g(lib, 'commit -q -m guide');
  const opts = { library: lib, env: {}, config: {} };

  const about = listProfiles(opts);   // buddy init --list-profiles
  assert.equal(about.contract, 2); assert.equal(about.defaultProfile, 'node-api'); assert.deepEqual(about.profiles.map(p => p.name), ['node-api']);
  assert.deepEqual(about.questions.map(q => q.id), ['Q-LANG']);
  const prof = listProfiles({ ...opts, profile: 'node-api' });   // buddy init --questions --profile node-api
  assert.deepEqual(prof.questions.map(q => q.id), ['Q-PUBLIC']);
  assert.deepEqual(prof.steps.map(s => [s.id, s.items.length, s.prefill]), [['privacy-review', 2, [{ id: 'PRV-01', file: 'src/buddy-app.mjs' }]]]);
  assert.deepEqual(prof.normative.map(x => x.id), ['SCS', 'PRIV']); assert.deepEqual(prof.prompts.map(p => p.name), ['release-review']);

  const d = path.join(tmp(), 'acme-orders'); fs.mkdirSync(d); const answers = path.join(tmp(), 'answers.json'); fs.writeFileSync(answers, ANSWERS);
  const who = { GIT_AUTHOR_NAME: 'Owner', GIT_AUTHOR_EMAIL: 'o@o', GIT_COMMITTER_NAME: 'Owner', GIT_COMMITTER_EMAIL: 'o@o' }; const was = {};
  for (const k of Object.keys(who)) { was[k] = process.env[k]; process.env[k] = who[k]; }
  let res; try { res = initProject({ ...opts, repo: d, host: 'github', answers }); } finally { for (const k of Object.keys(who)) if (was[k] === undefined) delete process.env[k]; else process.env[k] = was[k]; }
  const read = f => fs.readFileSync(path.join(d, f), 'utf8');
  assert.deepEqual(res.open, []); assert.ok(res.born);
  assert.match(read('docs/standards/general/documentation.md'), /documentation is written in English\./); assert.ok(fs.existsSync(path.join(d, 'docs/standards/node-api/code.md')));
  assert.match(read('src/acme-orders.mjs'), /The entry point of AcmeOrders\./); assert.equal(JSON.parse(read('package.json')).name, 'acme-orders');
  assert.ok(fs.existsSync(path.join(d, '.github/workflows/validate.yml')));
  const rec = read('docs/privacy/privacy-review.md');
  assert.match(rec, /- PRV-01: .*Decided by the base application in src\/acme-orders\.mjs\. `decided`\n/); assert.match(rec, /- PRV-02: .*To draft\. `unknown`\n/);
  assert.ok(fs.existsSync(path.join(d, 'docs/steps/privacy-review/step.md')));
  assert.equal(read('docs/standards/normative.md'), FILES['normative/index.md']); assert.ok(!fs.existsSync(path.join(d, 'normative')));
  assert.equal(read('.agents/skills/release-review/SKILL.md'), FILES['prompts/release-review/SKILL.md']);   // the full prompt; Claude Code's wrapper is tested in toolfiles.test.mjs
  assert.equal(fs.readdirSync(path.join(d, 'docs/decisions')).length, 1);
  const said = readContext(path.join(d, 'docs/context.md')).statements.filter(s => s.origin === 'human').map(s => [s.section, s.text]);
  assert.deepEqual(said.map(([s]) => s), ['Constraints', 'Risk appetite']); assert.match(said[0][1], /English\. Asked because: /);
  assert.equal(res.actions.find(a => a.what === 'the first commit')?.done, 'created');
});
