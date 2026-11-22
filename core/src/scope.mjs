// Scope assessment: trace each addition in a diff to a human answer, a stated risk, the request, or the agent's own initiative.
// Deterministic pre-pass (term overlap); an optional judge (a function) decides the hunks the pre-pass cannot.
// The shares are indicative, not exact (design question Q12): term overlap is a proxy for "this line follows from that statement".

const STOP = new Set(('the and for with that this from have has had not are was were been being into onto over under than then them they their there these those ' +
  'what when where which while will would should could can may might must shall also only each any all more most some such very just like about after before ' +
  'const let var function return import export default async await true false null undefined void class interface type extends implements new typeof instanceof ' +
  'string number boolean array object promise error catch throw try else switch case break continue while describe expect test beforeeach aftereach vitest jest ' +
  'src server web test tests spec index main app json html css node module props state value values data item items list lists name names length push').split(' '));

export function terms(text) {
  const out = new Set();
  for (const w of String(text).match(/[A-Z]?[a-z]+|[A-Z]+(?![a-z])|\d+/g) || []) {
    let t = w.toLowerCase();
    if (t.length > 5 && /(ing|ed|es)$/.test(t)) t = t.replace(/(ing|ed|es)$/, '');
    else if (t.length > 4 && t.endsWith('s')) t = t.slice(0, -1);
    if (t.length > 4 && t.endsWith('e')) t = t.slice(0, -1);      // archive, archived, archiving -> archiv
    if ((t.length >= 4 && !STOP.has(t)) || /^\d{2,}$/.test(t)) out.add(t);
  }
  return out;
}

const IGNORED = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$|(^|\/)(dist|node_modules|coverage)\//;
export const isTestFile = f => /(^|\/)(tests?|__tests__)\//i.test(f) || /\.(test|spec)\.[jt]sx?$/.test(f) || /Tests?\.cs$/.test(f);

// Unified diff -> [{ file, test, hunks: [{ header, added: [line], removed }] }]. Added lines without a letter or digit (blank, a lone brace) are not counted.
export function parseDiff(text) {
  const files = []; let file = null; let hunk = null;
  for (const l of text.split('\n')) {
    if (l.startsWith('diff --git ')) { file = null; hunk = null; continue; }
    if (l.startsWith('+++ ')) { const f = l.slice(4).replace(/^b\//, ''); file = f === '/dev/null' ? null : { file: f, test: isTestFile(f), hunks: [] }; if (file && !IGNORED.test(f)) files.push(file); else file = null; hunk = null; continue; }
    if (l.startsWith('--- ')) continue;
    if (!file) continue;
    if (l.startsWith('@@')) { hunk = { header: l, added: [], removed: 0 }; file.hunks.push(hunk); continue; }
    if (!hunk) continue;
    if (l.startsWith('+')) { const c = l.slice(1); if (/[A-Za-z0-9]/.test(c)) hunk.added.push(c); }
    else if (l.startsWith('-')) hunk.removed++;
  }
  return files.filter(f => f.hunks.some(h => h.added.length));
}

// sources: { request: string, answers: [{id, text}], risks: [{id, text}] }
export function buildSources(s) {
  const list = [];
  // The request's own words are the domain vocabulary every hunk uses; matching them says little. An answer or a risk is credited
  // only for the terms it adds beyond the request (the rule's specifics: a cap, a floor, a duplicate check).
  const req = terms(s.request || '');
  for (const a of s.answers || []) list.push({ key: `answer:${a.id}`, kind: 'answer', terms: new Set([...terms(a.text)].filter(t => !req.has(t))) });
  for (const r of s.risks || []) list.push({ key: `risk:${r.id}`, kind: 'risk', terms: new Set([...terms(r.text)].filter(t => !req.has(t))) });
  if (s.request) list.push({ key: 'request', kind: 'request', terms: req });
  return list;
}
const PRIORITY = { answer: 0, risk: 1, request: 2 };

// Specific sources (answers, risks) win whenever they match enough of their own terms; the request is the fallback because its
// words are the domain vocabulary that every hunk shares.
export function classifyHunk(hunkTerms, sources, minMatches = 2) {
  const score = src => ({ key: src.key, kind: src.kind, matched: [...hunkTerms].filter(t => src.terms.has(t)) });
  const pick = list => list.map(score).filter(x => x.matched.length).sort((x, y) => y.matched.length - x.matched.length || PRIORITY[x.kind] - PRIORITY[y.kind])[0];
  const specific = pick(sources.filter(s => s.kind !== 'request'));
  if (specific && specific.matched.length >= minMatches) return { source: specific.key, matched: specific.matched };
  const req = pick(sources.filter(s => s.kind === 'request'));
  if (req && req.matched.length >= minMatches) return { source: req.key, matched: req.matched };
  const best = [specific, req].filter(Boolean).sort((x, y) => y.matched.length - x.matched.length)[0];
  if (!best) return { source: 'initiative', matched: [] };
  return { source: 'unclear', matched: best.matched, candidate: best.key };
}

// opts: { minMatches, chunk, judgeRequest, judge(item, sources) -> source key | 'initiative' | null }
// The judge is called for unclear hunks, and with judgeRequest also for hunks attributed to the request alone.
export async function traceScope(diffText, sourceSpec, opts = {}) {
  const sources = buildSources(sourceSpec); const items = [];
  const chunk = opts.chunk ?? 8;     // long hunks are judged in windows so one rule does not hide an unrequested block
  for (const f of parseDiff(diffText)) for (const h of f.hunks) for (let i = 0; i < h.added.length; i += chunk) {
    const part = h.added.slice(i, i + chunk);
    const c = classifyHunk(terms(part.join('\n')), sources, opts.minMatches ?? 2);
    items.push({ file: f.file, test: f.test, hunk: h.header, lines: part.length, source: c.source, matched: c.matched, candidate: c.candidate, judged: false, sample: part.find(x => x.trim()).trim().slice(0, 80) });
  }
  const judged = it => it.source === 'unclear' || (opts.judgeRequest && it.source === 'request');   // request-attributed hunks can hide rules the request never stated
  if (opts.judge) for (const it of items) if (judged(it)) {
    const verdict = await opts.judge(it, sourceSpec);
    if (verdict) { it.source = verdict; it.judged = true; }
  }
  const total = items.reduce((s, i) => s + i.lines, 0);
  const lines = {}; for (const i of items) { const k = i.source.split(':')[0]; lines[k] = (lines[k] || 0) + i.lines; }
  for (const k of ['answer', 'risk', 'request', 'initiative', 'unclear']) lines[k] ||= 0;
  const share = Object.fromEntries(Object.entries(lines).map(([k, n]) => [k, total ? Math.round((n / total) * 100) : 0]));
  const perAnswer = {}; for (const i of items) if (i.source.startsWith('answer:') || i.source.startsWith('risk:')) perAnswer[i.source] = (perAnswer[i.source] || 0) + i.lines;
  const testLines = items.filter(i => i.test).reduce((s, i) => s + i.lines, 0);
  return { total_added: total, lines, share, test_lines: testLines, by_source: perAnswer, items, note: 'Indicative: term overlap between each hunk and the human answers, stated risks and request. Share of "unclear" is not attributed.' };
}

export function describe(result) {
  const s = result.share;
  const out = [`Added lines (non-blank): ${result.total_added}, of which tests: ${result.test_lines}`,
    `Traced to your answers: ${s.answer} %, to a stated risk: ${s.risk} %, to the request alone: ${s.request} %, the agent's own initiative: ${s.initiative} %, unclear: ${s.unclear} %`];
  const init = result.items.filter(i => i.source === 'initiative' || i.source === 'unclear');
  if (init.length) { out.push('Not traced to anything the human said:'); for (const i of init) out.push(`  - ${i.file} ${i.hunk.replace(/@@ (.*?) @@.*/, '$1')} (${i.lines} lines, ${i.source}): ${i.sample}`); }
  return out.join('\n');
}
