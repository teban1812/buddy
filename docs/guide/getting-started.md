# Getting started

From an empty folder to a first change you accept. Plan an hour for the first time, most of it conversation.

## 1. What you need

- **Claude Code**, signed in. Buddy runs inside it, and the independent reviewer runs as `claude -p`, so each checkpoint costs a few cents to under a dollar. For now Buddy works only with Claude Code; Antigravity support is planned for 0.5.0.
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

## 3. Bring the project to life

Say: *"Start a new project here."* If you already have a PRD or an HTML prototype, put it in the folder first and say so: Buddy reads it before he asks anything, so he does not ask what it already says.

What Buddy does, and why:

1. **He names the library** he will use, its version and why that one. You can name another one instead.
2. **He asks the library's questions**, one at a time, with the reason for each. The answers go into `docs/context.md` and fill the open values of your standards. The default library asks none of its own yet.
3. **He recommends a profile** with its reason. You choose: `empty` or `dotnet-react`.
4. **He asks where the repository will live**: GitHub, Azure DevOps or neither for now. The project keeps only that host's pipeline, so its checks run on every push.
5. **He creates the project** (`buddy init`): the standards in `docs/standards/`, the base application renamed for your project, `docs/context.md`, the first decision record, and the first commit. Then he tells you whether the project was born healthy: its build and tests ran once. If it was not, fixing that comes first.
6. **He asks about the business**, briefly: why the software exists and the outcome that matters, who uses it, the constraints, and what is costly to get wrong **and what is cheap to get wrong**. This is the risk appetite. It decides how much care each change gets. Confirm the risk lines: nothing is built until you do.
   Buddy writes the project's documentation in English and asks nothing about it. Only if you speak to him in another language, or hand over a PRD or a prototype written in one, he asks once in which language to keep it. Your answer becomes a line of `docs/context.md`, so he never asks again: the context is born whole in that language (its header then names the section that holds the risk appetite, `risk_section`, so the checks find it), and so are the changes, criteria and milestones you read. The records of a profile's steps stay in the language their library wrote them in.
7. **He runs the profile's steps**, if the library has any (a security checklist, say). He drafts each line; you confirm them one by one, then approve the record whole. The default library has no steps yet.

## 4. A first milestone

Tell Buddy what you want, in your words. For example: *"A page that lists my books, and lets me add one."*

1. Buddy proposes a **milestone** (a first version) and its **changes**, each with its criteria and exclusions. Correct anything that is not what you meant. A single small change can also live in the backlog, without a milestone.
2. He asks the **costly questions** once, for the whole milestone, each with options, their cost, his recommendation and a default.
3. He **announces his assumptions** for each change (at most five), each with what changes for you if it is wrong. Confirm them or correct them.
4. He reads you the **milestone card**: what he will build, in what order, what still waits for you. Say go. Your go-ahead is recorded; nothing starts before it.

## 5. Build, check, accept

Now Buddy works on his own. He tells you in one line what he is about to do; write *"stop"* to stop him.

- **Dev builds** each change, slice by slice, ticks each step and commits.
- **The checkpoint** checks each slice. A clean one asks nothing of you. A problem comes to you in plain words: see [Working alone](working-alone.md#when-the-checkpoint-stops-you).
- **Delivered changes wait for you.** Buddy goes on with the next one.

When every change is delivered, Buddy reads you the **milestone review**: what was promised and delivered, the order to try the changes, and for each one how to try it and what you should see. Try each one. Then, for each, tell Buddy *"I accept it"* or what is wrong. He records your acceptance; a change sent back goes to rework.

When you come back after a while, ask *"What is waiting for me?"* Buddy answers from the board and the digest.

Next: [Working alone](working-alone.md).
