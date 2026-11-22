// Optional judge for hunks the term-overlap pre-pass cannot place. Uses `claude -p` (Haiku by default). Returns a source key or null.
import { spawnSync } from 'node:child_process';

export function claudeJudge({ model = 'claude-haiku-5-5', onCost = () => {} } = {}) {
  return async (item, spec) => {
    const keys = [...(spec.answers || []).map(a => `answer:${a.id}`), ...(spec.risks || []).map(r => `risk:${r.id}`), 'request', 'initiative'];
    const prompt = `You assess the scope of a code change. Decide which source an added code fragment follows from.\n\n` +
      `Request: ${spec.request || '(none)'}\n` +
      `Human answers:\n${(spec.answers || []).map(a => `- ${a.id}: ${a.text}`).join('\n') || '(none)'}\n` +
      `Stated risks (from the business context):\n${(spec.risks || []).map(r => `- ${r.id}: ${r.text}`).join('\n') || '(none)'}\n\n` +
      `Added fragment (file ${item.file}${item.test ? ', a test' : ''}): first line "${item.sample}"; ${item.lines} lines; terms it shares with a source: ${item.matched.join(', ') || 'none'}.\n\n` +
      `The fragment was provisionally matched to: ${item.source}. Use "request" only if the request itself literally requires it; a rule, limit or behaviour the request does not state is "initiative" unless a human answer or a stated risk calls for it.\n\nReply with ONLY one of: ${keys.join(' | ')}. Use "initiative" when nothing the human said or the request asked for requires this fragment.`;
    const r = spawnSync('claude', ['-p', prompt, '--model', model, '--allowedTools', '', '--max-turns', '1', '--output-format', 'json'], { encoding: 'utf8', input: '', maxBuffer: 1 << 24 });
    try { const o = JSON.parse(r.stdout); onCost(o.total_cost_usd || 0); const v = String(o.result).trim().split(/\s+/)[0].replace(/[`"']/g, ''); return keys.includes(v) ? v : null; } catch { return null; }
  };
}
