# Commands

Buddy runs these for you; you rarely type them. They are here so you recognise them when he tells you what he is doing. `buddy <command>` is short for `node "<plugin folder>/bin/buddy.mjs" <command>`.

`buddy help` lists every command with its main options. The full options of each are in the [core reference](../../core/README.md).

## Once, on your machine

| Command | What it is for |
| :-- | :-- |
| `buddy library --set <git url or folder>` | Choose the library every new project starts from. |
| `buddy library --show` | Say which library a new project would use, and why. |
| `buddy feedback --factory <folder>` | Choose the folder where your feedback notes go. |

## When a project is born

| Command | What it is for |
| :-- | :-- |
| `buddy init --list-profiles` | Show the library's profiles and its general questions. Creates nothing. |
| `buddy init --questions --profile <profile>` | Show a profile's questions, steps and saved prompts. Creates nothing. |
| `buddy init --profile <profile> --host github` | Create the project: standards, base application, context, first decision record, first commit. |
| `buddy init --permissions` | Write only the routine permissions, for a project that existed before, or after a plugin update. |
| `buddy context add` | Write one line of the business context, in your words. |
| `buddy context confirm` | Confirm a line of the context or of a step's record. |
| `buddy context approve` | Record your approval of a step's record. |

## Planning the work

| Command | What it is for |
| :-- | :-- |
| `buddy milestone start` | Open a milestone. |
| `buddy start` | Open a change (in a milestone, or in the backlog). |
| `buddy criteria` and `buddy excludes` | Add or correct a change's criteria and exclusions, while it is refining. |
| `buddy slice assume` | Announce, confirm or correct the assumptions of a change. |
| `buddy queue` | Put the costly questions to you, and record your answers. |
| `buddy requests` | Keep the map of everything you asked for, with its priority and where it went. |
| `buddy prototype` | Read an HTML prototype and draft its manifest for you to confirm. |
| `buddy milestone card` | What a milestone will build, in what order, and what waits for you. |
| `buddy move` | Move a change or milestone to its next state (ready, building, accepted...). |
| `buddy decide` | Write one of your decisions as a decision record. |

## While it is built

| Command | What it is for |
| :-- | :-- |
| `buddy resume` | Where a slice stands, to pick up after a cut. |
| `buddy step` | Plan a change's steps, or tick one as done (Dev). |
| `buddy slice try` | Say how to try one criterion (Dev). |
| `buddy checkpoint` | Check a slice: tests, scan, independent review. |
| `buddy suite` | Run the project's whole test suite once; every acceptance rests on it for two days. |

## Accepting

| Command | What it is for |
| :-- | :-- |
| `buddy milestone review` | The script to try a milestone's changes, one by one. |
| `buddy slice accept-card` | The summary you see before accepting a change. |
| `buddy slice divergence` | Departures from the prototype: declared by Dev, decided by you. |
| `buddy view` | The story of a change, as a page or a short summary. |

## Looking around

| Command | What it is for |
| :-- | :-- |
| `buddy board` | Every milestone and change by state, and what waits for you. |
| `buddy digest` | What changed since you last looked. |
| `buddy status` | The changes in order, with their steps done. |
| `buddy minutes` | How often each change asked you something, and how long it waited for you. |
| `buddy find` | Find a change, a criterion, a request or a decision by its words. |

## Outside a change

| Command | What it is for |
| :-- | :-- |
| `buddy settle` | Check the commits made without a change (small corrections) and say whether you have to look. |
| `buddy feedback` | Note what got in the way, one line to your field log. |
