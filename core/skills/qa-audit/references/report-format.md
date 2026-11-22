# Report format

## Where the report lives
- **For a change**: `qa/report.md` inside the change's folder (`docs/buddy/milestones/<milestone>/changes/<date>-<name>/qa/report.md`, or under `docs/buddy/backlog/` for a change of no milestone). Always in the `qa/` folder, never as a `.md` next to `change.md`: Buddy reads the files beside `change.md` as pieces of the change. The folder moves with the change when Buddy moves or renames it.
- **For a part of the app no change covers**: `docs/qa/<module>.md`.
- Screenshots go beside the report, referenced by a relative path.

The local data never holds production data, so the report is tracked in git with the rest of the change. If the module was audited before, **add a new dated section** at the end instead of overwriting: keep the history. In the whole-app mode there is no separate index: the dates of the reports say what was audited and when.

## Severity
- **Critical**: data lost or corrupted, a crash, a business rule from the criteria or the context broken from the screen, another user's data reachable, or sensitive data exposed.
- **High**: something broken, or a clear contradiction of a criterion, a confirmed screen or a `must` standard, with no easy way around it for the user.
- **Medium**: inconsistent or confusing behaviour that breaks neither the flow nor the data.
- **Low**: visual detail, copy, a micro-interaction.
- **Note**: not a defect: a source conflict, or a hunch without a repro, for a human to decide.

The severity is what the finding lets through. A team decision behind it changes who answers for it, never how bad it is.

## Template

```markdown
# QA audit: <change title or module> (<name>), <date>

**Scope:** one change | a module of the whole app
**Environment:** local, reset before and after this run (commands from CLAUDE.md: <start> / <reset>)
**Sources read:** change.md (criteria AC.., exclusions X.., assumptions A..) · prototype screens <names> · standards <files and clauses> · normative documents cited <ids, or "none">

## Findings

### [High] <short, concrete title>
- **Source:** what says what should happen, cited (a criterion, a confirmed screen, a standard's clause, a reference)
- **How to reproduce:** the exact steps, with the data used
- **Expected:** what the source says
- **Observed:** what the app did
- **Evidence:** console, network, screenshot, file:line
- **Source conflict:** only when the sources disagree with each other: name every side; there is no single "expected"
- **Belongs to:** this change's criterion <id> (rework, the owner decides) | outside the change (a request, if the owner agrees)

<one per finding, most severe first; the code review's findings in the same form, marked "code review">

## Evidence of effort (mandatory)
Specific, never "everything worked". A category that does not apply says why; an unexplained "n/a" counts as blank.
- **Data seeded**: which records were created for this run and which edge case each represents; or why the reset data was enough.
- **Boundary values tried**: which, on which fields, and what happened.
- **States tried**: empty, one and many, network error, slow load.
- **Navigation tried**: back, refresh mid-flow, direct link, two tabs.
- **Rules attacked**: what you tried to break (ownership, sensitive actions, the criteria's edges) and what happened.
- **Code review**: the effort it ran at and what it covered.

A report with no findings and this section empty or generic is not finished.

## Coverage
- Flows tried: ...
- Left out this time, and why: ...
- Not verified, and what it would take: ...
```

## Closing with the owner
Two to four lines: the count by severity, the most severe finding in one sentence, the path to the report. What becomes rework, a request or nothing is the owner's call: offer, do not act.
