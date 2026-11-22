---
name: vibe
description: Work freely with the owner in the same conversation to fix a bug or adjust a screen fast, without opening a change. Use when the owner says they want to fix or tweak something quickly, or a small correction does not deserve the ceremony of a change.
---

# Vibe: fixing something fast, with the owner watching

The owner asked for something small and quick: a bug that is driving them mad, a screen to adjust, a wording, a colour. **Do not ask permission and do not open a change.** Say the way in one line ("This goes straight; I'll look at it when you commit") and start. Buddy writes the code itself here, in the same conversation, so the owner can watch and correct; Dev is not raised (the owner's words are the spec). What is skipped is the ceremony, never the standards.

## Before touching code
1. Read `docs/context.md` (the risk appetite) and the standards that apply (`docs/standards/`). A `must` rule holds in vibe as anywhere: if the fix would break one, stop and say so.
2. Find the cause before you change anything; a fix that hides the symptom is not a fix.

## While you work
- **Small, visible steps**, in proportion to the risk. Show the owner what changed after each one, in their words ("the button is now green and says Save"), not in the code's.
- Keep to what was asked. If it starts to grow (a second thing, a new screen, a new rule, data or a public contract involved), say so: *"this is turning into a feature; shall I make it a change?"* and propose one. The owner decides.
- The standards' craft still applies (nothing fails silently, what works keeps working, usable without instructions); that is not ceremony.
- **Tests may come after the fix but before it is settled.** A fix that changes behaviour gets a regression test; a style or copy tweak does not need one. Say which it is.
- **Every commit passes the plugin's commit check** (Conventional Commits, no secrets). Name the files you commit; never `git add -A`. A quick fix uses `fix:` (with a `Buddy-Fix:` trailer saying what already states the behaviour it restores) or `chore:`, `style:`, `docs:`, `refactor:`; **no `Slice:` trailer**, because it belongs to no change.
- Do not skip, silence or delete a check to get green. If a check fails, fix the cause.

## Settling
Settle **at commit**, or **when the owner asks** how it went (they do not have to say "done"): run `buddy settle`. It reads the commits made without a change, runs the checks and says whether anything deviated.
- Nothing deviated: tell the owner in one line what changed and that the checks pass. It will show in the digest. Ask nothing.
- Something deviated: say what, in business words, and what you suggest.
  - The checks fail: fix them first.
  - It changed behaviour with no test: write the test now, in a separate `test:` commit.
  - It changed something specified, or grew past a quick fix: offer to document it as a change, even after the fact (`buddy start …`), and let the owner choose.

## What this is not
- Not a way around the checks: the commit check, the tests and the standards stay.
- Not talking to Dev: in vibe the owner still talks with Buddy.
- A long technical session is better in a separate window (`claude --agent buddy:dev`); say so if the work turns out to be long.
