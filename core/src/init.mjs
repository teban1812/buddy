// buddy init: prepares a project for Buddy (R99, R101, R102, R103). It creates only what is missing and never overwrites:
// a git repository, docs/buddy/backlog/, an empty docs/context.md the context reader accepts, docs/inputs/ for what the owner hands over (R106), and the project's standards
// in docs/standards/ with a note of their origin and pin (design/09 section 3). The standards come from a library (the
// one named with --library, BUDDY_LIBRARY or buddy library --set, else Buddy's default library; R104), at the version
// asked for or its latest published one: its general standards (standards/general/, evergreen) and the
// profile's (standards/<profile>/, born with the project), each into its own folder; the library also gives the base
// application the project starts from, renamed for the project, unless the folder already holds a project (R103). Or,
// with --standards, they come from a plain folder of standards.
import { mergeClaudeMd } from './claudemd.mjs';
import { findTools } from './tools.mjs';
import { INSTRUCTIONS, FULL, WRAPPED, wrapperOf, writeNew, recordFiles } from './toolfiles.mjs';
import { parseDocument } from './frontmatter.mjs';
import { addStatement } from './context.mjs';
import { writePermissions, permissionsAction, SETTINGS } from './permissions.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { npmScriptCommand, validateCommand, runWithTimeout } from './proc.mjs';
import { readConfig, updateConfig, configFile } from './config.mjs';
import { decideV0 } from './decide.mjs';
import { ensureBuddyIgnored } from './gitdir.mjs';

export const CONTEXT_SECTIONS = ['Purpose and outcomes', 'Users', 'Constraints', 'Risk appetite', 'Unknowns'];
export const ORIGIN_NOTE = 'ORIGIN.md';
// The library's standards every profile receives (evergreen, R103); a profile's own are in standards/<profile>/.
export const GENERAL = 'general';
// The library used when none is named anywhere (R102, R104): private, reached with the user's own git credentials, read
// at its latest published version (no fixed version here: a library release must not wait for a Buddy release).
export const DEFAULT_LIBRARY = { url: 'https://github.com/teban1812/buddy-default-library.git' };
// What a library says about itself at its root (R104): { "name": "...", "contract": 1, "default_profile": "<profile>",
// "profiles": { "<profile>": "<one line>" } }.
export const LIBRARY_JSON = 'library.json';
// The contracts between Buddy and a library this Buddy understands: what it assumes of a library, written once in the
// default library's README ("Contract 1"); changes to a contract are additive, a new number is a breaking one. A library
// that declares none follows contract 1. Contract 2 adds the questions asked before a project is born (readQuestions) and a
// profile's steps (readSteps), the index of its normative documents (readNormative) and its saved prompts (readPrompts).
// Also optional in contract 2: themes/, one <name>.css of shadcn's CSS variables per theme (name and description in a comment at its top),
// copied to docs/design/themes/; design rules are a standards file, with no format of their own.
export const CONTRACTS = [1, 2];
// The profile used when neither --profile nor the library's default_profile names one (libraries written before it).
export const FALLBACK_PROFILE = 'dotnet-react';
// The placeholders a library's template uses for the application's name.
export const PLACEHOLDER = { pascal: 'BuddyApp', kebab: 'buddy-app' };
export const SETUP_TIMEOUT_MS = 15 * 60 * 1000;
export const VALIDATE_TIMEOUT_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5 * 60 * 1000;

// The CI pipelines a template may bring, one per host where the project's repository can live (R112): the project keeps
// only the chosen host's. A template's file belongs to a host by its path in the template; it brings a pipeline when it
// has a file under .github/workflows/ or an azure-pipelines.yml at its root.
export const HOSTS = {
  github: { name: 'GitHub Actions', owns: rel => rel.startsWith('.github/'), pipeline: rel => rel.startsWith('.github/workflows/') },
  azure: { name: 'Azure Pipelines', owns: rel => rel === 'azure-pipelines.yml', pipeline: rel => rel === 'azure-pipelines.yml' },
};
export const HOST_CHOICES = [...Object.keys(HOSTS), 'none'];
export const HOST_MISSING = "the base application brings a pipeline that runs the project's checks on every push, and it needs to know where the repository will live: "
  + 'run init again with --host github (GitHub Actions), --host azure (Azure Pipelines) or --host none (no pipeline). Nothing was written';
const slash = rel => rel.split(path.sep).join('/');
const hostOf = rel => Object.keys(HOSTS).find(h => HOSTS[h].owns(slash(rel))) || null;

// The template's files without the other hosts' pipelines, and what the project is born with: { files, pipeline } where
// pipeline is null when the template brings none, else { host, files } (files empty when the chosen host's is missing).
export function pipelineFor(files, host) {
  const offers = files.some(f => Object.values(HOSTS).some(h => h.pipeline(slash(f.rel))));
  if (!offers) return { files, pipeline: null };
  const kept = files.filter(f => { const h = hostOf(f.rel); return !h || h === host; });
  return { files: kept, pipeline: { host, files: host === 'none' ? [] : kept.filter(f => HOSTS[host].pipeline(slash(f.rel))).map(f => slash(f.rel)) } };
}

// The pipeline in words: the line of the report and the line of docs/standards/ORIGIN.md.
export function pipelineWords(p) {
  if (!p.files.length) return p.host === 'none' ? 'no pipeline: the project was born without one'
    : `no pipeline: the template has no ${HOSTS[p.host].name} file, so the project was born without one`;
  return `the project runs its checks on every push in ${HOSTS[p.host].name} (${p.files.join(', ')})`;
}

const git = (cwd, args, extra = {}) => { const r = spawnSync('git', args, { cwd, encoding: 'utf8', ...extra }); return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() || (r.error ? r.error.message : '') }; };
const todayStr = () => new Date().toISOString().slice(0, 10);

// The new context: the five sections empty, except one `unknown` line that says the story is still to be told, so the
// file is a valid context (the reader and the verifier want at least one tagged statement) without inventing anything.
export function emptyContext(name, date = todayStr()) {
  return [
    '---', 'schema: buddy/context@0', `title: ${JSON.stringify(`Business context of ${name}`)}`, `updated: ${date}`, 'owner: the Product Owner', 'status: draft', '---',
    '# Business context', '',
    'What this software is for, in the owner\'s words. Every statement ends with its origin: `human YYYY-MM-DD` (said or confirmed by the owner on that date), `assumed` (drafted, nobody confirmed it) or `unknown`. Only the owner makes a statement `human`.', '',
    ...CONTEXT_SECTIONS.flatMap(s => s === 'Unknowns' ? [`## ${s}`, '- The business has not been described yet; the owner tells its story next. `unknown`', ''] : [`## ${s}`, '']),
  ].join('\n');
}

// docs/inputs/ (R106): what the owner hands over, kept as it was given. Under docs/, so it never makes init take the folder
// for an existing project (NOT_A_PROJECT).
export const INPUTS_README = [
  '# Inputs', '',
  'What the owner hands over to build this project: the PRD, the prototype, the specification of a large change, or any other document the work starts from.', '',
  'Buddy reads these files to draft the business context and the changes, and never changes them. To replace one, put the new version here; the project\'s history keeps the old one.', '',
].join('\n');

// Where a standards folder comes from: its absolute path and, inside a git repository, the commit and whether the folder
// had changes not committed (then the copy is not exactly that commit).
export function standardsOrigin(src) {
  const abs = path.resolve(src); const o = { source: abs };
  const top = git(abs, ['rev-parse', '--show-toplevel']);
  if (!top.ok) return o;
  o.repository = path.resolve(top.out);
  const head = git(abs, ['rev-parse', 'HEAD']); o.commit = head.ok ? head.out : null;
  const st = git(abs, ['status', '--porcelain', '--', '.']); o.uncommitted = st.ok ? st.out.length > 0 : null;
  return o;
}

export function originNote(o, date = todayStr()) {
  const lines = ['# Origin of these standards', '',
    `Copied by \`buddy init\` on ${date}, so the project carries its standards and does not depend on the library to run.`, '',
    `- Source folder: \`${o.source}\``];
  if (o.repository) {
    lines.push(`- Git repository: \`${o.repository}\``, `- Commit: ${o.commit ? `\`${o.commit}\`` : 'none (the repository had no commits yet)'}`,
      `- Uncommitted changes in the source folder when copied: ${o.uncommitted == null ? 'could not tell' : o.uncommitted ? 'yes (this copy is not exactly that commit)' : 'no'}`);
  } else lines.push('- Not in a git repository: there is no commit to pin; keep the library under version control to tell its versions apart.');
  lines.push('', 'To update: copy the new version over this folder, review the difference in the project\'s history and update this note.', '');
  return lines.join('\n');
}

// --- libraries -------------------------------------------------------------------------------------------------------

const looksRemote = s => /^[a-z][a-z0-9+.-]*:\/\//i.test(s) || /^[\w.-]+@[\w.-]+:/.test(s);

// A library's address as it may be written down or shown: never the user name, password or token of a URL, nor its query.
export function publicUrl(source) {
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(source)) return source;
  try {
    const u = new URL(source);
    if (u.password || /^https?:$/.test(u.protocol)) { u.username = ''; u.password = ''; }
    u.search = ''; u.hash = '';
    return u.toString();
  } catch { return source.replace(/\/\/[^/@]*@/, '//'); }
}

// Where the library came from (R104), in words for people.
export const LIBRARY_FROM = { option: 'named with --library', env: 'from the BUDDY_LIBRARY variable', config: 'from your Buddy configuration', default: 'Buddy\'s default library' };
export const LIBRARY_VAR = 'BUDDY_LIBRARY';

// BUDDY_LIBRARY: "<git url or folder>" or "<git url or folder>#<version>" (the text after the last # is the version;
// a library address therefore cannot itself contain #). Empty or blank: not set.
export function parseLibraryVar(value) {
  const s = (value || '').trim(); if (!s) return null;
  const i = s.lastIndexOf('#');
  return i > 0 ? { source: s.slice(0, i), version: s.slice(i + 1) || null } : { source: s, version: null };
}

// The library stored by `buddy library --set`: { source, version? } under "library" in the user's configuration.
export function configuredLibrary(config = readConfig()) {
  const l = config && config.library; return l && typeof l.source === 'string' && l.source ? { source: l.source, version: l.version || null } : null;
}

// Which library to read and where that came from (R104): the command's --library, then BUDDY_LIBRARY, then the user's
// configuration, then Buddy's default library. The version is --version, else the one the chosen source carries, else
// none (then the latest published version is looked up when the library is read: latestVersion). Offline: never reads a library.
export function libraryChoice({ library = null, version = null } = {}, env = process.env, config = readConfig()) {
  const fromEnv = parseLibraryVar(env[LIBRARY_VAR]); const fromConfig = configuredLibrary(config);
  const pick = library ? { source: library, version: null, from: 'option' } : fromEnv ? { ...fromEnv, from: 'env' }
    : fromConfig ? { ...fromConfig, from: 'config' } : { source: DEFAULT_LIBRARY.url, version: null, from: 'default' };
  return { ...pick, version: version || pick.version, versionFrom: version ? 'option' : pick.version ? pick.from : null, env: fromEnv, config: fromConfig };
}

// Which library, version and profile init will use. A library without a version: a local folder is read as it is (its
// last commit); a remote one at its latest published version, looked up by latestVersion when it is read. Without
// --profile the profile is null until the library is read (its default_profile, else FALLBACK_PROFILE).
export function chooseLibrary({ library = null, version = null, profile = null, env = process.env, config = undefined } = {}) {
  const c = libraryChoice({ library, version }, env, config === undefined ? readConfig() : config);
  const local = !looksRemote(c.source);
  return { source: local ? path.resolve(c.source) : c.source, shown: local ? path.resolve(c.source) : publicUrl(c.source), local, isDefault: c.from === 'default',
    from: c.from, version: c.version, profile: profile || null };
}

// buddy library --set: keeps the library (and, if given, its version) in the user's configuration. A folder is kept as
// its absolute path and must exist; a URL is kept as written (so its credentials, if it has any, stay in the user's own
// file), never reached here, and only ever shown without credentials.
export function setLibrary(source, version = null) {
  if (!source || !source.trim()) throw new Error('--set needs a git url or a folder');
  let s = source.trim();
  if (!looksRemote(s)) {
    s = path.resolve(s);
    if (!fs.existsSync(s) || !fs.statSync(s).isDirectory()) throw new Error(`the library folder ${s} does not exist or is not a folder`);
  }
  updateConfig(c => { c.library = version ? { source: s, version } : { source: s }; });
  return { source: s, shown: looksRemote(s) ? publicUrl(s) : s, local: !looksRemote(s), version };
}
export function unsetLibrary() {
  const had = configuredLibrary(readConfig({ strict: true }));
  if (had) updateConfig(c => { delete c.library; });
  return had;
}

const showSource = s => looksRemote(s) ? publicUrl(s) : path.resolve(s);
// buddy library --show: which library a new project would use, at which version, and why that one won.
export function libraryShowReport(env = process.env, config = readConfig()) {
  const c = libraryChoice({}, env, config); const local = !looksRemote(c.source);
  const version = c.version ? `${c.version} (${c.versionFrom === 'env' ? `from the ${LIBRARY_VAR} variable` : 'set with the library in your Buddy configuration'})`
    : local ? 'none: the folder is read at its last commit' : 'the latest published version (its highest version tag, looked up when a project is created; the default branch if it has none)';
  const why = {
    env: `the ${LIBRARY_VAR} variable is set, and it wins over your Buddy configuration${c.config ? ` (which names ${showSource(c.config.source)}, not used while the variable is set)` : ''}`,
    config: `it is set in your Buddy configuration (${configFile()}) and the ${LIBRARY_VAR} variable is not set`,
    default: `neither the ${LIBRARY_VAR} variable nor your Buddy configuration names a library`,
  }[c.from];
  const out = [`Library: ${showSource(c.source)}${c.from === 'default' ? ' (Buddy\'s default library)' : ''}`, `Version: ${version}`, `Why this one: ${why}.`,
    'A command\'s own --library and --version win over all of these.'];
  if (c.from === 'default') out.push('Set your organisation\'s library once with: buddy library --set <git url or folder> [--version <tag>]');
  return out.join('\n');
}

// --- versions: the latest published version of a library (R104) -------------------------------------------------------

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
const cmpIds = (a, b) => {   // semantic-version pre-release order: numbers below words, numbers by value, a longer list above its prefix
  const x = a.split('.'), y = b.split('.');
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] === undefined) return -1; if (y[i] === undefined) return 1;
    const nx = /^\d+$/.test(x[i]), ny = /^\d+$/.test(y[i]);
    if (nx && ny) { const d = Number(x[i]) - Number(y[i]); if (d) return d; }
    else if (nx !== ny) return nx ? -1 : 1;
    else if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  }
  return 0;
};
export function compareVersions(a, b) {
  const x = a.match(SEMVER), y = b.match(SEMVER);
  for (let i = 1; i <= 3; i++) { const d = Number(x[i]) - Number(y[i]); if (d) return d; }
  if (!x[4] || !y[4]) return x[4] ? -1 : y[4] ? 1 : 0;
  return cmpIds(x[4], y[4]);
}
// The highest semantic-version tag (v1.2.3 or 1.2.3) among tag names; a pre-release only when there is nothing else; null without any.
export function latestTag(tags) {
  const sem = [...new Set(tags)].filter(t => SEMVER.test(t));
  const released = sem.filter(t => !t.match(SEMVER)[4]);
  const pool = released.length ? released : sem;
  return pool.length ? pool.sort(compareVersions).pop() : null;
}

const gitEnv = () => ({ ...process.env, GIT_TERMINAL_PROMPT: '0' });   // no hidden password prompt: the user's credential helper or nothing

// For a remote library without a version: its latest version tag ({ ...lib, version, latest: true }) or, without version
// tags, its default branch ({ ...lib, noTags: true }). A library with a version, or a local folder, is returned as it is.
export function latestVersion(lib) {
  if (lib.version || lib.local) return lib;
  const r = git(os.tmpdir(), ['ls-remote', '--tags', lib.source], { env: gitEnv(), timeout: 120000 });
  if (!r.ok) {
    const why = (r.err.split('\n').filter(Boolean).pop() || 'git gave no reason').split(lib.source).join(lib.shown);
    throw new Error(`could not read the versions of the library ${lib.shown}: ${why}. Check that your git can reach it (git ls-remote ${lib.shown})${lib.isDefault ? '; or name another library with --library, or prepare the project without one with --no-library' : ''}.`);
  }
  const tags = r.out.split('\n').map(l => (l.split('\t')[1] || '').replace(/^refs\/tags\//, '').replace(/\^\{\}$/, '')).filter(Boolean);
  const tag = latestTag(tags);
  return tag ? { ...lib, version: tag, latest: true } : { ...lib, noTags: true };
}

// The version as the report and the note say it.
const versionWords = lib => lib.latest ? `version ${lib.version} (the latest)` : lib.version ? `version ${lib.version}` : lib.noTags ? 'no version tags: its default branch' : null;
// Which library a project is born from, why that one, and the two ways to use another (said before init and in its summary).
export function libraryLine(lib, name = null, commit = null) {
  const at = [versionWords(lib), commit ? `commit ${commit.slice(0, 12)}` : null].filter(Boolean).join(', ');
  return `Library: ${name ? `${name} (${lib.shown})` : lib.shown}${at ? `, ${at}` : ''}; ${lib.from === 'default' ? 'Buddy\'s default library, as no other is set' : LIBRARY_FROM[lib.from]}. `
    + 'To use another one for this project only: buddy init --library <git url or folder>; for every new project: buddy library --set <git url or folder>.';
}

// What is left out when a library folder that is not in git is copied as it is: installed or built things, never sources.
export const UNVERSIONED_SKIP = new Set(['.git', 'node_modules', 'bin', 'obj', 'dist']);

// Gets the library's files: { dir, commit, uncommitted, inGit, cleanup }. A project receives only what its library has
// committed: a remote library, and a local folder in git, are fetched shallow at the version (or, for a local folder
// without one, its last commit) into a temporary folder, never read from a working tree (which holds ignored and
// uncommitted files). Only a local folder that is not in git is read where it is, without UNVERSIONED_SKIP.
export function fetchLibrary(lib) {
  let from = lib.source, prefix = '', uncommitted = false;
  if (lib.local) {
    if (!fs.existsSync(lib.source)) throw new Error(`the library folder ${lib.source} does not exist`);
    if (!fs.statSync(lib.source).isDirectory()) throw new Error(`the library ${lib.source} is not a folder`);
    const top = git(lib.source, ['rev-parse', '--show-toplevel']);
    if (!top.ok) {
      if (lib.version) throw new Error(`the library folder ${lib.source} is not a git repository, so it has no version ${lib.version}`);
      return { dir: lib.source, commit: null, uncommitted: null, inGit: false, cleanup: () => {} };
    }
    from = path.resolve(top.out); prefix = git(lib.source, ['rev-parse', '--show-prefix']).out;
    if (!lib.version) { const st = git(lib.source, ['status', '--porcelain', '--', '.']); uncommitted = st.ok ? st.out.length > 0 : null; }
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-library-'));
  const cleanup = () => { try { fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3 }); } catch { /* a temporary folder left behind is harmless */ } };
  const env = gitEnv();
  const quiet = (args, timeout = 60000) => git(tmpDir, args, { env, timeout });
  let r = quiet(['init', '-q']);
  if (r.ok) r = quiet(['fetch', '-q', '--depth', '1', '--no-tags', from, lib.version || 'HEAD'], FETCH_TIMEOUT_MS);
  // The files as the library committed them (its own .gitattributes still apply), not converted by this machine's autocrlf.
  if (r.ok) r = quiet(['-c', 'advice.detachedHead=false', '-c', 'core.autocrlf=false', 'checkout', '-q', 'FETCH_HEAD']);
  if (!r.ok) {
    cleanup();
    const why = (r.err.split('\n').filter(Boolean).pop() || 'git gave no reason').split(lib.source).join(lib.shown).split(from).join(lib.shown);
    const at = versionWords(lib) || (lib.local ? 'its last commit' : 'its default branch');
    const hint = lib.local ? (lib.version ? 'check that the library has that version' : 'check that the library has at least one commit')
      : `check that your git can reach it (git ls-remote ${lib.shown}) and that the version exists${lib.isDefault ? '; or name another library with --library, or prepare the project without one with --no-library' : ''}`;
    throw new Error(`could not get the library ${lib.shown} at ${at}: ${why}. ${hint[0].toUpperCase()}${hint.slice(1)}.`);
  }
  const head = quiet(['rev-parse', 'HEAD']);
  return { dir: path.join(tmpDir, prefix), commit: head.ok ? head.out : null, uncommitted, inGit: true, cleanup };
}

// Which standards a library gives a profile: [{ name, from }] for standards/general/ and standards/<profile>/, those that exist.
const isDirectory = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
export function standardsFolders(dir, profile) {
  const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
  return [GENERAL, profile].filter((n, i, a) => n && a.indexOf(n) === i).map(name => ({ name, from: path.join(dir, 'standards', name) })).filter(x => isDir(x.from));
}

// What a fetched library says about itself: its contract (checked first: one this Buddy does not understand stops here,
// in plain words, whatever else the file holds), its default profile and its profiles, from its library.json ({ name,
// contract, default_profile, profiles: { <profile>: <one line> } }) when it has one, else contract 1, no default and the
// folders of standards/ and templates/ without descriptions. `general` is never a profile. `shown` names the library in messages.
export function readProfiles(dir, shown = null) {
  const subdirs = d => { try { return fs.readdirSync(path.join(dir, d), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name); } catch { return []; } };
  const file = path.join(dir, LIBRARY_JSON); const the = shown ? `the library ${shown}` : 'the library';
  if (fs.existsSync(file)) {
    let j; try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error(`the library's ${LIBRARY_JSON} is not valid JSON: ${e.message}`); }
    if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error(`the library's ${LIBRARY_JSON} is not an object ({ "name": "...", "contract": 1, "profiles": { "<profile>": "<one line>" } })`);
    const declared = j.contract !== undefined;
    if (declared && !(Number.isInteger(j.contract) && j.contract >= 1)) throw new Error(`the library's ${LIBRARY_JSON} says which contract the library follows, and its "contract" must be a whole number from 1, not ${JSON.stringify(j.contract)}`);
    const contract = declared ? j.contract : 1; const top = Math.max(...CONTRACTS);
    if (!CONTRACTS.includes(contract)) throw new Error(`${the} follows contract ${contract}; this Buddy understands up to contract ${top}: install a newer Buddy`);
    if (j.default_profile !== undefined && !(typeof j.default_profile === 'string' && j.default_profile.trim())) throw new Error(`the library's ${LIBRARY_JSON} names its default profile in "default_profile", and it must be a profile's name, not ${JSON.stringify(j.default_profile)}`);
    if (typeof j.profiles !== 'object' || Array.isArray(j.profiles) || !j.profiles) throw new Error(`the library's ${LIBRARY_JSON} has no "profiles" object ({ "name": "...", "profiles": { "<profile>": "<one line>" } })`);
    const profiles = Object.entries(j.profiles).filter(([n]) => n !== GENERAL).map(([name, line]) => ({ name, line: typeof line === 'string' ? line.replace(/\s+/g, ' ').trim() : '' }));
    return { name: typeof j.name === 'string' && j.name.trim() ? j.name.trim() : null, described: true, contract, contractDeclared: declared, defaultProfile: j.default_profile ? j.default_profile.trim() : null, profiles };
  }
  const names = [...new Set([...subdirs('standards'), ...subdirs('templates')])].filter(n => n !== GENERAL).sort();
  return { name: null, described: false, contract: 1, contractDeclared: false, defaultProfile: null, profiles: names.map(name => ({ name, line: '' })) };
}

// Contract 2: the questions asked before a project is born, in the front matter of questions/general.md (always asked)
// and questions/<profile>.md: `questions:`, a list of { id, text, why (the clause that needs the answer), choices (optional
// list), section (of docs/context.md, where the answer goes), fills (optional: the open value {{name}} of the standards the
// answer fills) }. No file: no questions.
const NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
export const OPEN_VALUE = /\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g;
export function readQuestions(dir, name) {
  const rel = `questions/${name}.md`; const file = path.join(dir, rel); if (!fs.existsSync(file)) return [];
  const doc = parseDocument(fs.readFileSync(file, 'utf8')); const where = `the library's ${rel}`;
  if (doc.error || !Array.isArray(doc.data?.questions)) throw new Error(`${where} must start with a front matter that lists its questions (questions: - id: ...): ${doc.error || 'it has no "questions" list'}`);
  return doc.data.questions.map((q, i) => {
    const miss = ['id', 'text', 'why', 'section'].filter(k => typeof q?.[k] !== 'string' || !q[k].trim());
    if (miss.length) throw new Error(`question ${i + 1} of ${where} has no ${miss.map(k => `"${k}"`).join(', ')}`);
    if (!CONTEXT_SECTIONS.includes(q.section)) throw new Error(`question ${q.id} of ${where} sends its answer to "${q.section}"; the sections of the context are: ${CONTEXT_SECTIONS.join(', ')}`);
    if (q.choices != null && !Array.isArray(q.choices)) throw new Error(`question ${q.id} of ${where} has "choices" that are not a list`);
    if (q.fills != null && !NAME.test(String(q.fills))) throw new Error(`question ${q.id} of ${where} fills "${q.fills}", which is not a name (letters, digits and _)`);
    return { id: q.id, text: q.text, why: q.why, choices: (q.choices || []).map(String), section: q.section, fills: q.fills || null };
  });
}
export function questionsReport(qs, title) {
  if (!qs.length) return [`${title}: none.`];
  return [`${title}:`, ...qs.flatMap(q => [`  ${q.id}  ${q.text}${q.choices.length ? ` (${q.choices.join(' / ')})` : ''}`,
    `      why: ${q.why}; the answer goes to ${q.section}${q.fills ? ` and fills {{${q.fills}}} in the standards` : ''}`])];
}

// Contract 2: a profile's steps, which Buddy runs once after reading the requirements (run-profile-steps), in the front matter of
// steps/<step>/step.md: { id (the folder's name), profiles (the profiles it belongs to), record (where its record goes in the
// project), triggers (a list of { text, clause }: what a change may bring that asks to update the record), items (a list of
// { id, text, clause }) }. What a base application decides is its template's, not the step's (R189): the front matter of
// templates/<profile>/docs/steps/<step>.decided.md lists `decided:` { id (an item of the step), file (the template's file that decides
// it, with its placeholder names) }; it is a file of the template, so it is copied into the project with the rest. A folder without
// step.md is not a step. Returns the steps of `profile` (each with that profile's `prefill`), or all of them; a malformed one is refused.
const str = v => (v == null || typeof v === 'object' ? '' : String(v).replace(/\s+/g, ' ').trim());
export function readSteps(dir, profile = null) {
  let names; try { names = fs.readdirSync(path.join(dir, 'steps'), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort(); } catch { return []; }
  const steps = names.filter(n => fs.existsSync(path.join(dir, 'steps', n, 'step.md'))).map(n => {
    const where = `the library's steps/${n}/step.md`; const doc = parseDocument(fs.readFileSync(path.join(dir, 'steps', n, 'step.md'), 'utf8')); const d = doc.data;
    if (doc.error || !d || typeof d !== 'object') throw new Error(`${where} must start with a front matter (id, profiles, record, triggers, items): ${doc.error || 'it has none'}`);
    if (str(d.id) !== n) throw new Error(`${where} has the id "${str(d.id)}"; a step's id is the name of its folder, ${n}`);
    if (!Array.isArray(d.profiles) || !d.profiles.length || d.profiles.some(p => !str(p))) throw new Error(`${where} does not say which profiles it belongs to (profiles: [<profile>, ...])`);
    const record = str(d.record).replace(/\\/g, '/');
    if (!record.endsWith('.md') || path.isAbsolute(record) || /^[A-Za-z]:/.test(record) || record.split('/').includes('..')) throw new Error(`${where} says where its record goes with "record", a path inside the project ending in .md (such as docs/security/${n}.md), not "${record}"`);
    const list = (k, req, need) => {
      if (d[k] == null && !need) return [];
      if (!Array.isArray(d[k]) || (need && !d[k].length)) throw new Error(`${where} has no "${k}" list`);
      return d[k].map((x, i) => { const miss = req.filter(f => !str(x?.[f])); if (miss.length) throw new Error(`${k.slice(0, -1)} ${i + 1} of ${where} has no ${miss.map(f => `"${f}"`).join(', ')}`); return x; });
    };
    const triggers = list('triggers', ['text', 'clause'], false).map(t => ({ text: str(t.text), clause: str(t.clause) }));
    const items = list('items', ['id', 'text', 'clause'], true).map(x => ({ id: str(x.id), text: str(x.text), clause: str(x.clause), by: x.decided_by }));
    const old = items.find(x => x.by != null); if (old) throw new Error(`item ${old.id} of ${where} has "decided_by", which no longer goes in a step: each template says what it decides, in templates/<profile>/docs/steps/${n}.decided.md (decided: - id: ${old.id} file: <the template's file>)`);
    const twice = items.find((x, i) => items.findIndex(y => y.id === x.id) !== i); if (twice) throw new Error(`${where} has the item ${twice.id} twice`);
    return { id: n, profiles: d.profiles.map(str), record, triggers, items: items.map(({ by, ...x }) => x) };
  });
  return profile ? steps.filter(s => s.profiles.includes(profile)).map(s => ({ ...s, prefill: readPrefill(dir, profile, s) })) : steps;
}
// The prefill of a step in a profile's template: [{ id, file }], none when the template or its prefill is missing; an item the step lacks or a file the template lacks is refused.
function readPrefill(dir, profile, st) {
  const rel = `templates/${profile}/docs/steps/${st.id}.decided.md`; const file = path.join(dir, rel); if (!fs.existsSync(file)) return [];
  const where = `the library's ${rel}`; const doc = parseDocument(fs.readFileSync(file, 'utf8'));
  if (doc.error || !Array.isArray(doc.data?.decided)) throw new Error(`${where} must start with a front matter that lists what the template decides (decided: - id: <item> file: <the template's file>): ${doc.error || 'it has no "decided" list'}`);
  return doc.data.decided.map((x, i) => {
    const id = str(x?.id), f = str(x?.file).replace(/\\/g, '/'); if (!id || !f) throw new Error(`entry ${i + 1} of ${where} has no ${!id ? '"id"' : '"file"'}`);
    if (!st.items.some(it => it.id === id)) throw new Error(`${where} decides the item ${id}, which the step ${st.id} does not have; its items: ${st.items.map(it => it.id).join(', ')}`);
    if (f.split('/').includes('..') || !fs.statSync(path.join(dir, 'templates', profile, f), { throwIfNoEntry: false })?.isFile()) throw new Error(`${where} says the item ${id} is decided by ${f}, which templates/${profile}/ does not have`);
    return { id, file: f };
  });
}
export function stepsReport(steps, title) {
  if (!steps.length) return [`${title}: none.`];
  return [`${title}:`, ...steps.flatMap(s => { const by = (s.prefill || []).length; return [`  ${s.id}  ${s.items.length} item${s.items.length === 1 ? '' : 's'}${by ? ` (${by} decided by the base application)` : ''}, recorded in ${s.record}`,
    `      triggers: ${s.triggers.map(t => `${t.text} (${t.clause})`).join('; ') || 'none'}`]; })];
}

// Contract 2: the normative documents the standards and the steps cite, listed in the front matter of normative/index.md: `documents:`, a list of
// { id (what a citation names: SCS in "SCS v2.0 clause 4.2"), title, version, link (a URL, or the path of a file in the library) }; the text after
// the front matter is for people. Documents are linked, never copied: init copies only this index, to NORMATIVE. No file: no documents.
export const NORMATIVE = 'docs/standards/normative.md';
export function readNormative(dir) {
  const file = path.join(dir, 'normative', 'index.md'); if (!fs.existsSync(file)) return [];
  const where = 'the library\'s normative/index.md'; const doc = parseDocument(fs.readFileSync(file, 'utf8'));
  if (doc.error || !Array.isArray(doc.data?.documents) || !doc.data.documents.length) throw new Error(`${where} must start with a front matter that lists its documents (documents: - id: ... title: ... version: ... link: ...): ${doc.error || 'it has no "documents" list'}`);
  const docs = doc.data.documents.map((x, i) => {
    const miss = ['id', 'title', 'version', 'link'].filter(k => !str(x?.[k])); if (miss.length) throw new Error(`document ${i + 1} of ${where} has no ${miss.map(k => `"${k}"`).join(', ')}`);
    const link = str(x.link).replace(/\\/g, '/');
    if (!looksRemote(link) && (path.isAbsolute(link) || /^[A-Za-z]:/.test(link) || link.split('/').includes('..') || !fs.statSync(path.join(dir, link), { throwIfNoEntry: false })?.isFile())) throw new Error(`document ${str(x.id)} of ${where} links to "${link}", which is neither a URL nor a file of the library (a path from the library's root)`);
    return { id: str(x.id), title: str(x.title), version: str(x.version), link };
  });
  const twice = docs.find((x, i) => docs.findIndex(y => y.id === x.id) !== i); if (twice) throw new Error(`${where} lists the document ${twice.id} twice`);
  return docs;
}
export function normativeReport(docs) {
  if (!docs.length) return ['Normative documents of the library: none.'];
  return [`Normative documents of the library (linked, never copied: the project receives their index at ${NORMATIVE}):`, ...docs.map(x => `  ${x.id}  ${x.title}, ${x.version}: ${x.link}`)];
}

// Contract 2: the saved prompts of the organisation (a review before a test environment, the package for a human reviewer): Claude Code skills
// at prompts/<name>/SKILL.md, whose front matter has name (the folder's name), description (what it does and when it is used: Buddy offers it then)
// and profiles. init writes each of the profile's, folder and all, to the project's .agents/skills/<name>/, and a thin wrapper to .claude/skills/<name>/ for Claude Code. A folder without SKILL.md is not one.
export function readPrompts(dir, profile = null) {
  let names; try { names = fs.readdirSync(path.join(dir, 'prompts'), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort(); } catch { return []; }
  const prompts = names.filter(n => fs.existsSync(path.join(dir, 'prompts', n, 'SKILL.md'))).map(n => {
    const where = `the library's prompts/${n}/SKILL.md`; const doc = parseDocument(fs.readFileSync(path.join(dir, 'prompts', n, 'SKILL.md'), 'utf8')); const d = doc.data;
    if (doc.error || !d || typeof d !== 'object') throw new Error(`${where} must start with a front matter (name, description, profiles): ${doc.error || 'it has none'}`);
    if (str(d.name) !== n) throw new Error(`${where} has the name "${str(d.name)}"; a saved prompt's name is the name of its folder, ${n}`);
    if (!str(d.description)) throw new Error(`${where} has no "description", which says what it does and when it is used`);
    if (!Array.isArray(d.profiles) || !d.profiles.length || d.profiles.some(p => !str(p))) throw new Error(`${where} does not say which profiles it belongs to (profiles: [<profile>, ...])`);
    return { name: n, description: str(d.description), profiles: d.profiles.map(str) };
  });
  return profile ? prompts.filter(p => p.profiles.includes(profile)) : prompts;
}
export function promptsReport(prompts, title) {
  if (!prompts.length) return [`${title}: none.`];
  return [`${title}:`, ...prompts.map(p => `  ${p.name}  ${p.description}`)];
}

// buddy init --list-profiles (with the general questions), or --questions --profile <name> (that profile's questions and steps):
// the library is chosen as init would choose it and read (shallow, into a temporary folder).
export function listProfiles({ library = null, version = null, profile = null, env = process.env, config = undefined } = {}) {
  const lib = latestVersion(chooseLibrary({ library, version, env, config }));
  const got = fetchLibrary(lib);
  try {
    const about = readProfiles(got.dir, lib.shown);
    if (profile && !about.profiles.some(p => p.name === profile)) throw new Error(`the library ${lib.shown} has no profile "${profile}"; its profiles: ${about.profiles.map(p => p.name).join(', ') || 'none'}`);
    return { lib, commit: got.commit, inGit: got.inGit, ...about, questions: readQuestions(got.dir, profile || GENERAL), steps: profile ? readSteps(got.dir, profile) : [], normative: profile ? readNormative(got.dir) : [], prompts: profile ? readPrompts(got.dir, profile) : [] };
  } finally { got.cleanup(); }
}

export function profilesReport({ lib, commit, inGit, name, described, profiles, contract = 1, contractDeclared = false, defaultProfile = null, questions = [] }) {
  const at = [versionWords(lib) || (lib.local ? (inGit ? 'its last commit' : 'not versioned') : null), commit ? `commit ${commit.slice(0, 12)}` : null].filter(Boolean).join(', ');
  const out = [`Profiles of the library ${name ? `${name} (${lib.shown})` : lib.shown}, ${LIBRARY_FROM[lib.from]}${at ? `, ${at}` : ''}:`];
  if (!profiles.length) out.push('  none: the library has no profiles');
  const w = Math.max(0, ...profiles.map(p => p.name.length));
  for (const p of profiles) out.push(`  ${described ? p.name.padEnd(w) : p.name}${described ? `  ${p.line || '(no description)'}` : ''}`);
  if (!described) out.push(`The library has no ${LIBRARY_JSON}, so its profiles are the folders of its standards/ and templates/, without descriptions.`);
  if (profiles.length) out.push('', 'Create the project with one of them: buddy init --profile <profile>' + (lib.from === 'option' ? ` --library ${lib.shown}` : '') + (lib.version && !lib.latest ? ` --version ${lib.version}` : ''));
  out.push(defaultProfile ? `Without --profile: ${defaultProfile}, the library's default.` : `Without --profile: ${FALLBACK_PROFILE} (the library names no default_profile, so Buddy's own).`);
  out.push(`The library follows contract ${contract}${contractDeclared ? '' : ' (it declares none)'}; this Buddy understands up to contract ${Math.max(...CONTRACTS)}.`);
  out.push('', ...questionsReport(questions, 'General questions, asked before every project'), 'A profile\'s own questions: buddy init --questions --profile <profile>', '', libraryLine(lib, name, commit));
  return out.join('\n');
}

export function libraryOriginNote(lib, got, date = todayStr(), copied = [GENERAL, lib.profile].filter(Boolean), pipeline = null, themes = []) {
  const version = lib.latest ? `latest: \`${lib.version}\`` : lib.version ? `\`${lib.version}\`` : lib.noTags ? 'none: the library has no version tags, so its default branch was read' : !lib.local ? 'none: the library\'s default branch' : got.inGit ? 'none: the library\'s last commit' : 'none: the library folder is not versioned';
  const lines = ['# Origin of these standards', '',
    `Copied by \`buddy init\` on ${date}, so the project carries its standards and does not depend on the library to run.`, '',
    `- Library: \`${lib.shown}\` (${LIBRARY_FROM[lib.from] || LIBRARY_FROM.option})`,
    lib.profile ? `- Profile: \`${lib.profile}\`` : '- Profile: none (born without a profile; add one with `buddy init --profile <profile>`)',
    `- Standards copied: ${copied.length ? copied.map(n => `\`docs/standards/${n}/\` from the library's \`standards/${n}/\``).join(', ') : lib.profile ? 'none: the library has no general standards and none for this profile' : 'none: the library has no general standards'}`,
    `- Version requested: ${version}`,
    `- Commit: ${got.commit ? `\`${got.commit}\`` : got.inGit ? 'none (the library had no commits yet)' : 'none (the library folder is not in git, so it was copied as it was, without node_modules, bin, obj, dist and .git; keep it under version control to tell its versions apart)'}`];
  if (pipeline) lines.push('- Repository host: `' + pipeline.host + '`; ' + pipelineWords(pipeline));
  if (lib.local && !lib.version && got.inGit) lines.push(`- Uncommitted changes in the library: ${got.uncommitted == null ? 'could not tell' : got.uncommitted ? 'yes, and they were NOT included: only the committed state was copied' : 'none'}`);
  if (themes.length) lines.push(`- Themes copied: ${themes.map(n => `\`docs/design/themes/${n}\``).join(', ')} from the library's \`themes/\`; the project's own from then on.`);
  if (!copied.includes(GENERAL)) lines.push(`- The library has no general standards (no \`standards/${GENERAL}/\` folder)${lib.profile ? ': only the profile\'s were copied' : ''}.`);
  if (lib.profile && !copied.includes(lib.profile)) lines.push(`- The profile \`${lib.profile}\` has no standards of its own in the library (no \`standards/${lib.profile}/\` folder): only the general ones were copied.`);
  lines.push('', 'Each standards file says in its front matter whether it is born with the project (`lifecycle: birth`: from now on the project\'s own, edited here) or kept up to date by the library (`lifecycle: evergreen`: the project keeps the version pinned above until it decides to move it).',
    '', 'To update: copy the same folders from the new version over these, review the difference in the project\'s history and update this note.', '');
  return lines.join('\n');
}

// --- the base application ---------------------------------------------------------------------------------------------

const FOLD = { 'ß': 'ss', 'æ': 'ae', 'Æ': 'AE', 'ø': 'o', 'Ø': 'O', 'œ': 'oe', 'Œ': 'OE', 'đ': 'd', 'Đ': 'D', 'ł': 'l', 'Ł': 'L', 'þ': 'th', 'Þ': 'TH' };

// The application's names from the project's folder name: PascalCase (a C# identifier: namespaces, projects) and kebab
// (package names, URLs), ASCII-folded. Throws, saying why, when no valid C# identifier can be made of it.
export function projectNames(folder) {
  const ascii = folder.normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^\x00-\x7f]/g, c => FOLD[c] ?? ' ');
  const words = ascii.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (!words.length) throw new Error(`the project's folder name "${folder}" has no letters or digits to name the application with; rename the folder (for example "my-app") and run init again, or use --no-template`);
  const pascal = words.map(w => w[0].toUpperCase() + w.slice(1).toLowerCase()).join('');
  const kebab = words.map(w => w.toLowerCase()).join('-');
  if (/^[0-9]/.test(pascal)) throw new Error(`the project's folder name "${folder}" would name the application ${pascal}, and a C# name cannot start with a digit; rename the folder (for example "app-${kebab}") and run init again, or use --no-template`);
  return { pascal, kebab };
}

const rename = (s, n) => s.split(PLACEHOLDER.pascal).join(n.pascal).split(PLACEHOLDER.kebab).join(n.kebab);
// A library in git gives only its committed files (and never its .git); a folder that is not in git is copied without UNVERSIONED_SKIP.
const skipOf = got => got.inGit ? new Set(['.git']) : UNVERSIONED_SKIP;
const isText = buf => !buf.subarray(0, 8000).includes(0);

// The files of a template, as { from, rel } with rel already renamed for the project; the library's .git is never part of it.
function templateFiles(dir, names, skip, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    if (skip.has(e.name)) continue;
    const r = rel ? path.join(rel, e.name) : e.name;
    if (e.isDirectory()) out.push(...templateFiles(dir, names, skip, r));
    else if (e.isFile()) out.push({ from: path.join(dir, r), rel: rename(r, names) });
  }
  return out;
}

// Both tools get the same block (INSTRUCTIONS in toolfiles.mjs says where each reads it).
// The tools init writes for: those found on the machine; with none found (a machine where neither is on the path) Claude Code, as in 0.4.0.
const toolsHere = () => { const f = findTools(); return f.length ? f : ['claude']; };

// Buddy's block (src/claudemd.mjs) in the instructions file of a tool: created, or merged into the one the template brought (block first, the template's
// text kept) or, when the folder already had one, appended to its end; running init again keeps it.
function claudeMdAction(root, cameFromTemplate, name = 'CLAUDE.md') {
  const file = path.join(root, name); const had = fs.existsSync(file);
  const r = mergeClaudeMd(had ? fs.readFileSync(file, 'utf8') : null, { where: cameFromTemplate ? 'top' : 'end' });
  if (r.change !== 'kept') fs.writeFileSync(file, r.text);
  const note = { created: 'a short pointer to the context, the standards, the inputs and the commit rules, so any session here knows the project is built with Buddy',
    merged: cameFromTemplate ? "Buddy's block was put first, the template's text was kept" : "Buddy's block was added at the end; the rest of the file is as it was",
    updated: "Buddy's block was brought up to date; the rest of the file is as it was", kept: "Buddy's block is already there" }[r.change];
  return { done: r.change === 'created' ? 'created' : r.change === 'kept' ? 'kept' : 'merged', what: name, note };
}

function copyTemplate(files, root, names) {
  const copied = [], skipped = [];
  for (const f of files) {
    const to = path.join(root, f.rel);
    if (fs.existsSync(to)) { skipped.push(f.rel.split(path.sep).join('/')); continue; }
    fs.mkdirSync(path.dirname(to), { recursive: true });
    const buf = fs.readFileSync(f.from);
    fs.writeFileSync(to, isText(buf) ? rename(buf.toString('utf8'), names) : buf);
    try { fs.chmodSync(to, fs.statSync(f.from).mode & 0o777); } catch { /* modes do not matter where they cannot be set */ }
    copied.push(f.rel);
  }
  return { copied, skipped };
}

// --- an existing project ----------------------------------------------------------------------------------------------

// What init itself creates or a new folder may already hold (names compared without case; README* and LICENSE* too).
// Any other entry at the top of the folder, file or folder, means it already holds a project (R103): its own code, over
// which no template is copied.
export const NOT_A_PROJECT = ['.git', '.buddy', 'docs', '.gitignore', '.gitattributes', '.editorconfig', '.claude', '.agents', 'claude.md', 'agents.md', '.ds_store', 'thumbs.db', 'desktop.ini'];
const notAProject = name => { const n = name.toLowerCase(); return NOT_A_PROJECT.includes(n) || n.startsWith('readme') || n.startsWith('license'); };

// The entries at the top of the folder that make it an existing project (none when it is new or does not exist yet).
export function existingProject(root) {
  let entries; try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return []; }
  return entries.filter(e => !notAProject(e.name)).map(e => e.name + (e.isDirectory() ? '/' : '')).sort();
}
export const EXISTING_MESSAGE = 'This folder already holds a project: no template was copied; the standards apply to the code each change writes from now on, and existing code that is not touched is not forced to follow them.';

// --- init --------------------------------------------------------------------------------------------------------------

const bornWithoutProfile = dest => { try { return /^- Profile: none\b/m.test(fs.readFileSync(path.join(dest, ORIGIN_NOTE), 'utf8')); } catch { return false; } };

// Returns { root, actions: [{ what, done: 'created'|'copied'|'kept'|'used'|'skipped', note }], born, existing, pipeline };
// `born` is true when the base application was copied, so its setup and validate should run once (firstChecks); `existing`
// lists what made the folder an existing project when a library was read (then no template is copied); `pipeline` is set
// when the template brings pipelines (pipelineFor), and then `host` is required. Validates before writing.
export function initProject({ repo = process.cwd(), standards = null, library = null, version = null, profile = null, noProfile = false, noLibrary = false, noTemplate = false, host = null, answers = null, now = todayStr(), env = process.env, config = undefined } = {}) {
  const root = path.resolve(repo); const actions = [];
  // The owner's answers to the library's questions (contract 2): { "<question id>": "<answer>" }, read before anything is written.
  let given = null, questions = [], steps = [], normative = [], prompts = [];
  if (answers && (standards || noLibrary)) throw new Error('--answers goes with a library: the answers are to its questions');
  if (answers) {
    try { given = JSON.parse(fs.readFileSync(answers, 'utf8')); } catch (e) { throw new Error(`the answers file ${path.resolve(answers)} could not be read as JSON: ${e.message}`); }
    if (!given || typeof given !== 'object' || Array.isArray(given) || Object.values(given).some(v => typeof v !== 'string')) throw new Error(`the answers file ${path.resolve(answers)} must be { "<question id>": "<answer>", ... }`);
  }
  const answer = q => given?.[q.id]?.trim() || null;
  if (noProfile && profile) throw new Error('--no-profile cannot go with --profile');
  if (noProfile && (standards || noLibrary)) throw new Error('--no-profile goes with a library: it brings the library\'s general standards and themes without a profile');
  if (standards && (library || version || profile)) throw new Error('choose either a plain folder of standards (--standards) or a library (--library, --version, --profile), not both');
  if (noLibrary && (library || version || profile)) throw new Error('--no-library cannot go with --library, --version or --profile');
  if (host != null && !HOST_CHOICES.includes(host)) throw new Error(`--host is where the repository will live: ${HOST_CHOICES.join(', ')}; not "${host}"`);
  let src = null;
  if (standards) {
    src = path.resolve(standards);
    if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) throw new Error(`the standards folder ${src} does not exist or is not a folder`);
    if (fs.existsSync(path.join(src, ORIGIN_NOTE))) throw new Error(`the standards folder already has an ${ORIGIN_NOTE}; it looks like a copy, not the library itself`);
    const rel = path.relative(src, root);
    if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) throw new Error('the project cannot be inside its own standards folder');
  }
  const dest = path.join(root, 'docs', 'standards');
  const standardsThere = fs.existsSync(dest);
  const addingProfile = standardsThere && !!profile && !standards && !noLibrary && !noProfile && bornWithoutProfile(dest);

  // A library is read for a project with no standards yet, or when bringing a profile into one born with --no-profile.
  // The folder is looked at before anything is written: one that already holds a project gets the standards, no template.
  let lib = null, got = null, names = null, plan = null, pipeline = null, folders = [], existing = [], libName = null, offered = [], profileWhy = 'it was chosen with --profile';
  if (!standards && !noLibrary && (!standardsThere || addingProfile)) {
    lib = chooseLibrary({ library, version, profile, env, config });
    if (lib.profile === GENERAL) throw new Error(`"${GENERAL}" holds the standards every profile receives; it is not a profile. Choose a profile with --profile`);
    existing = noProfile ? [] : existingProject(root);
    if (!noProfile && !noTemplate && !existing.length) names = projectNames(path.basename(root));
    lib = latestVersion(lib);
    got = fetchLibrary(lib);
    try {
      const subdirs = d => { try { return fs.readdirSync(path.join(got.dir, d), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name); } catch { return []; } };
      const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
      const about = readProfiles(got.dir, lib.shown);   // stops here a library whose contract this Buddy does not understand
      libName = about.name; offered = about.profiles;
      if (noProfile) {
        folders = standardsFolders(got.dir, null);
        questions = readQuestions(got.dir, GENERAL);
        const unknown = Object.keys(given || {}).filter(id => !questions.some(q => q.id === id));
        if (unknown.length) throw new Error(`the answers name a question the library does not ask: ${unknown.join(', ')}; its general questions: ${questions.map(q => q.id).join(', ') || 'none'}`);
        normative = readNormative(got.dir);
      } else {
        if (!lib.profile) {
          lib = { ...lib, profile: about.defaultProfile || FALLBACK_PROFILE }; profileWhy = about.defaultProfile ? 'it is the library\'s default profile' : 'the library names no default profile, so Buddy\'s own was taken';
          if (lib.profile === GENERAL) throw new Error(`the library's ${LIBRARY_JSON} names "${GENERAL}" as its default_profile, but it holds the standards every profile receives; it is not a profile. Choose a profile with --profile`);
        }
        const tpl = path.join(got.dir, 'templates', lib.profile);
        folders = standardsFolders(got.dir, lib.profile);
        if (!folders.some(f => f.name === lib.profile) && !isDir(tpl)) {
          const have = [...new Set([...subdirs('standards'), ...subdirs('templates')])].filter(n => n !== GENERAL).sort();
          throw new Error(`the library ${lib.shown} has no profile "${lib.profile}" (neither standards/${lib.profile}/ nor templates/${lib.profile}/); ${have.length ? `its profiles: ${have.join(', ')}` : 'it has no standards/ or templates/ folder: it does not look like a library'}`);
        }
        questions = [...readQuestions(got.dir, GENERAL), ...readQuestions(got.dir, lib.profile)];
        const unknown = Object.keys(given || {}).filter(id => !questions.some(q => q.id === id));
        if (unknown.length) throw new Error(`the answers name a question the library does not ask: ${unknown.join(', ')}; its questions for the profile ${lib.profile}: ${questions.map(q => q.id).join(', ') || 'none'}`);
        steps = readSteps(got.dir, lib.profile); normative = readNormative(got.dir); prompts = readPrompts(got.dir, lib.profile);
        if (names && isDir(tpl)) {
          plan = templateFiles(tpl, names, skipOf(got));
          if (pipelineFor(plan, 'none').pipeline && !host) throw new Error(HOST_MISSING);
          ({ files: plan, pipeline } = pipelineFor(plan, host));
        }
      }
    } catch (e) { got.cleanup(); throw e; }
  }

  const made = [];   // the files init writes, named one by one in the project's first commit
  const wrote = file => { made.push(file); return file; };
  const filesUnder = dir => fs.readdirSync(dir, { withFileTypes: true, recursive: true }).filter(e => e.isFile()).map(e => path.join(e.parentPath ?? e.path, e.name));
  try {
    if (!fs.existsSync(root)) { fs.mkdirSync(root, { recursive: true }); actions.push({ done: 'created', what: `the folder ${root}` }); }

    const top = git(root, ['rev-parse', '--show-toplevel']);
    if (top.ok) actions.push({ done: 'used', what: `the git repository at ${path.resolve(top.out)}` });
    else { const r = git(root, ['init', '-q']); if (!r.ok) throw new Error(`git init failed: ${r.err}`); actions.push({ done: 'created', what: 'a git repository' }); }

    // The backlog (R118): where each change of no milestone is recorded; milestones get their folder when the first one is opened.
    const backlog = path.join(root, 'docs', 'buddy', 'backlog');
    if (fs.existsSync(backlog)) actions.push({ done: 'kept', what: 'docs/buddy/backlog/', note: 'already there' });
    else { fs.mkdirSync(backlog, { recursive: true }); actions.push({ done: 'created', what: 'docs/buddy/backlog/', note: 'where each change will be recorded until it belongs to a milestone' }); }

    const ctx = path.join(root, 'docs', 'context.md');
    if (fs.existsSync(ctx)) actions.push({ done: 'kept', what: 'docs/context.md', note: 'already there, left as it was' });
    else { fs.writeFileSync(wrote(ctx), emptyContext(path.basename(root), now)); actions.push({ done: 'created', what: 'docs/context.md', note: 'the business context, empty until the owner tells it' }); }
    const answered = questions.filter(answer);
    if (answered.length) {   // each answer in its question's section, with the question and why it is asked: the owner's words
      let text = fs.readFileSync(ctx, 'utf8');
      for (const q of answered) text = addStatement(text, { section: q.section, statement: `${q.text} ${answer(q).replace(/\.+$/, '')}. Asked because: ${q.why}`, date: now }).text;
      fs.writeFileSync(ctx, text); made.push(ctx); actions.push({ done: 'created', what: `${answered.length} answer${answered.length === 1 ? '' : 's'} in docs/context.md`, note: 'each in its question\'s section, with the question and why it is asked' });
    }

    const inputs = path.join(root, 'docs', 'inputs');
    if (fs.existsSync(inputs)) actions.push({ done: 'kept', what: 'docs/inputs/', note: 'already there, left as it was' });
    else { fs.mkdirSync(inputs, { recursive: true }); fs.writeFileSync(wrote(path.join(inputs, 'README.md')), INPUTS_README); actions.push({ done: 'created', what: 'docs/inputs/', note: 'where what the owner hands over is kept' }); }

    if (standardsThere && !addingProfile) actions.push({ done: 'kept', what: 'docs/standards/', note: src || library || version || profile ? 'already there, left as it was; the standards were not copied' : 'already there; no library was read' });
    else if (src) {
      const origin = standardsOrigin(src);
      fs.cpSync(src, dest, { recursive: true, errorOnExist: true, force: false, filter: f => path.basename(f) !== '.git' });
      fs.writeFileSync(path.join(dest, ORIGIN_NOTE), originNote(origin, now)); made.push(...filesUnder(dest));
      const pin = origin.repository ? (origin.commit ? `, commit ${origin.commit.slice(0, 12)}${origin.uncommitted ? ' plus uncommitted changes' : ''}` : ', no commit yet') : ', not in git';
      actions.push({ done: 'copied', what: 'docs/standards/', note: `from ${src}${pin}; origin in docs/standards/${ORIGIN_NOTE}` });
    } else if (lib) {
      const skip = skipOf(got);
      fs.mkdirSync(dest, { recursive: true });
      const copiedNow = [];
      for (const f of folders) {
        const sub = path.join(dest, f.name);
        if (fs.existsSync(sub)) continue;
        fs.cpSync(f.from, sub, { recursive: true, errorOnExist: true, force: false, filter: p => !skip.has(path.basename(p)) });
        made.push(...filesUnder(sub)); copiedNow.push(f.name);
      }
      const copiedNames = folders.map(f => f.name).filter(n => isDirectory(path.join(dest, n)));
      let copiedNormative = false;
      if (normative.length && !fs.existsSync(path.join(root, NORMATIVE))) {
        fs.copyFileSync(path.join(got.dir, 'normative', 'index.md'), wrote(path.join(root, NORMATIVE)));   // the index only, never a document
        copiedNormative = true;
      }
      const themesFrom = path.join(got.dir, 'themes'), themesTo = path.join(root, 'docs', 'design', 'themes');
      const themeNames = isDirectory(themesFrom) ? fs.readdirSync(themesFrom).filter(n => n.endsWith('.css')).sort() : [];
      const themeSamples = isDirectory(themesFrom) ? fs.readdirSync(themesFrom).filter(n => n.endsWith('.html')).sort() : [];
      fs.writeFileSync(wrote(path.join(dest, ORIGIN_NOTE)), libraryOriginNote(lib, got, now, copiedNames, pipeline, themeNames));
      if (themeNames.length) {   // the library's themes (contract 2, optional), never over one the project already has
        fs.mkdirSync(themesTo, { recursive: true });
        const copiedThemes = [];
        for (const n of themeNames) { const to = path.join(themesTo, n); if (!fs.existsSync(to)) { fs.copyFileSync(path.join(themesFrom, n), to); made.push(to); copiedThemes.push(n); } }
        for (const n of themeSamples) { const to = path.join(themesTo, n); if (!fs.existsSync(to)) { fs.copyFileSync(path.join(themesFrom, n), to); made.push(to); } }
        if (copiedThemes.length) actions.push({ done: 'copied', what: 'docs/design/themes/', note: `${copiedThemes.length} theme${copiedThemes.length === 1 ? '' : 's'} of the library (${copiedThemes.map(n => n.replace(/\.css$/, '')).join(', ')}), for the owner to choose from during discovery` });
      }
      const at = [versionWords(lib), got.commit ? `commit ${got.commit.slice(0, 12)}` : null,
        got.inGit ? null : 'not versioned: copied as it was, without node_modules, bin, obj, dist and .git'].filter(Boolean).join(', ');
      const left = got.uncommitted ? '; the library\'s uncommitted changes were NOT included, only what it has committed' : '';
      const which = noProfile
        ? (copiedNames.length ? `${copiedNames.map(n => `${n}/`).join(' and ')}, without a profile` : 'nothing: the library has no general standards')
        : addingProfile
          ? (copiedNow.length ? `${copiedNow.map(n => `${n}/`).join(' and ')}` : `nothing new: the profile ${lib.profile} has no standards of its own`)
          : (copiedNames.length ? `${copiedNames.map(n => `${n}/`).join(' and ')}${copiedNames.includes(GENERAL) ? '' : ', the library has no general standards'}${copiedNames.includes(lib.profile) ? '' : `, the profile ${lib.profile} has no standards of its own`}` : 'nothing: the library has no general standards and none for this profile');
      actions.push({ done: 'copied', what: 'docs/standards/', note: `${which}; ${lib.profile ? `profile ${lib.profile} of ` : ''}${lib.isDefault ? 'the default library ' : ''}${lib.shown}${lib.from === 'env' || lib.from === 'config' ? ` (${LIBRARY_FROM[lib.from]})` : ''}${at ? `, ${at}` : ''}${left}; origin in docs/standards/${ORIGIN_NOTE}` });
      if (copiedNormative) actions.push({ done: 'copied', what: NORMATIVE, note: `the library's index of its normative documents (${normative.map(x => `${x.id} ${x.version}`).join(', ')}); the documents are linked, never copied` });
    } else actions.push({ done: 'skipped', what: 'docs/standards/', note: 'no library chosen; add the standards later with buddy init --library <git url or folder>, or --standards <folder>' });
    if (given && !lib) actions.push({ done: 'skipped', what: 'the answers', note: 'the project already has its standards, so no library was read and its questions are not answered here' });
    // The open values {{name}} of the standards just copied: filled from the answers; those left are to be defined.
    const open = new Set();
    if ((!standardsThere || addingProfile) && (src || lib)) for (const f of filesUnder(dest)) {
      const buf = fs.readFileSync(f); if (!isText(buf)) continue;
      const was = buf.toString('utf8'); const text = was.replace(OPEN_VALUE, (m, n) => answer(questions.find(q => q.fills === n && answer(q)) || {}) || m);
      if (text !== was) { fs.writeFileSync(f, text); made.push(f); }
      for (const m of text.matchAll(OPEN_VALUE)) open.add(`{{${m[1]}}} (${slash(path.relative(root, f))})`);
    }

    let born = false, copiedClaudeMd = false;
    if (lib && noProfile) actions.push({ done: 'skipped', what: 'the base application', note: 'no profile yet (--no-profile); bring one later with buddy init --profile <profile>' });
    else if (lib && existing.length) actions.push({ done: 'skipped', what: 'the base application', note: `the folder already holds a project: ${existing.slice(0, 6).join(', ')}${existing.length > 6 ? ` and ${existing.length - 6} more` : ''}` });
    else if (lib && noTemplate) actions.push({ done: 'skipped', what: 'the base application', note: 'not asked for (--no-template)' });
    else if (lib && !plan) actions.push({ done: 'skipped', what: 'the base application', note: `the library has no template for the profile ${lib.profile}` });
    else if (lib) {
      const { copied, skipped } = copyTemplate(plan, root, names);
      born = copied.length > 0; copiedClaudeMd = copied.includes('CLAUDE.md'); made.push(...copied.map(rel => path.join(root, rel)));
      const left = skipped.length ? `; ${skipped.length} already existed and ${skipped.length === 1 ? 'was' : 'were'} left as ${skipped.length === 1 ? 'it was' : 'they were'}: ${skipped.slice(0, 8).join(', ')}${skipped.length > 8 ? ` and ${skipped.length - 8} more` : ''}` : '';
      actions.push({ done: copied.length ? 'copied' : 'kept', what: 'the base application', note: `${copied.length} file${copied.length === 1 ? '' : 's'} of the profile's template, named ${names.pascal} (${names.kebab}), without the library's history${left}` });
    }
    // The project's first architecture decision record: what it is born from. The template's own records in docs/decisions/ came with it.
    if (lib && lib.profile) {
      const at = [versionWords(lib), got.commit ? `commit ${got.commit.slice(0, 12)}` : null].filter(Boolean).join(', ') || 'not versioned';
      const from = `${libName ? `${libName} (${lib.shown})` : lib.shown}, ${at}`; const base = actions.find(a => a.what === 'the base application');
      const adr = decideV0({ title: `Build on the profile ${lib.profile} of the library ${libName || libraryLabel(lib.shown)}`, requested_by: 'buddy init', decided_by: 'human',
        context: 'The project needs standards to be built to and, when its library offers one, a base application to start from. buddy init takes both from a library of the organisation, for one of its profiles.',
        options: offered.map(p => `- The profile ${p.name}${p.line ? `: ${p.line}` : ''}`).join('\n') || `- The profile ${lib.profile}`,
        outcome: `the profile ${lib.profile} of the library ${from}`, reason: `${profileWhy}; the library is ${LIBRARY_FROM[lib.from]}`,
        consequences: `- The standards in docs/standards/ are the project's; docs/standards/ORIGIN.md says where they came from.\n- The base application: ${base ? `${base.done}, ${base.note}` : 'none'}.`,
        built: 'built', where: `docs/standards/${ORIGIN_NOTE}`, rules: [{ text: `The project follows the standards in docs/standards/, from the profile ${lib.profile} of ${from}`, origin: 'human' }] }, root, { date: now });
      made.push(path.join(root, adr.file)); actions.push({ done: 'created', what: adr.file, note: 'the project\'s first architecture decision record: the library, its version, the profile and the base application it is born from' });
    }
    // The profile's steps (contract 2): each copied to docs/steps/<step>/, and its record written at its record path, where an item the prefill
    // of the template just copied decides is written as decided with its file (never asked), and the rest as to draft: Buddy drafts them after
    // reading the requirements and the owner confirms or corrects them line by line. What is there already is kept.
    for (const st of steps) {
      const to = path.join(root, 'docs', 'steps', st.id);
      if (fs.existsSync(to)) actions.push({ done: 'kept', what: `docs/steps/${st.id}/`, note: 'already there, left as it was' });
      else { fs.cpSync(path.join(got.dir, 'steps', st.id), to, { recursive: true, filter: p => !skipOf(got).has(path.basename(p)) }); made.push(...filesUnder(to)); actions.push({ done: 'copied', what: `docs/steps/${st.id}/`, note: `the step ${st.id} of the profile ${lib.profile}, run after the requirements are read` }); }
      const rec = path.join(root, st.record);
      if (fs.existsSync(rec)) { actions.push({ done: 'kept', what: st.record, note: `the record of the step ${st.id}, already there, left as it was` }); continue; }
      const decided = it => { const p = born && st.prefill.find(x => x.id === it.id); return p && fs.existsSync(path.join(root, rename(p.file, names))) ? rename(p.file, names) : null; };
      fs.mkdirSync(path.dirname(rec), { recursive: true }); fs.writeFileSync(wrote(rec), stepRecord(st, decided, now));
      const n = st.items.filter(decided).length;
      actions.push({ done: 'created', what: st.record, note: `the record of the step ${st.id}: ${n} item${n === 1 ? '' : 's'} decided by the base application, ${st.items.length - n} for Buddy to draft once the first milestone's plan says what will be built; the owner confirms each line, then approves the whole record before any change is built` });
    }
    // The profile's saved prompts (contract 2), each a skill of the project that Buddy offers at the moment its description names. Written in full to
    // .agents/skills/<name>/ and, with Claude Code on the machine, as a thin SKILL.md in .claude/skills/<name>/ that sends to it. What is there already is kept.
    const tools = toolsHere(); const mine = [];
    for (const p of prompts) {
      const what = `${FULL}/${p.name}/`; const to = path.join(root, FULL, p.name);
      if (fs.existsSync(to)) actions.push({ done: 'kept', what, note: 'already there, left as it was' });
      else {
        fs.cpSync(path.join(got.dir, 'prompts', p.name), to, { recursive: true, filter: f => !skipOf(got).has(path.basename(f)) }); made.push(...filesUnder(to)); mine.push(...filesUnder(to).map(f => slash(path.relative(root, f))));
        actions.push({ done: 'copied', what, note: `the saved prompt ${p.name} of the profile ${lib.profile}, which Buddy offers when its description says` });
      }
      if (!tools.includes('claude') || !fs.existsSync(path.join(to, 'SKILL.md'))) continue;
      const wrap = `${WRAPPED}/${p.name}/SKILL.md`;
      if (!writeNew(root, wrap, wrapperOf(p.name, fs.readFileSync(path.join(to, 'SKILL.md'), 'utf8')))) actions.push({ done: 'kept', what: `${WRAPPED}/${p.name}/`, note: 'already there, left as it was' });
      else { made.push(path.join(root, wrap)); mine.push(wrap); actions.push({ done: 'created', what: wrap, note: `the same front matter; it sends Claude Code to ${FULL}/${p.name}/SKILL.md` }); }
    }
    // The routine permissions (R157), merged into what the template or the owner already put there. The first commit takes the file when init
    // created it or it was committed and clean before: an owner's file with work of their own in it is left for them to commit.
    const settings = path.join(root, SETTINGS); const cleanBefore = fs.existsSync(settings) && git(root, ['ls-files', '--error-unmatch', '--', '.claude/settings.json']).ok && git(root, ['status', '--porcelain', '--', '.claude/settings.json']).out === '';
    // Only for the tools found on the machine: .claude/settings.json and CLAUDE.md for Claude Code, AGENTS.md for Antigravity. Antigravity's form of the
    // routine permissions is not written: where it reads a project's rules and their syntax are not documented in what `agy` says without a model.
    if (tools.includes('claude')) {
      const perm = writePermissions(root); actions.push(permissionsAction(perm));
      if (perm.change === 'created' || (perm.change === 'merged' && (cleanBefore || made.includes(settings)))) made.push(settings);
    }
    for (const t of tools) {
      const md = claudeMdAction(root, t === 'claude' && copiedClaudeMd, INSTRUCTIONS[t]); actions.push(md); if (md.done !== 'kept') made.push(path.join(root, INSTRUCTIONS[t]));
      if (md.done === 'created') mine.push(INSTRUCTIONS[t]);
    }
    if (ensureBuddyIgnored(root)) { made.push(path.join(root, '.gitignore')); actions.push({ done: 'created', what: '.gitignore (.buddy/)', note: 'keeps Buddy\'s local state out of git' }); }
    if (mine.length) made.push(path.join(root, recordFiles(root, mine)));   // the hash of what init wrote, to tell later a file the owner edited
    const ver = lib && (lib.version || (got.commit ? `commit ${got.commit.slice(0, 7)}` : 'unversioned'));
    const subject = lib ? (addingProfile ? `add profile ${lib.profile} from ${libName || libraryLabel(lib.shown)} ${ver}`
      : noProfile ? `born from ${libName || libraryLabel(lib.shown)} ${ver}, without a profile`
      : `born from ${libName || libraryLabel(lib.shown)} ${ver}, profile ${lib.profile}`)
      : src ? `born from the standards of ${path.basename(src)}` : 'born without a library';
    const first = birthCommit(root, [...new Set(made)], `chore: ${subject}`, addingProfile ? 'the profile commit' : 'the first commit'); if (first) actions.push(first);
    return { root, actions, born, existing, pipeline, open: [...open], library: lib ? libraryLine(lib, libName, got.commit) : null };
  } finally { if (got) got.cleanup(); }
}

// The record of a step as init writes it: its items as lines tagged like the context's (decided, to draft as `unknown`), confirmed with buddy context confirm.
export function stepRecord(st, decided, date = todayStr()) {
  const line = it => `- ${it.id}: ${it.text} (${it.clause}). ${decided(it) ? `Decided by the base application in ${decided(it)}. \`decided\`` : 'To draft. `unknown`'}`;
  return [`---\nstep: ${st.id}\nupdated: ${date}\n---`, `# The record of the step ${st.id}`, '',
    'Every line ends with its origin: `decided` (the base application decides it, in the file named; never asked), `unknown` (Buddy drafts it after reading the requirements), `assumed` (drafted by Buddy with his reason, not confirmed) or `human YYYY-MM-DD` (confirmed by the owner). Only the owner changes a line to `human`: `buddy context confirm ' + st.record + ' --line <n> --by owner`, with `--text "<the corrected line>"` to correct it. Development starts when every line is decided or confirmed and the owner approved the record whole (`buddy context approve ' + st.record + ' --by owner`); any later edit needs his approval again.', '',
    '## Items', ...st.items.map(line), ''].join('\n');
}

// A library's name when its library.json gives none: the last part of its address, without .git.
const libraryLabel = shown => String(shown).replace(/[\\/]+$/, '').split(/[\\/:]/).pop().replace(/\.git$/, '') || 'the library';

// The project's first commit of what init wrote (R144), its files named one by one (never the whole folder): the owner's later work and Dev's
// first change start from it, and the checkpoint of the first slice has a parent to measure from. Without a git identity nothing is committed
// and the action says so; a commit git refuses (a hook of the project, say) does not stop init either. Returns the action, or null when init
// wrote nothing.
function birthCommit(root, files, message, what = 'the first commit') {
  const rels = files.filter(f => fs.existsSync(f)).map(f => path.relative(root, f).split(path.sep).join('/'));
  if (!rels.length) return null;
  const ignored = new Set(git(root, ['check-ignore', '--no-index', '--stdin'], { input: rels.join('\n') }).out.split('\n').map(l => l.trim()).filter(Boolean));
  const keep = rels.filter(f => !ignored.has(f)); if (!keep.length) return null;
  const who = k => process.env[`GIT_COMMITTER_${k.toUpperCase()}`] || git(root, ['config', `user.${k}`]).out;
  if (!who('name') || !who('email')) return { done: 'skipped', what, note: 'git does not know who you are (user.name and user.email are not set), so everything init made is left uncommitted; set them with git config --global user.name "<your name>" and git config --global user.email "<your email>", then commit it' };
  const add = git(root, ['add', '--', ...keep]);
  const c = add.ok ? git(root, ['commit', '-q', '-m', message, '--', ...keep]) : add;
  if (!c.ok) return { done: 'skipped', what, note: `git refused it (${(c.err.split('\n').filter(Boolean).pop() || 'no reason given').slice(0, 200)}); everything init made is left uncommitted` };
  return { done: 'created', what, note: `"${message}", with the ${keep.length} file${keep.length === 1 ? '' : 's'} init made` };
}

// Runs the project's setup (if it has one) and then its validate, once, each with a time limit, and never fails: it says
// whether the project is born healthy. Returns [{ label, result: 'passed'|'failed'|'timed out'|'not run', status, ms, tail }].
export async function firstChecks(root, { setupTimeoutMs = SETUP_TIMEOUT_MS, validateTimeoutMs = VALIDATE_TIMEOUT_MS, onStart = () => {} } = {}) {
  const out = [];
  const run = async (c, timeoutMs) => {
    onStart(c, timeoutMs);
    const r = await runWithTimeout(c, { cwd: root, timeoutMs });
    const tail = ((r.stdout || '') + (r.stderr || '')).split(/\r?\n/).filter(l => l.trim()).slice(-12).join('\n');
    const res = { label: c.label, result: r.timedOut ? 'timed out' : r.status === 0 ? 'passed' : 'failed', status: r.status, ms: r.ms, timeoutMs, tail };
    out.push(res); return res;
  };
  const setup = npmScriptCommand(root, 'setup');
  if (setup && (await run(setup, setupTimeoutMs)).result !== 'passed') {
    const v = validateCommand(root); if (v) out.push({ label: v.label, result: 'not run', note: 'the setup did not pass' });
    return out;
  }
  const v = validateCommand(root);
  if (v) await run(v, validateTimeoutMs);
  return out;
}

const secs = ms => ms < 60000 ? `${Math.max(1, Math.round(ms / 1000))}s` : `${Math.round(ms / 60000)} min`;

export function healthReport(checks) {
  if (!checks) return [];
  if (!checks.some(c => c.label !== 'npm run setup') && checks.every(c => c.result === 'passed')) return ['Health: the base application has no validate command, so it was not checked.'];
  if (checks.every(c => c.result === 'passed')) return [`Health: the project is born healthy: ${checks.map(c => `${c.label} passed (${secs(c.ms)})`).join(', ')}.`];
  const out = ['Health: the project is NOT healthy yet. It was prepared anyway; this must be fixed before the first change.'];
  for (const c of checks) {
    if (c.result === 'passed') out.push(`  ${c.label} passed (${secs(c.ms)})`);
    else if (c.result === 'not run') out.push(`  ${c.label} was not run: ${c.note}`);
    else {
      out.push(c.result === 'timed out' ? `  ${c.label} did not finish within ${secs(c.timeoutMs)} and was stopped` : `  ${c.label} failed (exit code ${c.status}) after ${secs(c.ms)}`);
      if (c.tail) out.push('    last lines of its output:', ...c.tail.split('\n').map(l => `      ${l}`));
    }
  }
  return out;
}

// `buddy init --permissions` (R157): only the routine permissions, for a project that already exists. Nothing is committed.
export function initPermissions({ repo = process.cwd() } = {}) {
  const root = path.resolve(repo);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error(`the folder ${root} does not exist`);
  const r = writePermissions(root); const a = permissionsAction(r);
  const head = r.change === 'kept' ? `Nothing to do: ${a.what} in ${root} already has the routine permissions` : `Permissions written in ${root}`;
  return [head, `  ${a.done.padEnd(8)} ${a.what} (${a.note})`, ...(r.change === 'kept' ? [] : ['', `Not committed: ${a.what} goes with the project's next commit.`])].join('\n');
}

export function initReport({ root, actions, checks, existing = [], pipeline = null, open = [], library = null }) {
  const changed = actions.some(a => ['created', 'copied', 'merged'].includes(a.done));
  const out = [changed ? `Project prepared in ${root}` : `Nothing to do: the project in ${root} is already prepared`];
  for (const a of actions) out.push(`  ${a.done.padEnd(8)} ${a.what}${a.note ? ` (${a.note})` : ''}`);
  if (library) out.push('', library);
  if (pipeline) { const w = pipelineWords(pipeline); out.push('', `${w[0].toUpperCase()}${w.slice(1)}.`); }
  if (existing.length) out.push('', EXISTING_MESSAGE);
  const health = healthReport(checks);
  if (health.length) out.push('', ...health);
  if (open.length) out.push(...(health.length ? [] : ['']), `Health: to be defined in the standards: ${open.join(', ')}; write each one in its file once the owner decides it.`);
  out.push('', 'Next: the owner tells the story of the business: why this software exists and the outcome that matters, who uses it, its constraints, and what would be costly to get wrong. Each statement goes into docs/context.md with: buddy context add --section "<section>" --text "<their words>"');
  return out.join('\n');
}
