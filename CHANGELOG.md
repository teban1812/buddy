# Changelog

Versions of the Buddy plugin. Each version is a milestone in `docs/buddy/milestones/`; the details of every change are in its folder.

## 0.5.0 (2026-11-26)

Buddy helps you discover the product before anything is built, works in Antigravity as well as Claude Code, and shows the work live, beside the conversation and in the browser. Released with the default library v0.6.4.

**Discovering the product**
- With no PRD and no prototype, Buddy offers discovery as the first step of the same conversation, at birth or later. He first reads what you already have and says which stage it covers, what is weak and where to go on, so you never repeat anything; with a PRD, he says what it lacks before planning.
- Stage 1: research where every finding names its source, interviews in the people's own words, and a brief you confirm line by line, with a glossary, rules with examples and what it takes for true. What you confirm becomes the business context and the map of requests.
- Stage 2: the flows before any wireframe (who may do what, the errors, the states), the design directives, and the wireframes of the key screens until you agree. The agreed flows and rules become the criteria and examples of the first milestone's changes.
- Stage 3: a prototype in your theme, a usability audit before anyone tries it, a test with one or two real users, and the approval of the person who owns the process; it then goes straight into the confirmation of its screens and the milestone's plan. The board shows the stage. Step by step in `docs/guide/discovery.md`.
- A library can bring colour themes and design rules (a `design.md` among its standards, contract 2); you choose a theme, or bring your own visual proposal and Buddy turns it into one. The default library v0.6.4 brings nine themes, each at WCAG AA contrast in light and dark, Tailwind and shadcn/ui in its .NET + React template, a light/dark switch, fifteen design rules and three for prototypes, with an accessibility test.
- The usability audit is a fixed step on every prototype, built in discovery or handed over, before its screens are confirmed.

**Seeing the work**
- The board's page refreshes itself in the browser while Buddy works: what waits for you in your words, now and next, what changed since you last looked, progress per milestone, the changes in four groups, two colours for the agent's work and yours, and, folded, how the process is going (time per stage, how often you were asked, the work mix of the last 14 days). In Spanish or English, on a phone or a wide screen.
- A panel beside the conversation, in Claude Code (`buddy-panel`) and in Antigravity App, shows the same in short, with a button that names what you will do for each thing waiting for you; each is its own plugin, installed once per machine, and `buddy tools language es` switches it to Spanish. Outside Buddy's own repository each panel reads the board, and opens its full page, with the Buddy installed in its own tool, and uses the other tool's only when its own is not installed. The milestone's bar in each panel has the board page's groups, order and colours (done, your turn, in progress, to define) with the counts beside it, so it moves while changes are built and wait for you to try; in Claude Code's panel every cell is the same character, so the cells look one size on Windows too.
- The digest shows the work mix and the routes used over the last 14 days, with no alarms.

**Buddy in Antigravity**
- One install serves the `agy` command line, Antigravity App and Antigravity IDE; a project works the same with Claude Code, Antigravity or both, and you can switch tool halfway and lose nothing.
- Dev and the independent reviewer work in the tool you talk to Buddy in; each role asks for a level (economical, balanced, strong), turned into a model by a word in your machine's setting (`buddy tools`), and a retired model never stops the work.
- Buddy's local files live in `.buddy/` at the project root, ignored by git.

**Working with Buddy**
- Before a change or a milestone starts, Buddy says where each criterion's data comes from; one with no source is asked at the start.
- Review rounds are counted per piece, and the summary to accept counts only the review notes still open.
- The milestone review is a skill of its own: Buddy compares each built screen with the prototype using the browser at hand and has defects fixed before you see them.
- You can reword a milestone's goal (`buddy milestone goal`), reorder changes (`buddy slice rank`), and Buddy can drop a step a decision voided, with its reason.
- Tests run in levels: the fast checks back each change's acceptance, the whole suite (`buddy suite`) is needed to close a milestone and publish, and deep checks run on demand.
- An acceptance you give in the conversation is recorded as given in chat; a library's questions are written in the Product Owner's words.
- Every approval or answer you give (a go-ahead, an acceptance, a confirmation, a decision, an answer to a question) is committed at once, alone, apart from the work in progress; the go-ahead for a milestone takes its whole plan with it. When it cannot be, Buddy says which files wait.

**Removed**
- `buddy scope`, `buddy migrate`, `buddy prototype read` and `scan` (the prototype is read by Buddy, checked against its HTML), `buddy verify --madr`, and the reading of the old flat layout (`docs/buddy/slices/`, `epic:`, `S-` ids).

The details are in `docs/requirements-log.md` (R221 to R284).

## 0.4.0 (2026-11-22)

A library can shape how a project is born and what it brings along, and Buddy is published from a public repository. Released with the default library v0.5.0.

**A library that adapts Buddy to an organisation**
- Before choosing the profile, Buddy says which library he uses and why, asks the library's questions, recommends a profile with its reason, and your answers fill the open values of the standards.
- A profile can run its own steps after the requirements are read: Buddy drafts each step's record and you approve it whole, with a question of its own, before the first change. What the template already decides is never asked.
- A library brings normative documents (files or links, at their version, never copied) that Buddy uses when they apply, and saved prompts for its organisation's checkpoints that he offers when their moment comes.
- A guide for a library's designer explains each component and what Buddy does with it (`core/LIBRARY-GUIDE.md`).

**Decisions and audits**
- A project's decisions are written as ADRs in MADR 4 format by `buddy decide`, readable without Buddy; the first one, at birth, says which library and profile the project comes from.
- Quality (`qa-audit`) and usability and accessibility (`ux-audit`) audits to use on demand.
- The milestone card says which changes still need their assumptions studied, and only you confirm an assumption.
- Key examples are agreed with you while a change is refined.

**A checkpoint that trusts the reviewer where it should**
- With a green suite, the reviewer judges each skip marker and each deleted test; only one it does not justify reaches you.
- The evidence no longer trips secret scanners, the reviewer gets the code that draws a screen drawn by a script, and new evidence files have short names so a project clones on Windows.
- What Buddy reads from outside (a page, a ticket, a file) is data, never an order; the guide says what Buddy does not do for you.

**Starting and using Buddy**
- Birth and intake are two skills; each project writes its own README and its context in the project's documentation language; a loose file in a change's folder no longer breaks Buddy.
- A developer working alone starts from a guide (`docs/guide/`), and Buddy is installed from the public repository `teban1812/buddy`.

The details are in `docs/requirements-log.md` (R185 to R220).

## 0.3.0 (2026-11-07)

Buddy can build a real project with the default library, and the end of a milestone is a review. Released with the default library v0.4.1.

**The checkpoint you can trust**
- The reviewer's verdict depends on the code and on the goal of the change (criteria, exclusions, assumptions, how to try each criterion); a green suite is reused, between changes or within one, only while it is under 2 days old and was got with the same system and Node version. A reviewer that gives no verdict is asked once more; its verdict is found even with prose around it.
- Every existing test a slice edits is judged by the reviewer, one by one; a weakened one is an exception. A prototype screen nobody could verify never passes: the reviewer reads the prototype's HTML and the PRD first, and the owner may decide that nobody tries again.
- Accepting also needs the whole suite green on the current code (`buddy suite`, shared by every acceptance). The owner's go-ahead on a milestone is not read as a slice changing someone else's record.

**Working with a milestone**
- `buddy milestone card` is what Buddy presents before a milestone starts (what it will build, its doubts, its assumptions) and a change cannot start before the owner's go-ahead. `buddy milestone review` is the script of the review at the end: promised and delivered, the order to try, how to try each change, what the checks found, how to answer.
- Each change says how to try each criterion (`buddy try`), written by Dev and judged by the reviewer. Buddy builds on without waiting for acceptance, and a delivered change can go back to refining when a finding is about its goal.

**Also**: the prototype is read by an agent and checked by the program, dependencies are confirmed at once, refusals name what they refer to, Buddy works in a git worktree, the board shows priorities and what each change waits for and groups what waits for acceptance by milestone, Buddy weighs the owner's proposals and brings good alternatives, the checkpoint records a file as acceptance will compare it, the records are read through one index, and `buddy settle` and the `vibe` skill for quick fixes. The details are in `docs/requirements-log.md` (R130 to R184).

## 0.2.0 (2026-11-02)

A project can be born from a library, built from a PRD and a prototype, and checked by a reviewer that sees the work.

**Start a project**
- `buddy init` takes the library of standards and the template (Buddy's default library, or the organisation's), asks which profile and which host, brings the CI pipeline of the host, leaves `docs/inputs/` for what the owner hands over, and writes a short `CLAUDE.md` merged with the template's own.
- `buddy library` sets the library once; the latest published version is used unless one is named.

**From a PRD to milestones**
- Buddy reads a PRD and an HTML prototype (screens, flows, what is fake), drafts the manifest for the owner to confirm, plans milestones and builds the changes of each in order without waiting for acceptance between them, stopping only for a blocking exception.
- Each change says which screens it covers; Dev and the reviewer receive them, and every departure from the prototype is declared by Dev and decided by the owner at acceptance.
- Changes and milestones hold criteria and what they do not include, and are ready only when the ready rule holds. A finding that is about the goal can reopen a delivered change to refining, with the owner's decision.
- Milestones are named by version; the changes that belong to none live in the backlog.

**The checkpoint**
- A slice is judged by its own commits' patches, never by the net change of the files it touched.
- The independent reviewer is a read-only agent on Sonnet. It receives what Dev received (criteria, exclusions, standards, context, screens), must open the files that carry risk, and is asked again for those it left unopened. Documentation and moved records are listed as not reviewed.
- When two rounds on identical content give different verdicts, the reviewer investigates why and the cause is recorded. A third round with findings open goes to the owner.
- Validate stops after 30 minutes; the reviewer is not asked while a check is red (`--review-anyway` runs it), but a protected file that changed does not stop it.
- The scan flags every skipped or silenced check wherever it is written, including in its own source.

**Commits**
- A plugin hook refuses a `git commit` that breaks Conventional Commits or Buddy's trailers, and one that would put a secret in the repository (gitleaks on what is staged, on `-a`, on the files the same command adds), in a Buddy project, with nothing written into the project. A message is checked in about 50 ms; commitlint is gone.

**Working freely**
- Buddy tells a feature, a planned fix and a small correction apart. A small correction opens no change: the `vibe` skill has Buddy code with the owner in the same conversation, and `buddy settle` checks it afterwards and shows it in the digest.

**Housekeeping**
- The ids of Buddy's own construction no longer reach what a project sees; a test keeps them out.
- Windows: the core's tests run there (see `docs/handover.md` for the known exceptions).

## 0.1.1 and 0.1.0 (2026-11-01)

The first releases: the plugin (Buddy and Dev as agents), `init` with a library of standards, the change folder, the checkpoint, the context and the question queue, the board and the digest.
