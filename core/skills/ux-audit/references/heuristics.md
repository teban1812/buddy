# Usability, hierarchy and legibility

A toolbox, not a script. Pick what applies: a dense list and a multi-step form fail in completely different ways. Each item says what to look at **and how to establish it**, because the difference between an audit and an opinion is whether the finding survives someone disagreeing with it. Name, in each finding, the ISO 9241-110 principle or the heuristic it breaks.

## 0. First impression (before analysing anything)
Open the screen and, within five seconds, answer in writing:
- What is this screen for?
- What is the single most important thing on it?
- What am I supposed to do next?

If you cannot answer all three, that **is** the finding, and it outranks everything else on that screen. Write down what you *thought* the answer was before you learned the screen: that first wrong guess is evidence you cannot reproduce once you know the app.

Then the sharper version: **would the role this screen is for answer the same way?** A reader opening a screen full of actions they can never use is looking at a different screen than the one its builder saw.

## 1. Visual hierarchy and layout (self-descriptiveness, suitability for the task)
- **Does importance match prominence?** The most consequential item (something overdue, an expiring approval, a blocked action) should be the most visually dominant. Rank the elements by visual weight, rank them by business importance, compare the two lists. The divergence is the finding.
- **Scanning path.** Squint, or blur the screenshot. What survives is what a real user sees in their first second. If a decorative card outranks the data, say so.
- **Grouping.** Related things grouped (proximity, a shared container or background), unrelated things apart. Fields of one decision split across two cards cost a round trip of attention every time.
- **Alignment and rhythm.** Uneven gutters, labels aligned three ways in one form, cards of unequal padding: each trivial, together the difference between a product and an assembled screen.
- **Whitespace under pressure.** Check at realistic volume: density that reads fine at 3 rows can be unusable at 40.
- **Actions where the hand is.** The main action found without hunting; the destructive one not next to the one people click most.

## 2. Legibility and information density
- **The type scale actually in use.** Collect every size and weight rendered on the screen. More than about five sizes on one screen usually means decorative rather than structural hierarchy; two sizes 1px apart means an accident.

  ```js
  // Every distinct size/weight/color combination actually rendered, with a sample and a count.
  const seen = new Map();
  document.querySelectorAll('body *').forEach(el => {
    if (!el.textContent?.trim() || el.children.length) return;
    const s = getComputedStyle(el);
    const key = `${s.fontSize} / ${s.fontWeight} / ${s.color}`;
    if (!seen.has(key)) seen.set(key, { count: 0, sample: '' });
    const v = seen.get(key);
    v.count++;
    if (!v.sample) v.sample = el.textContent.trim().slice(0, 40);
  });
  console.log([...seen.entries()].map(([k, v]) => `${k}  x${v.count}  "${v.sample}"`).join('\n'));
  ```

- **Line length.** Body text beyond about 90 characters a line is measurably harder to read. Measure it.
- **Truncation.** Anything cut with an ellipsis: is the full value reachable (a tooltip, a detail view) or lost? A truncated identifier the user must copy is worse than a wrapped one.
- **Numbers and dates.** Aligned for comparison (right-aligned, tabular figures) or ragged? Dates in a format unambiguous for this audience, and the same on every screen?
- **Raw values leaking through.** Internal identifiers, enum member names (`InProgress`, `ExternalVendor`), ISO timestamps, `null`, `undefined`, `NaN`, `[object Object]`. Any of these in front of a user is a finding, however it got there.
- **Empty is not blank.** An empty state that only says there is nothing, without saying what to do about it, wastes the moment the user is most open to guidance.

## 3. Feedback, error prevention and recovery (controllability, use-error robustness)
- **Every action acknowledges itself.** Within about 100 ms something changes (a pressed state, a spinner, a disabled button). Silence reads as "it did not register" and produces the double click that creates two records.
- **Destructive actions are recoverable or confirmed**, and the confirmation names *what* is destroyed: "are you sure?" with no object name is confirmed without reading.
- **Errors say what to do next**: they name the field, the reason and the remedy. One that does none is a developer's exception wearing a UI.
- **Errors appear where the problem is.** A banner at the top of a long form for a field 40 lines down makes the user hunt for their own mistake.
- **Prevention beats messaging.** A constraint the system already knows (a reason required in some case, a date that must be in the future) belongs in the control (disabled, constrained, defaulted), not in a rejection after submitting.
- **Loss of work.** Navigate away mid-form, press Back mid-flow, refresh. Is there a guard, and is it honest about what will be lost?
- **State after the action.** After success, is the user where they need to be, with the result visible? A list that does not show a change until a manual refresh teaches people to distrust the app.
- **A disabled button as the only validation.** Disabled with no visible reason is a dead end: the user cannot tell what is missing.

## 4. Recognition over recall (self-descriptiveness, learnability)
- Does the app ever make the user **remember** something it already knows? An identifier to paste, a name to retype, a value from the previous step not shown in this one.
- Are codes shown **without** their human label?
- In a multi-step flow, can the user see what they entered earlier without losing their place?
- Are the values in lists self-explanatory to the role using them, or do they assume the vocabulary of whoever modelled the domain?

## 5. Consistency (conformity with user expectations; the whole app's richest pass)
These are the findings a per-screen pass cannot see, and the likeliest to be real: two changes built apart, each coherent, that disagree. Check side by side:
- **The same entity, two names** (one screen's "Supplier", another's "Vendor").
- **The same action, two affordances** (a button here, a link there, an icon elsewhere).
- **The same state, two treatments** (a coloured pill on one screen, plain text on another).
- **The same date, two formats**; the same person once as a name and once as an account.
- **Language.** Copy in the product's language is the convention (calibration tells you which); two languages on one screen is not. Watch the **shared** layer: a menu, an empty state or a confirmation dialog in one language renders inside every screen written in the other. If translation is planned, say so once rather than per screen.
- **Page skeletons.** Do lists share a structure (title, filters, table, pagination in the same places) or does each invent its own?
- **Interaction grammar.** If editing is a side panel on one screen and a full page on another, is there a reason a user could infer?

## 6. Information architecture and the cost of a task (efficiency)
For each main job the app supports:
- **Count the cost.** Screens visited, clicks, fields typed and, the one people forget, **pieces of knowledge the user had to bring that the app already had**. Write it as numbers: `4 screens / 11 clicks / 2 values retyped` is a finding a reader can act on; "the flow feels long" is not.
- **Is the entry point where the user would look?** A task starts from the screen where its need becomes visible, not after navigating somewhere else.
- **Dead ends.** A screen from which the obvious next step is not reachable, especially after an error or an empty state.
- **Navigation honesty.** Does the menu show where you are? Does Back do what a user expects? Can the user always tell which scope or context they are working in, without opening a menu?

## 7. Defaults worth checking in any web front end
- **Hand-built dialogs and side panels**: where focus traps, Escape, scroll locking and focus return go missing. Every `role="dialog"` or `role="alertdialog"` gets the full treatment of `accessibility.md` section 4.
- **Tables built from `div`s**: they look identical and behave differently for keyboard and screen-reader users (`accessibility.md` section 5).
- **Colour as the only signal**: a status or severity told by colour alone fails a colour-blind user and every printed copy of the screen.
