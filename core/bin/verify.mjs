#!/usr/bin/env node
// usage: verify.mjs <dir|file>... [--require-risk-confirmed] [--canonical] [--json]      schema, id, reference and state checks on Buddy files
//        verify.mjs theme <file.css>... [--json]                                         measure WCAG AA contrast of theme CSS files in light and dark
//        verify.mjs theme --sample [dir] [--out <file>]                                  generate a sample HTML page linking every CSS theme in dir
import fs from 'node:fs';
import path from 'node:path';
import { verify } from '../src/verify.mjs';
import { measureTheme, generateThemeSample } from '../src/theme.mjs';

const args = process.argv.slice(2);
if (args[0] === 'theme') {
  const rest = args.slice(1);
  if (rest.includes('--sample')) {
    let dir = 'docs/design/themes', out = 'docs/discovery/theme-sample.html';
    const pos = [];
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '--sample') continue;
      if (rest[i] === '--out') { out = rest[++i]; if (!out) { console.error('--out requires a file path'); process.exit(2); } continue; }
      if (rest[i].startsWith('--')) { console.error(`unknown option ${rest[i]}\nusage: verify.mjs theme --sample [dir] [--out <file>]`); process.exit(2); }
      pos.push(rest[i]);
    }
    if (pos.length > 1) { console.error('usage: verify.mjs theme --sample [dir] [--out <file>]'); process.exit(2); }
    if (pos.length === 1) dir = pos[0];
    try {
      const r = generateThemeSample(dir, out);
      console.log(`Wrote ${path.relative(process.cwd(), r.out) || r.out} linking ${r.themes.length} theme(s): ${r.themes.map(t => t.id).join(', ')}`);
      process.exit(0);
    } catch (e) { console.error(e.message); process.exit(2); }
  }
  const flags = rest.filter(a => a.startsWith('--')), files = rest.filter(a => !a.startsWith('--'));
  const unknown = flags.filter(f => f !== '--json');
  if (!files.length || unknown.length) {
    console.error(`${unknown.length ? `unknown option ${unknown.join(' ')}\n` : ''}usage: verify.mjs theme <file.css>... [--json]\n       verify.mjs theme --sample [dir] [--out <file>]`);
    process.exit(2);
  }
  const themes = [];
  for (const f of files) {
    if (!fs.existsSync(f) || !fs.statSync(f).isFile()) { console.error(`theme file not found: ${f}`); process.exit(2); }
    themes.push(measureTheme(fs.readFileSync(f, 'utf8'), f));
  }
  const totalPairs = themes.reduce((n, t) => n + t.pairs.length, 0);
  const failedPairs = themes.reduce((n, t) => n + t.failures.length, 0);
  if (flags.includes('--json')) console.log(JSON.stringify({ themes, totalPairs, failedPairs }, null, 1));
  else {
    for (const t of themes) for (const p of t.failures) {
      const detail = p.reason ? p.reason : `${p.ratio.toFixed(2)}:1 (needs ${p.min.toFixed(1)}:1)`;
      console.error(`${p.file}: ${p.mode}: ${p.pair}: ${detail}`);
    }
    console.log(`${themes.length} theme(s) checked, ${totalPairs} pair(s) measured, ${failedPairs} below WCAG AA`);
  }
  process.exit(failedPairs ? 1 : 0);
}

const flags = args.filter(a => a.startsWith('--')); const paths = args.filter(a => !a.startsWith('--'));
if (!paths.length) { console.error('usage: verify.mjs <dir|file>... [--require-risk-confirmed] [--canonical] [--json]'); process.exit(2); }
const unknown = flags.filter(f => !['--require-risk-confirmed', '--canonical', '--json'].includes(f));
if (unknown.length) { console.error(`unknown option ${unknown.join(' ')}\nusage: verify.mjs <dir|file>... [--require-risk-confirmed] [--canonical] [--json]`); process.exit(2); }
const r = verify(paths, { requireRiskConfirmed: flags.includes('--require-risk-confirmed'), canonical: flags.includes('--canonical') });
if (flags.includes('--json')) console.log(JSON.stringify(r, null, 1));
else { for (const p of r.problems) console.error(`${p.file}: ${p.where}: ${p.message}`); console.log(`${r.count} Buddy file(s) checked, ${r.problems.length} problem(s)`); }
process.exit(r.problems.length ? 1 : 0);
