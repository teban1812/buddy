# Glossary

The words Buddy uses, in alphabetical order.

**Acceptance.** Your decision that a delivered change is what you asked for. Only you take it, after trying the change. Buddy shows you a summary first: what you asked for, what was built, the exceptions, the assumptions and any departure from the prototype.

**ADR (architecture decision record).** A short file in `docs/decisions/` that records one decision: the problem, the options weighed, the one chosen and why. Buddy writes one, unasked, each time you choose between options. Anyone can read it without Buddy. The project's first one, written at birth, says which library and profile it came from.

**Approval.** Your sign-off on a step's record as a whole, once every line is decided or confirmed. It is stored with a fingerprint of the record, so a later edit makes it stale and needs your approval again.

**Assumption.** Something Buddy will take as true to build a change without asking you more. He announces at most five before building, each with what changes for you if it is wrong. You confirm them or correct them.

**Brief.** The file `docs/discovery/brief.md` that discovery writes with you: the problem, who uses it, what is in and out, a glossary, the business rules with their examples and what it takes for true. You confirm it line by line; what you confirm becomes the business context and the map of requests.

**Board's page.** The board as a page in your browser, `.buddy/board.html`, which refreshes itself as the work moves. Local, never committed.

**Change.** One thing you asked for: a feature or a planned fix. It has your request, its criteria and its exclusions, and lives in its own folder under `docs/buddy/`.

**Checkpoint.** The check of a slice after Dev builds it: the project's tests, a scan for signs of cheating, and an independent reviewer. A clean slice asks nothing of you; anything else comes to you as an exception.

**Design rules.** The rules of how screens must look and behave (contrast, keyboard, forms...), in the `design.md` files among the standards (`docs/standards/**/design.md`). Read like any standard: a `must` is fixed.

**Discovery.** Finding out what to build when you have an idea but no PRD and no prototype: research, interviews, the brief, the flows, the wireframes and a prototype tested with users. See [Discovery](discovery.md).

**Costly decision.** A choice that would be expensive to undo later: a new library, a new pattern, an integration, a data model. Buddy asks these before building. When Dev makes one nobody specified, the reviewer flags it and it comes to you.

**Criterion (acceptance criterion).** How you will know a change is right, in your terms. AC1, AC2 and so on. A change without criteria cannot be accepted. Dev writes, for each one, how you can try it.

**Exclusion.** What a change does not include, in your terms. X1, X2 and so on. It stops the change from growing. *"Nothing beyond the criteria above"* is a valid one.

**Flows.** The file `docs/discovery/flows.md`: where people meet the solution, who may see or do what, the main case with its errors, and the states of the main thing. What is not written is not allowed.

**Library.** A git repository that holds a process: standards, base applications, questions, steps, normative documents and saved prompts. A project is born from one and keeps its own copy. You start with Buddy's default library.

**Milestone.** A delivery of value made of several changes: a first version, a phase, a proof of concept. It starts only with your go-ahead and is accepted when all its changes are.

**Normative document.** An outside document the standards cite, such as a security standard at a given version. The library brings an index of them (`docs/standards/normative.md`), never the documents themselves.

**Panel.** A view beside the conversation, in Claude Code or Antigravity App, of what waits for you, now and next, with a button for each thing that waits. A plugin of its own, installed once per machine.

**Piece.** See *Slice*.

**Profile.** One stack in a library, with its own standards and base application. The default library has `empty` and `dotnet-react`. You choose one when the project is born.

**Prototype manifest.** The file `docs/inputs/prototype/manifest.md`. It says, for an HTML prototype you handed over, which screens and flows are the contract, which parts are illustrative and which are fake. Buddy drafts it; you confirm it line by line.

**Record.** A file Buddy's program keeps. The records of milestones and changes live under `docs/buddy/` and change only through the program. A step's record is the file where a step's checklist is answered for your project.

**Saved prompt.** A ready-made instruction a library brings for a known moment, such as a review before a release. Buddy offers it when the work reaches that moment and runs it when you agree.

**Slice.** A piece of a large change, built and checked on its own, with its own review rounds. You still accept the change once.

**Theme.** A file of colours (light and dark) in `docs/design/themes/`, from the library or made from your own visual proposal. You choose one during discovery; the wireframes, the prototype and the app use it.

**Step.** A checklist a profile brings (a security checklist, say), copied to `docs/steps/`. Buddy drafts its record from your requirements; you confirm each line and approve the whole. Until then no change can be built. (A change also has numbered steps that Dev ticks as he builds.)

**Usability audit.** A check that real people can do their job with a screen (WCAG 2.2 AA and the ISO 9241-110 principles), by the `ux-audit` skill. On demand, and always on a prototype before its test with users or the confirmation of its screens.

**Wireframe.** A plain page of one key screen, in `docs/discovery/wireframes/`, drawn from the brief and the flows and agreed with you before the prototype. It names the screen the changes will use.
