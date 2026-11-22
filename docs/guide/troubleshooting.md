# Troubleshooting

Problems people have really met with Buddy, and their fixes. If yours is not here, tell the author: see [Feedback](feedback.md).

## On Windows the checks hang

**What you see**: a checkpoint, `buddy suite` or `buddy settle` runs for many minutes and never ends, or a project's `npm run` command hangs.

**Why**: npm runs scripts with the shell set in its `script-shell` setting. When that is PowerShell (`pwsh`), it can hang, for example on network drives it cannot reach.

**Fix**: run `npm config get script-shell`. If it says `pwsh`, remove the setting (`npm config delete script-shell`) so npm uses `cmd`, or set it for one command only: in PowerShell, `$env:npm_config_script_shell='C:\Windows\System32\cmd.exe'`.

## Everything is slow

**What you see**: each commit takes seconds; the project's tests take far longer than on another machine.

**Why**: an antivirus that scans every file Node opens. On one machine it made a test suite take 15 to 25 minutes.

**Fix**: ask whoever manages the machine to exclude your development folders from real-time scanning. Meanwhile, a checkpoint stops its tests after 30 minutes and says so; Buddy can give it more time (`--validate-timeout <seconds>`).

## Buddy keeps asking permission for his own commands

**What you see**: after a plugin update, Claude Code asks you to approve Buddy's program, the project's checks or local git, which it did not ask before.

**Why**: the routine permissions are written into the project's `.claude/settings.json` when it is born, and they point to the plugin's folder, which changed with the update.

**Fix**: ask Buddy to write them again: `buddy init --permissions`. It touches nothing else. A project that existed before Buddy needs the same command once.

## The library cannot be reached

**What you see**: starting a project fails because the library cannot be read.

**Why**: the default library is public, so this happens with a private library of your own organisation, or with no network. Buddy reads a library with your own git credentials and never asks for a password: a private library you have no access to, or git with no credentials for that host, fails.

**Fix**: check it in your terminal with `git ls-remote <library url>`. If it asks for a password or fails, sign in to that host with git first (for GitHub, for example, the GitHub CLI's `gh auth login`, or your system's git credential manager), or ask the library's owner for read access. To start without a library, tell Buddy so: `--no-library` gives a project with no standards and no base application.

## Every command fails after you put a file in a change's folder

**What you see**: after you saved a note of your own (a `.md` file) in a change's folder under `docs/buddy/`, Buddy's commands stop with an error about that file.

**Why**: the program reads every markdown file in that folder as one of its records. This is being fixed.

**Fix**: move your file out of `docs/buddy/`. Keep your own notes elsewhere, for example in `docs/inputs/` or a folder of your own.

## The checkpoint finds no work in a slice

**What you see**: the checkpoint says the slice has no commits, or measures nothing, though Dev committed.

**Why**: the checkpoint finds a slice's commits by the `Slice: <name>` line at the end of the commit message. git reads it only in the message's last paragraph; in its own paragraph above `Co-Authored-By:` it is not read.

**Fix**: ask Buddy to have Dev amend the message so `Slice:` and `Co-Authored-By:` are together in the last paragraph, one per line, then run the checkpoint again.

## The tests fail only while your app is running

**What you see**: with the `dotnet-react` profile, the checks fail to build the server while you have the app running (`dotnet run`).

**Why**: the running app locks its build folder, so the tests cannot build it again.

**Fix**: stop the app before a checkpoint, `buddy suite` or `buddy settle`, and start it again after.

## Accepting is refused

**What you see**: Buddy says the change cannot be accepted yet.

**Why**, and fix, by the reason it gives:
- *the whole test suite has not passed on the code as it is now*: Buddy runs `buddy suite` once, then accepts again.
- *an assumption is not confirmed*: confirm it or correct it.
- *a departure from the prototype is undecided*: accept or reject it.
- *a step is open, or a finding is open*: the work is not finished; Buddy sends it back to Dev.
