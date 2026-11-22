# Report format

## Where the report lives
- **The prototype**: `docs/inputs/prototype/ux-audit.md`, beside the prototype it judges. Only the HTML there is the prototype, so the report does not disturb the manifest.
- **One change**: `qa/ux-report.md` inside the change's folder (`docs/buddy/milestones/<milestone>/changes/<date>-<name>/qa/ux-report.md`, or under `docs/buddy/backlog/`), beside the QA audit's `qa/report.md`. Always in `qa/`, never as a `.md` next to `change.md`: Buddy reads the files beside `change.md` as pieces of the change.
- **The whole app**: each change's module in its own `qa/ux-report.md`; the parts no change covers in `docs/qa/ux-<module>.md`; the consistency pass and the goal check in `docs/qa/ux-app.md`.
- Screenshots go beside the report, referenced by a relative path.

If there is a report already, **add a new dated section** at the end instead of overwriting: the history of what was found and when is the evidence the audit works. The audit never marks its own findings resolved: what is fixed or not worth fixing is the owner's call.

## Severity is the cost to the user, not how broken the code is
The QA audit's scale ranks how broken the software is; under it every usability failure collapses into "Low", next to a misaligned label. This one ranks **what it costs the person trying to do their job**:
- **Blocker**: the job cannot be done, or not without help from outside the app. A role locked out of a task it may perform; an action reachable only by mouse; a dead end with no way forward or back.
- **Serious**: the job gets done at real cost: the user is likely to take the wrong action, re-enters data the app holds, has to keep state in their head across screens, or is misled about what happened. A WCAG AA failure on a main flow lands here by default.
- **Moderate**: friction and hesitation: extra steps, inconsistency that forces re-learning, copy read twice, a hierarchy that makes people hunt.
- **Minor**: polish: alignment, spacing, a lone inconsistent label, a rough empty state.
- **Note**: no measurable cost to the user yet: a decision worth a second look, or a conflict between sources that hurts nobody today. One that does cost the user is rated by that cost, not filed here.

Two rules keep the scale honest:
1. **Severity is per flow, not per pixel.** The same misalignment is Minor on an admin screen and Moderate on the screen the product is judged by. Say which flow you rated it against.
2. **Every finding names what it breaks**: an accessibility finding its WCAG success criterion (`1.4.3`, `2.4.7`), a usability finding its ISO 9241-110 principle or heuristic (`heuristics.md` section N). One that can name neither is a Suggestion.

Every finding also names its **source**: the build, the prototype, or a decision (the project's `CLAUDE.md`, a recorded decision, Dev's decision nobody specified, a token). One whose source is a decision is a **Decision** finding: the owner answers for it, at the same severity.

### In the prototype mode
Nothing is built yet, so "the user cannot do the job" is a prediction. Rank by **what it would cost once built**: Blocker when it would make a screen unusable for its role, or set a pattern every later screen copies; Serious when it would ship a WCAG AA failure, or a pattern that contradicts another screen of the same prototype; the rest as above.

And every finding says **who pays for its fix**:

| The screen | What the fix costs |
|---|---|
| **No change that covers it has been built** | An edit to the prototype. Free. |
| **A change that covers it is building, delivered or accepted** | The prototype changes, the built screen now departs from it, and realigning it is a new change: the owner decides whether the fix is worth it. |

A prototype report that does not state this for every finding is not finished: it invites an edit that silently leaves built screens departing from the prototype.

## Findings that are not findings
Two sections keep the rest credible:
- **Suggestions**: improvements with no principle or criterion behind them. Never counted in the totals. If everything you found is a suggestion, say so plainly: that is a real result.
- **Handed to QA**: functional bugs tripped over. One line each, no investigation.

## Template: the prototype (`docs/inputs/prototype/ux-audit.md`)

```markdown
# Usability audit of the prototype, <date>

**Served at:** <local address> · **screens:** <n> · **built:** <n> · **not built:** <n>
**Manifest:** confirmed by the owner | not yet confirmed
**Goal** (`docs/context.md`, verbatim): <the sentence>
**Conditions:** <screen widths> · <themes> · contrast, target size, semantics and keyboard measured

## What this mode cannot see
Real data and its states, roles, volume, errors, slow answers, and whatever the build invents or leaves as a placeholder. Those need an audit of the change or of the app.

## Free to fix now (no change covering the screen has been built)

### [Serious] <title>
- **Screens:** <names from the manifest>
- **What the prototype does:** <observed, measured>
- **What it breaks and what it costs the user:** <criterion or principle; the cost>
- **Proposed edit:** <the concrete change to the prototype>

## Fixing these costs work already built

### [Serious] <title>
- **Screens:** <names> (built by <change>)
- **What the prototype does:** <observed, measured>
- **What it breaks and what it costs the user:** <criterion or principle; the cost>
- **Proposed edit:** <the concrete change to the prototype>
- **What it costs once built:** <which change, which screens and files would have to be realigned>

## Suggestions

## Applied
<Only after the owner agreed: what changed in the prototype, file by file, and what was left as it was. Then `buddy prototype draft` again.>

## Evidence of effort (mandatory)
<Screens opened, switches driven, snippets run, keys pressed, themes and widths covered, and what you tried that found nothing.>
```

## Template: a change or the app

```markdown
# Usability audit: <change title or module> (<name>), <date>

**Scope:** one change | a module of the whole app | the whole app's consistency and goal check
**Goal** (`docs/context.md`, verbatim): <the sentence>
**Environment:** local, reset before and after (commands from CLAUDE.md: <start> / <reset>) · app at <address it printed>
**Identities used:** <role and how it was obtained>, <role ...>
**Volume seeded:** <how many records of what, and how>
**Screens covered:** <names from the manifest, with their addresses>
**Conditions:** <themes> · <widths> · axe-core <version> · keyboard-only pass: yes | no

## Summary
| Severity | Count |
|---|---|
| Blocker | 0 |
| Serious | 0 |
| Moderate | 0 |
| Minor | 0 |
| Note | 0 |

<Two or three sentences: the most important thing to do after reading this.>

## Findings

### [Serious] <short, concrete title>
- **Screen and flow:** <screen> (`<address>`), as <role>
- **What happens:** <observed, with the measured value: ratio, px, clicks>
- **What it breaks and what it costs the user:** <WCAG criterion, or ISO 9241-110 principle or heuristic; the cost>
- **Source:** the build | the prototype | a decision (cited, its reason quoted)
- **Evidence:** <screenshot, console output, measurement>
- **Options:** <one or more directions, not a mandated fix>
- **Belongs to:** this change's criterion <id> (rework, the owner decides) | outside the change (a request, if the owner agrees)

## Consistency across screens (whole app)
| Concept | One screen does | Another does |
|---|---|---|

## The goal check (whole app)
<The goal sentence performed end to end as the role it names: screens, clicks, values re-entered, what the app never told the person; and the verdict.>

## Accessibility summary
| Area | Result |
|---|---|
| axe-core | <violations by impact> |
| Contrast (each theme) | <pass, or failures with the worst ratio> |
| Keyboard only | <complete, or where it broke> |
| Focus visible and order | |
| Dialogs (trap, Escape, return) | <per dialog> |
| Names, labels, landmarks, headings | |
| Target size (2.5.8) | |
| Reflow and zoom (1.4.10, 1.4.4) | |

## Suggestions (no principle or criterion behind them)

## Handed to QA

## Evidence of effort (mandatory)
<What you actually did: screens opened, identities used, records seeded, snippets run, keys pressed, themes and widths covered, and what you tried that found nothing. A report with few findings shows the work behind it, or it cannot be told from a shallow pass.>
```

## Closing with the owner
Two to four lines: the count by severity, the most costly finding in one sentence, the path to the report. What becomes rework, a request, an edit to the prototype or nothing is the owner's call: offer, do not act.
