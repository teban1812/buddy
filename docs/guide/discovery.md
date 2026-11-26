# Discovery: from an idea to a tested prototype

You have an idea, but no PRD and no prototype. Buddy can help you find out what to build before anything is built: research, interviews, a brief, the flows, the wireframes and a prototype tried by real people. It is not a separate tool. It is the first part of the same conversation, and what it leaves is exactly what Buddy needs to plan the first milestone, so you never tell anything twice.

Everything Buddy writes in discovery lives in `docs/discovery/`, created as soon as you accept discovery, except the prototype, which goes to `docs/inputs/prototype/` like one you would hand over. What you hand over yourself stays in `docs/inputs/`, untouched: your interview and test notes in `docs/inputs/interviews/`.

## When Buddy offers it

- **At birth.** When you start a project and bring no PRD and no prototype, the project is born without a profile (context, the library's general standards with `design.md`, and its themes — no template yet), and Buddy offers discovery as the first step before any profile is chosen.
- **Later.** In any project, when you bring an idea with nothing written, or ask for help researching, interviewing or writing a brief.
- **With a PRD.** Buddy does not offer the whole discovery, but before planning he tells you what the PRD lacks to be built well (rules without examples, missing error paths or permissions, a term used two ways, a criterion whose data comes from nowhere). You choose: answer those as questions, or take a short pass through the stage of discovery that covers them.

You can say no. Discovery is an offer, never a gate.

## First: where you already are

Before he proposes anything, Buddy reads what you already have in `docs/inputs/` and `docs/discovery/` (notes, research, a brief, flows, wireframes, a PRD, a prototype), or notes that there is nothing. In a few lines he tells you:

- which stage is already covered;
- what is incomplete or weak, each with an example ("this finding has no source", "this rule has no example", "this flow has no error path", "this wireframe names no screen");
- where he proposes to go on.

**You** confirm the starting point. Buddy then completes only what is missing. Nothing you did is redone, and your own files are never changed: what he completes goes to `docs/discovery/`.

## Throughout

- **Your decisions are kept.** Every choice you make between options, every "your call" and every priority you confirm is recorded when you give it (a decision record, the answer to a question, the priority in the map of requests), and Buddy tells you in one line. He never asks it again nor plans against it: if you chose what goes first, the plan follows it.
- **A commit at the end of each stage**, naming its files.
- **He checks before you confirm.** Before he asks you to confirm the brief or the flows, Buddy checks them himself: every rule has an example that meets it, one that does not and what the system does then; every glossary term has words not to use; every state has a way out; no sample data uses a real person's name, not even your interviewees'. He tells you what he fixed.
- **In your words.** A confirmation line by line shows each line's number, so you can answer "line 6 is right". You never get one of Buddy's internal commands to read or type.
- **In order.** If you ask why a step was skipped, he tells you, and goes back to it.
- **One plan, at the end.** The first milestone is planned once, when discovery ends: after the stage where you stop, or once the prototype's screens are confirmed.

## Stage 1: research, interviews and the brief

| Step | What you do | What Buddy does | What it leaves |
| :-- | :-- | :-- | :-- |
| **Research** | Say which questions to follow and where to look; share notes or reports you have. | Proposes what to find out about the problem, the users and the alternatives, searches the web and your files, and writes one finding per line, **each with its source** (a link or a file). What he only believes stays an open question; a missing figure is named, never invented. | `docs/discovery/research.md` |
| **Interviews** | Hold the interviews with the people who have the problem, and bring back notes or transcripts. | Says who to talk to and writes a guide of questions about **facts of the past** ("the last time you did it, what happened?"), checked for leading questions. Turns your notes into findings that quote the people's **own words**, never polished or invented. | the guide, your notes in `docs/inputs/interviews/`, new findings in `research.md` |
| **The brief** | Read it **line by line**, each line numbered: confirm, correct or strike each line. | Drafts it from the research and the interviews only, and checks it before you read it: the problem and its impact, who uses it, what is in and what is left out, open questions. It holds a **glossary** (each term, its meaning and the words not to use instead), the **business rules** (each with one example that meets it and one that does not, and what the system does then) and **what it takes for true without proof**, with the two or three to test first with users. | `docs/discovery/brief.md` |
| **The hand-over** | Confirm the priorities and the dependencies, as in any intake. | Writes what you confirmed, in your words, into the business context and the map of requests: every need and every rule becomes a request with its source. Unconfirmed lines stay `assumed` and pass on to nothing. | `docs/context.md`, `docs/buddy/requests.md` |

From here on, Buddy uses only the glossary's words: in the flows, the wireframes, the prototype and the changes.

## Stage 2: the flows, the design directives and the wireframes

| Step | What you do | What Buddy does | What it leaves |
| :-- | :-- | :-- | :-- |
| **The flows**, before any wireframe | Confirm or correct each part; say what you do not know, and it stays a question. | Writes with you, one part at a time: every place a person meets the solution, **who may see or do what**, the main case step by step with its decisions, **its error paths and what happens without permission**, and the states of the main thing with who changes each and when. What is not written is not allowed. A flow that breaks a rule of the brief is said at once. | `docs/discovery/flows.md` |
| **The design directives** | Choose a theme by looking at it, or bring your own look. | Reads the library's **design rules** (the `design.md` files among the standards, `docs/standards/**/design.md`; a `must` is fixed) and shows its **themes** (`docs/design/themes/`) on a sample page (a form, a table with states, buttons and an alert, in light and dark) — using the library's own sample page when it brings one, or generating `docs/discovery/theme-sample.html` linking every theme CSS without copying them. If you bring a visual proposal of your own (a style guide, a mock-up, screenshots, a stylesheet), he turns it into a theme of the same format, says which values he had to propose (a dark variant, say), **measures its contrast against WCAG AA in light and dark** (naming every pair below AA with its ratio), and adds it to the sample page beside the library's. With no theme at all, he drafts a short brand brief with you. | the choice under "Design" in `flows.md`; `docs/discovery/theme-sample.html`; your theme in `docs/design/themes/<name>.css`, or `docs/discovery/brand.md` |
| **The wireframes** | Choose the navigation's shape (side navigation at the left, or top bar only); decide which screens get a wireframe; comment on each one until you agree. | Records the navigation's shape in `flows.md` under "Design" (coloured through the theme's `--sidebar-*` variables and kept in every wireframe and the prototype). Proposes the key screens and **recommends going straight to the styled main screen without a wireframe** when the theme is chosen, the screen follows a known pattern (list, detail, form, dashboard) and the flows left its structure clear; otherwise draws a wireframe as a plain page (grey boxes, real labels in the glossary's words, the states the flows give, in your theme's colours, each naming its screen). You decide. Where a wireframe you agreed clashes with a design rule, he tells you first, naming the rule; you decide which gives way. | navigation shape under "Design" and agreed wireframes under "Wireframes" in `flows.md`; `docs/discovery/wireframes/<screen>.html` |

The default library brings themes, design rules for every screen (contrast, keyboard, forms, states, navigation and more) and rules for prototypes (believable sample data, more than one role); its `standards/general/design.md` holds the current list ([buddy-default-library](https://github.com/teban1812/buddy-default-library)). A library of your own may bring others, or none.

You may stop at the end of stage 2: discovery ends there and the first milestone is planned from the flows and wireframes you agreed. Or go on to stage 3 first.

## Stage 3: the prototype, its audit, its test with users and the approval

| Step | What you do | What Buddy does | What it leaves |
| :-- | :-- | :-- | :-- |
| **The prototype** | Walk it and comment, until you agree with it as a draft. | Builds it only once every wireframe is agreed, one HTML page per screen, linking your theme in `docs/design/themes/` (never a copy), keeping your chosen navigation shape and following the design rules, and shows it to you before any audit: the links follow the flows, so the main case can be walked end to end; sample data is marked as an example; only the roles and states the flows name, with each screen with data shown in **five states** (with data, empty, loading, error and read-only), each reachable through a role, a switch or the sample data. | `docs/inputs/prototype/` |
| **The usability audit** | Accept or refuse each finding. | Runs the usability audit (the `ux-audit` skill: WCAG 2.2 AA and the ISO 9241-110 principles) on every screen, **before anyone tries it**, while a fix is one edit. Findings come ordered by importance, each with its cost to the person; nothing changes until you accept it. A prototype you hand over yourself gets the same audit before its screens are confirmed. | `docs/discovery/ux-audit.md`; the accepted fixes in the prototype |
| **The test with one or two real users** | Hold the sessions with people who do the work, and bring back notes. | Writes the guide: tasks to do without help, in the person's words ("pay this invoice"), never naming a button; questions about the past and about facts, never "do you like it". Turns your notes into **proposed changes ordered by importance**, each with the person's own words. Nothing changes until you agree; a second round may follow. | `docs/discovery/test-guide.md`, your notes in `docs/inputs/interviews/` |
| **The approval** | Tell Buddy that **the person who owns the process approved it**. | Until then the prototype is a draft. When you say so, he goes straight on to confirming its screens. | nothing new: the draft becomes the contract |

## Into the milestone, with nothing to repeat

Once the prototype is approved, there is no other hand-over step. Buddy reads it as he reads any prototype you hand over, drafts its manifest (each screen, each flow, what is only an example) and you confirm it line by line. That manifest, `docs/inputs/prototype/manifest.md`, is your **experience contract**: Dev builds from it, and every departure from it comes to you at acceptance.

If the project was born without a profile, Buddy recommends a profile now — before the first milestone is planned — with reasons drawn from what discovery found. Once you choose, he brings that profile's template and standards into the project and checks that it is healthy, without touching anything discovery wrote.

Then, and only then, the milestone is planned as usual ([Getting started](getting-started.md#4-a-first-milestone)), starting from what you already decided: the requests already in the map, the flows and rules as criteria with their examples, each change naming the screens it covers, one round of costly questions (none you already answered), and the milestone card for your go-ahead. The discovery is over.

**On the board.** While you discover and nothing is being built, the board, its page and the panel say where you are: *Discovering the product: stage 2 of 3 (flows and wireframes)*. Buddy reads it from the files above; nothing else is recorded.

## A short example

> **You:** I want an app for our team to request time off. I have nothing written.
>
> **Buddy:** I looked: there is nothing in `docs/inputs/` yet. I propose to start from the beginning: what the problem costs today, who has it, and what people use now. Shall I search for how other teams handle time off, and do you have last year's requests?
>
> *(Research, then two interviews you hold with colleagues.)*
>
> **Buddy:** Here is the brief, 14 lines. Line 6 says a manager approves within two days: is that a rule, and what happens on day three?
>
> **You:** Line 6 is right; on day three it goes to HR. Strike line 9.
>
> *(The flows, then the themes.)*
>
> **Buddy:** The library brings several themes, among them neutral (black and white), modern-minimal (white with a blue accent)... or bring your own.
>
> **You:** Here is our intranet's stylesheet.
>
> **Buddy:** I turned it into a theme called intranet. Your stylesheet has no dark colours; I propose these, as mine. Here are the three key screens in it.
>
> *(Wireframes agreed, the prototype, its audit: 2 serious findings, both accepted. Two people try it; you bring the notes.)*
>
> **You:** Marta, who runs HR, approved it.
>
> **Buddy:** Then here are its screens to confirm, line by line. After that I'll propose the first milestone.

Next: [Getting started](getting-started.md), or back to the [Overview](overview.md).
