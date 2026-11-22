# Designing a library for Buddy

The agent knows how to program, but it does not know your process. The library defines the process, and Buddy runs it.

This guide is for whoever designs a library for an organisation: a technical lead, an architect, the owner of the standards. You do not need to know Buddy well. It explains each part of a library, what Buddy does with it, and what he refuses. Every example is invented; copy them and change them.

## What a library is

A library is a git repository of folders and plain text files. When a Product Owner creates a project with `buddy init`, Buddy reads the library once and copies what the project needs: the rules to build by, the application to start from, the questions to ask first, the checklists to fill in and the organisation's own prompts. After that the project carries its own copy and never depends on the library again.

One library serves many kinds of project through its **profiles**. A profile is one way of building, such as a web API in Node.js or a data pipeline. The owner chooses one profile per project.

A library adds to Buddy; it does not replace him. What you put in a library costs only your organisation's process, never Buddy. If you want a heavy process, the library can ask for it; Buddy runs it as written.

## What a library cannot change

Some rules protect the Product Owner, and Buddy keeps them whatever a library says:

- **Nothing the owner asks for is lost.** Every request is weighed and followed until it is built, excluded or deferred in the open.
- **The evidence is honest.** Programs and an independent reviewer check the work. Buddy never grades his own work, never hides a failing check and never lowers the severity of a finding.
- **Buddy never accepts or signs for the owner.** Only the owner confirms a line of the business context or of a step's record, and only he approves a step's record. A saved prompt that asks for an independent human reviewer gets that review prepared; Buddy never acts as that reviewer.
- **A change's goal is fixed once it is ready.** Changing it is the owner's decision.
- **Costly matters are asked, cheap ones are announced.** Buddy asks the owner only what is costly to get wrong.
- **Buddy never overwrites what a project already has.** A file that exists is kept.
- **Buddy's own records** (under `docs/buddy/`) change only through his program, and the project's decisions are written as decision records in `docs/decisions/`.

## The layout

```text
library.json                       what the library says about itself
standards/
  general/                         the rules every project follows
  <profile>/                       the rules of one profile
templates/
  <profile>/                       the application a new project starts from
    docs/steps/<step>.decided.md   what this application already decides of a step
questions/
  general.md                       asked before every project
  <profile>.md                     asked once the owner chose that profile
steps/
  <step>/step.md                   a checklist Buddy drafts and the owner confirms
normative/
  index.md                         the documents the standards cite, and their versions
prompts/
  <name>/SKILL.md                  a saved prompt of the organisation
```

Each profile needs its own standards, its template, or both. Every other part is optional, though a library should always have its `library.json`.

## How Buddy reads a library

**Which library.** The first that is named wins: `buddy init --library <git url or folder>`; the `BUDDY_LIBRARY` variable; the library a user set once with `buddy library --set <git url or folder>`; else Buddy's default library. `buddy library --show` says which one wins and why.

**Which version.** A version is a git tag. Without `--version`, Buddy reads the highest version tag (`v1.2.0` or `1.2.0`; a pre-release such as `v2.0.0-rc.1` only when there is nothing else). A library without version tags is read at its default branch. A local folder is read at its last commit.

**Only what is committed.** Buddy fetches the library into a temporary folder at that version. Files you have not committed never reach a project. A folder that is not in git is copied as it is, without `node_modules`, `bin`, `obj`, `dist` and `.git`.

**Three moments.** Buddy reads the library at three moments, and never after the project is born:

| Command | What Buddy reads |
| :-- | :-- |
| `buddy init --list-profiles` | `library.json` and the general questions |
| `buddy init --questions --profile <profile>` | that profile's questions, steps (with its template's prefill), normative documents and saved prompts |
| `buddy init` | all of it, and then he copies it into the project |

**Refusals stop everything.** Buddy checks every part before he writes anything. If one part is malformed he stops, says which file and why, and the project folder is left as it was. Fix the library, commit, and run the command again.

**A project is born once.** A project that already has `docs/standards/` is not given a library again: Buddy reads nothing and copies nothing.

## The front matter

Several files start with a front matter: a block between two `---` lines at the very top. Buddy reads a restricted form of YAML there:

- two spaces of indentation, one value per line;
- a list either on one line (`[English, Spanish]`) or one item per line (`- English`);
- no tabs, no multi-line text, no comments at the end of a line;
- a value that starts with a quote is read as a quoted string, so close the quote at the end of the value;
- a number is read as a number, so `2.0` becomes `2`: write `"2.0"` when the exact text matters, such as a version.

The text after the front matter is for people, unless this guide says otherwise.

## library.json

**What it is.** What the library says about itself: its name, the contract it follows and its profiles.

**Where it lives.** At the root of the library.

**Format.** A JSON object:
- `name`: one line; Buddy names the library with it.
- `contract`: a whole number, the version of the agreement between Buddy and the library. Contract 1 covers `library.json`, the standards and the templates. Contract 2 adds the questions, the steps, the normative documents and the saved prompts. A library that uses any of those declares `2`. Without `contract`, the library follows contract 1.
- `default_profile`: the profile used when the owner names none. Without it, Buddy uses `dotnet-react`.
- `profiles`: an object; each key is a profile's name and its value is the one line the owner reads when choosing. `general` is never a profile.

**When Buddy reads it.** At all three moments, first of all.

**What he copies into the project.** Nothing. He names the library, its version and the chosen profile in `docs/standards/ORIGIN.md` and in the project's first decision record, which lists every profile as the options considered.

**What he refuses.** A contract he does not understand: "the library <name> follows contract 3; this Buddy understands up to contract 2: install a newer Buddy". A file that is not valid JSON, or not an object. A `contract` that is not a whole number from 1. A `default_profile` that is not a profile's name. A file with no `profiles` object. At birth, a profile that has neither `standards/<profile>/` nor `templates/<profile>/`: "the library <name> has no profile "<profile>"".

A library without `library.json` still works: its profiles are the folders under `standards/` and `templates/`, without descriptions, and it follows contract 1. Write one anyway; the owner chooses better with a line for each profile.

**Example.**

<!-- file: library.json -->
```json
{
  "name": "Acme engineering library",
  "contract": 2,
  "default_profile": "node-api",
  "profiles": {
    "node-api": "A Node.js web API with its tests, for services other teams call"
  }
}
```

## The standards and their open values

**What they are.** The rules a project is built by. Dev, the agent that builds, works inside them, and the independent reviewer checks the work against them.

**Where they live.** `standards/general/` holds the rules every profile receives; the name `general` is fixed. `standards/<profile>/` holds one profile's own rules. Either may be missing; a profile without its own standards needs a template.

**Format.** Markdown files, in any subfolders. Buddy's agents read the whole text. A rule works best when it states its zone (`must` is fixed, `prefer` is the default, `free` is the builder's choice), how it is checked (a program first, then the reviewer) and the problem it prevents. Buddy's program does not read a `lifecycle` line in the front matter; it is a note for people about who owns the file after birth.

**Open values.** A rule can leave a value to each project by writing `{{name}}` (letters, digits and `_`). A question fills it: the question that `fills` that name writes its answer in place of `{{name}}` in the project's copy. A value left unanswered stays as `{{name}}`, and Buddy tells the owner it is still to be defined. `{{name}}` is reserved for open values: Buddy replaces it in every text file of the project's `docs/standards/`.

**When Buddy reads them.** At birth only.

**What he copies into the project.** `standards/general/` to `docs/standards/general/` and `standards/<profile>/` to `docs/standards/<profile>/`, then fills the open values. He writes `docs/standards/ORIGIN.md`: the library, profile, version and commit they came from. From then on the standards are the project's own.

**What he refuses.** Nothing in the files themselves. A missing folder is not an error; `ORIGIN.md` says which ones were missing.

**Example.**

<!-- file: standards/general/documentation.md -->
```markdown
---
lifecycle: evergreen
---
# Documentation

- `must` The project's documentation is written in {{doc_language}}. Checked by: the reviewer. Prevents: documents half the team cannot read.
```

<!-- file: standards/node-api/code.md -->
```markdown
---
lifecycle: birth
---
# Code

- `must` Every endpoint has a test that calls it. Checked by: npm run validate. Prevents: an endpoint that breaks without anyone noticing.
- `prefer` One module per endpoint. Checked by: the reviewer. Prevents: files nobody can review in one sitting.
```

## The templates

**What they are.** The base application a new project starts from: a working skeleton with its build, its tests and its pipeline.

**Where they live.** `templates/<profile>/`, one per profile. A profile may have none; then the project gets standards only.

**Format.** Any files. Buddy treats a few of them specially:
- **Placeholders.** `BuddyApp` (PascalCase, a valid C# name) and `buddy-app` (kebab-case) are replaced by the project's name, taken from its folder: a folder `acme-orders` gives `AcmeOrders` and `acme-orders`. They are replaced in file and folder names and in the contents of every text file.
- **Pipelines.** `.github/workflows/` for GitHub Actions and `azure-pipelines.yml` at the root for Azure Pipelines. The owner says where the repository will live (`--host github`, `azure` or `none`), and the project keeps only that host's pipeline.
- **Scripts.** In `package.json`: `setup` (optional) runs once when the project is born; `validate` runs the project's checks, at birth and before each change is presented; `scan` (optional) runs the project's own scanning rules once per change. A `validate.sh` at the root also counts as the validate command.
- **`CLAUDE.md`** (optional): kept, with Buddy's own block put first.
- **`docs/decisions/`** (optional): decision records the application already took. They are copied like any file, so the project is born with them. They use the format of `buddy decide` (an id such as `D-2026-01-15-a1b2` and a MADR 4 body); the simplest way to write one is with `buddy decide` in a scratch project.
- **`docs/steps/<step>.decided.md`**: the prefill of a step, described with the steps below.
- **No `README.md`.** Each project writes its own README at birth, from its context (Buddy does it): a README copied from the template describes the base, not the project, and goes stale against what the project decides. What the base application provides at birth and how to run it go in `docs/base-application.md`, written as what the base guarantees and the patterns it offers, never as decisions that are each project's (who its users are, what each user may see).
- **No example features** a project would have to remove. When the base needs an example as the pattern every feature follows, keep it without a screen and where no project has to delete it (its tests and a migration with it).

**When Buddy reads them.** At birth. He lists the template's files before writing anything.

**What he copies into the project.** Every file of `templates/<profile>/`, renamed, into the project's root, without the library's history and without the other hosts' pipelines. He never overwrites a file the folder already has. He does not copy the template into a folder that already holds a project (any file or folder at its top other than `docs`, `.git`, `.claude`, `.gitignore`, `.gitattributes`, `.editorconfig`, a README or a LICENSE), nor with `--no-template`. Then he runs `setup` and `validate` once and tells the owner whether the project was born healthy. He also writes the project's first decision record, in `docs/decisions/`: which library, version and profile it was born from.

**What he refuses.** A template that brings a pipeline when the owner has not said where the repository lives: "the base application brings a pipeline that runs the project's checks on every push, and it needs to know where the repository will live: run init again with --host github (GitHub Actions), --host azure (Azure Pipelines) or --host none (no pipeline). Nothing was written". A project folder whose name has no letters or digits, or would make a name that starts with a digit.

**Example.**

<!-- file: templates/node-api/package.json -->
```json
{
  "name": "buddy-app",
  "private": true,
  "type": "module",
  "scripts": {
    "validate": "node --test"
  }
}
```

<!-- file: templates/node-api/src/buddy-app.mjs -->
```js
// The entry point of BuddyApp. Logs go to standard output only; nothing is kept on disk.
import http from 'node:http';

export const server = http.createServer((req, res) => res.end('BuddyApp is up'));
```

<!-- file: templates/node-api/.github/workflows/validate.yml -->
```yaml
name: validate
on: push
jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm run validate
```

## The questions

**What they are.** What Buddy asks the owner before the project is born, because a standard or a decision needs the answer.

**Where they live.** `questions/general.md` is asked before every project, whatever its profile. `questions/<profile>.md` is asked once the owner has chosen that profile. Both are optional.

**Format.** A front matter with a `questions` list. Each question has:
- `id`: the key of its answer, such as `Q-LANG`. Keep it unique in the library.
- `text`: the question as the owner hears it.
- `why`: why it is asked, citing the clause of a standard or the decision that needs the answer.
- `choices` (optional): the answers to offer. The owner may still answer otherwise.
- `section`: where the answer goes in the project's business context: `Purpose and outcomes`, `Users`, `Constraints`, `Risk appetite` or `Unknowns`. Always one of these English names, whatever language the project's documentation is kept in.
- `fills` (optional): the name of the open value the answer fills in the standards.

The questions do not choose the profile. Buddy recommends one from the answers and each profile's line in `library.json`, and the owner chooses.

**When Buddy reads them.** `--list-profiles` shows the general questions; `--questions --profile <profile>` shows that profile's. Buddy asks them one at a time, in the owner's terms, and writes the answers to a file: `{ "<question id>": "<answer>" }`. `buddy init --answers <file>` reads it.

**What he copies into the project.** Not the questions: their answers. Each answer becomes a line of `docs/context.md` in its question's section, with the question and its `why`, as the owner's own words. An answer to a question that `fills` an open value replaces it in the standards.

**The language.** A library brings its questions in one language, and `buddy init` writes the context in English. When the owner keeps the project's documentation in another language, Buddy rewrites the new context whole in it right after init: the headings, and each question with its answer, worded as he asked it and as the owner answered. He asks the owner for that language only when there is a sign of one other than English (the owner speaks it, or the PRD or the prototype is written in it); a question of the library that asks the documentation language, like `Q-LANG` below, counts as that question, and he does not ask twice. The records of a profile's steps keep the language the library wrote them in.

**What he refuses.** A file without a front matter or a `questions` list: "the library's questions/<name>.md must start with a front matter that lists its questions". A question without `id`, `text`, `why` or `section`: "question 1 of the library's questions/<name>.md has no "why"". A section that is not one of the five: "question Q-LANG of the library's questions/general.md sends its answer to "Elsewhere"; the sections of the context are: ...". `choices` that are not a list. A `fills` that is not a name. At birth, an answer to a question the library does not ask: "the answers name a question the library does not ask: Q-OTHER".

**Example.**

<!-- file: questions/general.md -->
```markdown
---
questions:
  - id: Q-LANG
    text: In which language is the project's documentation written?
    why: "standards/general/documentation.md: the documentation is written in the project's language"
    choices: [English, Spanish]
    section: Constraints
    fills: doc_language
---
# Questions asked before every project
```

<!-- file: questions/node-api.md -->
```markdown
---
questions:
  - id: Q-PUBLIC
    text: Will people outside the company call this service?
    why: SCS v2.0 clause 4.2 asks more of a service the internet reaches
    choices: [yes, no]
    section: Risk appetite
---
# Questions for a Node.js web API
```

And the answers file Buddy writes after asking them:

<!-- answers -->
```json
{ "Q-LANG": "English", "Q-PUBLIC": "no" }
```

## The steps and each template's prefill

**What they are.** A step is a document Buddy drafts once per project, after reading the requirements, and the owner confirms line by line and then approves as a whole before development starts: a privacy review, a security design checklist. A template's prefill says which lines of a step its base application already decides, so nobody is asked them.

**Where they live.** A step lives in `steps/<step>/step.md`, and one step serves every profile it names. Other files in its folder (a checklist, an explanation) travel with it. A folder without `step.md` is not a step. The prefill lives in the template: `templates/<profile>/docs/steps/<step>.decided.md`. Both are optional.

**Format of a step.** A front matter with:
- `id`: the name of the step's folder.
- `profiles`: every profile it applies to, including one without a template.
- `record`: where the step's record goes in the project, a path inside it ending in `.md`.
- `triggers` (optional): what a later change may bring that asks to update the record, each with its `text` and its `clause`.
- `items`: the record's lines, each with its `id` (unique in the step), its `text` and its `clause`.

**Format of a prefill.** A front matter with `decided`: a list of the items this template decides, each with its `id` (an item of the step) and its `file` (the template's file that decides it, written with the placeholders). An item a template decides only in part becomes two items in the step: the part it decides, named in the prefill, and the part the project answers.

**When Buddy reads them.** `--questions --profile <profile>` lists the profile's steps and how many items its template decides. At birth he reads them again before writing anything. After birth, while refining each later change, he checks it against the triggers.

**What he copies into the project.** Each step of the profile to `docs/steps/<step>/`, and its record at the step's `record` path. In the record, an item the prefill decides, whose file the project was born with, is written as decided with that file and never asked. Every other item is left for Buddy to draft from the requirements once the first milestone's plan says what will be built (not at birth), each with his reason, and for the owner to confirm or correct. A record kept in the project's repository is approved by the Product Owner, and only by him, before development: Buddy shows him every line, the decided ones with the file that decides them, and records his approval in the record (who and when) with `buddy context approve <record> --by owner`. Until every line is decided or confirmed and the record is approved as it is now, no change moves to building; any later edit of the record, such as an update a trigger asks for, needs his approval again. The prefill itself is a file of the template, so it is copied and renamed with it. A profile without a template, a project born with `--no-template` or in a folder that holds a project, and a template without a prefill have every item to draft.

**What he refuses.** A step without a front matter. An `id` that is not its folder's name: "the library's steps/<step>/step.md has the id "x"; a step's id is the name of its folder, <step>". No `profiles`. A `record` outside the project or not ending in `.md`. No `items`, or an item or trigger without one of its fields. An item listed twice. An item with `decided_by`, which belongs in the template's prefill. In a prefill: no `decided` list, an entry without its `id` or `file`, an item the step does not have, or a file the template does not have: "the library's templates/node-api/docs/steps/privacy-review.decided.md says the item PRV-01 is decided by src/missing.mjs, which templates/node-api/ does not have".

**Example.**

<!-- file: steps/privacy-review/step.md -->
```markdown
---
id: privacy-review
profiles: [node-api]
record: docs/privacy/privacy-review.md
triggers:
  - text: a new kind of personal data
    clause: PRIV 2026 part 2
items:
  - id: PRV-01
    text: Where the service writes its logs, and how long they are kept
    clause: PRIV 2026 part 3
  - id: PRV-02
    text: Which personal data the service stores, and why
    clause: PRIV 2026 part 2
---
# Privacy review

Drafted after the requirements are read; the owner confirms each line.
```

<!-- file: templates/node-api/docs/steps/privacy-review.decided.md -->
```markdown
---
decided:
  - id: PRV-01
    file: src/buddy-app.mjs
---
What the node-api template decides of the privacy review.
```

## The normative documents

**What they are.** The documents your standards and steps cite (a secure coding standard, a privacy guideline), so Buddy, Dev and the reviewer know which document and version each citation means.

**Where they live.** `normative/index.md`. Optional.

**Format.** A front matter with a `documents` list. Each document has:
- `id`: what a citation names, unique in the index (`SCS` in "SCS v2.0 clause 4.2").
- `title`: the document's name.
- `version`: the version the standards and steps cite.
- `link`: where it is read: a URL (it may be a private page), or the path of a file in the library from its root.

The text after the front matter is for people: where the documents live, what each version changed. When a document's version changes, change it here and review every standard and step that cites the old one.

**When Buddy reads it.** `--questions --profile <profile>` lists the documents with their versions and links. At birth he reads it before writing anything.

**What he copies into the project.** Only the index, to `docs/standards/normative.md`. Never a document, and nothing else of `normative/`: a confidential document stays in the organisation's own document store. The agents resolve each citation through the index, never fetch a link, and work from the clauses as cited; when a decision needs the document itself, they say so.

**What he refuses.** No front matter or an empty `documents` list: "the library's normative/index.md must start with a front matter that lists its documents". A document without one of its fields. An `id` listed twice. A `link` that is neither a URL nor a file of the library: "document PRIV of the library's normative/index.md links to "normative/missing.md", which is neither a URL nor a file of the library".

**Example.**

<!-- file: normative/index.md -->
```markdown
---
documents:
  - id: SCS
    title: Secure Coding Standard
    version: v2.0
    link: https://intranet.example.com/standards/scs-v2.0.pdf
  - id: PRIV
    title: Privacy guideline
    version: "2026"
    link: normative/privacy-guideline.md
---
# Normative documents

The Secure Coding Standard lives on the intranet; the privacy guideline is kept here.
```

<!-- file: normative/privacy-guideline.md -->
```markdown
# Privacy guideline 2026

Part 2: personal data is stored only when a feature needs it. Part 3: logs keep no personal data.
```

## The saved prompts

**What they are.** The organisation's own prompts, for moments that are not one of Buddy's steps: a review before publishing to a test environment, the package an independent reviewer reads before a release.

**Where they live.** `prompts/<name>/SKILL.md`, one folder per prompt; it is a Claude Code skill. Other files in its folder travel with it. A folder without `SKILL.md` is not one. Optional.

**Format.** A front matter with:
- `name`: the name of its folder.
- `description`: what it does and when it is used, in one line. Buddy offers the prompt at that moment.
- `profiles`: every profile it applies to.

The text after the front matter is the prompt itself.

**When Buddy reads them.** `--questions --profile <profile>` lists the profile's prompts with their descriptions. At birth he reads them before writing anything. After birth no program detects the moment: Buddy offers the prompt to the owner when the work reaches what its description names, and runs it when the owner agrees.

**What he copies into the project.** Each prompt of the profile, folder and all, to `.claude/skills/<name>/`. One that is already there is kept.

**What he refuses.** No front matter. A `name` that is not its folder's name: "the library's prompts/<name>/SKILL.md has the name "x"; a saved prompt's name is the name of its folder, <name>". No `description`. No `profiles`.

**Example.**

<!-- file: prompts/release-review/SKILL.md -->
```markdown
---
name: release-review
description: "Prepares the package an independent reviewer reads before a release. Use it before a release to production."
profiles: [node-api]
---
# Release review

List the changes delivered since the last release, each with its acceptance criteria and the evidence of its checks. Do not judge them: the reviewer does.
```

## What a project receives

| From the library | In the project |
| :-- | :-- |
| `standards/general/`, `standards/<profile>/` | `docs/standards/general/`, `docs/standards/<profile>/`, open values filled, and `docs/standards/ORIGIN.md` |
| `templates/<profile>/` | the project's root, renamed, with one host's pipeline |
| the answers to `questions/` | lines in `docs/context.md` |
| `steps/<step>/` | `docs/steps/<step>/` and the step's record |
| `normative/index.md` | `docs/standards/normative.md` |
| `prompts/<name>/` | `.claude/skills/<name>/` |
| the library, its version and the profile | the first decision record in `docs/decisions/` |

Buddy commits all of it as the project's first commit, naming each file.

## Trying your library

Commit your changes first: Buddy reads only what is committed. Then, from any folder:

```text
buddy init --list-profiles --library <your library's folder>
buddy init --questions --profile <profile> --library <your library's folder>
```

The first shows the profiles, the default one, the contract and the general questions. The second shows a profile's questions, steps, normative documents and saved prompts. Either one refuses a malformed part and says which and why.

To see a whole birth, create an empty folder, write an answers file and run, inside that folder:

```text
buddy init --library <your library's folder> --profile <profile> --host none --answers <answers file>
```

Read what it reports, then look at the project it made. Delete the folder when you are done; nothing else was touched.
