// Answer analysis: after the human answers, look for contradictions, newly opened decisions and moot recommendations.
// Ask a follow-up only where deciding wrongly is costly (at most `maxFollowups`, at most `maxRounds` rounds in total);
// everything else becomes an assumed default. Port of probes/queue/followup_analysis.py, with structured follow-ups.
import { spawnSync } from 'node:child_process';
import { createBatch } from './queue.mjs';

export const LIMITS = { maxFollowups: 3, maxRounds: 3 };   // round 1 = intake, so at most two follow-up rounds (design: 04 rule R7)

export function buildAnalysisPrompt({ request = '', context = '', batch }) {
  const qa = batch.questions.filter(q => q.answer).map((q, i) => {
    const o = q.options.find(x => x.id === q.answer.option);
    return `Q${i + 1}. ${q.situation}\n   Options: ${q.options.map(x => `${x.id}) ${x.label} [${x.cost}]`).join('; ')}\n   Human's answer: ${o ? `${o.id}) ${o.label}` : ''} ${q.answer.text ?? ''} (${q.answer.origin})`;
  }).join('\n');
  return `You are the development agent. Requested change: ${request || '(not given)'}\n` +
    `${context ? `BUSINESS CONTEXT (statements marked assumed are unconfirmed and are not evidence):\n${context}\n` : '(No business context document exists.)\n'}\n` +
    `You asked the human these questions before coding, and they answered:\n${qa}\n\n` +
    `Before writing any code, analyse the answers. Look for: (1) answers that contradict the context or each other; (2) new decisions the answers open that nobody has made yet; (3) recommendations the answers make moot. ` +
    `Ask a follow-up ONLY where deciding wrongly would be costly for the business or the users (data loss, surprising behaviour that cannot be undone, rules that are hard to change later); anything cheap gets a minimal default instead. ` +
    `Write each follow-up in business language, with 2 or 3 options each showing its cost in business terms, the minimal option first as the default. At most ${LIMITS.maxFollowups} follow-ups; none is fine.\n` +
    `Reply with ONLY JSON: {"followups":[{"because":"Because you answered ... ","situation":"...","options":[{"id":"a","label":"...","cost":"..."}],"recommended":"a","default":"a","why_costly":"..."}],"defaults_assumed":["..."]}`;
}

export function parseAnalysis(text) {
  const m = /\{[\s\S]*\}/.exec(text); if (!m) throw new Error('no JSON object in the analysis reply');
  const j = JSON.parse(m[0]); const warnings = [];
  const followups = [];
  for (const f of j.followups || []) {
    const ok = f && f.situation && Array.isArray(f.options) && f.options.length >= 2 && f.options.every(o => o && o.label && o.cost);
    if (!ok) { warnings.push(`dropped a malformed follow-up: ${JSON.stringify(f).slice(0, 80)}`); continue; }
    followups.push(f);
  }
  return { followups: followups.slice(0, LIMITS.maxFollowups), defaults_assumed: (j.defaults_assumed || []).filter(x => typeof x === 'string' && x.trim()), warnings };
}

// ask(prompt) -> reply text. Returns { followupBatch|null, defaults, warnings }.
export async function analyseAnswers({ request, context, batch, ask, date }) {
  const reply = await ask(buildAnalysisPrompt({ request, context, batch }));
  const a = parseAnalysis(reply);
  const round = batch.round + 1;
  if (round > LIMITS.maxRounds) {
    return { followupBatch: null, defaults: [...a.defaults_assumed, ...a.followups.map(f => `${f.situation} (would have been a follow-up; round limit reached, default ${f.default ?? f.options[0].id})`)], warnings: [...a.warnings, `round limit reached: ${a.followups.length} follow-up(s) recorded as assumed defaults`] };
  }
  const followupBatch = a.followups.length ? createBatch({
    slice: batch.slice, round, raised_by: 'answer-analysis',
    because: `Follow-up ${round - 1} of ${LIMITS.maxRounds - 1}: your answers opened ${a.followups.length} costly decision(s) nobody has made.`,
    questions: a.followups.map(f => ({ situation: f.situation, because: f.because?.replace(/^Because\s+/i, '').trim(), blocking: true, recommended: f.recommended, default: f.default, options: f.options })),
  }, { date }) : null;
  return { followupBatch, defaults: a.defaults_assumed, warnings: a.warnings };
}

export function claudeAsk({ model = 'claude-haiku-5-5', onCost = () => {} } = {}) {
  return async prompt => {
    const r = spawnSync('claude', ['-p', prompt, '--model', model, '--allowedTools', '', '--max-turns', '2', '--output-format', 'json'], { encoding: 'utf8', input: '', maxBuffer: 1 << 24 });
    const o = JSON.parse(r.stdout); onCost(o.total_cost_usd || 0); return o.result;
  };
}
