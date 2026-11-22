// Business context document: statements are bullets that end with an origin tag (see docs/design/03-schemas-v0.md).
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseDocument } from './frontmatter.mjs';

// `decided` marks a line of a step's record that the base application decides (run-profile-steps): it is never asked.
export const ORIGIN_TAG = /`(human|assumed|unknown|decided)(?:\s+(\d{4}-\d{2}-\d{2}))?`\s*$/;
export const RISK_SECTION = /^risk appetite/i;
// The lines of the risk section: the one the context's header names (risk_section, so its heading may be in any language, R211),
// or the heading 'Risk appetite' when the header names none.
export function riskLines(statements, data) {
  const name = String(data?.risk_section ?? '').trim().toLowerCase();
  return statements.filter(s => name ? s.section.toLowerCase() === name : RISK_SECTION.test(s.section));
}

// Returns [{ section, text, origin, date, line }]; origin is null for an untagged bullet.
export function contextStatements(body) {
  const out = []; let section = '';
  body.split('\n').forEach((raw, i) => {
    const h = /^#{2,3}\s+(.*)$/.exec(raw); if (h) { section = h[1].trim(); return; }
    const b = /^\s*[-*]\s+(.*)$/.exec(raw); if (!b) return;
    const t = ORIGIN_TAG.exec(b[1]);
    out.push({ section, text: t ? b[1].slice(0, t.index).trim() : b[1].trim(), origin: t ? t[1] : null, date: t?.[2] ?? null, line: i + 1 });
  });
  return out;
}

export function readContext(file) {
  const doc = parseDocument(fs.readFileSync(file, 'utf8'));
  if (doc.error) throw new Error(`${file}: ${doc.error}`);
  return { data: doc.data, body: doc.body, statements: contextStatements(doc.body) };
}

// The records of the profile's steps copied into the project: docs/steps/<step>/step.md names where its record is (`record:`).
export function stepRecordFiles(repo) {
  let names; try { names = fs.readdirSync(path.join(repo, 'docs', 'steps')).sort(); } catch { return []; }
  return names.flatMap(step => {
    const f = path.join(repo, 'docs', 'steps', step, 'step.md'); if (!fs.existsSync(f)) return [];
    const record = String(parseDocument(fs.readFileSync(f, 'utf8')).data?.record || ''); return record ? [{ step, record, file: path.join(repo, record) }] : [];
  });
}
// Whether a file is the record of a step of the project that holds it (any folder above it with docs/steps/ naming it).
export function isStepRecord(file) {
  const abs = path.resolve(file);
  for (let dir = path.dirname(abs); ; dir = path.dirname(dir)) { if (stepRecordFiles(dir).some(r => path.resolve(r.file) === abs)) return true; if (path.dirname(dir) === dir) return false; }
}
// The owner approves a step's record whole (R193): who, when, and a fingerprint of the record without those fields, so any later edit makes it stale.
const APPROVAL = /^approved_(by|at|sha):.*\n/gm;
export function recordFingerprint(text) { const { head, body } = splitFile(text); return createHash('sha256').update(head.replace(APPROVAL, '') + body).digest('hex'); }
export function approveRecord(text, { by, at = new Date().toISOString().replace(/\.\d+Z$/, 'Z') } = {}) {
  if (by !== 'owner') throw new Error('only the Product Owner approves a step\'s record (--by owner), and only after he said so in the conversation');
  const { head, body } = splitFile(text); const waiting = contextStatements(body).filter(s => !['human', 'decided'].includes(s.origin));
  if (waiting.length) throw new Error(`${waiting.length} line(s) are not confirmed yet: ${waiting.map(s => `line ${s.line} (${s.text.split(':')[0].slice(0, 40)})`).join(', ')}; the owner confirms or corrects each first (buddy context confirm <record> --line <n> --by owner)`);
  const out = head.replace(APPROVAL, '').replace(/\n---[ \t]*\n?$/, `\napproved_by: owner\napproved_at: ${at}\napproved_sha: -\n---\n`) + body;
  return out.replace(/^approved_sha: -$/m, `approved_sha: ${recordFingerprint(out)}`);
}
// For each record: the lines the owner has not confirmed yet (neither `decided` nor `human`), and whether he approved it as it is now
// ('none', 'stale' when it changed after his approval, 'ok'). A missing record waits whole. Development starts when none is left.
export function stepRecords(repo) {
  return stepRecordFiles(repo).map(({ step, record, file }) => {
    if (!fs.existsSync(file)) return { step, record, missing: true, waiting: [] };
    const text = fs.readFileSync(file, 'utf8'); const doc = parseDocument(text); const d = doc.data || {};
    const approval = d.approved_by !== 'owner' || !d.approved_sha ? 'none' : String(d.approved_sha) === recordFingerprint(text) ? 'ok' : 'stale';
    return { step, record, missing: false, waiting: contextStatements(doc.body).filter(s => !['human', 'decided'].includes(s.origin)), approval, approvedAt: d.approved_at };
  }).filter(r => r.missing || r.waiting.length || r.approval !== 'ok');
}
const approveHint = r => `then read it whole and approve it with buddy context approve ${r.record} --by owner`;
export const stepWaitingText = r => (r.missing ? `the record ${r.record} of the step ${r.step} is missing`
  : r.waiting.length ? `${r.waiting.length} line(s) of ${r.record}, the record of the step ${r.step}, wait for your confirmation: ${r.waiting.map(s => `line ${s.line} (${s.text.split(':')[0].slice(0, 40)})`).join(', ')}; confirm or correct each with buddy context confirm ${r.record} --line <n> --by owner, ${approveHint(r)}`
  : r.approval === 'stale' ? `${r.record}, the record of the step ${r.step}, changed after you approved it (${r.approvedAt}): ${approveHint(r).replace('then read', 'read')} again`
  : `${r.record}, the record of the step ${r.step}, waits for your approval: ${approveHint(r).replace('then read', 'read')}`);

// The risk-appetite statements as scope sources. Lines that say "high cost: ..." are what justifies unrequested protection.
export function riskSources(ctx) {
  return riskLines(ctx.statements, ctx.data).map((s, i) => ({ id: `R${i + 1}`, text: s.text, origin: s.origin }));
}

// ---------------------------------------------------------------------------------------------------------------------
// Risk-appetite gate and context intake (task 3). Design: docs/design/04-interaction-spec.md section 3.1, R11; 03-schemas-v0.md.

const todayStr = () => new Date().toISOString().slice(0, 10);

// State of the risk appetite: 'confirmed' (every line human), 'accepted-assumed' (the owner explicitly chose to go on with
// assumed lines, recorded as risk_assumed_accepted), 'blocked' (a line is assumed/unknown/untagged and nobody accepted that),
// or 'missing' (no risk-appetite section, or the one the header names does not exist or has no line: the message says which).
// The agent can never move a line to 'human'.
export function riskState(ctx) {
  const lines = riskLines(ctx.statements, ctx.data); const named = ctx.data?.risk_section;
  if (!lines.length) return { state: 'missing', lines, unconfirmed: [], named: !!named, message: named ? `the context names "${named}" as its risk section (risk_section in its header), and it has no section with that heading or the section has no line` : 'the context has no "Risk appetite" section' };
  const unconfirmed = lines.filter(s => s.origin !== 'human');
  if (!unconfirmed.length) return { state: 'confirmed', lines, unconfirmed, message: 'every risk-appetite line is confirmed by the owner' };
  if (ctx.data.risk_assumed_accepted) return { state: 'accepted-assumed', lines, unconfirmed, message: `${unconfirmed.length} risk-appetite line(s) left assumed on purpose (owner, ${ctx.data.risk_assumed_accepted}); protections beyond the request must be asked, not added` };
  return { state: 'blocked', lines, unconfirmed, message: `${unconfirmed.length} risk-appetite line(s) not confirmed by the owner and not accepted as assumed` };
}

// Only statements the owner confirmed may answer a question for the agent; a confirmed line older than `staleDays` stops doing so until reconfirmed (design Q18).
export function suppressionSources(ctx, { today = todayStr(), staleDays = 90 } = {}) {
  const age = d => Math.floor((Date.parse(today) - Date.parse(d)) / 86400000);
  const usable = [], stale = [];
  for (const s of ctx.statements) if (s.origin === 'human') (age(s.date) > staleDays ? stale : usable).push(s);
  return { usable, stale };
}

export function contextCard(ctx) {
  const r = riskState(ctx); const out = ['Before I start I need your confirmation of how much risk to take. I drafted this from your request and the code; lines marked drafted are not confirmed yet.', ''];
  if (!r.lines.length) out.push('  (there is no risk-appetite section yet: I will ask you to describe what is costly to get wrong)');
  r.lines.forEach((s, i) => { const t = s.text.length > 100 ? s.text.slice(0, 97) + '...' : s.text; out.push(`  ${i + 1}. ${t} ${'.'.repeat(Math.max(2, 58 - t.length))} ${s.origin === 'human' ? `confirmed ${s.date}` : 'drafted (' + (s.origin ?? 'untagged') + ')'}`); });
  out.push('', 'Reply "ok" to confirm all, a number and a correction to change one, or "skip" to continue with these marked ASSUMED (I will then ask before adding protections beyond what the request needs).');
  return out.join('\n');
}

function splitFile(text) {
  const m = /^---\n[\s\S]*?\n---[ \t]*\n?/.exec(text.replace(/\r\n/g, '\n')); if (!m) throw new Error('no front matter');
  return { head: m[0], body: text.replace(/\r\n/g, '\n').slice(m[0].length), offset: m[0].split('\n').length - 1 };
}
const bumpUpdated = (head, date) => /^updated:.*$/m.test(head) ? head.replace(/^updated:.*$/m, `updated: ${date}`) : head;

// Confirms statements by body line number (relative to the body, as contextStatements reports them) or all risk lines.
// `corrections`: { [line]: 'new text' } replaces the text of a line the owner corrected. Returns the new file text and what changed.
export function confirmStatements(text, { lines = [], allRisk = false, corrections = {}, date = todayStr() } = {}) {
  const { head, body } = splitFile(text); const stmts = contextStatements(body); const changed = [];
  const want = new Set(lines.map(Number)); if (allRisk) for (const s of riskLines(stmts, parseDocument(text).data)) want.add(s.line);
  for (const l of Object.keys(corrections)) want.add(Number(l));
  const out = body.split('\n').map((raw, i) => {
    const no = i + 1; if (!want.has(no)) return raw;
    const s = stmts.find(x => x.line === no); if (!s) throw new Error(`line ${no} is not a statement`);
    if (['human', 'decided'].includes(s.origin) && !(no in corrections)) return raw;
    const bullet = /^(\s*[-*]\s+)/.exec(raw)[1]; changed.push(no);
    return `${bullet}${corrections[no] ?? s.text} \`human ${date}\``;
  });
  for (const w of want) if (!stmts.some(s => s.line === w)) throw new Error(`line ${w} is not a statement`);
  return { text: bumpUpdated(head, date) + out.join('\n'), changed };
}

// The owner decides to go on with the risk appetite left assumed. Recorded in the front matter; the lines stay assumed.
export function acceptAssumed(text, date = todayStr()) {
  const { head, body } = splitFile(text);
  const h = /^risk_assumed_accepted:.*$/m.test(head) ? head.replace(/^risk_assumed_accepted:.*$/m, `risk_assumed_accepted: ${date}`) : head.replace(/\n---[ \t]*\n?$/, `\nrisk_assumed_accepted: ${date}\n---\n`);
  return bumpUpdated(h, date) + body;
}

// The sections a context file has: its level-2 and level-3 headings, as the reader sees them.
export function contextSections(body) {
  return body.split('\n').map(l => /^#{2,3}\s+(.*)$/.exec(l)?.[1].trim()).filter(Boolean);
}

// Appends one statement to the end of a section, as the owner said it (`human <date>`) or drafted by the agent (`assumed`).
// Refuses an unknown section, empty text, or text that would end in an origin tag of its own. A statement already in the
// section (same words) is not written twice: `added` is false and the text is returned unchanged.
export function addStatement(text, { section, statement, assumed = false, date = todayStr() } = {}) {
  const { head, body } = splitFile(text);
  const words = String(statement ?? '').replace(/\s+/g, ' ').trim();
  if (!words) throw new Error('the statement is empty: say it with --text "<the words>"');
  if (ORIGIN_TAG.test(words)) throw new Error('the statement already ends with an origin tag; give only the words');
  const names = contextSections(body);
  const name = names.find(n => norm(n) === norm(section ?? ''));
  if (!name) throw new Error(`no section "${section ?? ''}" in the context; the sections are: ${names.join(', ') || '(none)'}`);
  const lines = body.split('\n');
  const idx = lines.findIndex(l => (/^#{2,3}\s+(.*)$/.exec(l)?.[1].trim()) === name);
  let end = idx + 1; while (end < lines.length && !/^#{1,3}\s/.test(lines[end])) end++;
  const inSection = contextStatements(body).filter(s => s.line > idx + 1 && s.line <= end);
  if (inSection.some(s => norm(s.text) === norm(words))) return { text, added: false, section: name };
  let ins = end; while (ins > idx + 1 && lines[ins - 1].trim() === '') ins--;
  const line = `- ${words} \`${assumed ? 'assumed' : `human ${date}`}\``;
  lines.splice(ins, 0, line);
  if (lines[lines.length - 1] !== '') lines.push('');
  return { text: bumpUpdated(head, date) + lines.join('\n'), added: true, section: name, line };
}

const SECTIONS = [['purpose', 'Purpose and outcomes'], ['users', 'Users'], ['setting', 'Setting'], ['success', 'What success looks like'], ['non_goals', 'What we are not doing'], ['risk_appetite', 'Risk appetite'], ['who_decides', 'Who decides what'], ['unknowns', 'Unknowns']];
const norm = s => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();   // letters and digits of any language: the context may be written in the project's own

// Draft from an intake reply (see intakePrompt). Everything drafted is `assumed` or `unknown`; nothing becomes `human` here.
// With an existing file: confirmed lines are kept exactly as they are, new items are appended as assumed, nothing is removed.
export function draftContext(spec, { title = 'Business context', existing = null, date = todayStr() } = {}) {
  const have = new Map(); let body = null; let head = null;
  if (existing) { const sp = splitFile(existing); body = sp.body; head = sp.head; for (const s of contextStatements(body)) have.set(norm(s.text), s); }
  const add = (section, text, tag) => { if (!text || have.has(norm(text))) return null; return `- ${text.trim()} \`${tag}\``; };
  const newItems = {};
  for (const [key, name] of SECTIONS) {
    const items = (spec[key] || []).map(x => typeof x === 'string' ? x : (x.level ? `${x.level} cost: ${x.text}` : x.text));
    const tag = key === 'unknowns' ? 'unknown' : 'assumed';
    newItems[name] = items.map(t => add(name, t, tag)).filter(Boolean);
  }
  const questions = (spec.questions_for_owner || []).map(t => add('Questions for the owner', t, 'unknown')).filter(Boolean);
  if (!existing) {
    const lines = [`---\nschema: buddy/context@0\ntitle: ${title}\nupdated: ${date}\nstatus: draft\n---`, '# Business context', '',
      'Drafted by the agent from rough notes. Every statement ends with its origin: `human YYYY-MM-DD` (confirmed by the owner), `assumed` (drafted, nobody confirmed it) or `unknown`. Only the owner changes a statement to `human`.', ''];
    for (const [, name] of SECTIONS) if (newItems[name].length || name === 'Risk appetite') { lines.push(`## ${name}`, ...(newItems[name].length ? newItems[name] : ['- What is costly to get wrong has not been described yet. `unknown`']), ''); }
    if (questions.length) lines.push('## Questions for the owner', ...questions, '');
    return lines.join('\n');
  }
  // merge: append new items at the end of their section (or a new section at the end); keep everything else byte for byte
  let lines = body.split('\n');
  for (const [, name] of SECTIONS) {
    const items = newItems[name]; if (!items.length) continue;
    const idx = lines.findIndex(l => new RegExp(`^##\\s+${name.replace(/[()]/g, '\\$&')}\\s*$`, 'i').test(l));
    if (idx < 0) { while (lines.length && lines[lines.length - 1] === '') lines.pop(); lines.push('', `## ${name}`, ...items, ''); continue; }
    let end = idx + 1; while (end < lines.length && !/^#{1,3}\s/.test(lines[end])) end++;
    let ins = end; while (ins > idx + 1 && lines[ins - 1].trim() === '') ins--;
    lines.splice(ins, 0, ...items);
  }
  if (questions.length) { const i = lines.findIndex(l => /^##\s+Questions for the owner/i.test(l)); if (i < 0) { while (lines.length && lines[lines.length - 1] === '') lines.pop(); lines.push('', '## Questions for the owner', ...questions, ''); } else { let e = i + 1; while (e < lines.length && !/^#{1,3}\s/.test(lines[e])) e++; let ins = e; while (ins > i + 1 && lines[ins - 1].trim() === '') ins--; lines.splice(ins, 0, ...questions); } }
  return bumpUpdated(head, date) + lines.join('\n');
}

export function intakePrompt({ notes, facts = '', existing = '' }) {
  return `You are drafting a short business-context document for a software project, for its owner to confirm. Write for a business reader.\n` +
    `ROUGH NOTES FROM THE OWNER:\n${notes}\n${facts ? `\nPROJECT FACTS (technical, for orientation only):\n${facts}\n` : ''}${existing ? `\nLINES THE OWNER ALREADY CONFIRMED (do not repeat or contradict them):\n${existing}\n` : ''}\n` +
    `Rules: state only what the notes support or what is a reasonable reading of them; never present a guess as a fact (everything you write will be labelled "assumed"); ` +
    `put what you do not know in "unknowns" instead of inventing it; the risk appetite must say what is costly to get wrong in business terms (data loss, behaviour users cannot undo, public commitments, money) and what is cheap; no technical vocabulary. Keep it short: each statement is one sentence of at most 25 words, at most 3 statements per section, exactly one line each for High, Medium and Low risk (do not begin them with the words costly or cheap). Do not add requirements, protections or features the notes do not state; if the notes suggest it but do not say it, put it in "unknowns" or "questions_for_owner".\n` +
    `Reply with ONLY JSON: {"purpose":["..."],"users":["..."],"setting":["..."],"success":["..."],"non_goals":["..."],"risk_appetite":[{"level":"High","text":"..."},{"level":"Medium","text":"..."},{"level":"Low","text":"..."}],"who_decides":["..."],"unknowns":["..."],"questions_for_owner":["..."]}`;
}

export function parseIntake(reply) {
  const m = /\{[\s\S]*\}/.exec(reply); if (!m) throw new Error('no JSON object in the intake reply'); return JSON.parse(m[0]);
}
