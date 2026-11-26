#!/usr/bin/env node
// buddy: one entry point for the core commands. Each command is a script in this folder; this dispatcher only forwards.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMMANDS = {
  init: 'prepare a project here: git, docs/buddy/backlog/, docs/context.md, the standards and base application of a library (--library, else the one set with buddy library, else Buddy\'s; --version, --profile, --no-profile, --no-template, --list-profiles), or --standards <folder> (never overwrites)',
  library: 'the library new projects use, set once for you: --set <git url or folder> [--version <tag>], --show (which one wins and why), --unset',
  context: 'the business context and its risk-appetite gate (add, check, card, confirm, approve, accept-assumed, intake)',
  plain: 'mark the words in a text meant for the owner that they may not know (paths, commands, code names, technical terms, HTML tags); it warns, never blocks ("<text>", or - to read it from the standard input)',
  feedback: 'note what got in the way, one line to the field log of Buddy\'s factory ("<text>"; --factory <path> to set where it is)',
  queue: 'question batches: new, show, answer, assume, confirm, status, analyse, defaults',
  scan: 'anti-gaming signals on a git range (deleted tests, skip markers, protected files)',
  decide: 'write an architecture decision record (MADR 4) to docs/decisions/, marking the one it supersedes',
  verify: 'check Buddy files (schemas, ids, references, states) and theme CSS contrast (verify theme [--sample])',
  checkpoint: 'final checkpoint: validate, scan, independent review, review by exception',
  slice: 'milestones, changes and slices (schema @1, one folder each): start [--in | --milestone], milestone start, move-to <change> <milestone|backlog>, list, show, rename, move (legal states only), step add|done|undo, criteria and excludes add|edit|remove (while refining), assume (what Buddy will assume, before building), decision <n> costly|cheap',
  prototype:  'the prototype as the experience contract: facts, draft the manifest from Buddy\'s reading (--reading), card, confirm line by line, add a line, check, screens (docs/inputs/prototype/, HTML first)',
  requests: 'the map of what was asked, each requirement with its destination: add, set (--to, --excluded, --deferred, --waiting), priority (MoSCoW), depend|undepend (--on, --assumed), confirm, order, list [--open], remove',
  index: 'read every record in one pass into .buddy/index.json, rebuilt only when a record changed (--force, --json)',
  find: 'find a change, a piece, a milestone, a criterion, a request, a question or a decision by its words ("<words>", --json)',
  decisions: 'the decisions of the requirements log, each with whether it is built and where (--state built|partly|"not built"|backlog|deferred|superseded|"not applicable", --json)',
  board: 'the board and what is waiting for you, from the records only (--out board.html, --json)',
  tools: 'the setting of this environment, kept in your home folder: the tools found, which builds and which reviews, the word of each level and its effort, what each tool offers today (dev|reviewer <tool>, word <tool> <level> <word> [<effort>], language <en|es>, seen, reset)',
  worker: 'the registry of the workers (Dev, Reviewer, processes) raised for a slice: register, seen, finish, list',
  suite: 'run the project\'s whole test suite once and keep the result, which milestone acceptance rests on (--deep for validate:deep, --validate-timeout <seconds>)',
  settle: 'settle the commits made without a change (a quick fix, vibe work): classify them, run the checks, keep the record, say if the owner has to look (--since <commit>, --json)',
  digest: 'the digest: what changed since you last looked, what waits for you, what may be stalled (--mark records the look)',
  minutes: 'how many times each change asked you something and how long it waited for you, all time ([<change or milestone>], --json)',
  resume: 'where a slice stands, built from the files, to relaunch Dev after a cut (no id: the slices in flight)',
  view: 'the story of a change as a static page or a business-terms summary',
};
// Short forms from the design: `buddy start`, `buddy step`, `buddy status`, `buddy move`, `buddy criteria`, `buddy excludes`, `buddy milestone`,
// `buddy assume`, `buddy try`, `buddy unverified` and `buddy decision` too. `buddy move-to` are `buddy slice start|step|list|move|criteria|excludes|milestone|move-to`.
const ALIAS = { milestone: ['slice', 'milestone'], 'move-to': ['slice', 'move-to'], start: ['slice', 'start'], step: ['slice', 'step'], status: ['slice', 'list'], move: ['slice', 'move'], criteria: ['slice', 'criteria'], excludes: ['slice', 'excludes'], assume: ['slice', 'assume'], try: ['slice', 'try'], unverified: ['slice', 'unverified'], decision: ['slice', 'decision'] };
let [cmd, ...rest] = process.argv.slice(2);
if (cmd in ALIAS) { const [c, sub] = ALIAS[cmd]; cmd = c; rest = [sub, ...rest]; }
if (!cmd || cmd === 'help' || cmd === '--help' || !(cmd in COMMANDS)) {
  const out = ['usage: buddy <command> [args]', '', ...Object.entries(COMMANDS).map(([k, v]) => `  ${k.padEnd(11)} ${v}`), '', 'Run a command without arguments, or see core/README.md, for its options.'];
  (cmd && !(cmd in COMMANDS) && cmd !== 'help' && cmd !== '--help' ? console.error : console.log)(out.join('\n'));
  process.exit(cmd && !(cmd in COMMANDS) && cmd !== 'help' && cmd !== '--help' ? 2 : 0);
}
const r = spawnSync(process.execPath, [path.join(HERE, `${cmd}.mjs`), ...rest], { stdio: 'inherit' });
process.exit(r.status ?? 1);
