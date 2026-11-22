# Accessibility: WCAG 2.2 AA

## What this is anchored to
WCAG 2.2 Level AA, plus whatever the project's standards (`docs/standards/`) say about accessibility. Check in calibration whether a rule the standards call automatic has a check behind it that can turn red (an axe or similar step in the project's checks). If a rule is written as automatic and nothing enforces it, say so in the report: a requirement nobody can see fail is the surest one to rot, and section 1 below is then its only mechanism, run by hand.

**Measure, never estimate.** Every criterion below has a snippet or a key to press. A contrast finding without a ratio, or a target-size finding without pixels, will be argued away.

## 1. Automated first pass (axe-core)
Do it first on every screen: it clears the mechanical part so your attention goes to what no tool sees. Inject it with the browser's JavaScript tool (a local server usually sets no policy that blocks it):

```js
// Load once per page, then run. Re-run after opening a dialog or a panel: axe only sees the current page.
await new Promise((res, rej) => {
  if (window.axe) return res();
  const s = document.createElement('script');
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js';
  s.onload = res; s.onerror = rej;
  document.head.appendChild(s);
});
const r = await axe.run(document, { resultTypes: ['violations'] });
console.log(r.violations.map(v =>
  `[${v.impact}] ${v.id}: ${v.help}\n  ${v.nodes.length} node(s): ` +
  v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')
).join('\n\n') || 'axe: no violations');
```

- Re-run **with every dialog, panel and menu open**: the most serious violations live in what only exists while open.
- axe's `impact` is not the report's severity: translate it through `report-format.md`. A serious violation on a screen nobody reaches matters less than a moderate one on the main flow.
- axe finding nothing means the mechanical layer is clean, not that the screen is accessible. Sections 2 to 8 are where the real findings are.

## 2. Contrast (1.4.3 text 4.5:1, large text 3:1; 1.4.11 non-text 3:1)

```js
// Every text node's measured contrast against its effective background.
// Handles two things a naive version gets wrong, each a flood of false failures:
//   1. `color(srgb r g b / a)`, what browsers return for color-mix(), whose channels are 0-1 floats.
//   2. Translucent backgrounds, composited down the ancestor chain to the first opaque layer.
const parse = c => {
  if (!c) return null;
  const m4 = c.match(/color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?/i);
  if (m4) return { rgb: [1, 2, 3].map(i => Math.round(parseFloat(m4[i]) * 255)), a: m4[4] !== undefined ? parseFloat(m4[4]) : 1 };
  const m = c.match(/[\d.]+/g);
  if (!m) return null;
  return { rgb: m.slice(0, 3).map(Number), a: m.length > 3 ? parseFloat(m[3]) : 1 };
};
const lum = c => {
  const p = parse(c); if (!p) return 1;
  const [r, g, b] = p.rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const bgOf = el => {
  const layers = [];
  for (let n = el; n; n = n.parentElement) {
    const p = parse(getComputedStyle(n).backgroundColor);
    if (!p || p.a === 0) continue;
    layers.push(p);
    if (p.a === 1) break;                       // the first opaque layer ends the stack
  }
  if (!layers.length || layers[layers.length - 1].a < 1) layers.push({ rgb: [255, 255, 255], a: 1 });
  let out = layers[layers.length - 1].rgb;      // composite back to front
  for (let i = layers.length - 2; i >= 0; i--) {
    const { rgb, a } = layers[i];
    out = out.map((v, k) => Math.round(rgb[k] * a + v * (1 - a)));
  }
  return `rgb(${out.join(', ')})`;
};
const out = [];
document.querySelectorAll('body *').forEach(el => {
  const t = el.textContent?.trim();
  if (!t || el.children.length || !el.offsetParent) return;
  const s = getComputedStyle(el);
  const px = parseFloat(s.fontSize);
  const large = px >= 24 || (px >= 18.66 && +s.fontWeight >= 700);
  const bg = bgOf(el);
  const [a, b] = [lum(s.color), lum(bg)].sort((x, y) => y - x);
  const ratio = (a + 0.05) / (b + 0.05);
  const need = large ? 3 : 4.5;
  if (ratio < need) out.push(`${ratio.toFixed(2)}:1 (needs ${need}) ${px}px ${s.color} on ${bg} - "${t.slice(0, 45)}"`);
});
console.log(out.length ? [...new Set(out)].join('\n') : 'contrast: all text passes AA');
```

Then by hand, what the snippet cannot reach:
- **Non-text (1.4.11, 3:1)**: focus indicators, input borders, icons that carry meaning, status colours, the separators a table needs to stay readable.
- **Regions that stay dark in a light page** (a sidebar, a toolbar): light-theme text tokens meet a dark surface there. Measure the badges and labels inside them separately.
- **Placeholder text**, routinely the lightest thing on a form and routinely failing.
- **Disabled controls** are exempt from 1.4.3; but if disabled is the app's main way of saying "not yet", illegible disabled text is still a usability finding (`heuristics.md` section 3).
- **Every theme.** If the app has a dark theme, re-run with it applied. A dark block that overrides the neutrals but not the state colours leaves those on a different background: measure them separately.

**When a failing colour comes from the prototype**, it is a conflict between the prototype and WCAG: report it with the measured ratio and the token or colour, rated by its cost to the user (the golden rule in `SKILL.md`). Do not present a new colour as a bug fix; offering one as an option for the owner is fine. **In the prototype mode it is simply the finding**: the prototype can still change, so a failing colour is a defect to fix before Dev builds it.

## 3. Keyboard (2.1.1, 2.1.2, 2.4.3, 2.4.7, 2.4.11)
Put the mouse down. Everything below with the keyboard only:
- **Reach every interactive element with Tab.** Anything clickable that never takes focus fails 2.1.1, most often a `div` or `span` with a click handler.
- **Focus order follows visual order** (2.4.3). Tab through and write the sequence.
- **Focus is always visible** (2.4.7): watch for `outline: none` with nothing in its place, and for focus rings that vanish against their background (measure per section 2).
- **Focus is never hidden** (2.4.11) behind a sticky header, footer or toolbar.
- **No keyboard trap** (2.1.2): you can always Tab back out.
- **Escape closes** any dialog, panel or menu, and returns focus to what opened it.
- **Enter and Space activate** what looks activatable, custom controls included.

```js
// Focus order as the browser will walk it.
console.log([...document.querySelectorAll(
  'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"]),[contenteditable]'
)].filter(el => el.offsetParent && !el.disabled)
  .map((el, i) => `${i + 1}. <${el.tagName.toLowerCase()}> ${(el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || '').trim().slice(0, 40)}`)
  .join('\n'));
```

## 4. Dialogs, panels and overlays
For **every** `role="dialog"` or `role="alertdialog"`:
1. Focus **moves into** it when it opens.
2. Focus is **trapped** while it is open: Tab from the last element returns to the first and never reaches the page behind.
3. Escape closes it.
4. Focus **returns** to the trigger on close (lost to the page body, it sends a keyboard user back to the top).
5. `aria-modal="true"` **and** an accessible name (`aria-labelledby` pointing at a real id).
6. The page behind is inert, not just covered: verify by tabbing, not by looking.
7. The page behind does not scroll while it is open.

Each is checked and broken on its own: report them separately, not as one "the dialog is not accessible".

## 5. Structure and semantics (1.3.1, 2.4.6, 4.1.2)
- **Heading outline**: one `h1` per screen, no skipped levels, headings that describe their section.
  ```js
  console.log([...document.querySelectorAll('h1,h2,h3,h4,h5,h6')]
    .map(h => `${'  '.repeat(+h.tagName[1] - 1)}${h.tagName} ${h.textContent.trim().slice(0, 60)}`).join('\n'));
  ```
- **Landmarks**: `header`, `nav`, exactly one `main`, `footer`. With no `main`, a screen-reader user cannot skip the chrome.
- **Tables**: a real `<table>` with `<th scope>`, or, built from `div`s, the full ARIA grid pattern. Half of either is worse than both.
- **Every control has an accessible name**; icon-only buttons are the usual offenders.
  ```js
  console.log([...document.querySelectorAll('button,a[href],input,select,textarea')]
    .filter(el => el.offsetParent)
    .filter(el => !(el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') ||
      el.textContent.trim() || el.labels?.length || el.getAttribute('title')))
    .map(el => `UNNAMED <${el.tagName.toLowerCase()}> ${el.outerHTML.slice(0, 90)}`).join('\n') || 'all controls named');
  ```
- **Labels are associated** (`<label for>` or wrapping): a text next to an input is not its label.
- **State is exposed, not only drawn**: `aria-expanded`, `aria-selected`, `aria-current`, `aria-checked` where they apply.
- **Live regions**: what appears later and matters (a toast, an inline error, a result count) needs `role="alert"`, `role="status"` or `aria-live`, or a screen-reader user never learns it happened.
- **Language**: `<html lang>` matches the copy rendered; Spanish copy under `lang="en"` is read aloud with the wrong sounds.

## 6. Target size (2.5.8, at least 24 by 24 CSS px)

```js
console.log([...document.querySelectorAll('button,a[href],input[type=checkbox],input[type=radio],[role=button]')]
  .filter(el => el.offsetParent)
  .map(el => ({ el, r: el.getBoundingClientRect() }))
  .filter(({ r }) => r.width < 24 || r.height < 24)
  .map(({ el, r }) => `${Math.round(r.width)}x${Math.round(r.height)} - ${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40)}`)
  .join('\n') || 'target size: all >= 24x24');
```

The exceptions (links inside a sentence, targets with enough spacing) apply: use them honestly instead of reporting every inline link.

## 7. Forms and errors (3.3.1 to 3.3.4, 3.3.7)
- Errors are **identified in text**, not by colour or a red border alone (3.3.1).
- Every input has a **persistent visible label**: a placeholder that vanishes on typing is not one (3.3.2).
- Error messages **suggest the correction** when the system can know it (3.3.3).
- Legal, financial or data-destroying submissions are reversible, checked or confirmed (3.3.4).
- **Redundant entry** (3.3.7): the app does not ask again for what it already has in the same process.

## 8. Reflow, zoom and motion (1.4.4, 1.4.10, 1.4.12, 2.3.3)
- **Zoom to 200%** (1.4.4): no content or function lost.
- **Reflow at 320 CSS px** (1.4.10): no horizontal scrolling for content. If the project decided not to support narrow screens (its stylesheet declares no breakpoints, and a comment or a decision says so), report it **once, at the app level**, as a Decision finding with the measurement, rated by what it costs the users the context names; not per screen.
- **Text spacing** (1.4.12): force `line-height: 1.5`, `letter-spacing: .12em`, `word-spacing: .16em` and `margin-bottom: 2em` on paragraphs; nothing may clip or overlap.
- **Motion** (2.3.3): respect `prefers-reduced-motion`; verify with the browser's emulation, not by reading the CSS.
