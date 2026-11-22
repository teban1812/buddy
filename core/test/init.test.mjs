import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync, execSync } from 'node:child_process';
import { readContext, riskState } from '../src/context.mjs';
import { verify } from '../src/verify.mjs';
import { chooseLibrary as chooseLibraryFrom, libraryChoice, parseLibraryVar, latestTag, publicUrl, projectNames, DEFAULT_LIBRARY, FALLBACK_PROFILE, CONTRACTS, fetchLibrary, libraryLine } from '../src/init.mjs';
import { runWithTimeout } from '../src/proc.mjs';
import { routineRules, buddyCommands, writePermissions, PLUGIN_ROOT } from '../src/permissions.mjs';
import { startSlice, moveSlice } from '../src/slicestore.mjs';
import { loadBoard } from '../src/board.mjs';

const BUDDY = fileURLToPath(new URL('../bin/buddy.mjs', import.meta.url));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'init-'));
// Every run has a private home (so the user's own ~/.buddy is never read or touched) and no BUDDY_LIBRARY, unless given.
const HOME = tmp();
const run = (args, cwd, { home = HOME, env = {} } = {}) => {
  const e = { ...process.env, HOME: home, USERPROFILE: home }; delete e.BUDDY_LIBRARY;
  return spawnSync('node', [BUDDY, ...args], { encoding: 'utf8', cwd, env: { ...e, ...env } });
};
const g = (cwd, c) => execSync(`git -c core.autocrlf=false -c user.name=t -c user.email=t@t ${c}`, { cwd, encoding: 'utf8' });
const snapshot = dir => { const out = {}; const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.name === '.git') continue; if (e.isDirectory()) { out[path.relative(dir, p) + '/'] = ''; walk(p); } else out[path.relative(dir, p)] = fs.readFileSync(p, 'utf8'); } }; walk(dir); return out; };

test('init in an empty folder: git, the changes folder and a context that the reader, check and verify accept', () => {
  const d = path.join(tmp(), 'shop');  fs.mkdirSync(d);
  const r = run(['init', '--no-library'], d); assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(d, '.git'))); assert.ok(fs.statSync(path.join(d, 'docs/buddy/backlog')).isDirectory());
  assert.match(r.stdout, /created +a git repository/); assert.match(r.stdout, /Next: the owner tells the story of the business/);
  assert.doesNotMatch(r.stdout, /\b[RQ]\d+\b/);
  const ctx = readContext(path.join(d, 'docs/context.md'));
  assert.equal(ctx.data.schema, 'buddy/context@0'); assert.equal(ctx.data.title, 'Business context of shop'); assert.equal(ctx.data.owner, 'the Product Owner'); assert.equal(ctx.data.status, 'draft'); assert.match(ctx.data.updated, /^\d{4}-\d{2}-\d{2}$/);
  const heads = fs.readFileSync(path.join(d, 'docs/context.md'), 'utf8').match(/^## .*$/gm);
  assert.deepEqual(heads, ['## Purpose and outcomes', '## Users', '## Constraints', '## Risk appetite', '## Unknowns']);
  assert.equal(riskState(ctx).state, 'missing');
  assert.equal(run(['context', 'check', 'docs/context.md'], d).status, 0);
  assert.deepEqual(verify([path.join(d, 'docs')]).problems, []);
});
test('init keeps a docs/buddy/changes/ of before milestones and creates no backlog next to it', () => {
  const d = path.join(tmp(), 'shop'); fs.mkdirSync(path.join(d, 'docs/buddy/changes'), { recursive: true });
  const r = run(['init', '--no-library'], d); assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /kept +docs\/buddy\/changes\/.*buddy migrate moves it to docs\/buddy\/backlog\//); assert.ok(!fs.existsSync(path.join(d, 'docs/buddy/backlog')));
});
test('init inside an existing repository uses it, and a second run changes nothing', () => {
  const d = tmp(); g(d, 'init -q'); const sub = path.join(d, 'app'); fs.mkdirSync(sub);
  const r = run(['init', '--no-library', '--repo', sub], d); assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /used +the git repository/); assert.ok(!fs.existsSync(path.join(sub, '.git')));
  const before = snapshot(sub);
  const again = run(['init', '--no-library', '--repo', sub], d); assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /^Nothing to do/); assert.deepEqual(snapshot(sub), before);
});
test('init never overwrites an existing context or standards folder', () => {
  const d = tmp(); const lib = tmp(); fs.writeFileSync(path.join(lib, 'stack.md'), '# stack\n');
  fs.mkdirSync(path.join(d, 'docs/standards'), { recursive: true }); fs.writeFileSync(path.join(d, 'docs/context.md'), 'mine'); fs.writeFileSync(path.join(d, 'docs/standards/own.md'), 'own');
  const r = run(['init', '--standards', lib], d); assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(path.join(d, 'docs/context.md'), 'utf8'), 'mine');
  assert.deepEqual(fs.readdirSync(path.join(d, 'docs/standards')), ['own.md']);
  assert.match(r.stdout, /kept +docs\/context\.md/); assert.match(r.stdout, /kept +docs\/standards\/ \(already there, left as it was; the standards were not copied\)/);
});
test('init --standards copies the library without its .git and pins its commit; uncommitted changes are noted', () => {
  const lib = tmp(); g(lib, 'init -q'); fs.mkdirSync(path.join(lib, 'dotnet')); fs.writeFileSync(path.join(lib, 'dotnet/rules.md'), '# rules\n'); g(lib, 'add -A'); g(lib, 'commit -q -m lib');
  const sha = g(lib, 'rev-parse HEAD').trim();
  const d = tmp(); const r = run(['init', '--standards', path.join(lib, 'dotnet')], d); assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(path.join(d, 'docs/standards/rules.md'), 'utf8'), '# rules\n');
  const note = fs.readFileSync(path.join(d, 'docs/standards/ORIGIN.md'), 'utf8');
  assert.ok(note.includes(path.join(lib, 'dotnet'))); assert.ok(note.includes(sha)); assert.match(note, /Uncommitted changes in the source folder when copied: no/);
  assert.match(r.stdout, new RegExp(`copied +docs/standards/ \\(from .*commit ${sha.slice(0, 12)}`));
  fs.writeFileSync(path.join(lib, 'dotnet/rules.md'), '# rules v2\n');
  const d2 = tmp(); assert.equal(run(['init', '--standards', path.join(lib, 'dotnet')], d2).status, 0);
  assert.match(fs.readFileSync(path.join(d2, 'docs/standards/ORIGIN.md'), 'utf8'), /when copied: yes/);
  const whole = tmp(); assert.equal(run(['init', '--standards', lib], whole).status, 0); assert.ok(!fs.existsSync(path.join(whole, 'docs/standards/.git')));
});
test('init --standards outside git says there is no commit; a missing folder is refused before anything is written', () => {
  const lib = tmp(); fs.writeFileSync(path.join(lib, 'a.md'), 'a');
  const d = tmp(); assert.equal(run(['init', '--standards', lib], d).status, 0);
  if (spawnSync('git', ['rev-parse'], { cwd: lib }).status !== 0) assert.match(fs.readFileSync(path.join(d, 'docs/standards/ORIGIN.md'), 'utf8'), /Not in a git repository/);
  const e = tmp(); const bad = run(['init', '--standards', path.join(lib, 'nope')], e);
  assert.equal(bad.status, 1); assert.match(bad.stderr, /does not exist/); assert.deepEqual(fs.readdirSync(e), []);
});

// --- libraries: a small fake library, local and in git; never the network ---
const BIN = Buffer.from([0, 1, 2, ...Buffer.from('BuddyApp'), 0]);
const put = (root, files) => { for (const [f, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), c); } };
// standards/general (unless general: false), standards/x and standards/y; templates/x: a base application named with the
// placeholders, whose validate checks the renaming; templates/empty: an empty project whose validate passes.
const EMPTY_TEMPLATE = {
  'templates/empty/README.md': '# BuddyApp\n', 'templates/empty/.gitignore': 'node_modules/\n', 'templates/empty/.editorconfig': 'root = true\n',
  'templates/empty/package.json': JSON.stringify({ name: 'buddy-app', private: true, scripts: { validate: 'node -e "console.log(\'nothing is checked yet\')"' } }, null, 2) + '\n',
};
// The pipelines of templates/x, one per host (unless pipelines: false); the empty template brings none.
const PIPELINES = { 'templates/x/.github/workflows/validate.yml': 'name: buddy-app\non: push\n', 'templates/x/azure-pipelines.yml': "trigger: ['*']\n# buddy-app\n" };
function fakeLibrary({ scripts = { validate: 'node check.mjs' }, general = true, pipelines = true } = {}) {
  const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'lib-')); g(lib, 'init -q');
  if (general) put(lib, { 'standards/general/team.md': '---\nlifecycle: evergreen\n---\n# team\n' });
  put(lib, EMPTY_TEMPLATE);
  put(lib, {
    'standards/x/rules.md': '# rules\n', 'standards/x/web/react.md': '# react\n', 'standards/y/other.md': '# other\n',
    'templates/x/package.json': JSON.stringify({ name: 'buddy-app', private: true, ...(scripts ? { scripts } : {}) }, null, 2) + '\n',
    'templates/x/check.mjs': "import fs from 'node:fs';\nif (!fs.readFileSync('src/BuddyApp.Api/Program.cs', 'utf8').includes('namespace BuddyApp.Api;')) process.exit(1);\n",
    'templates/x/src/BuddyApp.Api/Program.cs': 'namespace BuddyApp.Api;\n// served at /buddy-app\n',
    'templates/x/README.md': '# BuddyApp v1\n', 'templates/x/assets/logo.bin': BIN,
    ...(pipelines ? PIPELINES : {}),
  });
  g(lib, 'add -A'); g(lib, 'commit -q -m v1'); g(lib, 'tag v1');
  const v1 = g(lib, 'rev-parse HEAD').trim();
  put(lib, { 'templates/x/README.md': '# BuddyApp v2\n' }); g(lib, 'commit -q -am v2');
  return { lib, v1, head: g(lib, 'rev-parse HEAD').trim() };
}
const project = name => { const d = path.join(tmp(), name); fs.mkdirSync(d); return d; };

test('without a library named anywhere, init chooses the default library, no fixed version, and the default profile', () => {
  const chooseLibrary = (o = {}) => chooseLibraryFrom({ env: {}, config: {}, ...o });
  // No profile is chosen before the library is read: its library.json names the default (AC2), else FALLBACK_PROFILE.
  assert.deepEqual(chooseLibrary(), { source: DEFAULT_LIBRARY.url, shown: DEFAULT_LIBRARY.url, local: false, isDefault: true, from: 'default', version: null, profile: null });
  assert.deepEqual(Object.keys(DEFAULT_LIBRARY), ['url']); assert.equal(FALLBACK_PROFILE, 'dotnet-react');
  assert.equal(DEFAULT_LIBRARY.url, 'https://github.com/teban1812/buddy-default-library.git');
  const v = chooseLibrary({ version: 'v0.2.0', profile: 'other' }); assert.equal(v.source, DEFAULT_LIBRARY.url); assert.equal(v.version, 'v0.2.0'); assert.equal(v.profile, 'other');
  const named = chooseLibrary({ library: 'https://github.com/acme/standards.git' }); assert.equal(named.isDefault, false); assert.equal(named.version, null); assert.equal(named.local, false);
  const local = chooseLibrary({ library: 'some/folder' }); assert.equal(local.local, true); assert.equal(local.source, path.resolve('some/folder'));
  assert.equal(chooseLibrary({ library: 'git@github.com:acme/standards.git' }).local, false);
});
test('a library address is written down without its credentials or query', () => {
  assert.equal(publicUrl('https://user:s3cret@github.com/acme/lib.git?token=abc#x'), 'https://github.com/acme/lib.git');
  assert.equal(publicUrl('https://ghp_TOKEN@github.com/acme/lib.git'), 'https://github.com/acme/lib.git');
  assert.equal(publicUrl('git@github.com:acme/lib.git'), 'git@github.com:acme/lib.git');
  assert.equal(publicUrl('C:\\libs\\mine'), 'C:\\libs\\mine');
});
test('a library that cannot be fetched is refused, saying where and at which version', () => {
  const lib = chooseLibraryFrom({ library: 'file:///no/such/buddy-library-here', version: 'v1', env: {}, config: {} });
  assert.throws(() => fetchLibrary(lib), /could not get the library file:\/\/\/no\/such\/buddy-library-here at version v1/);
});
test('the application is named after the project folder, ASCII-folded; a name that cannot be a C# identifier is refused', () => {
  assert.deepEqual(projectNames('shop-app'), { pascal: 'ShopApp', kebab: 'shop-app' });
  assert.deepEqual(projectNames('Café Señor'), { pascal: 'CafeSenor', kebab: 'cafe-senor' });
  assert.deepEqual(projectNames('MyShop'), { pascal: 'MyShop', kebab: 'my-shop' });
  assert.deepEqual(projectNames('straße_2'), { pascal: 'Strasse2', kebab: 'strasse-2' });
  assert.throws(() => projectNames('2048'), /cannot start with a digit/);
  assert.throws(() => projectNames('日本'), /no letters or digits/);
});
test('init --library copies the profile\'s standards with their origin and the template renamed, then the project is born healthy', () => {
  const { lib, head } = fakeLibrary({ scripts: { setup: 'node -e "0"', validate: 'node check.mjs' } }); const d = project('shop-app');
  const r = run(['init', '--library', lib, '--profile', 'x', '--host', 'none'], d); assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(path.join(d, 'docs/standards/x/web/react.md'), 'utf8'), '# react\n'); assert.ok(!fs.existsSync(path.join(d, 'docs/standards/y')));
  assert.equal(fs.readFileSync(path.join(d, 'docs/standards/general/team.md'), 'utf8'), '---\nlifecycle: evergreen\n---\n# team\n');
  assert.deepEqual(fs.readdirSync(path.join(d, 'docs/standards')).sort(), ['ORIGIN.md', 'general', 'x']);
  const note = fs.readFileSync(path.join(d, 'docs/standards/ORIGIN.md'), 'utf8');
  assert.ok(note.includes(lib)); assert.ok(note.includes(head)); assert.match(note, /Profile: `x`/); assert.match(note, /Standards copied: `docs\/standards\/general\/` .*, `docs\/standards\/x\/`/); assert.match(note, /lifecycle: birth.*lifecycle: evergreen/); assert.match(note, /Version requested: none: the library.s last commit/); assert.match(note, /Uncommitted changes in the library: none/);
  assert.equal(fs.readFileSync(path.join(d, 'src/ShopApp.Api/Program.cs'), 'utf8'), 'namespace ShopApp.Api;\n// served at /shop-app\n');
  assert.equal(JSON.parse(fs.readFileSync(path.join(d, 'package.json'), 'utf8')).name, 'shop-app');
  assert.equal(fs.readFileSync(path.join(d, 'README.md'), 'utf8'), '# ShopApp v2\n');
  assert.deepEqual(fs.readFileSync(path.join(d, 'assets/logo.bin')), BIN);   // binary files are copied as they are
  assert.ok(!fs.existsSync(path.join(d, 'src/BuddyApp.Api'))); assert.ok(!fs.existsSync(path.join(d, 'templates')));
  assert.equal(g(d, 'rev-list --all').trim(), '');   // the project's own repository, without the library's history
  assert.match(r.stdout, /copied +docs\/standards\/ \(general\/ and x\/; profile x of .*commit [0-9a-f]{12}/); assert.match(r.stdout, /copied +the base application \(5 files .*named ShopApp \(shop-app\)/);
  assert.match(r.stdout, /born healthy: npm run setup passed .*npm run validate passed/);
  assert.doesNotMatch(r.stdout, /\b[RQ]\d+\b/);
  const again = run(['init', '--library', path.join(lib, 'gone')], d); assert.equal(again.status, 0, again.stderr);   // a second run reads no library
  assert.match(again.stdout, /^Nothing to do/);
});
test('init --version takes the library at that version and records it; --no-template leaves the application out', () => {
  const { lib, v1 } = fakeLibrary({ scripts: null }); const d = project('shop');   // no scripts: the slow npm runs only where they are the point
  const r = run(['init', '--library', lib, '--version', 'v1', '--profile', 'x', '--no-template'], d); assert.equal(r.status, 0, r.stderr);
  const note = fs.readFileSync(path.join(d, 'docs/standards/ORIGIN.md'), 'utf8'); assert.match(note, /Version requested: `v1`/); assert.ok(note.includes(v1));
  assert.match(r.stdout, new RegExp(`version v1, commit ${v1.slice(0, 12)}`)); assert.match(r.stdout, /skipped +the base application \(not asked for/);
  assert.ok(!fs.existsSync(path.join(d, 'package.json'))); assert.doesNotMatch(r.stdout, /Health/);
  const t = project('tagged'); const byCommit = run(['init', '--library', lib, '--version', v1, '--profile', 'x', '--host', 'none'], t);   // a commit works as a version
  assert.equal(byCommit.status, 0, byCommit.stderr); assert.equal(fs.readFileSync(path.join(t, 'README.md'), 'utf8'), '# Tagged v1\n');
  assert.match(byCommit.stdout, /Health: the base application has no validate command, so it was not checked/);
});
test('a local library in git gives only what it has committed: no ignored, untracked or uncommitted file, and it says so', () => {
  const { lib } = fakeLibrary({ scripts: null });
  put(lib, { '.gitignore': 'node_modules/\n' }); g(lib, 'add .gitignore'); g(lib, 'commit -q -m ignore');
  put(lib, {
    'templates/x/web/node_modules/x/index.js': 'installed\n', 'standards/x/web/node_modules/y.md': 'installed\n',   // ignored
    'templates/x/notes.txt': 'untracked\n', 'standards/x/draft.md': 'untracked\n',                                    // untracked
    'templates/x/README.md': '# BuddyApp uncommitted\n', 'standards/x/rules.md': '# rules uncommitted\n',             // uncommitted
  });
  const d = project('shop'); const r = run(['init', '--library', lib, '--profile', 'x', '--host', 'none'], d); assert.equal(r.status, 0, r.stderr);
  assert.ok(!fs.existsSync(path.join(d, 'web'))); assert.ok(!fs.existsSync(path.join(d, 'notes.txt')));
  assert.ok(!fs.existsSync(path.join(d, 'docs/standards/x/web/node_modules'))); assert.ok(!fs.existsSync(path.join(d, 'docs/standards/x/draft.md')));
  assert.equal(fs.readFileSync(path.join(d, 'README.md'), 'utf8'), '# Shop v2\n'); assert.equal(fs.readFileSync(path.join(d, 'docs/standards/x/rules.md'), 'utf8'), '# rules\n');
  assert.match(r.stdout, /uncommitted changes were NOT included/); assert.match(r.stdout, /5 files of the profile's template/);
  assert.match(fs.readFileSync(path.join(d, 'docs/standards/ORIGIN.md'), 'utf8'), /Uncommitted changes in the library: yes, and they were NOT included/);
});
test('a local library folder that is not in git is copied as it is, without installed or built folders, and says it is not versioned', () => {
  const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'plainlib-'));
  if (spawnSync('git', ['rev-parse'], { cwd: lib }).status === 0) return;   // the temporary folder is inside a repository here
  put(lib, { 'standards/x/rules.md': '# rules\n', 'standards/x/node_modules/a.md': 'a', 'templates/x/README.md': '# BuddyApp\n',
    'templates/x/web/node_modules/x.js': 'x', 'templates/x/src/BuddyApp/bin/a.dll': 'x', 'templates/x/src/BuddyApp/obj/a': 'x', 'templates/x/web/dist/a.js': 'x' });
  const d = project('shop'); const r = run(['init', '--library', lib, '--profile', 'x'], d); assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(path.join(d, 'README.md'), 'utf8'), '# Shop\n'); assert.equal(fs.readFileSync(path.join(d, 'docs/standards/x/rules.md'), 'utf8'), '# rules\n');
  for (const f of ['web', 'src', 'docs/standards/x/node_modules']) assert.ok(!fs.existsSync(path.join(d, f)), f);
  assert.match(r.stdout, /not versioned: copied as it was, without node_modules, bin, obj, dist and \.git/); assert.match(r.stdout, /1 file of the profile's template/);
  assert.match(fs.readFileSync(path.join(d, 'docs/standards/ORIGIN.md'), 'utf8'), /Version requested: none: the library folder is not versioned/);
});
test('init never overwrites a file of the project with the template: it reports it and leaves it', () => {
  const { lib } = fakeLibrary({ scripts: null }); const d = project('shop'); g(d, 'init -q'); fs.writeFileSync(path.join(d, 'README.md'), 'mine\n');
  const r = run(['init', '--library', lib, '--profile', 'x', '--host', 'none'], d); assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(path.join(d, 'README.md'), 'utf8'), 'mine\n'); assert.ok(fs.existsSync(path.join(d, 'src/Shop.Api/Program.cs')));
  assert.match(r.stdout, /4 files .*; 1 already existed and was left as it was: README\.md/);
});
test('a base application whose validate fails is reported in plain words, and init still succeeds', () => {
  const { lib } = fakeLibrary({ scripts: { validate: 'node -e "console.log(\'2 tests failed\');process.exit(3)"' } }); const d = project('shop');
  const r = run(['init', '--library', lib, '--profile', 'x', '--host', 'none'], d); assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /NOT healthy yet/); assert.match(r.stdout, /npm run validate failed \(exit code [1-9]\d*\)/);   // the exact code is the npm script-shell's (PowerShell may turn a 3 into a 1) assert.match(r.stdout, /2 tests failed/);
});
test('init refuses, before writing anything, a profile the library lacks, a folder name that cannot name the application, and mixed options', () => {
  const { lib } = fakeLibrary();
  const a = project('shop'); const bad = run(['init', '--library', lib, '--profile', 'z'], a);
  assert.equal(bad.status, 1); assert.match(bad.stderr, /has no profile "z".*its profiles: empty, x, y/); assert.deepEqual(fs.readdirSync(a), []);
  const b = project('2048'); const num = run(['init', '--library', lib, '--profile', 'x'], b);
  assert.equal(num.status, 1); assert.match(num.stderr, /cannot start with a digit/); assert.deepEqual(fs.readdirSync(b), []);
  assert.equal(run(['init', '--library', lib, '--profile', 'x', '--no-template'], b).status, 0);   // without the application, the name does not matter
  const c = project('mix'); const mix = run(['init', '--library', lib, '--standards', lib], c);
  assert.equal(mix.status, 1); assert.match(mix.stderr, /not both/); assert.deepEqual(fs.readdirSync(c), []);
});
test('the empty profile gets only the general standards and an empty project that is born healthy', () => {
  const { lib } = fakeLibrary(); const d = project('blank');
  const r = run(['init', '--library', lib, '--profile', 'empty'], d); assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(fs.readdirSync(path.join(d, 'docs/standards')).sort(), ['ORIGIN.md', 'general']);
  assert.match(r.stdout, /copied +docs\/standards\/ \(general\/, the profile empty has no standards of its own; profile empty of/);
  assert.match(fs.readFileSync(path.join(d, 'docs/standards/ORIGIN.md'), 'utf8'), /The profile `empty` has no standards of its own .*only the general ones were copied/);
  for (const f of ['README.md', '.gitignore', '.editorconfig', 'package.json']) assert.ok(fs.existsSync(path.join(d, f)), f);
  assert.equal(fs.readFileSync(path.join(d, 'README.md'), 'utf8'), '# Blank\n');
  assert.match(r.stdout, /copied +the base application \(4 files/); assert.match(r.stdout, /born healthy: npm run validate passed/);
  assert.doesNotMatch(r.stdout, /already holds a project/);
  assert.doesNotMatch(r.stdout, /pipeline/i);   // a template without pipelines needs no --host, and nothing is said about one
});
test('a library without general standards gives only the profile\'s, and says so', () => {
  const { lib } = fakeLibrary({ scripts: null, general: false }); const d = project('shop');
  const r = run(['init', '--library', lib, '--profile', 'x', '--no-template'], d); assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(fs.readdirSync(path.join(d, 'docs/standards')).sort(), ['ORIGIN.md', 'x']);
  assert.match(r.stdout, /copied +docs\/standards\/ \(x\/, the library has no general standards; profile x of/);
  assert.match(fs.readFileSync(path.join(d, 'docs/standards/ORIGIN.md'), 'utf8'), /The library has no general standards .*only the profile's were copied/);
});
test('a folder that already holds a project gets the standards but no template, and is told so; a folder with only what init makes still gets the template', () => {
  const { lib } = fakeLibrary(); const d = project('2048');   // no application is named, so a name that could not name one does not matter
  put(d, { 'package.json': '{"name":"legacy"}\n', 'src/index.js': 'console.log(1)\n', 'README.md': '# legacy\n' });
  const r = run(['init', '--library', lib, '--profile', 'x'], d); assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(fs.readdirSync(path.join(d, 'docs/standards')).sort(), ['ORIGIN.md', 'general', 'x']);
  assert.equal(fs.readFileSync(path.join(d, 'package.json'), 'utf8'), '{"name":"legacy"}\n'); assert.ok(!fs.existsSync(path.join(d, 'check.mjs'))); assert.ok(!fs.existsSync(path.join(d, 'src/BuddyApp.Api')));
  assert.match(r.stdout, /skipped +the base application \(the folder already holds a project: package\.json, src\/\)/);
  assert.ok(r.stdout.includes('This folder already holds a project: no template was copied; the standards apply to the code each change writes from now on, and existing code that is not touched is not forced to follow them.'));
  assert.doesNotMatch(r.stdout, /Health/); assert.doesNotMatch(r.stdout, /\b[RQ]\d+\b/);
  assert.doesNotMatch(r.stdout, /pipeline/i); assert.ok(!fs.existsSync(path.join(d, '.github')));   // an existing project needs no --host
  const n = project('fresh'); g(n, 'init -q'); put(n, { 'README.md': '# mine\n', 'LICENSE': 'MIT\n', '.gitignore': 'x\n', '.editorconfig': 'root = true\n', '.claude/settings.json': '{}', 'docs/notes.md': 'n' });
  const fresh = run(['init', '--library', lib, '--profile', 'empty'], n); assert.equal(fresh.status, 0, fresh.stderr);
  assert.ok(fs.existsSync(path.join(n, 'package.json'))); assert.doesNotMatch(fresh.stdout, /already holds a project/);
  assert.match(fresh.stdout, /copied +the base application \(1 file .*3 already existed/);
});
// --- the pipeline of the repository's host ---
test('init --host keeps only that host\'s pipeline of the template, says so in plain words and records it', () => {
  const { lib } = fakeLibrary({ scripts: null });
  const cases = {
    github: { has: ['.github/workflows/validate.yml'], not: ['azure-pipelines.yml'], says: 'The project runs its checks on every push in GitHub Actions (.github/workflows/validate.yml).' },
    azure: { has: ['azure-pipelines.yml'], not: ['.github'], says: 'The project runs its checks on every push in Azure Pipelines (azure-pipelines.yml).' },
    none: { has: [], not: ['.github', 'azure-pipelines.yml'], says: 'No pipeline: the project was born without one.' },
  };
  for (const [host, c] of Object.entries(cases)) {
    const d = project(`shop-${host}`); const r = run(['init', '--library', lib, '--profile', 'x', '--host', host], d); assert.equal(r.status, 0, r.stderr);
    for (const f of c.has) assert.ok(fs.existsSync(path.join(d, f)), `${host}: ${f}`);
    for (const f of c.not) assert.ok(!fs.existsSync(path.join(d, f)), `${host}: ${f}`);
    assert.ok(r.stdout.includes(c.says), r.stdout); assert.doesNotMatch(r.stdout, /\b[RQ]\d+\b/);
    const note = fs.readFileSync(path.join(d, 'docs/standards/ORIGIN.md'), 'utf8');
    assert.ok(note.includes(`- Repository host: \`${host}\`; ${c.says[0].toLowerCase()}${c.says.slice(1, -1)}\n`), note);
    if (host === 'github') assert.equal(fs.readFileSync(path.join(d, '.github/workflows/validate.yml'), 'utf8'), 'name: shop-github\non: push\n');   // renamed like the rest
  }
});
test('init without --host, when the template brings pipelines, is refused before anything is written, naming the three choices', () => {
  const { lib } = fakeLibrary({ scripts: null }); const d = project('shop');
  const r = run(['init', '--library', lib, '--profile', 'x'], d);
  assert.equal(r.status, 1); assert.deepEqual(fs.readdirSync(d), []);
  assert.match(r.stderr, /--host github \(GitHub Actions\), --host azure \(Azure Pipelines\) or --host none \(no pipeline\)\. Nothing was written/);
  assert.doesNotMatch(r.stderr, /\b[RQ]\d+\b/);
  const bad = run(['init', '--library', lib, '--profile', 'x', '--host', 'gitlab'], d);
  assert.equal(bad.status, 1); assert.match(bad.stderr, /github, azure, none; not "gitlab"/); assert.deepEqual(fs.readdirSync(d), []);
  const plain = fakeLibrary({ scripts: null, pipelines: false }); const p = project('plain');   // a template without pipelines needs no --host
  const rp = run(['init', '--library', plain.lib, '--profile', 'x'], p); assert.equal(rp.status, 0, rp.stderr); assert.doesNotMatch(rp.stdout, /pipeline/i);
  assert.doesNotMatch(fs.readFileSync(path.join(p, 'docs/standards/ORIGIN.md'), 'utf8'), /Repository host/);
  assert.equal(run(['init', '--library', lib, '--profile', 'x', '--no-template'], project('bare')).status, 0);   // no template copied, no --host
  assert.equal(run(['init', '--list-profiles', '--library', lib], tmp()).status, 0);   // listing the profiles needs no --host
});
// --- which library (R104): option, BUDDY_LIBRARY, the user's configuration, the default; its latest version; its profiles ---
test('the library comes from --library, else BUDDY_LIBRARY, else the user\'s configuration, else the default; the version travels with its source', () => {
  const env = { BUDDY_LIBRARY: 'https://env.example/lib.git#v3.0.0' }; const config = { library: { source: 'https://conf.example/lib.git', version: 'v2.0.0' } };
  assert.deepEqual(parseLibraryVar('C:\\libs\\mine#1.2.0'), { source: 'C:\\libs\\mine', version: '1.2.0' });
  assert.deepEqual(parseLibraryVar(' https://x/lib.git '), { source: 'https://x/lib.git', version: null }); assert.equal(parseLibraryVar('  '), null);
  const o = libraryChoice({ library: 'https://opt.example/lib.git' }, env, config); assert.equal(o.from, 'option'); assert.equal(o.source, 'https://opt.example/lib.git'); assert.equal(o.version, null);
  const ov = libraryChoice({ library: 'https://opt.example/lib.git', version: 'v9.0.0' }, env, config); assert.equal(ov.version, 'v9.0.0'); assert.equal(ov.versionFrom, 'option');
  const e = libraryChoice({}, env, config); assert.equal(e.from, 'env'); assert.equal(e.source, 'https://env.example/lib.git'); assert.equal(e.version, 'v3.0.0');
  assert.equal(libraryChoice({ version: 'v4.0.0' }, env, config).version, 'v4.0.0');   // --version alone keeps the library and changes its version
  const c = libraryChoice({}, {}, config); assert.equal(c.from, 'config'); assert.equal(c.source, 'https://conf.example/lib.git'); assert.equal(c.version, 'v2.0.0');
  const d = libraryChoice({}, { BUDDY_LIBRARY: '' }, {}); assert.equal(d.from, 'default'); assert.equal(d.source, DEFAULT_LIBRARY.url); assert.equal(d.version, null);
  const ch = chooseLibraryFrom({ env: {}, config }); assert.equal(ch.isDefault, false); assert.equal(ch.from, 'config');
});
test('buddy library --set, --show and --unset keep the library in the user\'s configuration, say which source wins, and never show credentials', () => {
  const home = tmp(); const cwd = tmp(); const cfg = path.join(home, '.buddy', 'config.json');
  fs.mkdirSync(path.dirname(cfg)); fs.writeFileSync(cfg, JSON.stringify({ factory: 'C:\\factory' }));
  const def = run(['library', '--show'], cwd, { home }); assert.equal(def.status, 0, def.stderr);   // the default: its address only, never cloned
  assert.ok(def.stdout.includes(`Library: ${DEFAULT_LIBRARY.url} (Buddy's default library)`)); assert.match(def.stdout, /Why this one: neither the BUDDY_LIBRARY variable nor your Buddy configuration/); assert.match(def.stdout, /latest published version/);
  const set = run(['library', '--set', 'https://bot:s3cret@git.example/acme/lib.git', '--version', 'v1.4.0'], cwd, { home }); assert.equal(set.status, 0, set.stderr);
  assert.match(set.stdout, /Your library is https:\/\/git\.example\/acme\/lib\.git at version v1\.4\.0/);
  assert.deepEqual(JSON.parse(fs.readFileSync(cfg, 'utf8')), { factory: 'C:\\factory', library: { source: 'https://bot:s3cret@git.example/acme/lib.git', version: 'v1.4.0' } });
  const conf = run(['library', '--show'], cwd, { home }); assert.match(conf.stdout, /Library: https:\/\/git\.example\/acme\/lib\.git\n/); assert.match(conf.stdout, /Version: v1\.4\.0 \(set with the library in your Buddy configuration\)/); assert.match(conf.stdout, /Why this one: it is set in your Buddy configuration/);
  const env = run(['library', '--show'], cwd, { home, env: { BUDDY_LIBRARY: 'https://env.example/lib.git#2.0.0' } });
  assert.match(env.stdout, /Library: https:\/\/env\.example\/lib\.git\n/); assert.match(env.stdout, /Version: 2\.0\.0 \(from the BUDDY_LIBRARY variable\)/); assert.match(env.stdout, /wins over your Buddy configuration \(which names https:\/\/git\.example\/acme\/lib\.git, not used/);
  for (const r of [set, conf, env]) assert.doesNotMatch(r.stdout + r.stderr, /s3cret|bot@/);
  assert.equal(run(['library', '--set', path.join(home, 'nope')], cwd, { home }).status, 1);
  const un = run(['library', '--unset'], cwd, { home }); assert.equal(un.status, 0, un.stderr); assert.match(un.stdout, /no longer names a library/); assert.doesNotMatch(un.stdout, /s3cret/);
  assert.deepEqual(JSON.parse(fs.readFileSync(cfg, 'utf8')), { factory: 'C:\\factory' });
  assert.equal(run(['library', '--bogus'], cwd, { home }).status, 2);
  for (const r of [def, set, conf, env, un]) assert.doesNotMatch(r.stdout, /\b[RQ]\d+\b/);
});
test('the latest version is the highest version tag, with or without v; a pre-release only when there is nothing else', () => {
  assert.equal(latestTag(['v1.2.0', '1.10.0', 'v2.0.0-rc.1', 'v1.9.9', 'v1', 'latest', 'v1.9.9+build.5']), '1.10.0');
  assert.equal(latestTag(['v2.0.0-rc.2', 'v2.0.0-rc.10', 'v2.0.0-beta', 'v1.0.0-alpha']), 'v2.0.0-rc.10');
  assert.equal(latestTag(['v1', 'release', 'main']), null); assert.equal(latestTag([]), null);
});
// A library published as a git URL (here file://, never the network): three version tags, one a pre-release and one
// annotated, and a commit after the last of them.
function versionedLibrary({ tags = true } = {}) {
  const { lib } = fakeLibrary({ scripts: null }); g(lib, 'tag -d v1'); const at = {};
  for (const [tag, how] of [['v1.0.0', 'tag'], ['1.2.0', 'tag -a -m release'], ['v2.0.0-beta.1', 'tag']]) {
    put(lib, { 'templates/x/README.md': `# BuddyApp ${tag}\n` }); g(lib, `commit -q -am ${tag}`); if (tags) g(lib, `${how} ${tag}`); at[tag] = g(lib, 'rev-parse HEAD').trim();
  }
  put(lib, { 'templates/x/README.md': '# BuddyApp unreleased\n' }); g(lib, 'commit -q -am next');
  return { lib, url: pathToFileURL(lib).href, at, head: g(lib, 'rev-parse HEAD').trim() };
}
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
test('without a version, init takes the library\'s latest published version and records it', () => {
  const { url, at } = versionedLibrary(); const d = project('shop');
  const r = run(['init', '--library', url, '--profile', 'x', '--host', 'none'], d); assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(path.join(d, 'README.md'), 'utf8'), '# Shop 1.2.0\n');
  assert.ok(r.stdout.includes(`version 1.2.0 (the latest), commit ${at['1.2.0'].slice(0, 12)}`), r.stdout);
  const note = fs.readFileSync(path.join(d, 'docs/standards/ORIGIN.md'), 'utf8'); assert.ok(note.includes('Version requested: latest: `1.2.0`'), note); assert.ok(note.includes(at['1.2.0']));
  assert.match(note, /Library: .* \(named with --library\)/);
});
test('a library without version tags is read at its default branch, and the project says so', () => {
  const { url, head } = versionedLibrary({ tags: false }); const d = project('shop');
  const r = run(['init', '--library', url, '--profile', 'x', '--host', 'none'], d); assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(path.join(d, 'README.md'), 'utf8'), '# Shop unreleased\n');
  assert.ok(r.stdout.includes(`no version tags: its default branch, commit ${head.slice(0, 12)}`), r.stdout);
  assert.match(fs.readFileSync(path.join(d, 'docs/standards/ORIGIN.md'), 'utf8'), /Version requested: none: the library has no version tags, so its default branch was read/);
});
test('a library set once is used by every new project; BUDDY_LIBRARY wins over it and may carry the version', () => {
  const home = tmp(); const { url, at } = versionedLibrary();
  assert.equal(run(['library', '--set', url], tmp(), { home }).status, 0);
  const a = project('first'); const ra = run(['init', '--profile', 'x', '--no-template'], a, { home }); assert.equal(ra.status, 0, ra.stderr);
  assert.match(ra.stdout, /profile x of .* \(from your Buddy configuration\), version 1\.2\.0 \(the latest\)/); assert.doesNotMatch(ra.stdout, /default library/);
  assert.match(fs.readFileSync(path.join(a, 'docs/standards/ORIGIN.md'), 'utf8'), /\(from your Buddy configuration\)/);
  const b = project('second'); const rb = run(['init', '--profile', 'x', '--no-template'], b, { home, env: { BUDDY_LIBRARY: `${url}#v1.0.0` } }); assert.equal(rb.status, 0, rb.stderr);
  assert.match(rb.stdout, new RegExp(esc(`(from the BUDDY_LIBRARY variable), version v1.0.0, commit ${at['v1.0.0'].slice(0, 12)}`)));
  const c = project('third'); const rc = run(['init', '--profile', 'x', '--no-template', '--version', 'v2.0.0-beta.1'], c, { home, env: { BUDDY_LIBRARY: `${url}#v1.0.0` } });
  assert.equal(rc.status, 0, rc.stderr); assert.match(rc.stdout, /version v2\.0\.0-beta\.1, commit/);
});
test('init --list-profiles shows each profile with its line from library.json, the library and the version; without library.json, the folders', () => {
  const { lib } = fakeLibrary({ scripts: null });
  const bare = run(['init', '--list-profiles', '--library', lib], tmp()); assert.equal(bare.status, 0, bare.stderr);
  assert.match(bare.stdout, /^Profiles of the library .*, named with --library, its last commit, commit [0-9a-f]{12}:\n  empty\n  x\n  y\nThe library has no library\.json/);
  put(lib, { 'library.json': JSON.stringify({ name: 'Acme standards', profiles: { x: 'A .NET API with a React front end', empty: 'A truly empty project', general: 'not a profile' } }) });
  g(lib, 'add library.json'); g(lib, 'commit -q -m describe'); g(lib, 'tag v1.1.0');
  const cwd = tmp(); const r = run(['init', '--list-profiles', '--library', pathToFileURL(lib).href], cwd); assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^Profiles of the library Acme standards \(file:\/\/.*\), named with --library, version v1\.1\.0 \(the latest\), commit [0-9a-f]{12}:\n  x      A \.NET API with a React front end\n  empty  A truly empty project\n\nCreate the project with one of them: buddy init --profile <profile> --library file:/);
  assert.doesNotMatch(r.stdout, /general|not a profile/); assert.deepEqual(fs.readdirSync(cwd), []);
  assert.equal(run(['init', '--list-profiles', '--profile', 'x'], cwd).status, 2);
  put(lib, { 'library.json': '{ not json' }); g(lib, 'commit -q -am broken');
  const broken = run(['init', '--list-profiles', '--library', lib], cwd); assert.equal(broken.status, 1); assert.match(broken.stderr, /library\.json is not valid JSON/);
});
test('a library says which contract it follows; one this Buddy does not understand stops init in plain words, before anything is written', () => {
  assert.deepEqual(CONTRACTS, [1, 2]);
  const { lib } = fakeLibrary({ scripts: null });
  const bare = run(['init', '--list-profiles', '--library', lib], tmp()); assert.equal(bare.status, 0, bare.stderr);   // no library.json: contract 1
  assert.match(bare.stdout, /The library follows contract 1 \(it declares none\); this Buddy understands up to contract 2\./);
  put(lib, { 'library.json': JSON.stringify({ name: 'Acme', contract: 1, profiles: { x: 'one line' } }) }); g(lib, 'add library.json'); g(lib, 'commit -q -m one');
  const one = run(['init', '--list-profiles', '--library', lib], tmp()); assert.equal(one.status, 0, one.stderr);
  assert.match(one.stdout, /The library follows contract 1; this Buddy understands up to contract 2\./);
  put(lib, { 'library.json': JSON.stringify({ name: 'Acme', contract: 3, profiles: { x: 'one line' } }) }); g(lib, 'commit -q -am two');
  const d = project('shop'); const r = run(['init', '--library', lib, '--profile', 'x', '--no-template'], d);
  assert.equal(r.status, 1); assert.match(r.stderr, /the library .* follows contract 3; this Buddy understands up to contract 2: install a newer Buddy/); assert.deepEqual(fs.readdirSync(d), []);
  const listed = run(['init', '--list-profiles', '--library', lib], tmp()); assert.equal(listed.status, 1); assert.match(listed.stderr, /follows contract 3; this Buddy understands up to contract 2: install a newer Buddy/);
  put(lib, { 'library.json': JSON.stringify({ contract: 'two', profiles: { x: 'one line' } }) }); g(lib, 'commit -q -am word');
  const word = run(['init', '--library', lib, '--profile', 'x', '--no-template'], project('shop')); assert.equal(word.status, 1); assert.match(word.stderr, /"contract" must be a whole number from 1, not "two"/);
});
test('without --profile, init uses the default profile the library names in library.json, else dotnet-react', () => {
  const { lib } = fakeLibrary({ scripts: null });
  const old = run(['init', '--library', lib, '--no-template'], project('shop'));   // an older library that names no default: today's
  assert.equal(old.status, 1); assert.match(old.stderr, /has no profile "dotnet-react"/);
  put(lib, { 'library.json': JSON.stringify({ name: 'Acme', contract: 1, default_profile: 'y', profiles: { x: 'one line', y: 'another' } }) }); g(lib, 'add library.json'); g(lib, 'commit -q -m default');
  const d = project('shop'); const r = run(['init', '--library', lib, '--no-template'], d); assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(fs.readdirSync(path.join(d, 'docs/standards')).sort(), ['ORIGIN.md', 'general', 'y']); assert.match(r.stdout, /profile y of/);
  const named = project('other'); assert.equal(run(['init', '--library', lib, '--profile', 'x', '--no-template'], named).status, 0);   // --profile still wins
  assert.ok(fs.existsSync(path.join(named, 'docs/standards/x')));
  const listed = run(['init', '--list-profiles', '--library', lib], tmp()); assert.match(listed.stdout, /Without --profile: y, the library's default\./);
  put(lib, { 'library.json': JSON.stringify({ contract: 1, default_profile: 'general', profiles: { x: 'one line' } }) }); g(lib, 'commit -q -am general');
  const gen = run(['init', '--library', lib, '--no-template'], project('shop')); assert.equal(gen.status, 1); assert.match(gen.stderr, /"general" .* is not a profile/);
});
// --- contract 2: the library's questions, asked before the project is born (ask-at-birth) ---
const QUESTIONS = {
  'library.json': JSON.stringify({ name: 'Acme', contract: 2, default_profile: 'x', profiles: { x: 'one line', y: 'another' } }),
  'questions/general.md': '---\nquestions:\n  - id: Q-LANG\n    text: In which language is the documentation written?\n    why: "team.md: the documentation language is the project\'s"\n    choices: [English, Spanish]\n    section: Constraints\n    fills: doc_language\n---\n# General questions\n',
  'questions/x.md': '---\nquestions:\n  - id: Q-NET\n    text: Is the application exposed to the internet?\n    why: SDS 4.2\n    choices: [yes, no]\n    section: Risk appetite\n    fills: exposure\n  - id: Q-USERS\n    text: Who uses it?\n    why: SDS 3.1\n    section: Users\n---\n',
  'standards/general/team.md': '---\nlifecycle: evergreen\n---\n# team\nDocumentation is written in {{doc_language}}.\n',
  'standards/x/rules.md': '# rules\nExposure: {{exposure}}.\n',
};
const askingLibrary = () => { const { lib } = fakeLibrary({ scripts: null }); put(lib, QUESTIONS); g(lib, 'add -A'); g(lib, 'commit -q -m questions'); return lib; };
test('AC4: a contract 2 library writes its questions in questions/; --list-profiles shows the general ones, --questions a profile\'s, and a malformed one is refused', () => {
  const lib = askingLibrary();
  const l = run(['init', '--list-profiles', '--library', lib], tmp()); assert.equal(l.status, 0, l.stderr);
  assert.match(l.stdout, /General questions, asked before every project:\n  Q-LANG  In which language is the documentation written\? \(English \/ Spanish\)\n      why: team\.md: the documentation language is the project's; the answer goes to Constraints and fills \{\{doc_language\}\} in the standards\n/);
  assert.doesNotMatch(l.stdout, /Q-NET/); assert.match(l.stdout, /The library follows contract 2;/);
  const q = run(['init', '--questions', '--profile', 'x', '--library', lib], tmp()); assert.equal(q.status, 0, q.stderr);
  assert.match(q.stdout, /^Questions of the profile x:\n  Q-NET  Is the application exposed to the internet\? \(yes \/ no\)\n.*goes to Risk appetite and fills \{\{exposure\}\}.*\n  Q-USERS  Who uses it\?\n      why: SDS 3\.1; the answer goes to Users\n/);
  assert.match(run(['init', '--questions', '--profile', 'y', '--library', lib], tmp()).stdout, /^Questions of the profile y: none\./);
  assert.equal(run(['init', '--questions', '--library', lib], tmp()).status, 2);
  const none = run(['init', '--questions', '--profile', 'nope', '--library', lib], tmp()); assert.equal(none.status, 1); assert.match(none.stderr, /has no profile "nope"; its profiles: x, y/);
  put(lib, { 'questions/x.md': '---\nquestions:\n  - id: Q-BAD\n    text: Where?\n    why: x\n    section: Elsewhere\n---\n' }); g(lib, 'commit -q -am bad');
  const bad = run(['init', '--questions', '--profile', 'x', '--library', lib], tmp()); assert.equal(bad.status, 1);
  assert.match(bad.stderr, /question Q-BAD of the library's questions\/x\.md sends its answer to "Elsewhere"; the sections of the context are: Purpose and outcomes/);
  put(lib, { 'questions/x.md': '---\nquestions:\n  - id: Q-BAD\n    section: Users\n---\n' }); g(lib, 'commit -q -am bad2');
  assert.match(run(['init', '--questions', '--profile', 'x', '--library', lib], tmp()).stderr, /question 1 of the library's questions\/x\.md has no "text", "why"/);
});
test('AC2, AC3: init --answers writes each answer into the context with its question and clause, fills the open values, and names those left as to be defined', () => {
  const lib = askingLibrary();
  const answers = path.join(tmp(), 'answers.json'); fs.writeFileSync(answers, JSON.stringify({ 'Q-LANG': 'Spanish', 'Q-USERS': 'The shop\'s staff.' }));
  const d = project('shop'); const r = run(['init', '--library', lib, '--no-template', '--answers', answers], d); assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(path.join(d, 'docs/standards/general/team.md'), 'utf8'), '---\nlifecycle: evergreen\n---\n# team\nDocumentation is written in Spanish.\n');
  assert.equal(fs.readFileSync(path.join(d, 'docs/standards/x/rules.md'), 'utf8'), '# rules\nExposure: {{exposure}}.\n');
  assert.match(r.stdout, /created +2 answers in docs\/context\.md/);
  assert.match(r.stdout, /Health: to be defined in the standards: \{\{exposure\}\} \(docs\/standards\/x\/rules\.md\)/); assert.doesNotMatch(r.stdout, /doc_language/);
  const ctx = readContext(path.join(d, 'docs/context.md')); const said = s => ctx.statements.find(x => x.section === s && x.origin === 'human');
  assert.equal(said('Constraints').text, 'In which language is the documentation written? Spanish. Asked because: team.md: the documentation language is the project\'s');
  assert.equal(said('Users').text, 'Who uses it? The shop\'s staff. Asked because: SDS 3.1');
  assert.equal(run(['context', 'check', 'docs/context.md'], d).status, 0);
  const none = project('plain'); const rn = run(['init', '--library', lib, '--no-template'], none); assert.equal(rn.status, 0, rn.stderr);   // no answers: both left to be defined
  assert.match(rn.stdout, /to be defined in the standards: \{\{doc_language\}\} \(docs\/standards\/general\/team\.md\), \{\{exposure\}\}/);
  const unknown = path.join(tmp(), 'a.json'); fs.writeFileSync(unknown, JSON.stringify({ 'Q-NOPE': 'x' }));
  const e = project('other'); const bad = run(['init', '--library', lib, '--no-template', '--answers', unknown], e);
  assert.equal(bad.status, 1); assert.match(bad.stderr, /the answers name a question the library does not ask: Q-NOPE; its questions for the profile x: Q-LANG, Q-NET, Q-USERS/); assert.deepEqual(fs.readdirSync(e), []);
  assert.match(run(['init', '--no-library', '--answers', answers], project('third')).stderr, /--answers goes with a library/);
});
test('AC1: init and --list-profiles say which library and version and why, and how to use another one for this project or for every new one', () => {
  const lib = askingLibrary(); const d = project('shop');
  const r = run(['init', '--library', lib, '--no-template'], d); assert.equal(r.status, 0, r.stderr);
  const line = /\nLibrary: Acme \(.*\), commit [0-9a-f]{12}; named with --library\. To use another one for this project only: buddy init --library <git url or folder>; for every new project: buddy library --set <git url or folder>\.\n/;
  assert.match(r.stdout, line); assert.match(run(['init', '--list-profiles', '--library', lib], tmp()).stdout + '\n', line);
  assert.equal(libraryLine({ shown: DEFAULT_LIBRARY.url, from: 'default', version: 'v0.3.0', latest: true }).split('. To use')[0], `Library: ${DEFAULT_LIBRARY.url}, version v0.3.0 (the latest); Buddy's default library, as no other is set`);
});
test('AC1, AC2: Buddy\'s instructions say the library line, read the inputs, ask the general questions, recommend a profile with its reason, ask its questions, then init with the answers', () => {
  const birth = fs.readFileSync(fileURLToPath(new URL('../skills/new-project/SKILL.md', import.meta.url)), 'utf8');   // the birth lives in the new-project skill (split-birth-and-intake)
  const sec = birth.slice(birth.indexOf('# A new project'));   // its steps, after the front matter
  const at = ['`Library:` line', 'PRD or a prototype', 'general questions', 'Recommend a profile in one line with its reason', '--questions --profile', '--answers <file>'].map(s => sec.indexOf(s));
  assert.ok(at.every(i => i >= 0), JSON.stringify(at)); assert.deepEqual([...at].sort((a, b) => a - b), at);
  assert.match(sec, /`--library`[^\n]*`buddy library --set`/);
});
// --- contract 2: a profile's steps, run after the requirements are read (run-profile-steps) ---
const STEP = '---\nid: prv-1\nprofiles: [x, y]\nrecord: docs/security/prv-1.md\ntriggers:\n  - text: a new authentication flow\n    clause: SDS 3.1\n  - text: newly handled personal data\n    clause: SDS 3.1\n'
  + 'items:\n  - id: PRV1-01\n    text: Authentication method chosen and written down\n    clause: App. A #1; 4.1\n  - id: PRV1-03\n    text: Regulatory relevance of the data decided\n    clause: App. A #3\n---\n# PRV-1\nHow to draft it.\n';
// The template of x decides PRV1-01 in its prefill (R189); y has standards and no template; z has neither the step nor a template.
const PREFILL = '---\ndecided:\n  - id: PRV1-01\n    file: src/BuddyApp.Api/Program.cs\n---\nWhat this template decides of the step prv-1.\n';
const stepLibrary = (step = STEP, prefill = PREFILL) => {
  const { lib } = fakeLibrary({ scripts: null, pipelines: false });
  put(lib, { 'library.json': JSON.stringify({ name: 'Acme', contract: 2, default_profile: 'x', profiles: { x: 'one line', y: 'another', z: 'a third' } }), 'steps/prv-1/step.md': step, 'steps/prv-1/checklist.md': '# the clauses\n', 'steps/notes/README.md': 'not a step\n', ...(prefill ? { 'templates/x/docs/steps/prv-1.decided.md': prefill } : {}) });
  g(lib, 'add -A'); g(lib, 'commit -q -m steps'); return lib;
};
test('AC3: a contract 2 library writes a profile\'s steps in steps/<step>/step.md; --questions lists them and a malformed one is refused in plain words', () => {
  const lib = stepLibrary();
  const q = run(['init', '--questions', '--profile', 'x', '--library', lib], tmp()); assert.equal(q.status, 0, q.stderr);
  assert.match(q.stdout, /\nSteps of the profile x, run after the requirements are read:\n  prv-1  2 items \(1 decided by the base application\), recorded in docs\/security\/prv-1\.md\n      triggers: a new authentication flow \(SDS 3\.1\); newly handled personal data \(SDS 3\.1\)\n/);
  assert.match(run(['init', '--questions', '--profile', 'y', '--library', lib], tmp()).stdout, /\nSteps of the profile y, run after the requirements are read:\n  prv-1  2 items, recorded in docs\/security\/prv-1\.md\n/);   // a profile without a template
  assert.match(run(['init', '--questions', '--profile', 'z', '--library', lib], tmp()).stdout, /Steps of the profile z, run after the requirements are read: none\./);
  const refused = (step, why, prefill) => { const l = stepLibrary(step, prefill); const r = run(['init', '--questions', '--profile', 'x', '--library', l], tmp()); assert.equal(r.status, 1); assert.match(r.stderr, why); };
  refused(STEP.replace('id: prv-1', 'id: prv'), /the library's steps\/prv-1\/step\.md has the id "prv"; a step's id is the name of its folder, prv-1/);
  refused(STEP.replace('    clause: App. A #3\n', ''), /item 2 of the library's steps\/prv-1\/step\.md has no "clause"/);
  refused(STEP.replace('record: docs/security/prv-1.md', 'record: ../out.md'), /says where its record goes with "record", a path inside the project ending in \.md/);
  refused(STEP.replace('profiles: [x, y]\n', ''), /does not say which profiles it belongs to/);
  refused(STEP.replace('    clause: App. A #3\n', '    clause: App. A #3\n    decided_by: src/BuddyApp.Api/Program.cs\n'), /item PRV1-03 of the library's steps\/prv-1\/step\.md has "decided_by", which no longer goes in a step: each template says what it decides, in templates\/<profile>\/docs\/steps\/prv-1\.decided\.md/);
  refused(STEP, /the library's templates\/x\/docs\/steps\/prv-1\.decided\.md decides the item PRV1-09, which the step prv-1 does not have; its items: PRV1-01, PRV1-03/, PREFILL.replace('PRV1-01', 'PRV1-09'));
  const wrong = stepLibrary(STEP, PREFILL.replace('src/BuddyApp.Api/Program.cs', 'src/Nope.cs')); const e = project('shop');
  const r = run(['init', '--library', wrong], e); assert.equal(r.status, 1);   // refused at birth, before anything is written
  assert.match(r.stderr, /the library's templates\/x\/docs\/steps\/prv-1\.decided\.md says the item PRV1-01 is decided by src\/Nope\.cs, which templates\/x\/ does not have/); assert.deepEqual(fs.readdirSync(e), []);
});
test('AC1: init copies the step and writes its record: what the base application decides is decided with its file, the rest to draft; development waits for the owner to confirm each line', () => {
  const lib = stepLibrary(); const d = project('shop');
  const r = run(['init', '--library', lib], d, { env: { GIT_AUTHOR_NAME: 'Owner', GIT_AUTHOR_EMAIL: 'o@o', GIT_COMMITTER_NAME: 'Owner', GIT_COMMITTER_EMAIL: 'o@o' } }); assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /copied +docs\/steps\/prv-1\/ \(the step prv-1 of the profile x/);
  assert.match(r.stdout, /created +docs\/security\/prv-1\.md \(the record of the step prv-1: 1 item decided by the base application, 1 for Buddy to draft once the first milestone's plan says what will be built; the owner confirms each line, then approves the whole record before any change is built\)/);
  assert.ok(fs.existsSync(path.join(d, 'docs/steps/prv-1/checklist.md')));
  const rec = path.join(d, 'docs/security/prv-1.md'); const text = fs.readFileSync(rec, 'utf8');
  assert.match(text, /\n- PRV1-01: Authentication method chosen and written down \(App\. A #1; 4\.1\)\. Decided by the base application in src\/Shop\.Api\/Program\.cs\. `decided`\n- PRV1-03: Regulatory relevance of the data decided \(App\. A #3\)\. To draft\. `unknown`\n/);
  assert.match(spawnSync('git', ['show', '--name-only', '--format='], { cwd: d, encoding: 'utf8' }).stdout, /docs\/security\/prv-1\.md/);
  const line = readContext(rec).statements.find(s => s.text.startsWith('PRV1-03')).line;
  const s = startSlice({ repo: d, title: 'Save books', request: 'A list', criteria: ['Shows saved books'], excludes: ['Sharing'] }); moveSlice(d, s.id, 'ready');
  const waits = new RegExp(`line ${line} \\(PRV1-03\\)`);
  assert.throws(() => moveSlice(d, s.id, 'building'), new RegExp(`development starts once the owner confirms and approves the records of the profile's steps: 1 line\\(s\\) of docs/security/prv-1\\.md, the record of the step prv-1, wait for your confirmation: line ${line} \\(PRV1-03\\); confirm or correct each with buddy context confirm docs/security/prv-1\\.md --line <n> --by owner, then read it whole and approve it with buddy context approve docs/security/prv-1\\.md --by owner`));
  const step = () => loadBoard(d, '2026-11-08T12:00:00Z').waiting.filter(w => w.kind === 'step');
  assert.match(step()[0].text, waits);
  fs.writeFileSync(rec, text.replace('To draft. `unknown`', 'Answer: no personal, SOX or credential data. Because: the PRD names none. `assumed`'));   // Buddy drafts it
  assert.throws(() => moveSlice(d, s.id, 'building'), waits);
  // approve-step-record (R193): only the owner approves, only once every line is confirmed or decided; confirming a step's record needs --by owner too
  const approve = (...a) => run(['context', 'approve', 'docs/security/prv-1.md', ...a], d);
  let a = approve(); assert.equal(a.status, 1); assert.match(a.stderr, /only the Product Owner approves a step's record \(--by owner\)/);
  a = approve('--by', 'owner'); assert.equal(a.status, 1); assert.match(a.stderr, new RegExp(`1 line\\(s\\) are not confirmed yet: line ${line} \\(PRV1-03\\)`)); assert.doesNotMatch(fs.readFileSync(rec, 'utf8'), /approved_by/);
  const alone = run(['context', 'confirm', 'docs/security/prv-1.md', '--line', String(line)], d); assert.equal(alone.status, 1);
  assert.match(alone.stderr, /docs\/security\/prv-1\.md is the record of a step: only the Product Owner confirms or corrects its lines \(--by owner\)/); assert.match(fs.readFileSync(rec, 'utf8'), /`assumed`\n/);
  const c = run(['context', 'confirm', 'docs/security/prv-1.md', '--line', String(line), '--line', String(line - 1), '--by', 'owner'], d); assert.equal(c.status, 0, c.stderr);
  assert.match(c.stdout, new RegExp(`confirmed line\\(s\\): ${line}$`, 'm'));   // the decided line is not the owner's to confirm and stays decided
  assert.match(fs.readFileSync(rec, 'utf8'), /Because: the PRD names none\. `human \d{4}-\d{2}-\d{2}`\n/);
  const unapproved = /docs\/security\/prv-1\.md, the record of the step prv-1, waits for your approval: read it whole and approve it with buddy context approve docs\/security\/prv-1\.md --by owner/;
  assert.throws(() => moveSlice(d, s.id, 'building'), unapproved); assert.match(step()[0].text, unapproved);   // every line confirmed is not yet approved
  a = approve('--by', 'owner'); assert.equal(a.status, 0, a.stderr);
  assert.match(fs.readFileSync(rec, 'utf8'), /^---\nstep: prv-1\nupdated: [\d-]+\napproved_by: owner\napproved_at: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\napproved_sha: [0-9a-f]{64}\n---\n/);
  assert.deepEqual(step(), []); assert.equal(moveSlice(d, s.id, 'building').data.status, 'building');
  // any edit after the approval makes it stale: a line Buddy adds for a later change, or a change of words; no change moves to building until the owner approves again
  moveSlice(d, s.id, 'delivered'); fs.appendFileSync(rec, '- New sign-in with a partner: drafted. `assumed`\n');
  const t = startSlice({ repo: d, title: 'Sign in', request: 'A partner', criteria: ['Signs in'], excludes: ['Sharing'] }); moveSlice(d, t.id, 'ready');
  assert.throws(() => moveSlice(d, t.id, 'building'), /\(New sign-in with a partner\)/); assert.match(step()[0].text, /\(New sign-in with a partner\)/);
  const added = readContext(rec).statements.find(x => x.text.startsWith('New sign-in')).line;
  assert.equal(run(['context', 'confirm', 'docs/security/prv-1.md', '--line', String(added), '--by', 'owner'], d).status, 0);
  const stale = /docs\/security\/prv-1\.md, the record of the step prv-1, changed after you approved it \(\d{4}-\d{2}-\d{2}T[\d:]+Z\): read it whole and approve it with buddy context approve docs\/security\/prv-1\.md --by owner again/;
  assert.throws(() => moveSlice(d, t.id, 'building'), stale); assert.match(step()[0].text, stale);
  assert.equal(approve('--by', 'owner').status, 0); assert.equal(moveSlice(d, t.id, 'building').data.status, 'building');
  fs.writeFileSync(rec, fs.readFileSync(rec, 'utf8').replace('the PRD names none', 'the PRD names no such data'));   // an edit by hand, every line still confirmed
  moveSlice(d, t.id, 'delivered'); moveSlice(d, t.id, 'rework'); assert.throws(() => moveSlice(d, t.id, 'building'), stale);
  // the business context is not a step's record: confirming its lines stays as it was, without --by owner (X2)
  const ctx = run(['context', 'confirm', 'docs/context.md', '--all-risk'], d); assert.equal(ctx.status, 0, ctx.stderr);
  assert.equal(run(['context', 'approve', 'docs/context.md', '--by', 'owner'], d).status, 1);
  assert.match(fs.readFileSync(path.join(d, 'docs/steps/prv-1.decided.md'), 'utf8'), /file: src\/Shop\.Api\/Program\.cs\n/);   // the prefill came with the template, in the project's names
  // without the base application, from a profile without a template, or from a template without a prefill, nothing is decided
  const toDraft = (args, l = lib) => { const n = project('plain'); const x = run(['init', '--library', l, ...args], n); assert.equal(x.status, 0, x.stderr); assert.match(fs.readFileSync(path.join(n, 'docs/security/prv-1.md'), 'utf8'), /written down \(App\. A #1; 4\.1\)\. To draft\. `unknown`\n/); };
  toDraft(['--no-template']); toDraft(['--profile', 'y']); toDraft([], stepLibrary(STEP, null));
});
// --- maintain-decisions-as-adrs: a project is born with its decisions written as ADRs ---
const TEMPLATE_ADR = '---\nstatus: accepted\ndate: 2026-01-15\ndecision-makers: [the architects of Acme]\nschema: buddy/decision@0\nid: D-2026-01-15-a1b2\ntitle: Authenticate with OpenID Connect\nrequested_by: Acme architecture\ndecided_by: human\n'
  + 'built: built\nwhere: src/BuddyApp.Api/Program.cs\nrules:\n  - text: BuddyApp signs users in with OpenID Connect\n    origin: human\n---\n# Authenticate with OpenID Connect\n\n## Context and Problem Statement\n\nHow BuddyApp signs users in.\n\n'
  + '## Considered Options\n\n- OpenID Connect\n- Local accounts\n\n## Decision Outcome\n\nChosen option: OpenID Connect, because the organisation uses it.\n';
test('AC1, AC4: a project is born with docs/decisions/: the ADRs its template brings, which a step\'s prefill may name, and its first one, what it is born from', () => {
  const adr = 'docs/decisions/D-2026-01-15-a1b2-openid-connect.md'; const lib = stepLibrary(STEP, PREFILL.replace('src/BuddyApp.Api/Program.cs', adr));
  put(lib, { [`templates/x/${adr}`]: TEMPLATE_ADR }); g(lib, 'add -A'); g(lib, 'commit -q -m adr');
  const d = project('shop'); const r = run(['init', '--library', lib], d, { env: { GIT_AUTHOR_NAME: 'Owner', GIT_AUTHOR_EMAIL: 'o@o', GIT_COMMITTER_NAME: 'Owner', GIT_COMMITTER_EMAIL: 'o@o' } }); assert.equal(r.status, 0, r.stderr);
  const adrs = fs.readdirSync(path.join(d, 'docs/decisions')).sort(); assert.equal(adrs.length, 2); assert.equal(`docs/decisions/${adrs[0]}`, adr);
  assert.match(fs.readFileSync(path.join(d, adr), 'utf8'), /text: Shop signs users in with OpenID Connect\n/);   // the template's ADR came with it, in the project's names
  assert.match(fs.readFileSync(path.join(d, 'docs/security/prv-1.md'), 'utf8'), /Decided by the base application in docs\/decisions\/D-2026-01-15-a1b2-openid-connect\.md\. `decided`/);
  assert.match(adrs[1], /^D-\d{4}-\d{2}-\d{2}-[0-9a-f]{4}-build-on-the-profile-x-of-the-library-acme\.md$/);
  const birth = fs.readFileSync(path.join(d, 'docs/decisions', adrs[1]), 'utf8');
  assert.match(birth, /^---\nstatus: accepted\ndate: \d{4}-\d{2}-\d{2}\ndecision-makers: \[the Product Owner\]\n/);
  assert.match(birth, /\n## Considered Options\n\n- The profile x: one line\n- The profile y: another\n- The profile z: a third\n/);
  assert.match(birth, new RegExp(`\\nChosen option: the profile x of the library Acme \\(${esc(path.resolve(lib))}\\), commit [0-9a-f]{12}, because it is the library's default profile; the library is named with --library\\n`));
  assert.match(birth, /\n- The base application: copied, \d+ files of the profile's template, named Shop \(shop\)/); assert.match(birth, /\nbuilt: built\nwhere: docs\/standards\/ORIGIN\.md\n/);
  assert.match(r.stdout, /created +docs\/decisions\/D-\S+-build-on-the-profile-x-of-the-library-acme\.md \(the project's first architecture decision record/);
  assert.deepEqual(verify([path.join(d, 'docs')]).problems, []);
  const first = spawnSync('git', ['show', '--name-only', '--format='], { cwd: d, encoding: 'utf8' }).stdout;
  for (const f of adrs) assert.match(first, new RegExp(`docs/decisions/${esc(f)}`));   // both in the project's first commit
  const plain = project('plain'); assert.equal(run(['init', '--no-library'], plain).status, 0); assert.ok(!fs.existsSync(path.join(plain, 'docs/decisions')));   // born without a library: nothing was decided
});
test('AC1, AC2: Buddy\'s instructions draft the step after reading the requirements, never ask what is decided, and check each change against its triggers', () => {
  const md = fs.readFileSync(fileURLToPath(new URL('../agents/buddy.md', import.meta.url)), 'utf8');
  const sec = fs.readFileSync(fileURLToPath(new URL('../skills/new-project/SKILL.md', import.meta.url)), 'utf8');   // the birth lives in the new-project skill
  for (const s of ['docs/steps/', '`decided`', 'never ask', 'buddy context confirm', '--questions --profile']) assert.ok(sec.includes(s), s);
  const change = md.slice(md.indexOf('## A change'), md.indexOf('### The end of a milestone'));
  assert.match(change, /trigger/); assert.match(change, /in one line/);
  // approve-step-record (R193): every line shown, the decided ones with their file, before the approval; never confirmed or approved on his own; an update needs it again
  assert.match(sec, /show him every line of it in his terms, the `decided` ones too, each with the file that decides it/); assert.match(sec, /`buddy context approve <record> --by owner`/);
  assert.match(sec, /`buddy context confirm <record> --line <n> --by owner`/); assert.match(sec, /Never run `confirm` or `approve` with `--by owner` on your own: only after the owner said so in the conversation/);
  assert.match(change, /makes his earlier approval stale: show him the whole record again, the `decided` lines with the file that decides them/); assert.match(change, /Never confirm or approve with `--by owner` on your own/);
  const guide = fs.readFileSync(fileURLToPath(new URL('../LIBRARY-GUIDE.md', import.meta.url)), 'utf8');
  assert.match(guide, /A record kept in the project's repository is approved by the Product Owner, and only by him, before development/);
  // draft-step-record-after-the-plan (R202): not at birth; once the first milestone's plan says what will be built, presented with its card
  assert.match(sec, /\*\*Not at birth\*\*: a step's record answers how the product is built, so draft it once it is clear what will be built/); assert.match(md, /draft it now, from the plan, as the `new-project` skill says in its step 7, and present it with the card/); assert.match(guide, /once the first milestone's plan says what will be built \(not at birth\)/);
});
// --- contract 2: the index of the library's normative documents (bring-normative-documents) ---
const INDEX = '---\ndocuments:\n  - id: SDS\n    title: "Acme Secure Coding Standard: applications and APIs"\n    version: v1.1\n    link: https://example.sharepoint.com/sites/x/SDS_v1_1.pdf\n'
  + '  - id: PRIV\n    title: Privacy guideline\n    version: "2026"\n    link: normative/privacy.pdf\n---\n# Normative documents\n\n| Id | Document |\n| :-- | :-- |\n| SDS | the tables stay for people |\n';
const normLibrary = (index = INDEX) => {
  const { lib } = fakeLibrary({ scripts: null, pipelines: false });
  put(lib, { 'library.json': JSON.stringify({ name: 'Acme', contract: 2, default_profile: 'x', profiles: { x: 'one line' } }), 'normative/index.md': index, 'normative/privacy.pdf': 'the document itself' });
  g(lib, 'add -A'); g(lib, 'commit -q -m normative'); return lib;
};
test('AC1, AC3: a contract 2 library lists its normative documents in normative/index.md; --questions shows them and a malformed index is refused in plain words', () => {
  const q = run(['init', '--questions', '--profile', 'x', '--library', normLibrary()], tmp()); assert.equal(q.status, 0, q.stderr);
  assert.match(q.stdout, /\nNormative documents of the library \(linked, never copied: the project receives their index at docs\/standards\/normative\.md\):\n  SDS  Acme Secure Coding Standard: applications and APIs, v1\.1: https:\/\/example\.sharepoint\.com\/sites\/x\/SDS_v1_1\.pdf\n  PRIV  Privacy guideline, 2026: normative\/privacy\.pdf\n/);
  const { lib } = fakeLibrary({ scripts: null, pipelines: false });
  assert.match(run(['init', '--questions', '--profile', 'x', '--library', lib], tmp()).stdout, /Normative documents of the library: none\./);
  const refused = (index, why) => { const r = run(['init', '--questions', '--profile', 'x', '--library', normLibrary(index)], tmp()); assert.equal(r.status, 1); assert.match(r.stderr, why); };
  refused('# Acme normative documents\n\n| Id | Document |\n', /the library's normative\/index\.md must start with a front matter that lists its documents \(documents: - id: \.\.\. title: \.\.\. version: \.\.\. link: \.\.\.\)/);
  refused(INDEX.replace('    version: v1.1\n', ''), /document 1 of the library's normative\/index\.md has no "version"/);
  refused(INDEX.replace('normative/privacy.pdf', 'normative/missing.pdf'), /document PRIV of the library's normative\/index\.md links to "normative\/missing\.pdf", which is neither a URL nor a file of the library/);
  refused(INDEX.replace('normative/privacy.pdf', '../outside.pdf'), /links to "\.\.\/outside\.pdf", which is neither a URL nor a file of the library/);
  refused(INDEX.replace('id: PRIV', 'id: SDS'), /lists the document SDS twice/);
  const e = project('shop'); assert.equal(run(['init', '--library', normLibrary(INDEX.replace('    version: v1.1\n', ''))], e).status, 1); assert.deepEqual(fs.readdirSync(e), []);
});
test('AC1: a project born from the library has its index at docs/standards/normative.md, never a document', () => {
  const d = project('shop');
  const r = run(['init', '--library', normLibrary()], d, { env: { GIT_AUTHOR_NAME: 'Owner', GIT_AUTHOR_EMAIL: 'o@o', GIT_COMMITTER_NAME: 'Owner', GIT_COMMITTER_EMAIL: 'o@o' } }); assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /copied +docs\/standards\/normative\.md \(the library's index of its normative documents \(SDS v1\.1, PRIV 2026\); the documents are linked, never copied\)/);
  assert.equal(fs.readFileSync(path.join(d, 'docs/standards/normative.md'), 'utf8'), INDEX);
  const all = fs.readdirSync(d, { recursive: true }).map(f => String(f).replace(/\\/g, '/')).filter(f => !f.startsWith('.git/'));
  assert.ok(!all.some(f => /privacy\.pdf$/.test(f)), all.join(', ')); assert.ok(!all.includes('normative'));
  assert.match(spawnSync('git', ['show', '--name-only', '--format='], { cwd: d, encoding: 'utf8' }).stdout, /docs\/standards\/normative\.md/);
  const n = project('plain'); const { lib } = fakeLibrary({ scripts: null, pipelines: false });   // a library without an index gives none
  assert.equal(run(['init', '--library', lib, '--profile', 'x'], n).status, 0); assert.ok(!fs.existsSync(path.join(n, 'docs/standards/normative.md')));
});
test('AC2: Buddy\'s and Dev\'s instructions resolve each cited clause through the index, never fetch a link, and say when a decision needs the document itself', () => {
  const read = f => fs.readFileSync(fileURLToPath(new URL(`../agents/${f}`, import.meta.url)), 'utf8');
  const buddy = read('buddy.md'); const dev = read('dev.md');
  const birth = fs.readFileSync(fileURLToPath(new URL('../skills/new-project/SKILL.md', import.meta.url)), 'utf8');   // the birth lives in the new-project skill
  const always = buddy.slice(buddy.indexOf('## A new project'), buddy.indexOf('## What the owner hands over'));   // and its rule on the index holds in every session
  for (const s of ['docs/standards/normative.md', 'Never fetch a link', 'needs the document itself']) assert.ok(always.toLowerCase().includes(s.toLowerCase()), s);
  for (const md of [birth, dev.slice(dev.indexOf('## Before you build'), dev.indexOf('## While you build'))])
    for (const s of ['docs/standards/normative.md', 'SCS v2.0 clause 4.2', 'Never fetch a link', 'needs the document itself']) assert.ok(md.includes(s), s);
  assert.match(buddy, /\*\*Raise Dev\*\*[^\n]*docs\/standards\/normative\.md/);
});
// --- contract 2: the organisation's saved prompts (bring-saved-prompts) ---
const PROMPT = '---\nname: prv-2-review\ndescription: "Reviews a change against Appendix B before it is published to UAT. Use it before a deployment to a test environment."\nprofiles: [x, y]\n---\n# PRV-2 review\n';
const promptLibrary = (prompt = PROMPT) => {
  const { lib } = fakeLibrary({ scripts: null, pipelines: false });
  put(lib, { 'library.json': JSON.stringify({ name: 'Acme', contract: 2, default_profile: 'x', profiles: { x: 'one line', y: 'another', z: 'a third' } }),
    'prompts/prv-2-review/SKILL.md': prompt, 'prompts/prv-2-review/appendix-b.md': '# Appendix B\n', 'prompts/only-z/SKILL.md': '---\nname: only-z\ndescription: For z.\nprofiles: [z]\n---\n', 'prompts/notes/README.md': 'not a prompt\n' });
  g(lib, 'add -A'); g(lib, 'commit -q -m prompts'); return lib;
};
test('AC2: a contract 2 library writes its saved prompts in prompts/<name>/SKILL.md; --questions lists the profile\'s and a malformed one is refused in plain words', () => {
  const lib = promptLibrary();
  const q = run(['init', '--questions', '--profile', 'x', '--library', lib], tmp()); assert.equal(q.status, 0, q.stderr);
  assert.match(q.stdout, /\nSaved prompts of the profile x, copied to \.claude\/skills\/:\n  prv-2-review  Reviews a change against Appendix B before it is published to UAT\. Use it before a deployment to a test environment\.\n?$/);
  assert.doesNotMatch(q.stdout, /only-z|notes/);
  assert.match(run(['init', '--questions', '--profile', 'x', '--library', fakeLibrary({ scripts: null, pipelines: false }).lib], tmp()).stdout, /Saved prompts of the profile x, copied to \.claude\/skills\/: none\./);
  const refused = (prompt, why) => { const r = run(['init', '--questions', '--profile', 'x', '--library', promptLibrary(prompt)], tmp()); assert.equal(r.status, 1); assert.match(r.stderr, why); };
  refused('# PRV-2 review\n', /the library's prompts\/prv-2-review\/SKILL\.md must start with a front matter \(name, description, profiles\)/);
  refused(PROMPT.replace('name: prv-2-review', 'name: prv-2'), /has the name "prv-2"; a saved prompt's name is the name of its folder, prv-2-review/);
  refused(PROMPT.replace(/description: .*\n/, ''), /prompts\/prv-2-review\/SKILL\.md has no "description", which says what it does and when it is used/);
  refused(PROMPT.replace('profiles: [x, y]\n', ''), /prompts\/prv-2-review\/SKILL\.md does not say which profiles it belongs to/);
  const e = project('shop'); assert.equal(run(['init', '--library', promptLibrary('# no front matter\n')], e).status, 1); assert.deepEqual(fs.readdirSync(e), []);
});
test('AC1: a project born from the library has the profile\'s saved prompts in .claude/skills/, folder and all, also from a profile without a template', () => {
  const lib = promptLibrary(); const d = project('shop');
  const r = run(['init', '--library', lib], d, { env: { GIT_AUTHOR_NAME: 'Owner', GIT_AUTHOR_EMAIL: 'o@o', GIT_COMMITTER_NAME: 'Owner', GIT_COMMITTER_EMAIL: 'o@o' } }); assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /copied +\.claude\/skills\/prv-2-review\/ \(the saved prompt prv-2-review of the profile x, which Buddy offers when its description says\)/);
  assert.equal(fs.readFileSync(path.join(d, '.claude/skills/prv-2-review/SKILL.md'), 'utf8'), PROMPT);
  assert.ok(fs.existsSync(path.join(d, '.claude/skills/prv-2-review/appendix-b.md'))); assert.ok(!fs.existsSync(path.join(d, '.claude/skills/only-z')));
  assert.match(spawnSync('git', ['show', '--name-only', '--format='], { cwd: d, encoding: 'utf8' }).stdout, /\.claude\/skills\/prv-2-review\/appendix-b\.md/);
  const y = project('plain'); assert.equal(run(['init', '--library', lib, '--profile', 'y'], y).status, 0); assert.ok(fs.existsSync(path.join(y, '.claude/skills/prv-2-review/SKILL.md')));   // standards only
  const k = project('mine'); put(k, { '.claude/skills/prv-2-review/SKILL.md': 'my own\n' });   // one already there is kept
  const again = run(['init', '--library', lib], k); assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /kept +\.claude\/skills\/prv-2-review\/ \(already there, left as it was\)/); assert.equal(fs.readFileSync(path.join(k, '.claude/skills/prv-2-review/SKILL.md'), 'utf8'), 'my own\n');
});
test('AC1: Buddy\'s instructions offer each saved prompt at the moment its description names and never act as the independent human reviewer', () => {
  const md = fs.readFileSync(fileURLToPath(new URL('../agents/buddy.md', import.meta.url)), 'utf8');
  const sec = md.slice(md.indexOf('**Saved prompts.**'), md.indexOf('### The end of a milestone'));
  for (const s of ['.claude/skills/<name>/', 'description says when it is used', 'no program detects that moment', 'offer the owner that prompt', 'independent human reviewer', 'never act as that reviewer']) assert.ok(sec.includes(s), s);
});
test('a command that hangs is stopped at its time limit', async () => {
  const t0 = Date.now();
  const r = await runWithTimeout({ cmd: process.execPath, args: ['-e', 'setTimeout(() => {}, 60000)'], shell: false, label: 'hang' }, { cwd: tmp(), timeoutMs: 500 });
  assert.equal(r.timedOut, true); assert.equal(r.status, null); assert.ok(Date.now() - t0 < 10000);
  const ok = await runWithTimeout({ cmd: process.execPath, args: ['-e', 'console.log("hi")'], shell: false, label: 'ok' }, { cwd: tmp(), timeoutMs: 10000 });
  assert.equal(ok.status, 0); assert.equal(ok.timedOut, false); assert.match(ok.stdout, /hi/);
});
// --- what the owner hands over ---
test('init leaves docs/inputs/ with a README for what the owner hands over, keeps one that exists, and its files never make the folder an existing project', () => {
  const d = path.join(tmp(), 'shop'); fs.mkdirSync(d);
  const r = run(['init', '--no-library'], d); assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /created +docs\/inputs\//);
  const readme = fs.readFileSync(path.join(d, 'docs/inputs/README.md'), 'utf8'); assert.match(readme, /PRD/); assert.match(readme, /prototype/); assert.match(readme, /never changes them/);
  assert.deepEqual(verify([path.join(d, 'docs')]).problems, []);
  const k = project('kept'); put(k, { 'docs/inputs/prd.md': '# PRD\n' });
  const again = run(['init', '--no-library'], k); assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /kept +docs\/inputs\/ \(already there, left as it was\)/); assert.deepEqual(fs.readdirSync(path.join(k, 'docs/inputs')), ['prd.md']);
  const { lib } = fakeLibrary(); const n = project('fresh'); put(n, { 'docs/inputs/prd.md': '# PRD\n', 'docs/inputs/prototype/index.html': '<p>x</p>\n' });
  const fresh = run(['init', '--library', lib, '--profile', 'empty'], n); assert.equal(fresh.status, 0, fresh.stderr);
  assert.doesNotMatch(fresh.stdout, /already holds a project/); assert.ok(fs.existsSync(path.join(n, 'package.json')));
  assert.equal(fs.readFileSync(path.join(n, 'docs/inputs/prd.md'), 'utf8'), '# PRD\n'); assert.ok(!fs.existsSync(path.join(n, 'docs/inputs/README.md')));
});
// --- the project's first commit (R144) ---
import { checkCommitMessage } from '../src/commitcheck.mjs';
const WHO = { GIT_AUTHOR_NAME: 'Owner', GIT_AUTHOR_EMAIL: 'o@o', GIT_COMMITTER_NAME: 'Owner', GIT_COMMITTER_EMAIL: 'o@o' };
const log = d => spawnSync('git', ['log', '-1', '--format=%s', '--name-only'], { cwd: d, encoding: 'utf8' }).stdout.trim();
test('a project is born with one first commit of what init made, named by its library, version and profile, that Buddy\'s commit rules accept', () => {
  const { lib } = fakeLibrary({ scripts: null }); put(lib, { 'library.json': JSON.stringify({ name: 'acme-standards', profiles: { x: 'x' } }) }); g(lib, 'add library.json'); g(lib, 'commit -q -m name'); g(lib, 'tag v2');
  const d = project('shop');
  const r = run(['init', '--library', lib, '--version', 'v2', '--profile', 'x', '--host', 'none'], d, { env: WHO }); assert.equal(r.status, 0, r.stderr);
  const [subject, ...files] = log(d).split('\n');
  assert.equal(subject, 'chore: born from acme-standards v2, profile x'); assert.deepEqual(checkCommitMessage(subject).errors, []);
  assert.equal(spawnSync('git', ['rev-list', '--count', 'HEAD'], { cwd: d, encoding: 'utf8' }).stdout.trim(), '1');
  for (const f of ['CLAUDE.md', 'docs/context.md', 'docs/inputs/README.md', 'docs/standards/ORIGIN.md', 'docs/standards/x/rules.md', 'package.json', 'src/Shop.Api/Program.cs']) assert.ok(files.includes(f), f);
  assert.equal(spawnSync('git', ['status', '--porcelain'], { cwd: d, encoding: 'utf8' }).stdout, '');   // nothing init made is left out
  assert.match(r.stdout, /created +the first commit \("chore: born from acme-standards v2, profile x", with the \d+ files init made\)/);
});
test('without a git identity init leaves everything uncommitted and says so plainly; it does not fail', () => {
  const d = project('shop'); const r = run(['init', '--no-library'], d, { env: { GIT_COMMITTER_NAME: '', GIT_COMMITTER_EMAIL: '', GIT_CONFIG_GLOBAL: path.join(tmp(), 'none'), GIT_CONFIG_NOSYSTEM: '1' } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /skipped +the first commit \(git does not know who you are \(user\.name and user\.email are not set\), so everything init made is left uncommitted/);
  assert.notEqual(spawnSync('git', ['rev-parse', '--verify', '--quiet', 'HEAD'], { cwd: d }).status, 0);
});
test('in a folder that already had commits init commits only the files it made, by name; what the owner had staged stays out', () => {
  const d = project('shop'); g(d, 'init -q'); put(d, { 'notes.txt': 'mine\n' }); g(d, 'add notes.txt'); g(d, 'commit -q -m "chore: start"');
  put(d, { 'staged.txt': 'not init\'s\n' }); g(d, 'add staged.txt');
  const r = run(['init', '--no-library'], d, { env: WHO }); assert.equal(r.status, 0, r.stderr);
  const [subject, ...files] = log(d).split('\n');
  assert.equal(subject, 'chore: born without a library'); assert.deepEqual(files.filter(Boolean).sort(), ['.claude/settings.json', 'CLAUDE.md', 'docs/context.md', 'docs/inputs/README.md']);
  assert.match(spawnSync('git', ['status', '--porcelain'], { cwd: d, encoding: 'utf8' }).stdout, /^A  staged\.txt/m);
  const again = run(['init', '--no-library'], d, { env: WHO }); assert.match(again.stdout, /^Nothing to do/); assert.equal(log(d).split('\n')[0], 'chore: born without a library');   // nothing new, no commit
});

/// ask-only-what-matters (R157): the routine permissions are written at birth, merged with the owner's, and --permissions adds them later.
const settingsOf = d => JSON.parse(fs.readFileSync(path.join(d, '.claude/settings.json'), 'utf8'));
test('the routine rules: Buddy\'s program at this installation\'s path, the project\'s checks and local git; never a push, a deletion or an installation', () => {
  const rules = routineRules();
  const cli = path.join(PLUGIN_ROOT, 'bin', 'buddy.mjs').split(path.sep).join('/');
  for (const r of [`Bash(node "${cli}" *)`, 'Bash(npm run validate *)', 'Bash(npm run scan *)', 'Bash(npm run setup *)', 'Bash(npm test *)', 'Bash(git status *)', 'Bash(git diff *)', 'Bash(git log *)', 'Bash(git add *)', 'Bash(git commit *)', 'Bash(git show *)', 'PowerShell(git commit *)', `PowerShell(node "${cli}" *)`]) assert.ok(rules.includes(r), r);
  for (const r of rules) { assert.match(r, /^(Bash|PowerShell)\(.+ \*\)$/, r); assert.doesNotMatch(r, /push|\brm\b|remove|delete|install|npm run \*|git \*|curl/i, r); }
  const spaced = buddyCommands(path.join(path.sep, 'opt', 'my plugin'));
  assert.ok(spaced.every(c => /^node "[^"]+buddy\.mjs"$/.test(c)), `a path with spaces is only allowed quoted: ${spaced.join(' | ')}`);
  assert.ok(spaced.includes('node "/opt/my plugin/bin/buddy.mjs"'), 'the forward-slash form Claude Code writes');
});
test('a project is born with the routine permissions in .claude/settings.json, committed with the rest; a second run changes nothing', () => {
  const d = project('shop'); const r = run(['init', '--no-library'], d, { env: WHO }); assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(settingsOf(d).permissions.allow, routineRules());
  assert.match(r.stdout, /created +\.claude\/settings\.json \(Buddy's program, the project's checks .* run without asking; a push, a deletion, an installation or anything outside the project still asks\)/);
  assert.ok(log(d).split('\n').includes('.claude/settings.json'));
  const before = fs.readFileSync(path.join(d, '.claude/settings.json'), 'utf8');
  const again = run(['init', '--no-library'], d, { env: WHO }); assert.match(again.stdout, /^Nothing to do/); assert.match(again.stdout, /kept +\.claude\/settings\.json/);
  assert.equal(fs.readFileSync(path.join(d, '.claude/settings.json'), 'utf8'), before);
});
test('the owner\'s settings are kept: their rules, their other keys, and what they have not committed stays out of init\'s commit', () => {
  const d = project('shop'); put(d, { '.claude/settings.json': JSON.stringify({ model: 'x', permissions: { allow: ['Bash(make *)', 'Bash(git status *)'], deny: ['Bash(git push *)'] } }) });
  const r = run(['init', '--no-library'], d, { env: WHO }); assert.equal(r.status, 0, r.stderr);
  const s = settingsOf(d); assert.equal(s.model, 'x'); assert.deepEqual(s.permissions.deny, ['Bash(git push *)']);
  assert.deepEqual(s.permissions.allow.slice(0, 2), ['Bash(make *)', 'Bash(git status *)']); assert.equal(s.permissions.allow.filter(x => x === 'Bash(git status *)').length, 1);
  for (const rule of routineRules()) assert.ok(s.permissions.allow.includes(rule), rule);
  assert.match(r.stdout, /merged +\.claude\/settings\.json \(\d+ routine permissions added; the entries already there were kept/);
  assert.ok(!log(d).split('\n').includes('.claude/settings.json'), 'the owner\'s own file, not committed by them, stays out of the first commit');
  const bad = project('bad'); put(bad, { '.claude/settings.json': '{ not json' });
  const rb = run(['init', '--permissions'], bad); assert.equal(rb.status, 1); assert.match(rb.stderr, /not valid JSON.*left as it was/); assert.equal(fs.readFileSync(path.join(bad, '.claude/settings.json'), 'utf8'), '{ not json');
});
test('init --permissions gives an existing project the routine permissions and does nothing else', () => {
  const d = project('old'); g(d, 'init -q'); put(d, { 'docs/context.md': 'mine\n' });
  const before = snapshot(d);
  const r = run(['init', '--permissions'], d); assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^Permissions written in /); assert.match(r.stdout, /created +\.claude\/settings\.json/); assert.match(r.stdout, /Not committed/);
  const after = snapshot(d); delete after['.claude/']; delete after[path.join('.claude', 'settings.json')]; assert.deepEqual(after, before, 'nothing else was written');
  assert.deepEqual(settingsOf(d).permissions.allow, routineRules());
  const again = run(['init', '--permissions', '--repo', d], tmp()); assert.equal(again.status, 0, again.stderr); assert.match(again.stdout, /^Nothing to do: .*already has the routine permissions/);
  const mixed = run(['init', '--permissions', '--no-library'], d); assert.equal(mixed.status, 2); assert.match(mixed.stderr, /--permissions goes only with --repo/);
  assert.equal(writePermissions(d).change, 'kept');
});
