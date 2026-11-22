import { randomBytes } from 'node:crypto';
// <letter>-<YYYY-MM-DD>-<4 hex> for batches, questions, decisions and findings (a slice is named, below); `taken` is a Set of ids already used so a collision is re-drawn (design question Q2).
export function newId(letter, date = new Date().toISOString().slice(0, 10), taken = new Set(), rand = () => randomBytes(2).toString('hex')) {
  const day = date;
  for (let i = 0; i < 100; i++) { const id = `${letter}-${day}-${rand()}`; if (!taken.has(id)) { taken.add(id); return id; } }
  throw new Error('could not draw a free id');
}

// An id shown to a person travels with the text that says what it is (R78): "Save books [save-books]", "Who may delete? [Q-...]".
// A long text is cut to about 60 characters with an ellipsis; without a text the id is shown alone.
export const clip = (t, max = 60) => { const s = String(t ?? '').replace(/\s+/g, ' ').trim(); return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s; };
export const named = (text, id) => (text ? `${clip(text)} [${id}]` : String(id));

// A slice is named, not numbered (R86): lowercase letters, digits and single hyphens, at most 40 characters (R89), as OpenSpec names its changes.
// The dated form of R56 is still read, so the records written before R86 verify until they are renamed.
// The schemas keep a copy of SLICE_ID (test/schemas.test.mjs keeps them equal).
export const SLICE_NAME = /^(?=.{1,40}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLICE_ID = /^(?=.{1,40}$)(?:[a-z0-9]+(?:-[a-z0-9]+)*|S-\d{4}-\d{2}-\d{2}-[0-9a-f]{4})$/;
export const NAME_RULE = 'lowercase letters, digits and single hyphens, no hyphen at either end, at most 40 characters (add-validate-command)';
const EMPTY = new Set(['and', 'by', 'the', 'of', 'a', 'an', 'to', 'for', 'in', 'on', 'with', 'or']);
// The name Buddy proposes: the title folded to ASCII and lowercase, other characters as hyphens, cut at a word boundary within 40 characters,
// never ending on an empty word (R89). `shortened` says whether words of the title were left out, so `start` can say so.
export function nameFromTitle(title, max = 40) {
  const words = String(title).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const kept = []; for (const w of words) { if ([...kept, w].join('-').length > max) break; kept.push(w); }
  while (kept.length > 1 && EMPTY.has(kept[kept.length - 1])) kept.pop();
  const name = kept.length ? kept.join('-') : (words[0] || '').slice(0, max);
  return { name: name || 'slice', shortened: name !== words.join('-') };
}
