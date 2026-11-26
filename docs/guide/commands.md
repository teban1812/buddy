# Commands

Buddy runs these for you; you rarely type them. They are here so you recognise them when he tells you what he is doing. `buddy <command>` is short for `node "<plugin folder>/bin/buddy.mjs" <command>`.

`buddy help` lists every command with its main options. The full options of each are in the [core reference](../../core/README.md).

## Once, on your machine

| Command | What it is for |
| :-- | :-- |
| `buddy library --set <git url or folder>` | Choose the library every new project starts from. |
| `buddy library --show` | Say which library a new project would use, and why. |
| `buddy feedback --factory <folder>` | Choose the folder where your feedback notes go. |
| `buddy tools` | Show which tools this machine has and the model word of each level, and change them (`buddy tools word <tool> <level> <word> [<effort>]`, `buddy tools reset`). Kept in your home folder, not in the project. |
| `buddy tools language <en or es>` | The language of the panels beside the conversation (English by default). |

## When a project is born

| Command | What it is for |
| :-- | :-- |
| `buddy init --list-profiles` | Show the library's profiles and its general questions. Creates nothing. |
| `buddy init --questions --profile <profile>` | Show a profile's questions, steps and saved prompts. Creates nothing. |
| `buddy init --profile <profile> --host github` | Create the project: standards, base application, context, first decision record, first commit. In a project born with `--no-profile`, brings that profile's template and standards after discovery. |
| `buddy init --no-profile` | Create the project without a profile: context, general standards (with `design.md`) and themes, no template yet — used when discovery comes first. |
| `buddy init --permissions` | Write only the routine permissions, for a project that existed before, or after a plugin update. |
| `buddy context add` | Write one line of the business context, in your words. |
| `buddy context confirm` | Confirm a line of the context or of a step's record. |
| `buddy context approve` | Record your approval of a step's record. |

## Planning the work

| Command | What it is for |
| :-- | :-- |
| `buddy milestone start` | Open a milestone. |
| `buddy milestone goal` | Reword a milestone's goal in your words, in any state; the earlier wording stays in the record (needs `--by owner`). |
| `buddy start` | Open a change (in a milestone, or in the backlog). |
| `buddy criteria` and `buddy excludes` | Add or correct a change's criteria and exclusions, while it is refining. |
| `buddy slice assume` | Announce, confirm or correct the assumptions of a change. |
| `buddy queue` | Put the costly questions to you, and record your answers. |
| `buddy requests` | Keep the map of everything you asked for, with its priority and where it went. |
| `buddy prototype` | List what an HTML prototype holds (`facts`), draft its manifest from Buddy's reading (`draft --reading`) and record your confirmation line by line (`confirm`). |
| `buddy verify theme` | Measure a theme CSS file's WCAG AA contrast in light and dark (`<file.css>... [--json]`), or generate `docs/discovery/theme-sample.html` linking every theme in `docs/design/themes/` (`--sample [dir] [--out <file>]`). |
| `buddy milestone card` | What a milestone will build, in what order, and what waits for you. |
| `buddy slice rank` | Place a change before or after another, in a milestone or the backlog. |
| `buddy move` | Move a change or milestone to its next state (ready, building, accepted...). |
| `buddy decide` | Write one of your decisions as a decision record. |

## While it is built

| Command | What it is for |
| :-- | :-- |
| `buddy resume` | Where a slice stands, to pick up after a cut. |
| `buddy step` | Plan a change's steps, tick one as done (Dev), or drop one a decision voided, with its reason (`step drop`). |
| `buddy slice try` | Say how to try one criterion (Dev). |
| `buddy checkpoint` | Check a slice: tests, scan, independent review. |
| `buddy suite` | Run the project's whole test suite once; closing a milestone rests on it for two days (`--deep` runs the deep checks, when the project has them). |

## Accepting

| Command | What it is for |
| :-- | :-- |
| `buddy milestone review` | The script to try a milestone's changes, one by one; Buddy reads it to you as part of the milestone's review, after checking the screens beside the prototype. |
| `buddy slice accept-card` | The summary you see before accepting a change. |
| `buddy slice divergence` | Departures from the prototype: declared by Dev, decided by you. |
| `buddy view` | The story of a change, as a page or a short summary. |

## Looking around

| Command | What it is for |
| :-- | :-- |
| `buddy board` | Every milestone and change by state, and what waits for you; `--out .buddy/board.html` writes the page that refreshes itself. |
| `buddy digest` | What changed since you last looked. |
| `buddy status` | The changes in order, with their steps done. |
| `buddy minutes` | How often each change asked you something, and how long it waited for you. |
| `buddy find` | Find a change, a criterion, a request or a decision by its words. |

## Outside a change

| Command | What it is for |
| :-- | :-- |
| `buddy settle` | Check the commits made without a change (small corrections) and say whether you have to look. |
| `buddy feedback` | Note what got in the way, one line to your field log. |
