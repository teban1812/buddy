// buddy view: the story of one change in business terms, as text (for the chat) and as one static HTML page (no external assets).
// Order follows docs/design/04-interaction-spec.md section 5.
import { named } from './ids.mjs';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// How sure we are that the Product Owner accepted: recorded (nothing checks who typed it), signed (a signature with their presence), host (approved on the host by another identity).
export const assuranceText = a => ({ recorded: `recorded${a.channel ? ' via ' + a.channel : ''}, not signed`, signed: `signed${a.channel ? ' via ' + a.channel : ''}`, host: 'approved on the host' }[a.assurance ?? 'recorded']);
export const ORIGIN_LABEL = { human: 'you', delegated: 'your call', assumed: 'assumed', agent: 'agent', repo: 'found in the repo' };

// Things that need the owner: open findings and assumed defaults nobody confirmed.
export function needsOwner(story) {
  const items = [];
  for (const f of story.findings) if (f.status === 'open') items.push({ kind: 'finding', severity: f.severity, text: f.summary });
  for (const b of story.batches) {
    for (const q of b.questions) if (q.status === 'open') items.push({ kind: 'question', severity: q.blocking ? 'blocking' : 'info', text: `Unanswered: ${q.situation} [${q.id}]` });
    for (const q of b.questions) if (q.status === 'assumed') { const o = q.options.find(x => x.id === q.answer?.option); items.push({ kind: 'assumed', severity: 'info', text: `${q.situation} [${q.id}] Assumed: ${o?.label ?? q.answer?.option}.` }); }
    for (const d of b.assumed_defaults || []) if (d.status === 'assumed') items.push({ kind: 'assumed', severity: 'info', text: d.text });
  }
  // Derived facts are computed from the batches. The slice's stored outcome.unconfirmed_defaults is only a fallback for records that have no batches.
  if (!items.some(i => i.kind === 'assumed')) for (const t of story.slice.outcome?.unconfirmed_defaults || []) items.push({ kind: 'assumed', severity: 'info', text: t });
  return items;
}

export const mergeLabel = m => (m ? { merged: `merged into ${m.trunk}`, pending: `waiting to merge into ${m.trunk}`, unknown: 'branch not found here' }[m.state] ?? null : null);

export function summaryText(story, { merge } = {}) {
  const o = story.slice.outcome || {}; const need = needsOwner(story); const out = [];
  out.push(`${story.slice.title} [${story.slice.id}] (${story.slice.status})`);
  const st = story.steps || []; if (st.length) out.push(`Steps: ${st.filter(x => x.done).length} of ${st.length} done`);
  if (story.slice.accepted) out.push(`Accepted by you on ${story.slice.accepted.at.slice(0, 10)} (${assuranceText(story.slice.accepted)})${mergeLabel(merge) ? ` · ${mergeLabel(merge)}` : ''}`);
  if (o.built?.length) out.push('Built:', ...o.built.map(x => `  - ${x}`));
  if (o.left_out?.length) out.push('Left out:', ...o.left_out.map(x => `  - ${x}`));
  if (o.size) out.push(`Size: ${o.size}`);
  out.push(need.length ? `Needs you (${need.length}):` : 'Nothing needs you.', ...need.map(n => `  - [${n.kind}] ${n.text}`));
  return out.join('\n');
}

const badge = o => `<span class="pill o-${esc(o)}">${esc(ORIGIN_LABEL[o] ?? o)}</span>`;

export function renderView(story, { evidence, commits = [], context, merge } = {}) {
  const s = story.slice; const o = s.outcome || {}; const need = needsOwner(story);
  const li = a => (a || []).map(x => `<li>${esc(x)}</li>`).join('');
  const qa = story.batches.map(b => `<h3>Round ${b.round} · ${esc(b.raised_by ?? '')} · ${esc(b.status)}</h3>${b.because ? `<p class="k">${esc(b.because)}</p>` : ''}${b.questions.map(q => {
    const opt = q.options.find(x => x.id === q.answer?.option);
    return `<div class="card"><div class="row"><b>${esc(q.situation)}</b><span class="k">${esc(q.id)}</span></div>${q.because ? `<p class="k">Because ${esc(q.because)}</p>` : ''}
      <ul class="opts">${q.options.map(x => `<li class="${x.id === q.answer?.option ? 'chosen' : ''}">${esc(x.label)} <span class="k">cost: ${esc(x.cost)}</span>${x.id === q.recommended ? ' <span class="pill">recommended</span>' : ''}${x.id === q.answer?.option ? ' ✔' : ''}</li>`).join('')}</ul>
      <p>${q.answer ? `Answer: <b>${esc(opt?.label ?? q.answer.text)}</b> ${q.answer.text && opt ? '— ' + esc(q.answer.text) : ''} ${badge(q.answer.origin)} <span class="k">${esc(q.answer.at)}</span>` : `<span class="pill o-open">${q.blocking ? 'waiting for you' : 'open'}</span>`}</p></div>`;
  }).join('')}${(b.assumed_defaults || []).length ? `<div class="card"><b>Assumed defaults</b><ul>${b.assumed_defaults.map(d => `<li>${esc(d.text)} <span class="pill o-${d.status === 'assumed' ? 'assumed' : 'human'}">${esc(d.status)}</span></li>`).join('')}</ul></div>` : ''}`).join('') || '<p class="k">No questions were asked.</p>';
  const dec = story.decisions.map(({ data: d, body }) => `<div class="card ${String(d.status).startsWith('superseded') ? 'struck' : ''}"><div class="row"><b>${esc(d.title)}</b><span class="pill">${esc(d.status)}</span> ${badge(d.decided_by)}<span class="k">${esc(d.id)} · ${esc(d.date)}</span></div>
    <ul>${(d.rules || []).map(r => `<li>${esc(r.text)} ${badge(r.origin)}${r.cite ? ` <span class="k">${esc(r.cite)}</span>` : ''}</li>`).join('')}</ul>${d.supersedes?.length ? `<p class="k">Replaces ${esc(d.supersedes.map(x => named(story.decisions.find(y => y.data.id === x)?.data.title, x)).join(', '))}</p>` : ''}</div>`).join('') || '<div class="card"><span class="pill bad">none</span> No decision record for this change.</div>';
  const fnd = story.findings.map(f => `<div class="card"><div class="row"><span class="pill sev-${esc(f.severity)}">${esc(f.severity)}</span><b>${esc(f.summary)}</b></div><p class="k">${esc(f.source)} · ${esc(f.class)} · ${esc(f.status)}${f.disposition ? ` · ${esc(f.disposition.by)} ${esc(f.disposition.at)}: ${esc(f.disposition.reason)}` : ''}</p></div>`).join('') || '<p class="k">No findings.</p>';
  const ev = evidence ? `<div class="card"><table><tr><td>validate</td><td class="${evidence.validate_exit === 0 ? 'okc' : 'badc'}">${evidence.validate_exit === 0 ? 'green' : 'red'}</td></tr><tr><td>diff</td><td>${esc(evidence.diff_stat)}</td></tr><tr><td>reviewer</td><td>${esc(evidence.review?.details ?? '')}</td></tr></table><details><summary>raw evidence</summary><pre>${esc(JSON.stringify(evidence, null, 1))}</pre></details></div>` : '<p class="k">No evidence file supplied.</p>';
  const cm = commits.length ? `<div class="card"><table>${commits.map(c => `<tr><td class="k">${esc(c.h)}</td><td>${esc(c.s)}</td></tr>`).join('')}</table></div>` : '<p class="k">No commit trail supplied.</p>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(s.title)} — change story</title><style>
:root{--bg:#fafaf7;--fg:#1d1d1b;--mut:#6b6b66;--card:#fff;--line:#e3e2dc;--ok:#1a7f4b;--warn:#b25e00;--info:#1b5fb4;--bad:#b3261e;--code:#f2f1ec}
@media (prefers-color-scheme:dark){:root{--bg:#161614;--fg:#ecebe6;--mut:#9a9992;--card:#1f1f1c;--line:#34332e;--ok:#4fc08a;--warn:#e5a04a;--info:#7aa7e8;--bad:#f08a82;--code:#2a2a26}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}main{max-width:860px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:var(--mut);margin:32px 0 10px}h3{font-size:14px;margin:18px 0 8px}
.k{color:var(--mut);font-size:13px}.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 16px;margin:0 0 10px}.struck b,.struck li{text-decoration:line-through;color:var(--mut)}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.pill{font-size:12px;font-weight:600;padding:1px 8px;border-radius:99px;border:1px solid var(--mut);color:var(--mut)}
.o-human{color:var(--ok);border-color:var(--ok)}.o-delegated{color:var(--info);border-color:var(--info)}.o-assumed,.o-open,.sev-needs-human{color:var(--warn);border-color:var(--warn)}.o-repo{color:var(--info);border-color:var(--info)}.bad,.sev-blocking{color:var(--bad);border-color:var(--bad)}
.opts{margin:6px 0;padding-left:18px}.chosen{font-weight:600}pre{background:var(--code);padding:10px;border-radius:8px;overflow:auto;white-space:pre-wrap;font:12px/1.4 ui-monospace,monospace}code{background:var(--code);padding:0 4px;border-radius:4px}
.need li{margin:4px 0}
table{width:100%;border-collapse:collapse;font-size:13.5px}td{padding:4px 6px;border-top:1px solid var(--line);vertical-align:top}.okc{color:var(--ok)}.badc{color:var(--bad)}
</style></head><body><main>
<h1>${esc(s.title)}</h1><p class="k">${esc(s.id)} · ${esc(s.kind)} · ${esc(s.status)}${s.accepted ? ` (accepted by you ${esc(s.accepted.at.slice(0, 10))}, ${esc(assuranceText(s.accepted))})` : ''}${s.accepted && mergeLabel(merge) ? ` · ${esc(mergeLabel(merge))}` : ''} · created ${esc(s.created.slice(0, 10))}</p><p>${esc(s.request)}</p>
<h2>Outcome</h2><div class="card"><b>Built</b><ul>${li(o.built) || '<li class="k">not recorded</li>'}</ul><b>Left out</b><ul>${li(o.left_out) || '<li class="k">nothing recorded</li>'}</ul><b>Size</b><p>${esc(o.size ?? 'not recorded')}</p></div>
${(s.criteria || []).length || (story.steps || []).length ? `<h2>Criteria and steps</h2><div class="card">${(s.criteria || []).length ? `<b>Acceptance criteria</b><ul>${s.criteria.map(c => `<li><span class="k">${esc(c.id)}</span> ${esc(c.text)}</li>`).join('')}</ul>` : ''}${(story.steps || []).length ? `<b>Steps (${story.steps.filter(x => x.done).length} of ${story.steps.length} done)</b><ul>${story.steps.map(x => `<li class="${x.done ? 'chosen' : ''}" style="margin-left:${(x.depth - 1) * 16}px;list-style:none">${x.done ? '☑' : '☐'} <span class="k">${esc(x.num)}</span> ${esc(x.text)}</li>`).join('')}</ul>` : ''}</div>` : ''}
<h2>Needs you</h2>${need.length ? `<div class="card need"><ul>${need.map(n => `<li><span class="pill ${n.kind === 'assumed' ? 'o-assumed' : 'sev-' + esc(n.severity)}">${esc(n.kind)}</span> ${esc(n.text)}</li>`).join('')}</ul></div>` : '<div class="card"><span class="pill o-human">nothing</span> Nothing needs you.</div>'}
<h2>Questions and answers</h2>${qa}
<h2>Decisions</h2>${dec}
<h2>Findings</h2>${fnd}
<h2>Evidence</h2>${ev}
<h2>Commit trail</h2>${cm}
${context ? `<h2>Context at the time</h2><p class="k">${esc(context)}</p>` : ''}
</main></body></html>`;
}
