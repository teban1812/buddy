# Buddy

**The agent knows how to program, but not your process. The library defines the process, and Buddy runs it.**

Buddy is a plugin for Claude Code and for Antigravity. He is the Product Owner's companion for getting software that gives value to the business, efficiently. A coding agent will happily build what nobody asked for, skip a test, or decide something costly on its own. Buddy stands between you and the agent:

- with only an idea, he helps you discover the product first: research, interviews, a brief, the flows, the wireframes and a prototype tested with real users;
- he asks first what only you know (the business, what is costly to get wrong) and never what your project already says;
- an agent builds each change inside your project's standards;
- programs check the work (the tests, a scan for signs of cheating) and an independent reviewer reads it;
- you decide only what needs you: the costly questions, the assumptions, and the acceptance of each change.

The process itself (the standards, the base application, the questions, the checklists) comes from a **library**, a git repository. Buddy brings a default one; you can write your own.

## Who it is for

- **A developer who is his own Product Owner**, working alone on his own projects, who wants an agent that builds what he meant and proves it.
- **A Product Owner who works with an agent** and wants to see evidence, not promises.
- **An organisation** that wants its own process followed: it writes a library, and Buddy runs it.

## A first start

You need Claude Code or Antigravity, Node 22 or later and git. The lines below are for Claude Code; Antigravity is further down. In an empty folder:

```bash
mkdir my-project
cd my-project
claude plugin marketplace add teban1812/buddy --scope local
claude plugin install buddy@buddy --scope local
claude
```

**Panel beside the conversation (Claude Code, optional).** A second plugin of the same catalogue shows what waits for you, what Buddy is building and what comes next, and reads the board through Buddy's program: `claude plugin install buddy-panel@buddy`, after the marketplace above is added. It is installed on the machine, not in your project, and nothing in the project is configured. It shows the project the conversation is in, also when the conversation's folder is one inside it (the nearest folder up holding `docs/buddy`). The panel speaks English; `buddy tools language es` (kept in your machine's Buddy setting, never in a project) switches it to Spanish.

**Panel beside the conversation (Antigravity App, optional).** The same short view as a plugin of its own, shown in the App's side panel: `agy plugin install <path to this repository>/panel/antigravity` (nothing else to install; after installing a new version, quit and reopen Antigravity, since the running panel stays in memory); open it from the side panel's `+` menu or Overview → Plugins, then "Buddy panel". It follows the same language setting, and reads the board with the Buddy installed in Antigravity (Claude Code's only when that one is missing), as Claude Code's panel does with Claude Code's. When Buddy finds a tool without its panel, he tells you once how to install it.

Then say: *"Start a new project here."* Buddy asks a few questions, creates the project from the default library and asks about the business. With a PRD or a prototype, put it in the folder first; with only an idea, he offers [discovery](docs/guide/discovery.md). To watch the work, ask for the board's page: it refreshes itself in your browser. [Getting started](docs/guide/getting-started.md) has the details, the prerequisites and the path to your first accepted change.

**With Antigravity.** Install the plugin once with `agy plugin install https://github.com/teban1812/buddy`: it installs for the whole machine (`~/.gemini/config/plugins/`), so the same install serves the `agy` command line, Antigravity App and Antigravity IDE (pinning a version was not tried, so you get what the repository holds). Where Antigravity keeps the plugin, the plugin's variable arrives empty, so Buddy's program is run as `node "$(command -v buddy.mjs)" <command>`. Each environment keeps its own tool and model settings (`buddy tools`); the guide's [getting started](docs/guide/getting-started.md#with-antigravity) says how. Tried end to end on macOS: `agy` 1.5.14, Antigravity App 2.34.0 and Antigravity IDE 2.7.0; the Antigravity extension for other editors was not tried. The guide keeps [a table of what was tried](docs/guide/getting-started.md#what-was-tried-per-tool-and-version), per tool, surface and version.

## The guides

| You are | Read |
| :-- | :-- |
| a developer who uses Buddy | [the developer's guide](docs/guide/README.md) |
| designing a library for your process | [the library guide](core/LIBRARY-GUIDE.md) |
| a Product Owner who wants to understand Buddy | [the explainer](docs/explainer.html) |

What each version brings is in the [changelog](CHANGELOG.md).

## Licence

MIT. See [LICENSE](LICENSE).
