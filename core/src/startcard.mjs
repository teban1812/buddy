// The card Buddy presents before a milestone starts (the owner's go-ahead is recorded by moving it to building): what it will build and in what order, the doubts
// that wait for the owner, and the assumptions Buddy made. It is made from the records, not from Buddy's narration, so the owner always sees the same things.
import { buildIndex } from './index.mjs';

const named = (x, id) => { const r = x.changes.find(c => c.id === id); return r ? `${r.title} [${r.id}]` : id; };
const optionLabel = (q, id) => (q.options || []).find(o => o.id === id)?.label ?? null;

export function milestoneCard(repo, id, { index } = {}) {
  const x = index ?? buildIndex(repo);
  const m = x.milestones.find(r => r.id === id); if (!m) throw new Error(`there is no milestone ${id}${x.milestones.length ? `; they are: ${x.milestones.map(r => r.id).join(', ')}` : ''}`);
  const changes = x.changes.filter(r => r.milestone === id && !r.change && r.status !== 'abandoned');
  const mine = new Set(changes.map(c => c.id));
  const o = [`START  ${m.title} [${m.id}]  ·  ${m.status === 'building' ? 'already building' : 'waits for your go-ahead'}`, ''];
  o.push('You asked for:', `  ${m.request ?? '(no goal written)'}`);
  if ((m.criteria || []).length) o.push('', 'It is done when:', ...m.criteria.map(c => `  ${c.id}  ${c.text}`));
  if ((m.excludes || []).length) o.push('', 'It does not include:', ...m.excludes.map(c => `  ${c.id}  ${c.text}`));
  o.push('', changes.length ? `What I will build, in this order (${changes.length} change${changes.length === 1 ? '' : 's'}):` : 'There is no change in this milestone yet: nothing to build until it has some.');
  changes.forEach((c, i) => {
    const screens = c.data?.screens || []; const waits = (c.waits_for || []).map(w => w.title);
    o.push(`  ${i + 1}. ${[c.priority ? `[${c.priority}] ` : '', c.title, ` [${c.id}]`].join('')}  ·  ${[c.kind, `${(c.criteria || []).length} criteria`, screens.length ? `covers ${screens.join(', ')}` : null, waits.length ? `waits for ${waits.join(', ')}` : null, c.status === 'refining' ? 'still being refined' : null].filter(Boolean).join(' · ')}`);
  });
  // the doubts: open questions of these changes, the ones that stop the work first
  const qs = x.batches.filter(b => mine.has(b.slice)).flatMap(b => b.questions.filter(q => q.status === 'open').map(q => ({ q, change: b.slice }))).sort((a, b) => Number(b.q.blocking) - Number(a.q.blocking));
  o.push('', qs.length ? `Doubts I need you to resolve (${qs.length}, ${qs.filter(e => e.q.blocking).length} stop the work):` : 'Doubts: none open.');
  for (const { q, change } of qs) {
    const d = q.blocking ? 'nothing of it is built until you answer' : `I go on with ${optionLabel(q, q.default ?? q.recommended) ?? 'the default'} unless you say otherwise`;
    o.push(`  - ${named(x, change)}: ${q.situation}  (${d})`);
  }
  // the assumptions Buddy made: announced for each change, and the defaults it took for questions nobody answered
  const ass = changes.flatMap(c => (c.assumptions || []).map(a => ({ c, a })));
  const defaults = x.batches.filter(b => mine.has(b.slice)).flatMap(b => (b.assumed_defaults || []).filter(d => d.status !== 'confirmed').map(d => ({ change: b.slice, d })));
  // an empty list means studied with nothing to assume; no list, not studied yet (a change already delivered or accepted is past that)
  const none = changes.filter(c => Array.isArray(c.data?.assumptions) && !c.data.assumptions.length);
  const unstudied = changes.filter(c => !Array.isArray(c.data?.assumptions) && !['delivered', 'accepted'].includes(c.status));
  o.push('');
  if (ass.length || defaults.length) o.push(`What I assumed, and will build on unless you correct it (${ass.length + defaults.length}):`);
  else if (!none.length && !unstudied.length) o.push('Assumptions: none announced.');
  for (const { c, a } of ass) o.push(`  - ${c.title}: ${a.text}${a.if_otherwise ? `  (if it is not so: ${a.if_otherwise})` : ''}${a.status === 'confirmed' ? '  [you confirmed it]' : a.status === 'corrected' ? '  [you corrected it]' : ''}`);
  for (const { change, d } of defaults) o.push(`  - ${named(x, change)}: ${d.text ?? d.default ?? JSON.stringify(d)}  (an answer nobody gave)`);
  if (none.length) o.push(`Studied, nothing to assume: ${none.map(c => c.title).join(', ')}.`);
  if (unstudied.length) o.push(`Not studied yet, so their assumptions are still to come (${unstudied.length}): ${unstudied.map(c => `${c.title} [${c.id}]`).join(', ')}.`);
  o.push('', m.status === 'building' ? 'Already building: this is what is being built.' : qs.some(e => e.q.blocking) ? 'Answer the doubts that stop the work, say what you correct, and then give the go-ahead.' : 'Say "yes" to start, or answer a doubt or correct an assumption first. Nothing is built until you do.');
  return o.join('\n') + '\n';
}
