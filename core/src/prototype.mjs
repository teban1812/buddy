// The prototype as a first-class artifact (R107, R116, R126): this file lists the facts of an HTML prototype without deciding (R131), for Buddy's own
// reading (the agent's, checked against the HTML here). The manifest (draft, confirm, check, add), built on that reading, is in the same module further down.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseHtml, walk, textOf, find } from './htmlscan.mjs';

export const PROTOTYPE_DIR = 'docs/inputs/prototype';
const short = (s, n = 100) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
const isClickable = el => el.tag === 'button' || (el.tag === 'a' && 'href' in el.attrs) || el.attrs.role === 'button' || (el.tag === 'input' && ['button', 'submit', 'reset'].includes((el.attrs.type || '').toLowerCase()));
const isField = el => ['input', 'select', 'textarea'].includes(el.tag) && !['button', 'submit', 'reset', 'hidden', 'image'].includes((el.attrs.type || 'text').toLowerCase());

const fingerprintOf = files => crypto.createHash('sha256').update([...files].sort((a, b) => a.name.localeCompare(b.name)).map(f => `${f.name}\0${f.html}\0`).join('')).digest('hex').slice(0, 16);

// The facts of a prototype, without deciding what is a screen (R131): per file its ids, links, buttons, headings, forms and the names of the
// functions its scripts define (simple patterns over the script text, not a parser). Buddy, the agent, interprets them with the source.
const SCRIPT = /<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi;
const FUNC = '(?:async\\s+)?(?:function\\b|\\([^()]*\\)\\s*=>|[A-Za-z_$][\\w$]*\\s*=>)';
const FUNCS = [/\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/g, new RegExp(`\\b(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*${FUNC}`, 'g'), new RegExp(`['"]?([A-Za-z_$][\\w$-]*)['"]?\\s*:\\s*${FUNC}`, 'g')];
const dataOf = el => Object.fromEntries(Object.entries(el.attrs).filter(([k]) => k.startsWith('data-')));
export function prototypeFacts(files) {
  return { fingerprint: fingerprintOf(files), files: files.map(f => {
    const { root } = parseHtml(f.html); const ids = []; const headings = []; const links = []; const buttons = []; const forms = [];
    walk(root, el => {
      if (el.attrs.id) ids.push(el.attrs.id);
      if (/^h[1-6]$/.test(el.tag)) headings.push({ level: Number(el.tag[1]), text: textOf(el) });
      if (el.tag === 'form') forms.push({ id: el.attrs.id ?? null, action: el.attrs.action ?? null, fields: find(el, isField).map(x => x.attrs.name || x.attrs.id || x.attrs.placeholder || x.tag) });
      if (el.tag === 'a' || isClickable(el)) {
        const c = { text: textOf(el) || el.attrs['aria-label'] || el.attrs.value || el.attrs.title || '', ...(el.tag === 'a' ? { href: el.attrs.href ?? null } : {}), data: dataOf(el), ...(el.attrs.onclick ? { onclick: el.attrs.onclick } : {}) };
        (el.tag === 'a' ? links : buttons).push(c);
      }
    });
    const code = [...f.html.matchAll(SCRIPT)].map(m => m[1]); const found = code.join('\n');
    const functions = [...new Set(FUNCS.flatMap(re => [...found.matchAll(re)].map(m => ({ name: m[1], at: m.index }))).sort((a, b) => a.at - b.at).map(m => m.name))];
    return { name: f.name, bytes: Buffer.byteLength(f.html), scripts: code.length, ids, headings, links, buttons, forms, functions };
  }) };
}

// The HTML files of a project's prototype folder, names relative to it, in a stable order.
export function prototypeFiles(repo) {
  const dir = path.join(repo, PROTOTYPE_DIR); if (!fs.existsSync(dir)) return [];
  const files = []; const walkDir = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      if (e.isDirectory()) walkDir(path.join(d, e.name), path.posix.join(rel, e.name));
      else if (/\.html?$/i.test(e.name)) files.push({ name: path.posix.join(rel, e.name), html: fs.readFileSync(path.join(d, e.name), 'utf8') });
    }
  };
  walkDir(dir, ''); return files;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The manifest: docs/inputs/prototype/manifest.md. Buddy drafts it from the reading above with every line `assumed`; the owner confirms
// it line by line, as the business context (R116). Statements are bullets that end with an origin tag.
import { parseDocument } from './frontmatter.mjs';
import { dumpDocument } from './yaml.mjs';
import { contextStatements, contextSections, addStatement } from './context.mjs';

export const MANIFEST = `${PROTOTYPE_DIR}/manifest.md`;
export const SECTIONS = { screens: 'Screens', flows: 'Flows', fake: 'What is fake or only an example', fixed: 'What the owner fixed', notes: 'About the prototype', gone: 'No longer in the prototype' };
const today = () => new Date().toISOString().slice(0, 10);
const list = (a, n = 5) => (a.length > n ? [...a.slice(0, n), `${a.length - n} more`] : a).join(', ');

// The statements Buddy would write for a reading: [{ section, key, text }].
export function statementsOf(p) {
  const out = []; const add = (section, key, text) => out.push({ section, key, text });
  const mark = x => (x.problem ? ` (not backed by the prototype: ${x.problem})` : '');
  for (const s of p.screens) {
    const parts = s.evidence?.length ? [`from: ${s.evidence.map(e => short(e, 60)).join('; ')}`] : [];
    add(SECTIONS.screens, `screen:${s.name}`, `\`${s.name}\` ${s.title} (${s.file})${parts.length ? ` — ${parts.join('; ')}` : ''}${mark(s)}`);
  }
  for (const f of p.flows) add(SECTIONS.flows, `flow:${f.from}>${f.to}:${f.via}`, `\`${f.from}\` to \`${f.to}\` through "${f.via}"${mark(f)}`);
  for (const s of p.screens) {
    for (const f of s.fake) add(SECTIONS.fake, `fake:${s.name}:${f}`, `\`${s.name}\`: ${f}`);
    for (const z of s.fixed || []) add(SECTIONS.fixed, `fixed:${s.name}:${z}`, `\`${s.name}\`: ${z} (fixed)`);
  }
  for (const n of p.notes || []) add(SECTIONS.notes, keyOfStatement(SECTIONS.notes, n), n);
  return out;
}

// The key of an existing statement, from its text and section, to match it with a fresh reading. A line the owner declared by hand keys
// as the same line would without the mark.
const DECLARED = ' (declared by the owner)';
export function keyOfStatement(section, text) {
  let m; text = text.endsWith(DECLARED) ? text.slice(0, -DECLARED.length) : text;
  if (section === SECTIONS.screens && (m = /^`([a-z0-9-]+)`/.exec(text))) return `screen:${m[1]}`;
  if (section === SECTIONS.flows && (m = /^`([^`]+)` to `([^`]+)` through "(.*?)"(?: \((?:a guess|not backed by the prototype).*\))?$/.exec(text))) return `flow:${m[1]}>${m[2]}:${m[3]}`;
  if (section === SECTIONS.fake && (m = /^`([^`]+)`: (.*)$/.exec(text))) { const r = m[2].replace(/^illustrative, free to change: /, 'illustrative '); return `fake:${m[1]}:${r.replace(/^the whole screen is marked fake$/, 'the whole screen')}`; }
  if (section === SECTIONS.fixed && (m = /^`([^`]+)`: (.*) \(fixed\)$/.exec(text))) return `fixed:${m[1]}:${m[2]}`;
  if (section === SECTIONS.notes) return text.startsWith('The prototype has scripts') ? 'note:scripts' : (m = /^`([^`]+)`: (.*)$/.exec(text)) ? `note:${m[1]}:${m[2]}` : `note:${text}`;
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Buddy's reading (R131): docs/inputs/prototype/reading.json, written by the agent from the facts and the source. The program checks its
// shape and that every evidence text occurs in its file; it does not judge the interpretation, the owner does.
export const READING = `${PROTOTYPE_DIR}/reading.json`;
const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const squash = s => String(s).replace(/\s+/g, ' ').trim();
const fileOf = f => String(f).replace(/\\/g, '/').replace(/^(\.\/)?docs\/inputs\/prototype\//, '');

// What is wrong with the shape of a reading, as clear messages; [] when it is usable.
export function readingShape(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return ['the reading must be a JSON object { "screens": [...], "flows": [...], "fake": [...], "notes": [...] }'];
  const errs = []; const text = v => typeof v === 'string' && v.trim() !== ''; const texts = v => Array.isArray(v) && v.every(x => typeof x === 'string');
  const listOf = (k, need) => { if (r[k] === undefined && !need) return []; if (!Array.isArray(r[k]) || (need && !r[k].length)) { errs.push(`"${k}" must be a list${need ? ' with at least one item' : ''}`); return []; } return r[k]; };
  for (const k of Object.keys(r)) if (!['screens', 'flows', 'fake', 'notes'].includes(k)) errs.push(`unknown key "${k}": a reading has screens, flows, fake and notes`);
  const names = new Set();
  listOf('screens', true).forEach((s, i) => {
    const at = `screens[${i}]`; if (!s || typeof s !== 'object') return errs.push(`${at} must be an object { "name", "title", "file", "evidence" }`);
    if (!NAME.test(s.name ?? '')) errs.push(`${at}: "name" must be lowercase words joined by hyphens (got ${JSON.stringify(s.name)})`); else if (names.has(s.name)) errs.push(`${at}: two screens are named "${s.name}"`); else names.add(s.name);
    if (!text(s.title)) errs.push(`${at}: "title" must be a text`);
    if (!text(s.file)) errs.push(`${at}: "file" must be its HTML file, relative to ${PROTOTYPE_DIR}/`);
    if (s.evidence !== undefined && !texts(s.evidence)) errs.push(`${at}: "evidence" must be a list of texts found in its file`);
  });
  listOf('flows').forEach((f, i) => {
    const at = `flows[${i}]`; if (!f || typeof f !== 'object') return errs.push(`${at} must be an object { "from", "to", "via", "evidence" }`);
    for (const k of ['from', 'to']) if (!names.has(f[k])) errs.push(`${at}: "${k}" must name a screen of the reading (got ${JSON.stringify(f[k])})`);
    if (!text(f.via)) errs.push(`${at}: "via" must be a text (the control that leads there)`);
    if (f.evidence !== undefined && !texts(f.evidence)) errs.push(`${at}: "evidence" must be a list of texts found in the file of its "from" screen`);
  });
  listOf('fake').forEach((f, i) => { if (!f || typeof f !== 'object' || !names.has(f.screen) || !text(f.text)) errs.push(`fake[${i}] must be { "screen": <a screen of the reading>, "text": "<what is fake>" }`); });
  if (r.notes !== undefined && !texts(r.notes)) errs.push('"notes" must be a list of texts');
  return errs;
}

// The reading of a project, or null when there is none: { reading, errors }.
export function loadReading(repo) {
  const f = path.join(repo, READING); if (!fs.existsSync(f)) return null;
  let r; try { r = JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '')); } catch (e) { return { reading: null, errors: [`${READING} is not valid JSON: ${e.message}`] }; }
  return { reading: r, errors: readingShape(r) };
}

// A reading checked against the HTML files, in the form statementsOf takes; `problems` lists every screen or flow whose evidence is missing or
// occurs nowhere in its file (a flow's evidence is looked for in the file of its `from` screen). Throws when the shape is wrong.
export function fromReading(r, files) {
  const errs = readingShape(r); if (errs.length) throw new Error(`${READING}: ${errs.join('; ')}`);
  const html = new Map(files.map(f => [f.name, squash(f.html)])); const problems = [];
  const judge = (file, evidence) => {
    if (!html.has(file)) return `the file ${file} is not in ${PROTOTYPE_DIR}/`;
    const ev = (evidence || []).map(squash).filter(Boolean); if (!ev.length) return 'no evidence given';
    const miss = ev.filter(e => !html.get(file).includes(e)); return miss.length ? `not found in ${file}: ${miss.map(e => `"${short(e, 60)}"`).join(', ')}` : null;
  };
  const screens = r.screens.map(s => {
    const file = fileOf(s.file); const problem = judge(file, s.evidence); if (problem) problems.push(`screen \`${s.name}\`: ${problem}`);
    const fake = (r.fake || []).filter(f => f.screen === s.name).map(f => squash(f.text));
    return { name: s.name, title: short(squash(s.title), 80), file, evidence: (s.evidence || []).map(squash).filter(Boolean), problem, fake, fixed: fixedZones(files.find(x => x.name === file)?.html, s.evidence) };
  });
  const flows = (r.flows || []).map(f => {
    const from = screens.find(s => s.name === f.from); const problem = judge(from.file, f.evidence); if (problem) problems.push(`flow \`${f.from}\` to \`${f.to}\`: ${problem}`);
    return { from: f.from, to: f.to, via: squash(f.via), evidence: (f.evidence || []).map(squash).filter(Boolean), problem };
  });
  return { fingerprint: fingerprintOf(files), reading: true, screens, flows, notes: (r.notes || []).map(squash).filter(Boolean), problems };
}

const tag = o => (o.origin === 'human' ? `\`human ${o.date}\`` : o.origin === 'unknown' ? '`unknown`' : '`assumed`');
// Writes the manifest for a reading. With an existing manifest, what the owner confirmed (human) is kept byte for byte when it is still in the
// prototype and moved under "No longer in the prototype" when it is not (nothing the owner confirmed is lost in silence, R110); what was only
// assumed is rewritten from the new reading.
export function draftManifest(p, { title = 'Prototype manifest', existing = null, date = today() } = {}) {
  const fresh = statementsOf(p); const keep = new Map(); const gone = []; const declared = [];
  if (existing) {
    const old = parseDocument(existing); const body = old.body ?? '';
    for (const s of contextStatements(body)) {
      if (s.origin !== 'human') continue; const k = keyOfStatement(s.section, s.text);
      if (k && fresh.some(f => f.key === k)) keep.set(k, s); else if (s.section !== SECTIONS.gone && s.text.endsWith(DECLARED)) declared.push(s); else gone.push(s);   // what the owner declared stays where they put it
    }
  }
  const lines = ['# Prototype manifest', '', 'Every statement ends with its origin: `human YYYY-MM-DD` (confirmed by the owner on that date), `assumed` (read by Buddy from the HTML, nobody confirmed it) or `unknown`. Correct what is wrong with `buddy prototype confirm --line N --text "..."`.', ''];
  for (const section of [SECTIONS.screens, SECTIONS.flows, SECTIONS.fake, SECTIONS.fixed, SECTIONS.notes]) {
    const items = fresh.filter(f => f.section === section); const own = declared.filter(s => s.section === section);
    if (!items.length && !own.length && section !== SECTIONS.screens) continue;
    lines.push(`## ${section}`);
    if (!items.length && !own.length) lines.push('- No screen was found in the prototype. `unknown`');
    for (const f of items) { const k = keep.get(f.key); lines.push(k ? `- ${k.text} ${tag(k)}` : `- ${f.text} \`assumed\``); }
    for (const s of own) lines.push(`- ${s.text} ${tag(s)}`);
    lines.push('');
  }
  // the origin tag stays last on its line; a line already moved keeps its note and is not annotated again
  if (gone.length) { lines.push(`## ${SECTIONS.gone}`, ...gone.map(g => `- ${g.section === SECTIONS.gone ? g.text : `${g.text} (was under: ${g.section})`} ${tag(g)}`), ''); }
  return dumpDocument({ schema: 'buddy/prototype@1', title, source: PROTOTYPE_DIR, reading: READING, fingerprint: p.fingerprint, updated: date }, lines.join('\n'));
}

export function readManifest(file) {
  const d = parseDocument(fs.readFileSync(file, 'utf8')); if (d.error) throw new Error(`${file}: ${d.error}`);
  const statements = contextStatements(d.body);
  const screens = statements.filter(s => s.section === SECTIONS.screens).map(s => ({ name: (/^`([a-z0-9-]+)`/.exec(s.text) || [])[1] ?? null, text: s.text, origin: s.origin, date: s.date, line: s.line })).filter(s => s.name);
  return { data: d.data, body: d.body, statements, screens };
}

// The owner's confirmation: `lines` (numbers in the body), or `all`; `corrections` { line: new text }. A confirmed line keeps its text unless corrected.
export function confirmManifest(text, { lines = [], all = false, corrections = {}, date = today() } = {}) {
  const m = /^(---\n[\s\S]*?\n---\n)([\s\S]*)$/.exec(text.replace(/\r\n/g, '\n')); if (!m) throw new Error('no front matter');
  const head = m[1].replace(/^updated: .*$/m, `updated: ${date}`); const body = m[2]; const stmts = contextStatements(body); const changed = [];
  const want = new Set(lines.map(Number)); if (all) for (const s of stmts) if (s.section !== SECTIONS.gone) want.add(s.line); for (const l of Object.keys(corrections)) want.add(Number(l));
  for (const w of want) if (!stmts.some(s => s.line === w)) throw new Error(`line ${w} is not a statement`);
  const out = body.split('\n').map((raw, i) => {
    const no = i + 1; if (!want.has(no)) return raw; const s = stmts.find(x => x.line === no);
    if (s.origin === 'human' && !(no in corrections)) return raw;
    changed.push(no); return `${/^(\s*[-*]\s+)/.exec(raw)[1]}${corrections[no] ?? s.text} \`human ${date}\``;
  });
  return { text: head + out.join('\n'), changed };
}

// Problems of the manifest of a project, and whether it is confirmed. `files` is what the folder holds now (to notice a changed prototype).
export function manifestProblems(repo) {
  const file = path.join(repo, MANIFEST); if (!fs.existsSync(file)) return { exists: false, problems: [`no manifest yet: run \`buddy prototype draft\` (${MANIFEST})`], unconfirmed: [], screens: [] };
  const m = readManifest(file); const problems = []; const unconfirmed = [];
  for (const s of m.statements) {
    if (!s.origin) problems.push(`line ${s.line}: no origin tag: "${s.text.slice(0, 50)}"`);
    else if (s.origin === 'human' && !s.date) problems.push(`line ${s.line}: a human-confirmed statement needs its date`);
    if (s.origin !== 'human' && s.section === SECTIONS.screens) unconfirmed.push(s.line);
    if (s.section !== SECTIONS.gone && s.text.includes('(not backed by the prototype: ')) problems.push(`line ${s.line}: not backed by the prototype: "${short(s.text, 60)}": correct the reading and draft again, or correct the line`);
  }
  const files = prototypeFiles(repo);
  if (files.length) { const now = fingerprintOf(files); if (now !== m.data.fingerprint) problems.push(`the prototype changed since the manifest was drafted (${m.data.fingerprint} to ${now}): run \`buddy prototype draft\` again; what you confirmed is kept`); }
  // a manifest drafted from Buddy's reading: the reading is checked again against the HTML as it is now
  if (m.data.reading) {
    const r = loadReading(repo); const again = 'correct it and run `buddy prototype draft --reading` again';
    if (!r) problems.push(`the manifest was drafted from ${READING}, which is gone: write it again (\`buddy prototype facts\` first), then run \`buddy prototype draft --reading\``);
    else if (r.errors.length) problems.push(...r.errors.map(e => `${READING}: ${e}: ${again}`));
    else problems.push(...fromReading(r.reading, files).problems.map(e => `${READING}: ${e}: ${again}`));
  }
  return { exists: true, problems, unconfirmed, screens: m.screens, fingerprint: m.data.fingerprint };
}

// A line the owner declares by hand (a screen the draft missed): confirmed by them today, marked as theirs, and kept in its section when the
// manifest is drafted again. A screens line starts with the screen's name in backticks, so the manifest lists it.
export const ADDABLE = { screens: SECTIONS.screens, flows: SECTIONS.flows, fake: SECTIONS.fake };
export function addToManifest(text, { section, statement, date = today() } = {}) {
  const name = ADDABLE[section]; if (!name) throw new Error(`say the section with --section ${Object.keys(ADDABLE).join('|')}`);
  const words = String(statement ?? '').replace(/\s+/g, ' ').trim(); if (!words) throw new Error('the line is empty: say it with --text "<the line>"');
  const body = text.replace(/\r\n/g, '\n').replace(/^---\n[\s\S]*?\n---\n/, ''); const stmts = contextStatements(body);
  if (section === 'screens') {
    const m = /^`([a-z0-9]+(?:-[a-z0-9]+)*)` \S/.exec(words); if (!m) throw new Error('a screen starts with its name in backticks, lowercase words joined by hyphens, then its title: `report` Monthly report (index.html)');
    if (stmts.some(s => s.section === SECTIONS.screens && keyOfStatement(s.section, s.text) === `screen:${m[1]}`)) throw new Error(`the manifest already has a screen \`${m[1]}\`: correct its line with \`buddy prototype confirm --line N --text "..."\``);
  }
  let t = text.replace(/\r\n/g, '\n');
  if (!contextSections(body).includes(name)) { const at = t.indexOf(`\n## ${SECTIONS.gone}\n`); t = at < 0 ? `${t.replace(/\n*$/, '\n')}\n## ${name}\n` : `${t.slice(0, at)}\n## ${name}\n${t.slice(at)}`; }
  return addStatement(t, { section: name, statement: words.endsWith(DECLARED) ? words : words + DECLARED, date });
}

export function manifestCard(m) {
  const out = ['This is how I read your prototype. Nothing here is confirmed until you say so.', ''];
  let section = '';
  for (const s of m.statements) {
    if (s.section !== section) { section = s.section; out.push('', section); }
    out.push(`  ${String(s.line).padStart(3)}. ${s.text.length > 110 ? s.text.slice(0, 107) + '...' : s.text} ${s.origin === 'human' ? `[confirmed ${s.date}]` : `[${s.origin ?? 'untagged'}]`}`);
  }
  out.push('', 'Reply "ok" to confirm all, a number and a correction to change one line, or tell me what is missing.');
  return out.join('\n');
}

// ---------------------------------------------------------------------------------------------------------------------------------
// A screen's fragment of the prototype's HTML (R155): the element(s) the evidence of Buddy's reading points at, each the smallest element whose
// markup holds that evidence (whitespace squashed as the reading's check does), in the order of the file, the ones inside another left out.
// At most `cap` characters; a longer one is cut and says so. -> { html, total, cut } or null when no evidence is found in the file.
export const FRAGMENT_CAP = 4000;
const flatten = html => {
  let flat = ''; const at = []; let space = false;
  for (let k = 0; k < html.length; k++) { if (/\s/.test(html[k])) { if (!space) { flat += ' '; at.push(k); } space = true; } else { flat += html[k]; at.push(k); space = false; } }
  const { root } = parseHtml(html); const els = []; walk(root, el => { if (el !== root) els.push(el); });
  return { flat, at, root, els };
};
// What the owner fixed in a screen (`data-buddy-zone="fixed"`): the texts of those elements inside the region the screen's evidence sits in, the nearest
// element around it that carries `data-buddy-screen`, else an `id`, else the whole file.
function fixedZones(html, evidence) {
  if (!html) return []; const { flat, at, root, els } = flatten(html); const out = [];
  for (const e of (evidence || []).map(squash).filter(Boolean)) {
    const i = flat.indexOf(e); if (i < 0) continue; const a = at[i], b = at[i + e.length - 1] + 1;
    const around = els.filter(x => x.start <= a && x.end >= b).sort((x, y) => (x.end - x.start) - (y.end - y.start));
    const region = around.find(x => x.attrs['data-buddy-screen'] !== undefined) ?? around.find(x => x.attrs.id) ?? root;
    walk(region, el => { if (el.attrs['data-buddy-zone'] === 'fixed') { const t = short(textOf(el) || el.attrs['aria-label'] || el.attrs.value || el.attrs.title || el.attrs.placeholder || el.attrs.name || '(no label)', 60); if (!out.includes(t)) out.push(t); } });
  }
  return out;
}
export function fragmentOf(html, evidence, { cap = FRAGMENT_CAP, file = '' } = {}) {
  const { flat, at, els } = flatten(html);
  const picked = []; const all = (evidence || []).map(squash).filter(Boolean); const share = Math.floor(cap / Math.max(1, all.length));   // each piece of evidence gets its part
  for (const e of all) {
    const i = flat.indexOf(e); if (i < 0) continue; const a = at[i], b = at[i + e.length - 1] + 1;
    const el = els.filter(x => x.start <= a && x.end >= b).sort((x, y) => (x.end - x.start) - (y.end - y.start))[0];
    const span = el?.tag === 'script' ? scriptSpan(html, a, b, el, cap, share) : el ? [el.start, el.end] : [a, b]; if (!picked.some(p => p[0] === span[0] && p[1] === span[1])) picked.push(span);
  }
  if (!picked.length) return null;
  const outer = picked.filter(p => !picked.some(q => q !== p && q[0] <= p[0] && q[1] >= p[1])).sort((x, y) => x[0] - y[0]);
  const whole = outer.map(([a, b]) => html.slice(a, b).trim()).join('\n<!-- ... -->\n'); const script = outer.every(p => p.script) ? { script: true } : {};
  if (whole.length <= cap) return { html: whole, total: whole.length, cut: false, ...script };
  return { html: `${whole.slice(0, cap)}\n<!-- cut by Buddy: ${cap} of ${whole.length} characters shown; the whole screen is in ${file || 'its file'} -->`, total: whole.length, cut: true, ...script };
}
// Evidence inside a <script> (a prototype that draws its screens from code, a field pilot): the smallest named function whose body holds it, which is
// the code that draws the screen, not the whole script cut at its start; with none, or one longer than `cap`, the lines around the evidence.
const FUNC_START = new RegExp(`\\bfunction\\s*\\*?\\s*[A-Za-z_$][\\w$]*\\s*\\(|\\b(?:const|let|var)\\s+[A-Za-z_$][\\w$]*\\s*=\\s*${FUNC}|['"]?[A-Za-z_$][\\w$-]*['"]?\\s*:\\s*${FUNC}`, 'g');
function scriptSpan(html, a, b, el, cap, share = cap) {
  const tag = span => Object.assign(span, { script: true }); const starts = [];
  FUNC_START.lastIndex = el.start; for (let m; (m = FUNC_START.exec(html)) && m.index < a;) starts.push(m);
  for (const m of starts.reverse()) {
    const open = html.indexOf('{', m.index + m[0].length); if (open < 0 || open > a || /[;`'"]/.test(html.slice(m.index + m[0].length, open))) continue;   // an arrow with no block body
    const end = blockEnd(html, open, el.end); if (end < b) continue;
    if (end - m.index <= cap) return tag([html.lastIndexOf('\n', m.index) + 1, end]); break;
  }
  const from = Math.max(el.start, a - Math.floor(share / 2)); const to = Math.min(el.end, b + Math.floor(share / 2));   // whole lines when they fit
  const lo = html.indexOf('\n', from); const hi = html.lastIndexOf('\n', to);
  return tag([lo >= 0 && lo < a ? lo + 1 : from, hi >= b ? hi : to]);
}
// Where the block opened at `i` (a `{`) closes, skipping strings, comments and the text of template literals; -1 when it does not close before `hi`.
function blockEnd(s, i, hi) {
  const stack = ['{']; let k = i + 1;
  while (k < hi && stack.length) {
    const c = s[k];
    if (stack.at(-1) === '`') { if (c === '\\') k++; else if (c === '`') stack.pop(); else if (c === '$' && s[k + 1] === '{') { stack.push('${'); k++; } k++; continue; }
    if (c === '/' && s[k + 1] === '/') { k = s.indexOf('\n', k); if (k < 0) return -1; continue; }
    if (c === '/' && s[k + 1] === '*') { k = s.indexOf('*/', k + 2); if (k < 0) return -1; k += 2; continue; }
    if (c === '"' || c === "'") { k++; while (k < hi && s[k] !== c && s[k] !== '\n') k += s[k] === '\\' ? 2 : 1; k++; continue; }
    if (c === '`' || c === '{') stack.push(c); else if (c === '}') stack.pop();
    k++;
  }
  return stack.length ? -1 : k;
}

// The screens a change covers, as ONE text that Dev and the reviewer both receive (R119: the same inputs, by file and never by paraphrase):
// what the owner confirmed in the manifest, then what Buddy's reading says of that screen (checked against the HTML) with the screen's own HTML.
// Without a usable reading the brief names the manifest and says so. `files` is where Dev finds the originals.
export function screensBrief(repo, names) {
  if (!names || !names.length) return null;
  const mf = path.join(repo, MANIFEST); const manifest = fs.existsSync(mf) ? readManifest(mf) : null;
  const files = prototypeFiles(repo); const r = files.length ? loadReading(repo) : null; const p = r && !r.errors.length ? fromReading(r.reading, files) : null;
  const lack = !files.length ? 'no HTML in the prototype folder' : !r ? `${READING} is missing: write it (buddy prototype facts, then buddy prototype draft --reading)` : r.errors.length ? `${READING} is not usable: ${r.errors.join('; ')}` : 'not found in the prototype folder now';
  const items = names.map(n => {
    const m = manifest?.screens.find(s => s.name === n); const s = p?.screens.find(x => x.name === n);
    return {
      name: n, title: s?.title ?? null, file: s ? `${PROTOTYPE_DIR}/${s.file}` : null, manifest: m ? { text: m.text, origin: m.origin, date: m.date } : null, evidence: s?.evidence ?? [],
      fake: s?.fake ?? [], fixed: s?.fixed ?? [], fragment: s ? fragmentOf(files.find(f => f.name === s.file)?.html ?? '', s.evidence, { file: `${PROTOTYPE_DIR}/${s.file}` }) : null,
      goes_to: (p?.flows ?? []).filter(f => f.from === n).map(f => ({ screen: f.to, via: f.via })), comes_from: (p?.flows ?? []).filter(f => f.to === n).map(f => ({ screen: f.from, via: f.via })),
    };
  });
  const block = i => {
    const lines = [`### Screen \`${i.name}\`${i.title ? ` — ${i.title}` : ''}${i.file ? ` (${i.file})` : ` (${lack})`}`];
    lines.push(i.manifest ? `Manifest: ${i.manifest.text} [${i.manifest.origin === 'human' ? `confirmed ${i.manifest.date}` : i.manifest.origin ?? 'untagged'}]` : 'Manifest: this screen is not in the manifest.');
    if (i.evidence.length) lines.push(`Where it is in the prototype: ${i.evidence.join(' | ')}`);
    if (i.goes_to.length) lines.push(`Goes to: ${i.goes_to.map(g => `${g.screen} (through "${g.via}")`).join(', ')}`);
    if (i.comes_from.length) lines.push(`Comes from: ${i.comes_from.map(g => `${g.screen} (through "${g.via}")`).join(', ')}`);
    if (i.fixed.length) lines.push(`Fixed by the owner (do not change without asking): ${i.fixed.join(' | ')}`);
    if (i.fake.length) lines.push(`Fake or only an example: ${i.fake.join(' | ')}`);
    const many = i.fragment?.html.includes('<!-- ... -->'); const cut = i.fragment?.cut ? `, cut at ${FRAGMENT_CAP} of ${i.fragment.total} characters` : '';
    if (i.fragment) lines.push(i.fragment.script ? `Its code in the prototype (the script that draws it: the function${many ? 's' : ''} holding what the reading points at${cut}):` : `Its HTML in the prototype (the element${many ? 's' : ''} the reading points at${cut}):`, i.fragment.script ? '```js' : '```html', i.fragment.html, '```');
    return lines.join('\n');
  };
  return { names, fingerprint: p?.fingerprint ?? null, items, text: items.map(block).join('\n\n') };
}
