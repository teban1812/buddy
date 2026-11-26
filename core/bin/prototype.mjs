#!/usr/bin/env node
// usage: prototype.mjs facts [--json] | draft --reading [--title <t>] | card | confirm (--all | --line N [--text "<corrected>"])... | add --section screens|flows|fake --text "<line>"
//        | check [--require-confirmed] [--json] | screens [--json]     [--repo <dir>]
// The prototype is the experience contract (R107, R116, R126, R131). It lives in docs/inputs/prototype/ (HTML first). `facts` lists what it holds without deciding, for Buddy to write its reading (docs/inputs/prototype/reading.json); `draft` writes docs/inputs/prototype/manifest.md with every
// line assumed, from Buddy's reading, checked against the HTML (what you confirmed is kept when the prototype changes); `confirm` and `add` are you.
import fs from 'node:fs';
import path from 'node:path';
import { recordApproval } from '../src/proc.mjs';
import { prototypeFiles, prototypeFacts, loadReading, fromReading, draftManifest, readManifest, confirmManifest, addToManifest, manifestProblems, manifestCard, MANIFEST, PROTOTYPE_DIR, READING } from '../src/prototype.mjs';

const a = process.argv.slice(2); const cmd = a.shift(); const o = { line: [] }; const bool = new Set(['json', 'all', 'require-confirmed', 'reading']);
for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) { const k = a[i].slice(2); if (bool.has(k)) o[k] = true; else if (k === 'line') o.line.push(a[++i]); else o[k] = a[++i]; }
const repo = o.repo || process.cwd(); const file = path.join(repo, MANIFEST);
const need = () => { const f = prototypeFiles(repo); if (!f.length) { console.error(`no HTML found in ${PROTOTYPE_DIR}/ (put the prototype there)`); process.exit(1); } return f; };
const q = s => `"${String(s).slice(0, 40)}"`;
try {
  if (cmd === 'facts') {
    const f = prototypeFacts(need());
    if (o.json) console.log(JSON.stringify(f, null, 1));
    else for (const x of f.files) {
      const attrs = c => [c.href !== undefined ? `href=${c.href ?? '(none)'}` : '', ...Object.entries(c.data).map(([k, v]) => `${k}="${v}"`), c.onclick ? `onclick="${c.onclick.slice(0, 40)}"` : ''].filter(Boolean).join(' ');
      console.log(`${x.name}: ${x.ids.length} id(s), ${x.links.length} link(s), ${x.buttons.length} button(s), ${x.headings.length} heading(s), ${x.forms.length} form(s), ${x.scripts} script(s)`);
      if (x.headings.length) console.log(`  headings: ${x.headings.slice(0, 12).map(h => q(h.text)).join(', ')}`);
      for (const c of [...x.links, ...x.buttons].slice(0, 20)) console.log(`  ${c.href !== undefined ? 'link  ' : 'button'} ${q(c.text)} ${attrs(c)}`);
      if (x.functions.length) console.log(`  script functions: ${x.functions.slice(0, 30).join(', ')}`);
    }
    if (!o.json) console.log(`(the whole list: prototype facts --json; Buddy's reading goes in ${READING})`);
  } else if (cmd === 'draft') {
    const files = need(); if (!o.reading) throw new Error(`a draft comes only from Buddy's reading: write it first (\`prototype facts\`, then ${READING}), then \`prototype draft --reading\``);
    const r = loadReading(repo); if (!r) throw new Error(`no reading yet: write ${READING} (see prototype facts)`); if (r.errors.length) throw new Error(`${READING}: ${r.errors.join('; ')}`); const p = fromReading(r.reading, files);
    const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, draftManifest(p, { title: o.title || 'Prototype manifest', existing }));
    const m = readManifest(file); console.log(`wrote ${MANIFEST}${o.reading ? ` from ${READING}` : ''}: ${m.screens.length} screen(s), ${m.statements.length} statement(s), ${m.statements.filter(s => s.origin === 'human').length} already confirmed by you`);
    if (p.problems?.length) console.log(`\n${p.problems.length} line(s) not backed by the prototype, marked on the card (fix the reading or drop them before showing it):\n${p.problems.map(x => `  ${x}`).join('\n')}`);
    console.log(`\n${manifestCard(m)}`);
  } else if (cmd === 'card') console.log(manifestCard(readManifest(file)));
  else if (cmd === 'confirm') {
    const corrections = {}; if (o.text) { if (o.line.length !== 1) throw new Error('--text needs exactly one --line'); corrections[o.line[0]] = o.text; }
    if (!o.all && !o.line.length) throw new Error('say what to confirm: --all, or --line N');
    const r = confirmManifest(fs.readFileSync(file, 'utf8'), { lines: o.line, all: !!o.all, corrections }); fs.writeFileSync(file, r.text); console.log(`confirmed line(s): ${r.changed.join(', ') || '(none new)'}`);
    if (r.changed.length) recordApproval(repo, [file], `confirmation of line(s) ${r.changed.join(', ')} of the prototype's manifest`);   // committed at once (R281)
  } else if (cmd === 'add') {
    if (!fs.existsSync(file)) throw new Error(`no manifest yet: run \`buddy prototype draft\` first (${MANIFEST})`);
    const r = addToManifest(fs.readFileSync(file, 'utf8'), { section: o.section, statement: o.text });
    if (r.added) fs.writeFileSync(file, r.text); console.log(r.added ? `added under "${r.section}": ${r.line}` : `already in "${r.section}": nothing written`);
  } else if (cmd === 'check') {
    const r = manifestProblems(repo); for (const p of r.problems) console.error(p);
    const gate = o['require-confirmed'] && r.exists && r.unconfirmed.length;
    if (gate) console.error(`${r.unconfirmed.length} screen(s) not confirmed by you yet (lines ${r.unconfirmed.join(', ')})`);
    if (o.json) console.log(JSON.stringify(r, null, 1)); else if (r.exists) console.log(`${r.screens.length} screen(s), ${r.screens.filter(s => s.origin === 'human').length} confirmed`);
    process.exit(r.problems.length || gate ? 1 : 0);
  } else if (cmd === 'screens') {
    const m = readManifest(file); const rows = m.screens.map(s => ({ name: s.name, confirmed: s.origin === 'human', date: s.date }));
    console.log(o.json ? JSON.stringify(rows, null, 1) : rows.map(r => `${r.name.padEnd(24)} ${r.confirmed ? `confirmed ${r.date}` : 'not confirmed'}`).join('\n'));
  } else { console.error('usage: prototype.mjs facts|draft|card|confirm|add|check|screens (see the header of this file)'); process.exit(2); }
} catch (e) { console.error(`refused: ${e.message}`); process.exit(1); }
