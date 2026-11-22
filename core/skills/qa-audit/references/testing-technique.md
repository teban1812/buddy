# Testing technique

A toolbox, not a script. For each screen pick what applies: a read-only screen has little use for a double submit, a form-heavy one does. Your hunch decides where to look closer; this decides what to do once you look.

## The change's own borders
- Each **criterion**: try it as the owner would, then try to make it false (the input it did not foresee, the order it did not expect).
- Each **exclusion**: check the change stops cleanly at the border; a half-built excluded feature that breaks something in scope is a finding.
- Each **confirmed assumption**: does the app behave as the owner was told it would?
- Each **declared departure** from the prototype: does the built version reach the same goal? Each screen the change covers: any **undeclared** departure (a changed flow, a missing function, a fixed text changed) is a finding. Differences of colour, spacing or wording that change no flow are not.
- What the prototype marks as fake must not be built as if real, nor left fake where the criteria ask for it real.

## Forms and inputs
- **Boundary values**: zero, negatives, more decimals than the domain allows, extreme dates, text where a number is expected and the reverse.
- **Required fields empty**, **excessive length**, **unicode, emoji and special characters**.
- **Double submit**: does it create the record twice?
- **Leave before the response lands**: is the form left inconsistent?

## The stuck selector (call it by name)
A field that should show a readable label for a related record (an owner, a category) and instead shows a raw identifier, spins forever or stays empty is not cosmetic: the lookup never resolved, or was never wired. Default severity **High**. Check every field that refers to another record, and confirm in the network log that the lookup call happens and resolves.

## States
- **Empty**: a real empty state, or a broken layout?
- **One and many**: does it paginate, or choke?
- **Network error**: force one (stop the backend, trigger a 4xx or 5xx); does the screen say so, or fail silently?
- **Slow load**: a loading state, or a flash of empty that looks like a bug?

## Navigation
Browser back mid-flow; refresh mid-flow (is progress lost without warning?); a direct link to an inner address; two tabs on the same record, edit in one (is the other stale with no sign?).

## Visual consistency
Compare against the prototype's screen. If the app has several themes, repeat key screens in each, with attention to contrast on flagged or negative values. A value that looks hard-coded instead of the design's token is worth a note for the code review to confirm.

## Business rules
Start from what the context and the standards say matters (money, personal data, access, history) and add what the change's real surface touches. A risk the change under-estimated is itself a finding.
- **Ownership**: with the two identities, try to reach the other's record by its identifier (edit the address, call the API with a borrowed id). Expect a refusal, never the other's data.
- **Sensitive actions**: when an action is one the project treats as sensitive (an approval, a deletion, a role change), check the confirmation the criteria ask for fires, and that it really leaves the entry in whatever history the app shows.
- **Fields exposed**: on a list or detail response, check the body carries no field it should not.

## Console and network
On every screen, before the next: no unhandled error in the console (an expected warning is not a finding), and no 4xx or 5xx in the network log that the screen did not surface to the user.

## Data lifecycle
For each main record: create, edit, delete, refresh, and confirm it persisted or was really deleted. After each change, do totals and counters recompute, or stay stale until a refresh?

## Security cases
What to check comes first from the project's standards and the normative documents they cite; a library may also bring its organisation's own security review as a saved prompt, which this audit does not replace. Generic probes, fired from the app's own tab (a `fetch` in the page), within the limits of `safe-environment.md`:
- **No session**: call an API path without the session or its header; expect a refusal (401), never data.
- **Another identity's record**: as one identity create it, switch to the other, call read and each change on its id; expect a refusal. Data returned is **Critical**. A "not found" where the standards ask for "forbidden", with nothing leaked, is a source conflict to cite.
- **A well-formed id that does not exist**: expect not found; a malformed one: a validation error, never a 500.
- **A rule violated**: the payload the screen would never send (too long, out of range, missing field). Read the error body for stack traces, type names, queries or file paths.
- **Headers**: read the response headers of the page and of one API call against what the standards ask.

Prefer reading the project's automated security tests first; the live probe confirms them on the running app and finds what they miss. Record both.
