# Safe environment

The audit runs against the app on this machine with its local data, never anything shared. The risk is not leaking someone's data; it is leaving the local data in a state that misleads the next session. This protocol exists for that.

## 1. How to start, stop and reset
Read it in the project's `CLAUDE.md`: the command that starts the app, the one that stops it, and the one that resets its local data to a clean baseline. Use those, as written; do not invent others. If `CLAUDE.md` does not say, ask the owner once and suggest they add it there; never guess a command that could touch a shared database.

## 2. Known baseline, then start
Reset the local data first, unless you know exactly what it holds and need it (rare; when in doubt, reset). Start the app, read the address it prints rather than assuming a port, and wait until it answers before opening a tab. If the port is taken by what looks like a real session, ask before stopping it.

## 3. Two identities
Ownership (one user reaching another's data) is the invariant most worth breaking, and it needs two distinct identities. How the project gets them in development is its own (a seeded user, a persona switch, a header): read it in `CLAUDE.md`, the standards and the base application's docs. If the project brings a script that seeds development users, use it instead of inventing them. Use two identities with different roles or ownership on purpose.

## 4. Seeding edge cases (expected, not a fallback)
Testing empty, one and many, or a specific state (overdue, flagged, near expiry) means creating that data on purpose.
- **Prefer the app's own way in**: create through the UI or its API with the test identity. That gives the data the real shape and side effects (history entries, computed fields).
- **Write to the local database directly only** for what has no way in (what a background job or an import produces).
- **Check a hand-written value before trusting it**: create one equivalent record through the app, read it back with the database's own tool, and match its shape (identifier case, date encoding, enum form). A hand-typed value that silently never matches is how a seeding mistake gets reported as a bug.
- Respect what the code enforces even if the schema does not.
- If a hand-seeded case behaves oddly (an empty list, a 404), reproduce it with data made only through the app before you report it.

## 5. Security probes: local and bounded
Requests made to fail (no session, another identity's resource, invalid payloads) are safe only under these limits:
- **Only the local app** started in step 2, never a shared or deployed address, not even "one request".
- **Bounded**: a rate-limit proof is the documented threshold plus one to three requests; a timing comparison three to five per variant. No loops, no load.
- **No real credentials or secrets**: the development identities and placeholder values only. A probe that would need a real one is recorded as "not verified: needs the owner".
- **Nothing left behind**: step 6 clears it; if the project keeps throttling or lockout state somewhere else, clear it too and say so.

## 6. Clean up, always
Stop what you started and reset the local data to the baseline, even when the run ended in error. If either fails, tell the user plainly instead of leaving it silently.
