import { TEXT, es, actOf, groupsOf } from '../../claude/hooks/words.js';

// What Antigravity's panel shows, from `buddy board --json`: the same short view as Claude Code's panel (panel/claude/hooks/register.tsx, whose
// reading of the board this follows; core/test/panelantigravity.test.mjs fails when the two drift). It holds no logic of its own beyond that reading.
const pieceOf = (b, id, change) => {
  if (!change) return null;
  const rows = b.slices ?? [];
  const pieces = rows.filter(r => r.change === change).sort((x, y) => (x.rank ?? 0) - (y.rank ?? 0));
  return { title: rows.find(r => r.id === change)?.title ?? change, n: pieces.findIndex(r => r.id === id) + 1, total: pieces.length };
};
const item = (b, id, title, change, status = '') => {
  const steps = (b.slices ?? []).find(r => r.id === id)?.steps;
  return { id, title, of: pieceOf(b, id, change), done: steps?.done ?? 0, total: steps?.total ?? 0, status };
};
const lines = ws => ws.map(w => ({ kind: w.kind, text: w.text, ref: w.ref ?? null, under: lines(w.under ?? []) }));

export const empty = (error, lang) => ({ at: '', lang, current: [], next: null, milestone: null, waiting: [], error });
export function fromBoard(b, lang) {
  const ms = b.milestones ?? [];
  const open = ms.find(m => m.status === 'building') ?? ms.find(m => m.status !== 'accepted') ?? null;
  const n = b.next;
  return {
    at: b.now, lang,
    current: (b.current ?? []).map(c => item(b, c.id, c.title, c.change)),
    discovery: b.discovery ?? null,
    next: !n ? null : n.kind === 'milestone' ? { ...item(b, n.id, n.title, null, 'waits'), label: 'milestone' } : item(b, n.id, n.title, n.change?.id, n.status),
    milestone: open ? { id: open.id, title: open.title, total: open.changes.total, groups: groupsOf(open) } : null,
    waiting: lines(b.view ?? b.waiting ?? []),
    error: null,
  };
}

// What a button writes into the conversation, in the person's words, for Buddy to answer there.
export function ask(w, l) {
  const q = TEXT[l].request;
  const what = w.ref ? `[${w.ref}]` : `«${l === 'es' ? es(w.text) : w.text}»`;
  const v = q[actOf(w)];
  return typeof v === 'function' ? v(what) : v;
}
