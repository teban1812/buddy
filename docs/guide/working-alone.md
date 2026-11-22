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

Also yours: the risk appetite in `docs/context.md`, the criteria and exclusions of each change, and the answers to the costly questions. When you choose between options, Buddy writes your decision as a decision record (`buddy decide`) and tells you which file holds it.

## When the checkpoint stops you

Most slices pass clean and ask nothing. When one does not, Buddy brings it to you in plain words. The usual cases:

- **A check is red** (a test fails). The reviewer is not run. Dev fixes it and the slice is checked again.
- **A standard would be broken** (a `must` rule). Nothing is built around it. You decide: change the design, or change the rule.
- **A costly decision nobody specified.** The reviewer found a choice Dev made that would be costly to undo (a new library, a new pattern). Keep it, or ask for another.
- **A criterion is not met.** Send it back to Dev, or, if the finding shows the goal itself was wrong, move the change back to refining and correct its criteria.
- **A screen the reviewer could not verify.** It never counts as a pass. Keep trying, or decide that nobody tries again (it stays *not verified* on the summary you accept).
- **Round 3.** The same findings are still open after three checks. Buddy stops retrying and asks you.
- **Accepting is refused because the whole test suite has not passed on the code as it is now.** Buddy runs `buddy suite` once; one run serves every acceptance for two days.

Acceptance never blocks the work: while a change waits for you, Buddy builds the next one.

## The audits, on demand

Neither is a stage of the cycle. Ask for them when they would help:

- **A QA audit** (*"try to break this change"*, or the whole app). Buddy loads the `qa-audit` skill and writes a report with how to reproduce each finding.
- **A usability audit** (*"can people do their job with this screen?"*). Buddy loads the `ux-audit` skill: usability and accessibility, of the prototype, a change or the whole app.

Their findings become requests only when you agree.

## Work outside a change

Not everything deserves a change. A typo, a dependency bump, a quick bug fix or a screen tweak that changes nothing specified is a **small correction**. Buddy works on it with you in the same conversation (the `vibe` skill): no ceremony, the standards still hold, and the existing tests stay green.

When you commit, or when you ask, Buddy **settles** those commits (`buddy settle`): it classifies them, runs the checks and says whether you have to look. If a correction grew into a feature, or changed something specified, Buddy says so and proposes a change, even after the fact.

## Reading where things stand

- **`buddy board`**: every milestone and change by state, and what is waiting for you.
- **`buddy digest`**: what changed since you last looked, what waits for you, and what may be stalled.
- **`buddy minutes`**: how many times each change asked you something, and how long it waited for you.
- **`buddy view`**: the story of one change, as a page or a short summary.

You rarely need to run them yourself: ask Buddy *"what is waiting for me?"* and he reads them for you.
