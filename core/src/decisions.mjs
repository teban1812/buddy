// The decisions of Buddy's own factory and whether each is built (R110): read from docs/requirements-log.md into the index (R138), each
// with its Built state and where. An orphan is a decision with no destination: not built and in no change of the backlog, or a state
// that does not say where (a backlog change that does not exist or was abandoned, a deferral without its reason, a supersession that
// names no decision). Buddy's own suite fails on one (core/test/decisions.test.mjs). Reads only; nothing here writes a record.
import { BUILT } from './index.mjs';
export { BUILT };

const OPEN_CHANGE = r => !r.change && r.status !== 'abandoned';
export function orphans(x) {
  const ids = new Set(x.decisions.map(d => d.id)); const changes = new Map(x.changes.filter(r => !r.change).map(r => [r.id, r]));
  const why = d => {
    if (!d.built) return 'it says nothing of whether it is built';
    if (!BUILT.includes(d.built)) return `"${d.built}" is not a state`;
    if (d.built === 'not built') return 'not built and in no change of the backlog';
    if (d.built === 'backlog') {   // one change, or several separated by commas
      const names = (d.where || '').split(/\s*,\s*/).filter(Boolean); if (!names.length) return 'no change named (none)';
      const missing = names.filter(n => !changes.get(n)); if (missing.length) return `no change named ${missing.join(', ')}`;
      const gone = names.map(n => changes.get(n)).find(c => !OPEN_CHANGE(c)); return gone ? `its change ${gone.id} was abandoned` : null;
    }
    if (d.built === 'superseded') { const by = d.where.match(/\b[RP]\d+\b/g) || []; return !by.length ? 'it does not name the decision that supersedes it' : by.some(i => !ids.has(i)) ? `no decision ${by.filter(i => !ids.has(i)).join(', ')}` : null; }
    if (d.built === 'not applicable') return null;
    return d.where ? null : d.built === 'deferred' ? 'deferred without its reason' : 'it does not say where';
  };
  return x.decisions.map(d => ({ id: d.id, title: d.title, built: d.built, why: why(d) })).filter(o => o.why);
}

// How many decisions are in each state; "not built yet" is what is decided and waits to be built (not built, or in the backlog).
export function decisionTotals(ds) {
  const t = { decided: ds.length }; for (const s of BUILT) t[s] = ds.filter(d => d.built === s).length;
  t.none = ds.filter(d => !d.built).length; t.not_built_yet = t['not built'] + t.backlog; return t;
}
export const decisionsLine = t => `Decisions: ${t.decided} decided, ${t.not_built_yet} not built yet, ${t.partly} partly built (buddy decisions --state "not built")`;
export const decisionsText = ds => (ds.length ? ds.map(d => `${d.id}  ${d.built ?? '(no state)'}  ${d.title}${d.where ? `  · ${d.where}` : ''}`).join('\n') : 'no decisions');
