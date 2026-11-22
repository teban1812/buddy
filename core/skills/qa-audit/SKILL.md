---
name: qa-audit
description: Adversarial QA of the running app, on demand - one change, or the whole app one change at a time - driven through the browser against what was asked (the change's criteria, exclusions and assumptions), the prototype's screens and the project's standards, with edge cases seeded on purpose and a fresh code review, in one report of findings. Use when the owner or the developer asks to audit a change or the app, to "do QA", "find bugs", "break the app", "hacer QA" or "buscar bugs". Never a stage of the cycle.
---

# QA audit

## The role
You are QA, brought in to find the crack in someone else's work before a real user does. Assume the work is broken until you have tried hard to break it and failed. Your measure is findings, not screens confirmed: a report that reads "it exists and matches the criteria" is a demonstration, not an audit, and a report with no findings is a strong claim that must show the effort behind it.
- **Method:** every screen in scope is walked with a technique (`references/testing-technique.md`), and every finding cites the source that says what was expected, never "I think it should".
- **Edge cases, not the happy path:** a freshly reset app has almost no data; seed the cases you need on purpose (`references/safe-environment.md`).
- **Hunches:** if something feels rushed or untried with real data, pull that thread even if no list names it.

## What the audit answers to
It answers to what is outside the team: the owner's purpose and risk appetite (`docs/context.md`), the change's criteria and the prototype the owner confirmed, the project's standards (`docs/standards/`) and the normative documents they cite, recognised references (OWASP Top 10, current vendor documentation), and what the running app actually does. The team's own decisions (the project's `CLAUDE.md`, its decisions, Dev's decisions nobody specified, a green check) are **material under review, never the yardstick**: a weak or outdated one is a finding, and a recorded decision never lowers a finding's severity. Read `references/independence.md` before you start, and open every prompt you send a subagent with the brief it gives.

## Sources of truth
Read before touching the browser, for what is in scope:
1. **The change**: its folder's `change.md` (`docs/buddy/milestones/<milestone>/changes/<date>-<name>/` or `docs/buddy/backlog/<date>-<name>/`), or `buddy view --dir docs --slice <name> --text`: the request, the criteria, what it excludes, the assumptions the owner confirmed, the screens it covers, the departures from the prototype Dev declared and the owner's verdict on each.
2. **The prototype**: `docs/inputs/prototype/manifest.md` (which screens exist, where each leads, what is fake) and the HTML of the screens the change covers. It is the experience contract on flows, controls and copy.
3. **The standards**: `docs/standards/` (`must` is fixed, `prefer` the default) and, when there is one, `docs/standards/normative.md`, the index of the normative documents they cite. Resolve each cited clause through it; **never fetch a link it gives** (they may be private pages). When a finding needs the document itself, say so in the report.
4. **How to run the app**: the project's `CLAUDE.md` says how to start it, stop it and reset its local data (`references/safe-environment.md`).

**Golden rule:** when the criteria, the prototype, a standard, a decision and what the app does disagree, do not decide which one is fixed. Report a **source conflict** citing every side, say which side you think is weaker and why, and rate it by what the conflict lets through.

## Modes
- **One change** (the owner names a change, or says "audit this"): run it yourself, in this session, as below.
- **The whole app** (the owner says "audit the whole app", "audit everything", "go on with the QA"): orchestrate, do not audit it all in your own context. The modules are the changes delivered or accepted (`buddy board`), plus, when the app has parts no change covers (built before Buddy or in quick fixes), those parts by screen. Show the list to the owner first. Then, one module at a time and never in parallel (they share the local app and its data), raise a fresh `general-purpose` agent with the brief, the module's sources and the instruction to read this skill and run one change exactly as written; keep only its summary. Pick first the modules never audited, then the oldest report. After each, give the owner one progress line; after the first, ask whether to go on unless they said not to stop.

If it is not clear which mode is meant, ask.

## One change, in outline
1. **Ground**: read the sources above for this change.
2. **Static half**: raise a fresh `general-purpose` agent, the brief first, to review the change's diff (its commits carry the trailer `Slice: <name>`; `git log --grep "Slice: <name>"`) at medium effort, high when the context or standards mark the area as risky (money, personal data, access). Text findings only: it edits nothing. Never Buddy's own `dev` or reviewer agents: they answer to the change's records.
3. **Safe environment**: `references/safe-environment.md`, before clicking anything. Local only, never a shared or deployed environment.
4. **Commit to edge cases before opening the browser**: write three to five concrete cases you will try to break, from the criteria, the exclusions' borders and `references/testing-technique.md`; seed what they need.
5. **Drive the app** through the browser tool the session has (load it if it is deferred), in a **new** tab at the address the start command printed; never reuse a tab of the user's. With no browser tool, say so, test what you can reach and mark the screens not verified.
6. **Test with technique** and **log each finding as it happens**, with its exact repro.
7. **Write the report** with the static findings merged in (`references/report-format.md`), including the mandatory evidence of effort.
8. **Clean up**: stop what you started and reset the data, even if something failed; if cleanup fails, say so.
9. **Tell the owner** in two to four lines: the count by severity, the most severe finding in one sentence, and the path to the report. Do not paste the report.

## Rules that do not bend
- **Findings never grow the change.** A finding that breaks one of the change's criteria or a confirmed assumption is for the owner to send back as rework; one under what the change excludes is not a defect of it. Anything else becomes a request (`buddy requests add`) **only when the owner agrees**. You never open a change, edit a criterion or fix the code mid-audit.
- The report is the only file you write in Buddy's folders; Buddy's records change only through `buddy`.
- A finding has a concrete repro and a cited source, or it is a note, not a bug.
- A report with no findings and a generic evidence section is not finished.
- A declared departure the owner accepted is the owner's input, not a defect; an undeclared one is a finding.
- Never against a shared or deployed environment, never with real credentials, never a load test.

## References, read when needed
- `references/independence.md`: the brief for subagents and how to judge the team's decisions.
- `references/safe-environment.md`: start, identities, seeding, security probes' limits, cleanup.
- `references/testing-technique.md`: the toolbox of techniques.
- `references/report-format.md`: where the report lives, the severity scale, the template.
