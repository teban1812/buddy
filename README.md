# Buddy

**The agent knows how to program, but not your process. The library defines the process, and Buddy runs it.**

Buddy is the Product Owner's companion for getting software that gives value to the business, efficiently. **He is a plugin built for two tools: [Claude Code](https://claude.com/claude-code) and [Antigravity](https://antigravity.google).** Install him in either one and you talk with Buddy there; the same project works in both.

A coding agent will happily build what nobody asked for, skip a test, or decide something costly on its own. Buddy stands between you and the agent:

- **With only an idea,** he helps you discover the product first: research, interviews, a brief, the flows, the wireframes and a prototype tested with real users.
- **He asks first what only you know** (the business, what is costly to get wrong) and never what your project already says.
- **An agent builds each change** inside your project's standards.
- **Programs check the work** (the tests, a scan for signs of cheating) and **an independent reviewer reads it.**
- **You decide only what needs you:** the costly questions, the assumptions, and the acceptance of each change.

The process itself (the standards, the base application, the questions, the checklists) comes from a **library**, a git repository. Buddy brings a default one; you can write your own.

## Who it is for

- **A developer who is his own Product Owner**, working alone on his own projects, who wants an agent that builds what he meant and proves it.
- **A Product Owner who works with an agent** and wants to see evidence, not promises.
- **An organisation** that wants its own process followed: it writes a library, and Buddy runs it.

## A first start

You need Node 22 or later, git, and one of the two tools below, signed in. Pick yours; the rest of the project is the same either way.

### With Claude Code

In an empty folder:

```bash
mkdir my-project
cd my-project
claude plugin marketplace add teban1812/buddy --scope local
claude plugin install buddy@buddy --scope local
claude
```

Optional: a panel beside the conversation that shows what waits for you, what Buddy is building and what comes next: `claude plugin install buddy-panel@buddy`. It is installed on the machine, not in your project.

### With Antigravity

Install the plugin once for the whole machine (there is no per-folder scope), then start `agy`, Antigravity App or Antigravity IDE in an empty project folder:

```text
agy plugin install https://github.com/teban1812/buddy
```

It serves the three: the `agy` command line, the App and the IDE. Tried end to end on macOS with `agy` 1.5.14, Antigravity App 2.34.0 and Antigravity IDE 2.7.0; the extension for other editors was not tried. [Getting started](docs/guide/getting-started.md#with-antigravity) has the details and the table of what was tried.

Optional, for the App: the same short panel as a plugin of its own, `agy plugin install <path to this repository>/panel/antigravity`. After a new version, quit and reopen Antigravity.

### Then

Say: *"Start a new project here."* Buddy asks a few questions, creates the project from the default library and asks about the business. With a PRD or a prototype, put it in the folder first; with only an idea, he offers [discovery](docs/guide/discovery.md). To watch the work, ask for the board's page: it refreshes itself in your browser. [Getting started](docs/guide/getting-started.md) has the prerequisites and the path to your first accepted change.

Each environment keeps its own tool and model settings (`buddy tools`), and the panels speak English: `buddy tools language es` switches them to Spanish.

## The guides

| You are | Read |
| :-- | :-- |
| a Product Owner who wants to understand Buddy | [the explainer](docs/explainer.md) |
| a developer who uses Buddy | [the developer's guide](docs/guide/README.md) |
| designing a library for your process | [the library guide](core/LIBRARY-GUIDE.md) |

What each version brings is in the [changelog](CHANGELOG.md).

## Licence

MIT. See [LICENSE](LICENSE).
