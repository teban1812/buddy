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