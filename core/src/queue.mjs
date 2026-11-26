// Question queue: create a batch from a spec, show it as cards, record answers with their origin, apply minimal defaults,
// list assumed defaults. Files are markdown with front matter (docs/design/03-schemas-v0.md). The front matter is the source of truth.
import fs from 'node:fs';
import path from 'node:path';
import { parseDocument } from './frontmatter.mjs';
import { dumpDocument } from './yaml.mjs';
import { newId, named } from './ids.mjs';
import { refreshBoardPage } from './board.mjs';

// A question named in a refusal goes with its situation, its id beside it (R78).
const qn = q => named(q.situation, q.id);
// A question that is not in the batch, in plain words, with the questions it has (R78).
const noQuestion = (batch, qid) => `there is no question ${qid} in this batch; its questions are: ${batch.questions.map(qn).join(' | ') || '(none)'}`;

const today = () => new Date().toISOString().slice(0, 10);

export function loadBatchFile(file) {
  if (!fs.existsSync(file)) throw new Error(`there is no question batch at ${file}: a batch is a file such as docs/questions.md`);
  const d = parseDocument(fs.readFileSync(file, 'utf8'));
  if (d.error) throw new Error(`${file}: ${d.error}`);
  if (d.data.schema !== 'buddy/question-batch@0') throw new Error(`${file}: not a question batch`);
  return d.data;
}

// spec: { slice?, round?, raised_by?, because?, questions: [{ situation, because?, blocking?, recommended?, default?, options: [{id?, label, cost}] }] }
export function createBatch(spec, { date = today(), taken = new Set(), rand } = {}) {
  if (!spec.questions?.length) throw new Error('a batch needs at least one question');
  const batch = { schema: 'buddy/question-batch@0', id: newId('B', date, taken, rand), ...(spec.slice ? { slice: spec.slice } : {}), status: 'open', round: spec.round ?? 1, raised_by: spec.raised_by ?? 'intake', ...(spec.because ? { because: spec.because } : {}), created: date, questions: [] };
  for (const q of spec.questions) {
    if (!q.situation) throw new Error('every question needs a situation');
    if (!q.options || q.options.length < 2) throw new Error(`question "${q.situation.slice(0, 40)}" needs at least two options, each with its cost`);
    const options = q.options.map((o, i) => {
      if (!o.label || !o.cost) throw new Error(`option ${i + 1} of "${q.situation.slice(0, 40)}" needs a label and a cost in business terms`);
      return { id: o.id || String.fromCharCode(97 + i), label: o.label, cost: o.cost };
    });
    const blocking = q.blocking ?? false;
    const dflt = q.default ?? (blocking ? undefined : q.recommended ?? options[0].id);
    batch.questions.push({ id: newId('Q', date, taken, rand), situation: q.situation, ...(q.because ? { because: q.because } : {}), blocking, status: 'open', ...(q.recommended ? { recommended: q.recommended } : {}), ...(dflt ? { default: dflt } : {}), options });
  }
  return batch;
}

// `only`: a question id; just that card is printed (the answer to one question does not need the whole batch again), with the status line.
export function cards(batch, { only } = {}) {
  const open = batch.questions.filter(q => q.status === 'open');
  const waiting = open.filter(q => q.blocking).length;
  const out = [];
  if (batch.because) out.push(batch.because, '');
  batch.questions.forEach((q, i) => {
    if (only && q.id !== only) return;
    const tag = [q.blocking ? 'blocking' : 'not blocking (proceeds on the default)', q.status === 'open' ? (q.blocking ? 'waiting for you' : 'open') : q.status].join(' · ');
    out.push(`Q${i + 1} of ${batch.questions.length} (${q.id}) · ${tag}`);
    if (q.because) out.push(`Because ${q.because}`);
    out.push(`Situation   ${q.situation}`);
    q.options.forEach((o, j) => out.push(`${j === 0 ? 'Options     ' : '            '}${o.id}) ${o.label}   cost: ${o.cost}${o.id === q.recommended ? '   <- recommended' : ''}${o.id === q.default && o.id !== q.recommended ? '   <- default' : ''}`));
    if (q.recommended || q.default) out.push(`If you say "your call"   I will use ${q.recommended ?? q.default}) and record it as your delegated decision.`);
    if (q.answer) out.push(`Answer      ${q.answer.option ?? ''} ${q.answer.text ?? ''} (${q.answer.origin}, ${q.answer.at})`);
    out.push('');
  });
  if (batch.assumed_defaults?.length) { out.push('Assumed defaults (nobody decided these; please review):'); batch.assumed_defaults.forEach(d => out.push(`  - [${d.status}] ${d.text}`)); out.push(''); }
  out.push(waiting ? `I am waiting for you on ${waiting} blocking question(s); nothing else will happen until you answer.` : open.length ? 'No blocking question; the work can proceed on the defaults.' : 'All questions are settled.');
  return out.join('\n');
}

export function renderBatchFile(batch) {
  const body = `# Questions before building (round ${batch.round})\n\nGenerated view of the batch above; the front matter is the source of truth. Answer with \`buddy queue answer\`, or by editing the \`answer\` of a question.\n\n\`\`\`text\n${cards(batch)}\n\`\`\`\n`;
  return dumpDocument(batch, body);
}

export function writeBatchFile(file, batch) {
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, renderBatchFile(batch));
  for (let d = path.resolve(path.dirname(file)); ; d = path.dirname(d)) {   // the open board waits on the questions too (live-board): the repository is the nearest folder up that holds the page
    if (fs.existsSync(path.join(d, '.buddy', 'board.html'))) { refreshBoardPage(d); break; }
    if (d === path.dirname(d)) break;
  }
}

function settle(batch) {
  const open = batch.questions.some(q => q.status === 'open');
  const unconfirmed = batch.questions.some(q => q.status === 'assumed') || (batch.assumed_defaults || []).some(d => d.status === 'assumed');
  batch.status = open ? 'open' : unconfirmed ? 'answered' : 'closed';
  return batch;
}

// Records the human's answer. delegated: "your call" -> the recommended (else default) option, origin delegated.
export function answerQuestion(batch, qid, { option, text, delegated = false, at = today() } = {}) {
  const q = batch.questions.find(x => x.id === qid); if (!q) throw new Error(noQuestion(batch, qid));
  if (!['open', 'assumed'].includes(q.status)) throw new Error(`${qn(q)} is already ${q.status}`);
  let opt = option;
  if (delegated) { opt = q.recommended ?? q.default; if (!opt) throw new Error(`${qn(q)} has no recommended or default option to delegate to`); }
  if (opt && !q.options.some(o => o.id === opt)) throw new Error(`${qn(q)}: "${opt}" is not one of ${q.options.map(o => o.id).join(', ')}`);
  if (!opt && !text) throw new Error('an answer needs an option or free text');
  q.status = 'answered'; q.answer = { ...(opt ? { option: opt } : {}), ...(text ? { text } : {}), by: 'human', origin: delegated ? 'delegated' : 'human', at };
  return settle(batch);
}

// The work proceeds on minimal defaults for the open non-blocking questions; they are recorded as assumed by the agent.
export function assumeDefaults(batch, { at = today() } = {}) {
  const applied = [];
  for (const q of batch.questions) if (q.status === 'open' && !q.blocking) {
    if (!q.default) throw new Error(`${qn(q)} is non-blocking but has no default`);
    q.status = 'assumed'; q.answer = { option: q.default, by: 'agent', origin: 'assumed', at }; applied.push(q.id);
  }
  settle(batch); return applied;
}

export function blockingOpen(batch) { return batch.questions.filter(q => q.status === 'open' && q.blocking); }

// The owner reviewed an assumed default: confirmed as it is (origin becomes human) or changed to another option.
export function confirmAssumed(batch, qid, { option, at = today() } = {}) {
  const m = /^(.+)#(\d+)$/.exec(qid);                       // a free-text assumed default: <batch id>#<index>
  if (m) {
    const d = m[1] === batch.id ? (batch.assumed_defaults || [])[Number(m[2])] : null;
    if (!d) throw new Error(`there is no assumed default ${qid} in this batch`);
    if (d.status !== 'assumed') throw new Error(`${named(d.text, qid)} is not an assumed default waiting for you: it is already ${d.status}`);
    d.status = 'confirmed'; d.by = 'human'; d.at = at; return settle(batch);
  }
  const q = batch.questions.find(x => x.id === qid); if (!q) throw new Error(noQuestion(batch, qid));
  if (q.status !== 'assumed') throw new Error(`${qn(q)} is not an assumed default: it is ${q.status}`);
  const opt = option ?? q.answer.option; if (!q.options.some(o => o.id === opt)) throw new Error(`"${opt}" is not an option of ${qn(q)}`);
  q.status = 'answered'; q.answer = { option: opt, by: 'human', origin: 'human', at };
  return settle(batch);
}

// The Product Owner says "ok" to everything that was assumed on their behalf in this batch (questions and free-text defaults).
export function confirmAllAssumed(batch, { at = today() } = {}) {
  const ids = [...batch.questions.filter(q => q.status === 'assumed').map(q => q.id), ...(batch.assumed_defaults || []).flatMap((d, i) => (d.status === 'assumed' ? [`${batch.id}#${i}`] : []))];
  for (const id of ids) confirmAssumed(batch, id, { at });
  return ids;
}

export function addAssumedDefaults(batch, texts) {
  batch.assumed_defaults = [...(batch.assumed_defaults || []), ...texts.map(text => ({ text, status: 'assumed' }))];
  return settle(batch);
}

// Everything nobody decided yet: assumed questions and assumed free-text defaults, across batch files.
export const unconfirmedDefaults = files => unconfirmedIn(files.map(f => ({ file: f, batch: loadBatchFile(f) })));
// The same, from batches already read: [{ file, batch }] (the index holds them read, R148).
export function unconfirmedIn(list) {
  const out = [];
  for (const { file: f, batch: b } of list) {
    for (const q of b.questions) if (q.status === 'assumed') out.push({ file: f, batch: b.id, id: q.id, text: `${q.situation} -> ${q.options.find(o => o.id === (q.answer?.option ?? q.default))?.label ?? q.answer?.option ?? q.default}` });
    for (const [i, d] of (b.assumed_defaults || []).entries()) if (d.status === 'assumed') out.push({ file: f, batch: b.id, id: `${b.id}#${i}`, text: d.text });
  }
  return out;
}
