# Buddy

**The agent knows how to program, but not your process. The library defines the process, and Buddy runs it.**

Buddy is a plugin for Claude Code. He is the Product Owner's companion for getting software that gives value to the business, efficiently. A coding agent will happily build what nobody asked for, skip a test, or decide something costly on its own. Buddy stands between you and the agent:

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

You need Claude Code, Node 22 or later and git. In an empty folder:

```bash
mkdir my-project
cd my-project
claude plugin marketplace add teban1812/buddy --scope local
claude plugin install buddy@buddy --scope local
claude
```

Then say: *"Start a new project here."* Buddy asks a few questions, creates the project from the default library and asks about the business. [Getting started](docs/guide/getting-started.md) has the details, the prerequisites and the path to your first accepted change.

## The guides

| You are | Read |
| :-- | :-- |
| a developer who uses Buddy | [the developer's guide](docs/guide/README.md) |
| designing a library for your process | [the library guide](core/LIBRARY-GUIDE.md) |
| a Product Owner who wants to understand Buddy | [the explainer](docs/explainer.html) |

What each version brings is in the [changelog](CHANGELOG.md).

## Licence

MIT. See [LICENSE](LICENSE).
