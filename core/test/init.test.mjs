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
import { BUDDY, tmp, HOME, run, g, snapshot, BIN, put, EMPTY_TEMPLATE, PIPELINES, fakeLibrary, project } from './_init.helper.mjs';

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