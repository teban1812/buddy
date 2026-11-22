// The script of a milestone's review, like the demonstration of a sprint review (the owner's picture of the end of a milestone): what was promised and what was
// delivered, the order to try the changes, and for each one what it is for, how to try it, what to see and what the checks found. It is made from the records, so it
// always says the same; acceptance stays per change, and what the owner notices while trying becomes a new request.
import { buildIndex, inputs as recordInputs } from './index.mjs';
import { suiteGreen } from './evidence.mjs';
import { validateCommand } from './proc.mjs';

const DONE = ['delivered', 'accepted'];
const label = { delivered: 'delivered, waits for you', accepted: 'accepted', rework: 'sent back to rework', building: 'still being built', blocked: 'blocked', ready: 'ready, not started', refining: 'still being refined' };

export function milestoneReview(repo, id, { index, now = new Date() } = {}) {
  const x = index ?? buildIndex(repo);
  const m = x.milestones.find(r => r.id === id); if (!m) throw new Error(`there is no milestone ${id}${x.milestones.length ? `; they are: ${x.milestones.map(r => r.id).join(', ')}` : ''}`);
  const all = x.changes.filter(r => r.milestone === id && !r.change); const changes = all.filter(r => r.status !== 'abandoned'); const abandoned = all.filter(r => r.status === 'abandoned');
  const delivered = changes.filter(r => DONE.includes(r.status)); const left = changes.filter(r => !DONE.includes(r.status));
  const o = [`REVIEW  ${m.title} [${m.id}]  ·  ${left.length ? 'NOT READY: some changes are not delivered' : 'every change is delivered'}`, ''];
  o.push('What you asked for:', `  ${m.request ?? '(no goal written)'}`, '');
  o.push('Promised and delivered:', `  ${delivered.length} of ${changes.length} change${changes.length === 1 ? '' : 's'} delivered or accepted.`);
  if (left.length) o.push(`  Not delivered (${left.length}): ${left.map(r => `${r.title} [${r.id}], ${label[r.status] ?? r.status}`).join('; ')}.`);
  if (abandoned.length) o.push(`  Abandoned: ${abandoned.map(r => `${r.title} [${r.id}]`).join('; ')}.`);
  if (validateCommand(repo)) { const g = suiteGreen(repo, recordInputs(repo).evidence, { now }); o.push(g.ok ? `  The whole test suite is green on the code as it is now (run ${String(g.when ?? '').slice(0, 16).replace('T', ' ')} UTC${g.slice ? ` while checking ${g.slice}` : ''}).` : `  The whole test suite has NOT been shown green on the code as it is now (${g.why}): run buddy suite before you accept.`); }
  o.push('', delivered.length ? `Order to try them (${delivered.length}):` : 'Nothing to try yet.');
  const buildsOn = c => [...new Set([...(c.depends_on || []), ...(c.waits_for || []).map(w => w.id)])].map(i => x.changes.find(r => r.id === i)?.title).filter(Boolean);   // what it was built on, so it is tried after it
  delivered.forEach((c, i) => o.push(`  ${i + 1}. ${c.title} [${c.id}]  ·  ${label[c.status]}${buildsOn(c).length ? `  ·  builds on ${buildsOn(c).join(', ')}: try that first` : ''}`));
  delivered.forEach((c, i) => {
    const pieces = x.changes.filter(r => r.change === c.id); const records = [c, ...pieces];
    o.push('', `${i + 1}. ${c.title} [${c.id}]  ·  ${label[c.status]}`, `   For what: ${c.request ?? '(no request written)'}`);
    if (c.status === 'accepted') { o.push(`   You accepted it${c.data?.accepted?.at ? ` on ${c.data.accepted.at.slice(0, 10)}` : ''}.`); return; }
    o.push('   How to try it:');
    let any = false;
    for (const r of records) for (const k of r.data?.criteria || []) {
      any = true; const h = (r.data.howto || []).find(h => h.criterion === k.id);
      o.push(`     ${k.id}  ${k.text}`, h ? `          do:  ${h.steps}\n          see: ${h.expect}` : '          (nobody wrote how to try it: ask Buddy for it)');
    }
    if (!any) o.push('     (the change has no acceptance criteria written)');
    const excl = records.flatMap(r => r.data?.excludes || []); if (excl.length) o.push(`   Not included: ${excl.map(e => e.text).join('; ')}`);
    const ev = x.evidence.filter(e => records.some(r => r.id === e.slice)).sort((a, b) => String(a.when).localeCompare(String(b.when))).pop();
    const found = [];
    for (const reason of ev?.reasons || []) found.push(reason);
    for (const r of records) {
      for (const a of r.data?.assumptions || []) found.push(`assumption ${a.id}: ${a.text}${a.status === 'confirmed' ? ' (you confirmed it)' : a.status === 'corrected' ? ' (you corrected it)' : ' (waits for your word)'}`);
      for (const v of r.data?.divergences || []) found.push(`departure from the prototype ${v.id} on ${v.screen}: ${v.built} (${v.status})`);
      for (const u of r.data?.unverified || []) found.push(`screen ${u.screen} was left unverified by you; it is not a pass`);
    }
    const costly = (ev?.unspecified || []).filter(d => d.costly); for (const d of costly) found.push(`a costly decision nobody specified: ${d.text}`);
    o.push('   What the checks found:', ...(found.length ? found.map(f => `     - ${f}`) : [ev ? '     - nothing: every check passed.' : '     - no checkpoint on record.']));
    o.push(`   Answer: buddy move ${c.id} accepted --by owner   ·   or send it back: buddy move ${c.id} rework   ·   the full card: buddy slice accept-card ${c.id}`);
  });
  const next = x.milestones.filter(r => r.id !== id && r.rank > m.rank && !['accepted', 'abandoned'].includes(r.status)).sort((a, b) => a.rank - b.rank)[0];
  o.push('', 'While you try them:', `  Whatever you notice, say it and Buddy keeps it as a request: buddy requests add "<what you noticed>" --source "review of ${m.title}".`);
  o.push(next ? `  When this milestone is closed, the next one is ${next.title} [${next.id}]: Buddy presents it with buddy milestone card ${next.id} and starts it only with your go-ahead.` : '  There is no next milestone yet.');
  return o.join('\n') + '\n';
}
