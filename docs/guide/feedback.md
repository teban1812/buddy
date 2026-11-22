# Feedback

Your feedback decides what Buddy becomes. Send what got in the way, what you did not understand, and any approval you did not believe. Two ways, by size.

## Small things: `buddy feedback`

For one small thing (a confusing message, a question Buddy should not have asked, a step that took too long), tell Buddy: *"Note this as feedback: ..."*. He runs:

```bash
buddy feedback "<what happened>"
```

It writes one line, with the date, the project's name and Buddy's version, to `docs/field-log.md` in a folder you choose once. Nothing is written into your project. Choose the folder the first time (any folder of yours works, for example a clone of Buddy's repository):

```bash
buddy feedback --factory <folder>
```

Run `buddy feedback` with no text to see which folder it uses. The `BUDDY_FACTORY` variable, when set, wins over the folder you chose.

The notes stay on your machine. To send them, gather them in an issue (below) when several have piled up.

## Several small things, or a big one: a GitHub issue

When a few small notes have piled up, or something big happens (work lost, a check that passed what it should not, a step you could not get past), open an issue in Buddy's repository: **Issues → New issue → Feedback**. The template asks for:

- **What you were doing**: the moment, in a sentence or two (starting a project, accepting a change, a checkpoint).
- **What happened**: what you saw. Paste the message or the lines of your field log.
- **What you expected.**
- **Buddy's version**: the third column of any line `buddy feedback` wrote, or ask Buddy.
- **The library**: the default one or your own, and its version (the `Library:` line Buddy shows, or `docs/standards/ORIGIN.md` in your project).

Leave out anything private: your client's names, secrets, personal data. A short description of the situation is enough.

## When you want your own library

When the default library no longer fits (other standards, another stack, your own checklists), read the [library guide](../../core/LIBRARY-GUIDE.md). It explains each part of a library and what Buddy does with it, with an example of each. Then point Buddy at it once, for every new project:

```bash
buddy library --set <git url or folder>
```

`buddy library --show` says which library a new project would use, and why.
