#!/usr/bin/env node
// usage: see USAGE. Prepares a project; creates only what is missing.
import { missingPanelReport } from '../src/tools.mjs';
import { initProject, initReport, initPermissions, firstChecks, listProfiles, profilesReport, questionsReport, stepsReport, normativeReport, promptsReport, DEFAULT_LIBRARY, LIBRARY_JSON, FALLBACK_PROFILE } from '../src/init.mjs';

const USAGE = 'usage: buddy init [--library <git url or folder>] [--version <tag or commit>] [--profile <name> | --no-profile] [--host github|azure|none] [--answers <file>] [--no-template] [--repo <dir>]\n'
  + '       buddy init --list-profiles [--library <git url or folder>] [--version <tag or commit>]\n'
  + '       buddy init --questions --profile <name> [--library <git url or folder>] [--version <tag or commit>]\n'
  + '       buddy init --standards <folder> [--repo <dir>]\n'
  + '       buddy init --no-library [--repo <dir>]\n'
  + '       buddy init --permissions [--repo <dir>]';
const HELP = `${USAGE}
Prepares a project in the current folder (or --repo): a git repository, docs/buddy/backlog/ and docs/context.md, then
its standards and its base application from a library, and runs the application's setup and validate once.
  --library     the library, a git repository with its standards, templates and the rest (core/LIBRARY-GUIDE.md).
                Without it: the BUDDY_LIBRARY variable (<url or folder>, or <url or folder>#<version>), else the library
                set with buddy library --set, else Buddy's default library ${DEFAULT_LIBRARY.url}
                (reached with your own git credentials). See which one wins with: buddy library --show
  --version     the tag or commit to use (default: the one set with the library, else the library's latest published
                version, its highest version tag, or its default branch when it has no version tags; a local folder
                is read at its last commit)
  --profile     the profile to use (default: the one the library's ${LIBRARY_JSON} names, else ${FALLBACK_PROFILE});
                in a project born with --no-profile, brings that profile's template, standards, steps and saved prompts
  --no-profile  start without a profile: brings the library's general standards (including design.md) and themes,
                no template and no profile standards; add a profile later with buddy init --profile <name>
  --list-profiles  show the library's profiles, each with its line from the library's ${LIBRARY_JSON}, its default
                profile, the contract it follows and its general questions, and create nothing
  --questions   with --profile: show that profile's questions, its steps (each with its record and triggers) and the
                library's normative documents (each with its version and link) and its saved prompts, and create nothing
  --answers     a JSON file of the owner's answers to the library's questions, { "<question id>": "<answer>" }: each
                goes into docs/context.md in its question's section and fills its open value {{name}} in the standards
A library says in its ${LIBRARY_JSON} which contract it follows; one that needs a newer Buddy is refused, saying so.
  --host        where the project's repository will live: github (the project keeps the base application's GitHub
                Actions pipeline), azure (its Azure Pipelines one) or none (no pipeline). Required when the base
                application brings pipelines; not needed for a folder that already holds a project or with --no-template
  --no-template only the standards, not the base application
  --standards   a plain folder of standards instead of a library (no base application)
  --no-library  no standards and no base application
  --permissions only the routine permissions, for a project that already exists: writes them into .claude/settings.json
                and does nothing else
Every init also writes the routine permissions into the project's .claude/settings.json, so Claude Code runs them without
asking: Buddy's program (the path of this installation; after a plugin update, run buddy init --permissions again), the
project's checks (npm run validate, scan, setup, npm test) and local git (status, diff, log, add, commit, show). Never a
push, a deletion, an installation or anything outside the project. The entries already there are kept.
The general standards go to docs/standards/general/ and the profile's to docs/standards/<profile>/. A folder that
already holds a project gets the standards but no base application. Never overwrites what exists; a project that already
has docs/standards/ is not given a library again.`;

const VALUE = ['--standards', '--repo', '--library', '--version', '--profile', '--host', '--answers'];
const FLAG = { '--no-profile': 'noProfile', '--no-template': 'noTemplate', '--no-library': 'noLibrary', '--list-profiles': 'listProfiles', '--questions': 'questions', '--permissions': 'permissions' };
const argv = process.argv.slice(2); const o = {};
for (let i = 0; i < argv.length; i++) {
  const k = argv[i];
  if (VALUE.includes(k)) { if (!argv[i + 1] || argv[i + 1].startsWith('--')) { console.error(`error: ${k} needs a value\n${USAGE}`); process.exit(2); } o[k.slice(2)] = argv[++i]; }
  else if (k in FLAG) o[FLAG[k]] = true;
  else if (k === '--help' || k === 'help') { console.log(HELP); process.exit(0); }
  else { console.error(`error: unknown argument ${k}\n${USAGE}`); process.exit(2); }
}
try {
  if (o.permissions) {
    const other = ['standards', 'library', 'version', 'profile', 'noProfile', 'host', 'answers', 'noTemplate', 'noLibrary', 'listProfiles', 'questions'].filter(k => o[k]);
    if (other.length) { console.error(`error: --permissions goes only with --repo; it writes only the routine permissions\n${USAGE}`); process.exit(2); }
    console.log(initPermissions({ repo: o.repo || process.cwd() }));
    process.exit(0);
  }
  if (o.listProfiles) {
    const other = ['standards', 'repo', 'profile', 'noProfile', 'host', 'answers', 'noTemplate', 'noLibrary', 'questions'].filter(k => o[k]);
    if (other.length) { console.error(`error: --list-profiles goes only with --library and --version; it creates nothing\n${USAGE}`); process.exit(2); }
    console.log(profilesReport(listProfiles(o)));
    process.exit(0);
  }
  if (o.questions) {
    if (!o.profile || ['standards', 'repo', 'noProfile', 'host', 'answers', 'noTemplate', 'noLibrary'].some(k => o[k])) { console.error(`error: --questions needs --profile and goes only with --library and --version; it creates nothing\n${USAGE}`); process.exit(2); }
    const got = listProfiles(o);
    console.log([...questionsReport(got.questions, `Questions of the profile ${o.profile}`), '', ...stepsReport(got.steps, `Steps of the profile ${o.profile}, run after the requirements are read`), '', ...normativeReport(got.normative), '', ...promptsReport(got.prompts, `Saved prompts of the profile ${o.profile}, copied to .agents/skills/ (with a wrapper in .claude/skills/ for Claude Code)`)].join('\n'));
    process.exit(0);
  }
  const res = initProject(o);
  if (res.born) res.checks = await firstChecks(res.root, { onStart: (c, ms) => console.log(`Running ${c.label} once, to check the project is born healthy (stopped if it takes more than ${Math.round(ms / 60000)} minutes)...`) });
  console.log(initReport(res) + missingPanelReport());
} catch (e) { console.error(`error: ${e.message}`); process.exit(1); }
