// A check of the words in a text meant for the Product Owner (R74, lesson L7 of design/16): it marks file paths, commands, code names and a
// fixed list of technical terms, so Buddy can weigh each one and rephrase it or let it go; and HTML tags (`<br>`, `</b>`), which a terminal
// shows as they are (R148). It warns; it never blocks, because a technical word is sometimes the right one. A pure function of the text.

// The technical terms Buddy's own work uses and the owner does not need; an acronym is matched in capitals only, a word in any case.
export const TERMS = ['slice', 'checkpoint', 'frontmatter', 'front matter', 'schema', 'diff', 'commit', 'merge', 'rebase', 'hook', 'CI', 'lint', 'regex', 'JSON', 'YAML', 'stdin', 'stdout', 'PR'];

const KINDS = { html: 'HTML, which a terminal shows as it is (in a table cell separate the items with " · " or "; ", or use a list under the table)', path: 'a file path', command: 'a command', code: 'a code name', term: 'a technical term' };
// In order: what is found first owns its characters, so a command is not also reported as the path in it, nor a path as the term inside it;
// an HTML tag first of all, so `<div class="x">` is one warning.
const PATTERNS = [
  ['html', /<\/?[A-Za-z][A-Za-z0-9-]*(?:\s+[\w-]+(?:=(?:"[^"]*"|'[^']*'|[^\s<>"']+))?)*\s*\/?>/g],
  ['command', /\b(?:buddy|git|npm|npx)\s+(?:--?)?[a-z][\w-]*/g],
  ['command', /\bnode\s+(?:--?[a-z][\w-]*|\S+\.m?js\b)/g],
  ['path', /(?:\b[A-Za-z]:)?(?:\.{1,2}\/|\b)(?:docs|core|src|bin|test|tests|node_modules|\.git)\/[\w.\/-]*/g],
  ['path', /\b[\w.-]+(?:\\[\w.-]+)+/g],
  ['path', /\b[\w-]+(?:\.[\w-]+)*\.(?:mjs|cjs|js|ts|json|ya?ml|md|cs|csproj)\b/g],
  ['code', /\b[a-z]{2,}[A-Z][A-Za-z0-9]*\b/g],
  ['code', /\b[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+\b/g],
  ...TERMS.map(t => ['term', new RegExp(`\\b${t.replace(/ /g, '[ -]?')}s?\\b`, /[a-z]/.test(t) ? 'gi' : 'g')]),
];

// The warnings for `text`, in the order they appear: { kind, text, at, message }. An empty list means nothing was found.
export function plainWarnings(text) {
  const s = String(text ?? ''); const found = [];
  for (const [kind, re] of PATTERNS) for (const m of s.matchAll(re)) {
    const t = kind === 'path' ? m[0].replace(/\.+$/, '') : m[0];   // a path at the end of a sentence leaves its full stop
    const at = m.index, end = at + t.length;
    if (found.some(f => at < f.end && end > f.at)) continue;
    found.push({ kind, text: t, at, end });
  }
  return found.sort((a, b) => a.at - b.at).map(({ kind, text: t, at }) => ({ kind, text: t, at, message: `${KINDS[kind]}: ${t}` }));
}

// One line per warning, or the line that says the text reads plainly.
export function plainText(warnings) {
  if (!warnings.length) return 'No technical wording found.';
  return [`${warnings.length} word(s) the owner may not know; rephrase each in plain words, or keep it if it is the right one:`, ...warnings.map(w => `  - ${w.message}`)].join('\n');
}
