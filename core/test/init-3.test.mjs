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
import { BUDDY, tmp, HOME, run, g, snapshot, BIN, put, EMPTY_TEMPLATE, PIPELINES, fakeLibrary, project, esc } from './_init.helper.mjs';

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