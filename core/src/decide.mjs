// Decision records, written as architecture decision records in MADR 4 (https://adr.github.io/madr/) that an architect reads without Buddy:
// MADR's front matter (status, date, decision-makers, consulted, informed) and sections, with Buddy's own fields beside them (id, the change it
// was taken for, supersedes, rules, built and where). Every record goes to docs/decisions/.
import fs from 'node:fs';
import path from 'node:path';
import { dumpDocument } from './yaml.mjs';
import { newId, named } from './ids.mjs';
import { loadFiles } from './verify.mjs';
import { refreshBoardPage } from './board.mjs';

export const DIR = 'docs/decisions';
const slugOf = t => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
// spec: { title, requested_by, decided_by: 'human'|'agent', slice? (the change it was taken for), supersedes?, questions?, evidence?,
// rules: [{text, origin, confidence?, cite?}], context, options, outcome, reason, drivers?, consequences?, confirmation?, pros_cons?, consulted?, informed?,
// built?, where? }. The program sets id, date, status and decision-makers; each record it supersedes is marked "superseded by <id>". A section
// with nothing to say is left out, never filled.
export function decideV0(spec, cwd = process.cwd(), { date = new Date().toISOString().slice(0, 10), rand } = {}) {
  for (const k of ['title', 'requested_by', 'decided_by', 'rules', 'context', 'options', 'outcome', 'reason']) if (!spec[k] || (Array.isArray(spec[k]) && !spec[k].length)) throw new Error(`missing ${k}`);
  const old = (spec.supersedes || []).map(x => supersedable(cwd, x));        // checked before anything is written
  const dir = path.join(cwd, DIR); fs.mkdirSync(dir, { recursive: true });
  const taken = new Set(fs.readdirSync(dir).map(f => /^(D-\d{4}-\d{2}-\d{2}-[0-9a-f]{4})/.exec(f)?.[1]).filter(Boolean));
  const id = newId('D', date, taken, rand); const some = k => (spec[k]?.length ? { [k]: spec[k] } : {});
  const data = { status: 'accepted', date, 'decision-makers': [spec.decided_by === 'human' ? 'the Product Owner' : 'Buddy'], ...some('consulted'), ...some('informed'),
    schema: 'buddy/decision@0', id, title: spec.title, requested_by: spec.requested_by, decided_by: spec.decided_by, ...some('slice'), ...some('supersedes'), ...some('questions'),
    ...some('evidence'), ...some('built'), ...some('where'), rules: spec.rules };
  const sec = (h, t) => (t ? `${h}\n\n${t}\n\n` : '');
  const body = `# ${spec.title}\n\n${sec('## Context and Problem Statement', spec.context)}${sec('## Decision Drivers', spec.drivers)}${sec('## Considered Options', spec.options)}`
    + `## Decision Outcome\n\nChosen option: ${spec.outcome}, because ${spec.reason}\n\n${sec('### Consequences', spec.consequences)}${sec('### Confirmation', spec.confirmation)}${sec('## Pros and Cons of the Options', spec.pros_cons)}`;
  const f = `${DIR}/${id}-${slugOf(spec.title)}.md`; fs.writeFileSync(path.join(cwd, f), dumpDocument(data, body.trimEnd() + '\n'));
  for (const o of old) fs.writeFileSync(o.p, o.t.replace(/^status: (accepted|in-progress)$/m, `status: superseded by ${id}`));
  refreshBoardPage(cwd);   // the open board counts decisions (live-board)
  return { file: f, id, superseded: old.map(o => o.p) };
}

// The record `id` and its text, when it can be superseded. An old record may be in docs/decisions or in a change folder (the layout before every ADR went to docs/decisions).
function supersedable(cwd, id) {
  const p = loadFiles([path.join(cwd, 'docs')]).find(x => path.basename(x).startsWith(`${id}-`));
  if (!p) throw new Error(`cannot supersede ${id}: there is no decision with that id`);
  const t = fs.readFileSync(p, 'utf8');
  const title = /^title: (.+)$/m.exec(t)?.[1].trim().replace(/^(["'])(.*)\1$/, '$2');   // the decision by its title, its id beside it
  if (!/^status: (accepted|in-progress)$/m.test(t)) throw new Error(`${named(title, id)} is already superseded`);
  return { p, t };
}
