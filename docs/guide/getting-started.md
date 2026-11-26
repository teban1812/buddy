# Getting started

From an empty folder to a first change you accept. Plan an hour for the first time, most of it conversation.

## 1. What you need

- **Claude Code or Antigravity**, signed in. Buddy runs inside either. The independent reviewer runs as `claude -p` or as `agy`, so each checkpoint costs a few cents to under a dollar. With both on the machine, one builds and the other reviews; with one, a fresh session of it reviews. [With Antigravity](#with-antigravity) says how to install him there and what was tried.
- **Node 22 or later.** Buddy's program is plain Node, with nothing to install.
- **git**, with your name and email set (`git config --global user.name` and `user.email`). Buddy makes the project's first commit for you, and needs them.
- **Nothing to ask for the default library.** It is public (`https://github.com/teban1812/buddy-default-library`), so Buddy reads it with no access to request. A private library of your own organisation is read with your own git credentials; if it cannot be read, see [Troubleshooting](troubleshooting.md#the-library-cannot-be-reached).
- **For the `dotnet-react` profile**: the .NET 10 SDK and Node, to build and test the base application. The `empty` profile needs nothing more.
- **Optional: gitleaks.** Before each commit Buddy scans for secrets with it. Without it the scan reads *not run*, never a pass.

**On Windows**, check which shell npm uses: `npm config get script-shell`. If it says `pwsh`, the project's checks can hang. See [Troubleshooting](troubleshooting.md#on-windows-the-checks-hang).

## 2. Install Buddy

In an empty folder for your new project:

```bash
claude plugin marketplace add teban1812/buddy --scope local
claude plugin install buddy@buddy --scope local
```

The repository's README shows the same two lines; a test keeps them equal. `--scope local` installs Buddy for this folder only. To pin a version, add it after a `#`: `teban1812/buddy#v0.4.0`.

Then start Claude Code in the same folder:

```bash
claude
```

You are talking with Buddy.

### The panel beside the conversation (optional)

A second plugin of the same catalogue shows, beside the conversation, what waits for you, what is being built, what comes next and the open milestone's progress (one bar with the board page's groups and colours, and the counts beside it), with a button for each thing that waits for you (it writes your request into the text box, for you to send), one that opens the board's full page and one that refreshes it. It is installed on the machine, never in a project:

- **Claude Code**: `claude plugin install buddy-panel@buddy`, after the marketplace above is added; open it with `/buddy-panel`.
- **Antigravity App**: `agy plugin install <path to Buddy's repository>/panel/antigravity`; open it from the side panel's `+` menu, or Overview, Plugins, then "Buddy panel". The first time, it asks to connect to the open project through the conversation. After installing it again (a new version), quit Antigravity and open it again: the panel that was running stays in memory until then. The panel is for the App only: Antigravity documents side panels for the App, and the IDE was not tried.

Each panel reads the board, and opens its full page, with the Buddy installed in its own tool (Claude Code's plugin, or the one `agy plugin install` put in Antigravity), so what it shows is what the conversation uses; it takes the other tool's Buddy only when its own is not installed, and inside Buddy's repository the repository's own. When Buddy finds a tool on your machine without its panel, he tells you once, in one line, how to install it; he installs nothing himself. The panel speaks English; `buddy tools language es` switches it to Spanish (kept in your machine's setting, not in the project).

### With Antigravity

Install the plugin once for the whole machine, not per project (there is no per-folder scope):

```text
agy plugin install https://github.com/teban1812/buddy
```

Then start `agy`, Antigravity App or Antigravity IDE in the project folder. Things to know:

- **Where the program is.** Antigravity does not fill Claude Code's plugin variable, but puts the plugin's `bin` folder on the path, so Buddy runs his program there as `node "$(command -v buddy.mjs)" <command>`. Buddy and Dev already know this; you only need it to run a command by hand.
- **Versions.** Pinning a version of the plugin was not tried, so do not count on it.
- **What was tried.** The `agy` command line (1.5.14), Antigravity App (2.34.0) and Antigravity IDE (2.7.0) are all supported and were tried end to end on macOS; the Antigravity extension for other editors was not tried. The same machine-wide install (`~/.gemini/config/plugins/`) serves all three, and when `agy` is not on `PATH`, Buddy falls back to the bundled `~/.gemini/bin/agy` binary. The table below says what ran, per tool, surface and version. Buddy writes no routine permissions for Antigravity: its form is not verified.
- **A project, either tool.** Init writes `AGENTS.md` (Antigravity) and `CLAUDE.md` (Claude Code) with the same short pointers, only for the tools it finds. The records, steps and decisions are the same files for both, so you can change tool in the middle of a project and lose nothing; when a tool shows up on the machine later, `buddy board` brings the files it lacks, never over what exists.
- **Saved prompts.** A prompt of the library is written once, in full, to `.agents/skills/<name>/`; for Claude Code a thin file in `.claude/skills/<name>/` has the same front matter and only tells it to read that one.

### What was tried, per tool and version

A row counts only for its own tool, surface and version: **a newer version does not inherit the result**, it is not tried until it has its own row. What did not run says "not run". The notes behind each row are in `docs/research/` (the spikes and the real runs of 2026-11-22).

| Tool, surface, version | Date | Install | A change run end to end | Checkpoint and reviewer | Not run |
| :-- | :-- | :-- | :-- | :-- | :-- |
| Claude Code 2.1.321, command line, macOS | 2026-11-22 | `--plugin-dir core` (a local copy) | not run (only probes: the commit hook refused a bad message and passed a good one; Dev reached the program and ran `board`) | not run | a change end to end, the checkpoint |
| Claude Code 2.1.316, command line, macOS | 2026-11-22 | on the machine, kept out of the Antigravity run | not run | not run | everything |
| Claude Code, the Claude cloud, Linux (version not recorded) | 2026-11-22 | the session starts from the pushed branch; Buddy run from the repository | the whole suite (561 of 565; the 2 failures were the test's fake machine, fixed since), init (CLAUDE.md, the wrapper, no AGENTS.md), board, and a tiny change built by hand | the reviewer as `claude -p` at the strong level (opus): about $0.14 and 8 s; it refused an unrequested line | Dev building the change |
| `agy` 1.5.14, command line, macOS | 2026-11-22 | `agy plugin install <path to core>` (the public repository line also installs) | ran, with workarounds: Dev's text handed in by the prompt (`--agent dev` failed then); `--dangerously-skip-permissions` in a throwaway folder, because the sandbox cannot write under `.git` and a headless run cannot approve; `DEVELOPER_DIR` for macOS's git | passed: validate green, the `agy` reviewer's verdict clean, 32 s | a headless Dev that commits without skipping permissions; Auto mode (not available on that account) |
| Antigravity IDE 2.7.0, macOS | 2026-11-22 | same machine-wide `agy plugin install <path to core>` (`~/.gemini/config/plugins/buddy`); IDE bundles `~/.gemini/bin/agy` | passed without workarounds: spike (`buddy` and `dev` subagents, 5 skills, `buddy.md` ~31.2 KB loaded whole, `PreToolUse` hook exit 2) and full `greeting` change (`buddy init` 1 s, native `dev` subagent 63 s with TDD, step tick and commit, hook blocked bad message, accepted and verified) | passed: validate green (5/5), independent `agy` reviewer clean, slice moved to `delivered`, 31 s | pinning a plugin version; non-macOS hosts |
| Antigravity app 2.34.0, macOS | 2026-11-22 | same machine-wide `agy plugin install <path to core>` (`~/.gemini/config/plugins/buddy`) | passed without workarounds: spike (`buddy` and `dev` subagents, 5 skills, `buddy.md` ~31.2 KB loaded whole, `PreToolUse` hook exit 2) and full `greeting` change (`buddy init` 1 s, native `dev` subagent 76 s with TDD, step tick and commit, hook blocked bad message, accepted and verified) | passed: validate green (5/5), independent `agy` reviewer clean, slice moved to `delivered`, 33 s | pinning a plugin version; non-macOS hosts |
| Antigravity extension for other editors | not run | not run | not run | not run | everything (not tried) |

The panels beside the conversation, tried by hand:

| Tool, surface, version | Date | Install | What was seen | Not run |
| :-- | :-- | :-- | :-- | :-- |
| Claude Code 2.1.330, command line, Windows 11 | 2026-11-23 | `claude plugin install buddy-panel@buddy` from this repository's folder | `/buddy-panel` opens it; what waits, now, next and the hito are shown, with the three buttons | the Spanish words |
| Claude Code 2.1.330, VS Code extension, Windows 11 | 2026-11-23 | same | the same; the Ask button ran past the pane's edge until its label was kept short (`b889d7b`), then fit | the Spanish words |
| Claude Code, desktop app, Windows 11 (version not recorded) | 2026-11-23 | same | the same; the desktop app cuts a long label with an ellipsis | the Spanish words |
| Antigravity App 2.34.0, macOS | 2026-11-23 and 24 | `agy plugin install <path to this repository>/panel/antigravity` | opened from the side panel's Plugins; it learns the project from the conversation, then shows what waits, now, next and the milestone; the owner accepted it on 2026-11-24 | the Antigravity IDE (Antigravity documents side panels for the App only) |

### Which tool builds and which reviews

Dev and the independent reviewer work in the tool you talk to Buddy in: a session started in Antigravity stays in Antigravity, one started in Claude Code stays in Claude Code. The reviewer is a fresh session of that tool, at the strong level where the tool offers it apart. If you want a second look from the other tool, run it yourself whenever you like; Buddy does not do it for you.

Each environment keeps its own setting in `~/.buddy/environment.json` (never in the project, so it is not committed and does not travel to another machine): the tools Buddy found there and the words of the levels. `buddy tools` shows it. Each role asks for a **level** (economical, balanced or strong), never for a model: the setting holds, per tool, a base word that picks a model among the ones the tool offers today (Claude: `haiku`, `sonnet`, `opus`; Antigravity: `flash` for the economical one, its default for the others) and, optionally, an effort word (`low`, `medium`, `high`, `xhigh`) set with `buddy tools word <tool> <level> <word> [<effort>]`. Where a tool has no such effort the word is ignored and Buddy says so. When a word matches nothing the tool offers any more (a model retired or renamed), the work does not stop: Buddy takes the nearest model of the same family, else the tool's default, writes the corrected word into the setting and tells you in the next summary. `buddy tools seen` clears that note and `buddy tools reset` forgets the setting.

## 3. Bring the project to life

Say: *"Start a new project here."* If you already have a PRD or an HTML prototype, put it in the folder first and say so: Buddy reads it before he asks anything, so he does not ask what it already says. With a PRD, he also tells you, before planning, what it lacks to be built well. If you have only an idea, he offers to discover the product with you first: see [Discovery](discovery.md).

What Buddy does, and why:

1. **He names the library** he will use, its version and why that one. You can name another one instead.
2. **He asks the library's questions**, one at a time, with the reason for each. The answers go into `docs/context.md` and fill the open values of your standards. The default library asks none of its own yet.
3. **He recommends a profile** with its reason — when you brought a PRD or a prototype. You choose: `empty` or `dotnet-react`. When you have only an idea (no PRD and no prototype), the project is born without a profile first (`buddy init --no-profile`: context, general standards with `design.md` and themes, no template yet), and Buddy recommends the profile at the end of discovery, from what discovery found.
4. **He asks where the repository will live** (when a profile is chosen): GitHub, Azure DevOps or neither for now. The project keeps only that host's pipeline, so its checks run on every push.
5. **He creates the project** (`buddy init`): the standards in `docs/standards/`, the base application renamed for your project, `docs/context.md`, the first decision record, and the first commit. Then he tells you whether the project was born healthy: its build and tests ran once. If it was not, fixing that comes first.
6. **He asks about the business**, briefly (after a discovery, he fills it from the brief you confirmed instead of asking again): why the software exists and the outcome that matters, who uses it, the constraints, and what is costly to get wrong **and what is cheap to get wrong**. This is the risk appetite. It decides how much care each change gets. Confirm the risk lines: nothing is built until you do.
   Buddy writes the project's documentation in English and asks nothing about it. Only if you speak to him in another language, or hand over a PRD or a prototype written in one, he asks once in which language to keep it. Your answer becomes a line of `docs/context.md`, so he never asks again: the context is born whole in that language (its header then names the section that holds the risk appetite, `risk_section`, so the checks find it), and so are the changes, criteria and milestones you read. The records of a profile's steps stay in the language their library wrote them in.
7. **He runs the profile's steps**, if the library has any (a security checklist, say). He drafts each line; you confirm them one by one, then approve the record whole. The default library has no steps yet.

## 4. A first milestone

Tell Buddy what you want, in your words. For example: *"A page that lists my books, and lets me add one."*

1. Buddy proposes a **milestone** (a first version) and its **changes**, each with its criteria and exclusions. Correct anything that is not what you meant. A single small change can also live in the backlog, without a milestone.
2. He asks the **costly questions** once, for the whole milestone, each with options, their cost, his recommendation and a default.
3. He **announces his assumptions** for each change (at most five), each with what changes for you if it is wrong, and says where each criterion's data comes from; a criterion with no source is one of the costly questions. Confirm them or correct them.
4. He reads you the **milestone card**: what he will build, in what order, what still waits for you. Say go. Your go-ahead is recorded; nothing starts before it.

Each time you give your approval or an answer (a go-ahead, an acceptance, a confirmation, a decision, an answer to a question), it is saved in its own commit at once, apart from the work in progress; your go-ahead saves the milestone's whole plan with it.

## 5. Build, check, accept

Now Buddy works on his own. He tells you in one line what he is about to do; write *"stop"* to stop him.

- **Dev builds** each change, slice by slice, ticks each step and commits.
- **The checkpoint** checks each slice. A clean one asks nothing of you. A problem comes to you in plain words: see [Working alone](working-alone.md#when-the-checkpoint-stops-you).
- **Delivered changes wait for you.** Buddy goes on with the next one.

When every change is delivered, Buddy reads you the **milestone review**, like the demonstration of a sprint review: what was promised and delivered, the order to try the changes, and for each one how to try it and what you should see. When the changes cover prototype screens, he first opens each built screen beside its prototype with the browser at hand, looks for evident defects (console errors, text cut or overlapping, overflow on a phone or a wide screen, missing states, broken links), has Dev fix them, and then tells you what he found and fixed and what differs from the prototype. Try each change. Then, for each, tell Buddy *"I accept it"* or what is wrong. He records your acceptance; a change sent back goes to rework.

When you come back after a while, ask *"What is waiting for me?"* Buddy answers from the board and the digest. To watch the work move, ask for the board's page: it opens in your browser and refreshes itself.

Next: [Working alone](working-alone.md).
