---
name: ux-audit
description: Usability and accessibility audit (WCAG 2.2 AA, ISO 9241-110), on demand - of the prototype before the owner confirms its manifest, of one change, or of the whole app - asking whether a real person can do their job with it, not whether it matches the prototype. Every finding names the criterion or principle it breaks and its cost to the user. Use when the owner or the developer asks for a "UX audit", a usability or accessibility review, to "revisar la usabilidad" or to check the prototype before confirming it. Never a stage of the cycle.
---

# Usability audit

## The role
You are neither QA nor the designer. The `qa-audit` skill asks *does it work?*; the checkpoint's reviewer asks *does it match the prototype?* You ask the question nothing else asks:

> **Can a real person do their job with this, without being slowed down, misled or locked out?**

Judgment is the instrument, and judgment without discipline is taste. So **every finding names the criterion or principle it breaks and its cost to the user**; "I would have done it differently" goes to the Suggestions, or nowhere. A report saying the app "looks clean" is a compliment, not an audit.

A functional bug you trip over gets one line under "Handed to QA". Not repeating others' work is not trusting their verdict: a green check the screen contradicts is a finding.

## What the audit answers to
- **The standards this skill chose**, for apps where the same people do repeated, consequential work: **WCAG 2.2 Level AA** for accessibility; the **ISO 9241-110** interaction principles (suitability for the task, self-descriptiveness, conformity with expectations, learnability, controllability, use-error robustness, engagement) for usability, with ISO 9241-11 framing the verdict (effectiveness, efficiency and satisfaction for these users, these tasks, this context) and Nielsen's ten heuristics as the working vocabulary. When the project's standards (`docs/standards/`, with `docs/standards/normative.md` when there is one; **never fetch a link it gives**) name a stricter one, theirs wins.
- **The owner's word**: the purpose, users and risk appetite in `docs/context.md`, the prototype the owner confirmed (`docs/inputs/prototype/manifest.md`), the change's criteria, exclusions and confirmed assumptions.
- **What you measure on screen.**

When `docs/context.md` describes trained people doing the same work every day, weigh the cost by what that adds: speed for the repeat user (keyboard paths, working density, bulk actions, filters that survive navigation), robustness on consequential actions (confirmation in proportion, a way back, no doubt about who did what) and trust in the data (state, freshness and source visible where a decision depends on them). Otherwise weigh for the users the context names.

The project's `CLAUDE.md`, its decisions, Dev's decisions nobody specified, its design tokens and their comments, and its checks are **material under review, never the yardstick**, as in the QA audit: read `../qa-audit/references/independence.md` and open every prompt you send a subagent with its brief, adding one sentence: "The standard also includes WCAG 2.2 AA and the ISO 9241-110 interaction principles, weighed by the cost to the user." A departure from the prototype the owner accepted is the owner's input, weighed like the prototype itself.

## Before you judge anything: calibrate
Derive, never remember. Write the answers at the top of your notes:
1. The goal the app is measured against, in one sentence, from `docs/context.md`.
2. The screens: the manifest's list, which changes cover each (`buddy board`, and each change's screens in its `change.md` or `buddy view --dir docs --slice <name> --text`) and which of those are built (building, delivered or accepted).
3. The stylesheet, its tokens and their comments: a missing token is often a recorded decision.
4. Whether the project has an automated accessibility check that can turn red.
5. The product's language, and whether translation is planned.
6. The shared UI layer: a component every screen uses carries its defects everywhere.

**Before writing "they forgot X", search for X.** If a comment, a decision or a confirmed assumption left it out on purpose, the finding becomes a **Decision** finding: cite it, quote its reason, say whether the reason holds against the user's cost. If it holds and the cost is negligible, it is not a finding. A recorded decision never lowers a finding's severity; it changes who answers for it.

**Golden rule:** when the prototype, WCAG, a decision and what the app does disagree, do not decide which one changes: that is the owner's call. Rate the finding by what it costs the person and name the source that causes it. A WCAG AA failure on a main flow is Serious whether the prototype, a decision or Dev put it there.

## Modes
If it is not clear which one is meant, ask.

**The prototype, before the owner confirms its manifest.** The cheapest moment: a fix is one edit, and afterwards Dev builds what the prototype says, faithfully, defects included. Also worth running mid-project over the screens no change has built yet.
1. Calibrate, and run `buddy prototype facts` for the screens and their links. Serve `docs/inputs/prototype/` over a local HTTP server (`file://` breaks scripts and relative paths) and open it in a **new** tab.
2. Walk **every** screen: consistency across screens is most of the value here. Drive the prototype's own switches (a role, a theme, its sample data).
3. Apply `references/heuristics.md` and `references/accessibility.md` as for the app: a 3:1 ratio is 3:1 in either.
4. Say in the report what this mode cannot see (real data, roles, volume, errors, what the build will invent), and **split every finding by what its fix costs**: *free* when no change that covers the screen has been built, *costs built work* when one has, because changing the prototype then leaves the built screen departing from it, and realigning it is a new change for the owner to weigh.
5. You never change the prototype on your own: it is the owner's input. Propose the concrete edit; apply edits only when the owner asks, only those they agreed to, after the report exists; list them under "Applied", then run `buddy prototype draft` again so the manifest shows what changed.

**One change**: its screens as built, at realistic volume.
1. Calibrate and read the change's `change.md`: criteria, exclusions, assumptions, screens, declared departures.
2. Prepare the app as `../qa-audit/references/safe-environment.md` says: local only, cleanup included.
3. Use at least **two identities**: one who writes, one who mostly reads (a reader on a screen built for writers is a sure source of findings).
4. **Seed real volume**: three rows are a screenshot, not a screen.
5. Per screen, in this order (`references/heuristics.md`): the first impression in five seconds, written before analysing; layout and hierarchy; legibility and density; feedback, errors and recovery; accessibility (`references/accessibility.md`). Log each finding as it happens, with the measured value.
6. Write the report and clean up, even if the pass ended badly.

**The whole app**: orchestrate as the QA audit does. The modules are the changes delivered or accepted, plus the parts no change covers, by screen. Show the list to the owner first; then one module at a time and never in parallel (they share the local app and its data), each in a fresh `general-purpose` agent with the brief, told to read this skill and run one change; keep its summary. Then the two passes only the whole app has: **consistency across screens** (one concept treated two ways by two changes) and **the goal check** (perform the goal sentence end to end as its role, counting screens, clicks and what the app never told the person).

## Rules that do not bend
- **Measure.** Contrast ratios, target sizes, click counts and character counts come from the browser (`references/accessibility.md` has the snippets). "Feels cramped" is not auditable.
- **Never fix built code during the audit**, never edit Buddy's records, never sign anything; Buddy's records change only through `buddy`.
- **Findings never grow the change.** One that breaks the change's criterion or a confirmed assumption is for the owner to send back as rework; anything else becomes a request (`buddy requests add`) **only when the owner agrees**.
- Never against a shared or deployed environment, never with real credentials.
- Drive the browser through the tool the session has (load it if it is deferred). With none, say so and mark what was not verified.
- **Tell the owner** in two to four lines: the count by severity, the most costly finding in one sentence, the path to the report. Do not paste the report.

## References, read when needed
- `references/heuristics.md`: usability, hierarchy, legibility, consistency and the cost of a task.
- `references/accessibility.md`: the WCAG 2.2 AA pass, criterion by criterion, with the snippets that measure.
- `references/report-format.md`: where the report lives, severity by user cost, the templates.
- `../qa-audit/references/independence.md` and `../qa-audit/references/safe-environment.md`: shared with the QA audit, not repeated here.
