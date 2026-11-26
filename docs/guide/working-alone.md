# Working alone: being your own Product Owner

When you work alone you wear two hats. As the developer you could do anything. As the owner you decide what is right. Buddy keeps the two apart: he does the work, and leaves you the decisions.

## The decisions only you take

Buddy records these only after you say so in the conversation. The program marks each one `--by owner`. That mark is recorded, not signed: an agent could type it. So Buddy is told never to do it on his own, and you should never ask him to "just accept it" without looking.

| Decision | When | What Buddy runs after you say yes |
| :-- | :-- | :-- |
| Accept a change | after you tried it | `buddy move <change> accepted --by owner` |
| Confirm or correct an assumption | before the change is built | `buddy slice assume <change> confirm all --by owner` |
| Confirm a line of a step's record | after the project is born, or when a change touches the step | `buddy context confirm <record> --line <n> --by owner` |
| Approve a step's record whole | after every line is decided or confirmed | `buddy context approve <record> --by owner` |
| Accept or reject a departure from the prototype | at acceptance | `buddy slice divergence decide <change> <V id> accept --by owner` |
| Call a decision nobody specified cheap | when the reviewer marked it costly | `buddy slice decision <change> <n> cheap --by owner` |
| Start a milestone | after its card | `buddy move <milestone> building` |
| Reword a milestone's goal | whenever its words no longer say what you mean | `buddy milestone goal <milestone> "<your words>" --by owner` (the earlier wording stays in the record) |
| Reorder a change before or after another | whenever priorities change | `buddy slice rank <change> before\|after <other change>` |

Also yours: the risk appetite in `docs/context.md`, the criteria and exclusions of each change, and the answers to the costly questions. When you choose between options, Buddy writes your decision as a decision record (`buddy decide`) and tells you which file holds it.

## When the checkpoint stops you

Most slices pass clean and ask nothing. When one does not, Buddy brings it to you in plain words. The usual cases:

- **A check is red** (a test fails). The reviewer is not run. Dev fixes it and the slice is checked again.
- **A standard would be broken** (a `must` rule). Nothing is built around it. You decide: change the design, or change the rule.
- **A costly decision nobody specified.** The reviewer found a choice Dev made that would be costly to undo (a new library, a new pattern). Keep it, or ask for another.
- **A criterion is not met.** Send it back to Dev, or, if the finding shows the goal itself was wrong, move the change back to refining and correct its criteria.
- **A screen the reviewer could not verify.** It never counts as a pass. Keep trying, or decide that nobody tries again (it stays *not verified* on the summary you accept).
- **Round 3.** The same findings are still open after three checks of the same piece. Buddy stops retrying and asks you. Each piece counts its own rounds: a new piece starts at round 1, whatever the others went through.
- **Accepting a milestone is refused because the whole test suite has not passed on the code as it is now.** Accepting a change rests on the fast checks the checkpoint already ran; closing a milestone needs the whole suite green. Buddy runs `buddy suite` once; one run serves for two days.

When a decision makes one of a change's steps pointless, Buddy drops it with the reason (`buddy step drop <change> <n> --why "<the decision>"`): it stays in the record, marked dropped, and no longer counts as open.

Acceptance never blocks the work: while a change waits for you, Buddy builds the next one.

## The audits, on demand

Ask for them when they would help:

- **A QA audit** (*"try to break this change"*, or the whole app). Buddy loads the `qa-audit` skill and writes a report with how to reproduce each finding.
- **A usability audit** (*"can people do their job with this screen?"*). Buddy loads the `ux-audit` skill: usability and accessibility, of the prototype, a change or the whole app. On a prototype it is not optional: it runs before the test with users in [discovery](discovery.md), and before the screens of a prototype you hand over are confirmed.

Their findings become requests only when you agree.

## Work outside a change

Not everything deserves a change. A typo, a dependency bump, a quick bug fix or a screen tweak that changes nothing specified is a **small correction**. Buddy works on it with you in the same conversation (the `vibe` skill): no ceremony, the standards still hold, and the existing tests stay green.

When you commit, or when you ask, Buddy **settles** those commits (`buddy settle`): it classifies them, runs the checks and says whether you have to look. If a correction grew into a feature, or changed something specified, Buddy says so and proposes a change, even after the fact.

## Reading where things stand

- **The board's page** (`buddy board --out .buddy/board.html`, then open that file in your browser): it refreshes itself every few seconds as Buddy works. At the top, what waits for you, one line each in your words, what is being built now and what comes next, then what changed since you last looked; one overall percentage and one row per milestone; the milestone in progress with its changes in four groups (waiting for you to try and accept, being worked on, still to define, done), and your own test at the end of the group that waits for you. Two colours run through it: one for what the agent does, one for what waits for you. Folded at the end, *How the process is going*: the average time a change spent in each stage, how many times you were asked and how long the work waited for you, and the mix of the last 14 days (product, tests, Buddy's records, process). It reads on a phone and a wide screen, light or dark, in Spanish or English. You can also just ask Buddy for it.
- **The panel beside the conversation**: the same short view (what waits, now, next, the milestone), with a button for each thing that waits for you; the milestone's bar has the same groups, order and colours as the page's, with the counts written beside it (for example *12 done · 18 your turn · 1 in progress, of 31*), so it moves while changes are built and wait for you, not only when you accept; see [Getting started](getting-started.md#the-panel-beside-the-conversation-optional).
- **`buddy board`**: the same as text: every milestone and change by state, with the same counts by group beside each milestone not yet done, and what is waiting for you.
- **`buddy digest`**: what changed since you last looked, what waits for you, what may be stalled, and the work mix of the last 14 days.
- **`buddy minutes`**: how many times each change asked you something, and how long it waited for you.
- **`buddy view`**: the story of one change, as a page or a short summary.

You rarely need to run them yourself: ask Buddy *"what is waiting for me?"* and he reads them for you.
