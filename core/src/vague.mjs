// A check of acceptance criteria that cannot be checked (R94; change return-vague-criteria): a fixed list of the common vague words and
// phrases, in English and Spanish. It warns; it never blocks. The program only detects: Buddy writes the checkable wording and the owner
// confirms it. Whole words, any case, accents tolerated; a Spanish adjective also matches its feminine and plural forms. A pure function.

export const VAGUE = [
  'fast', 'quick', 'quickly', 'easy', 'easily', 'simple', 'intuitive', 'user friendly', 'appropriate', 'as appropriate', 'as needed',
  'good', 'nice', 'robust', 'scalable', 'efficient', 'seamless', 'flexible', 'etc', 'TBD', 'TBC',
  'rápido', 'fácil', 'sencillo', 'intuitivo', 'amigable', 'adecuado', 'según corresponda', 'bueno', 'robusto', 'escalable', 'eficiente',
  'flexible', 'por definir',
];

const fold = s => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const forms = w => /^[a-z]+o$/.test(w) ? [w, `${w.slice(0, -1)}a`, `${w}s`, `${w.slice(0, -1)}as`] : /^[a-z]+l$/.test(w) ? [w, `${w}es`] : [w];
// Longest first, so "as appropriate" owns its characters and "appropriate" inside it is not reported again.
const PATTERNS = [...new Set(VAGUE)].sort((a, b) => b.length - a.length).map(w => {
  const alts = forms(fold(w)).map(f => f.split(' ').join('[\\s-]+'));
  return [w, new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts.join('|')})(?![\\p{L}\\p{N}])`, 'gu')];
});

// The vague words of `text`, each once, in the order they appear, as the list writes them.
export function vagueWords(text) {
  const s = fold(text); const found = [];
  for (const [w, re] of PATTERNS) for (const m of s.matchAll(re)) {
    const at = m.index, end = at + m[0].length;
    if (!found.some(f => at < f.end && end > f.at)) found.push({ w, at, end });
  }
  return [...new Set(found.sort((a, b) => a.at - b.at).map(f => f.w))];
}

// One warning per vague criterion: { id, text, words, message }.
export const vagueWarnings = criteria => (criteria || []).map(c => ({ c, words: vagueWords(c.text) })).filter(x => x.words.length).map(({ c, words }) => ({
  id: c.id, text: c.text, words,
  message: `${c.id} "${c.text}" is vague (${words.map(w => `"${w}"`).join(', ')}): propose a checkable wording to the owner (a number, a time, a list, an example)`,
}));
