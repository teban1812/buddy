#!/usr/bin/env node
// usage: see USAGE. The setting of this environment: which tools it has and the word of each level (Dev and the reviewer work in Buddy's tool, R235).
import { effective, offers, resolveLevel, setWord, resetSetting, clearNotes, setLanguage, languageOf, languageSet, LANGUAGES, TOOLS, LEVELS } from '../src/tools.mjs';

const USAGE = 'usage: buddy tools                                          show the setting and what each tool offers today\n'
  + '       buddy tools word <claude|agy> <level> <word> [<effort>]  the word of a level (economical, balanced, strong), with an optional effort; - takes it away\n'
  + '       buddy tools language <en|es>                          the language of the panels beside the conversation (English when unset)\n'
  + '       buddy tools seen                                      clear the corrections Buddy made, once you have been told\n'
  + '       buddy tools reset                                     forget the setting and start again from what Buddy finds';
const bad = m => { console.error(`error: ${m}\n${USAGE}`); process.exit(2); };
try {
  const [cmd, ...a] = process.argv.slice(2);
  if (cmd === '--help' || cmd === 'help') { console.log(USAGE); process.exit(0); }
  if (cmd === 'word') { if (a.length < 3 || a.length > 4) bad('word takes a tool, a level, a word and optionally an effort'); setWord(a[0], a[1], a[2], a[3]); }
  else if (cmd === 'language') { if (a.length !== 1) bad('language takes one code: en or es'); setLanguage(a[0]); }
  else if (cmd === 'seen') clearNotes();
  else if (cmd === 'reset') console.log(resetSetting() ? 'The setting is forgotten.' : 'There was no setting.');
  else if (cmd) bad(`unknown argument ${cmd}`);
  const e = effective();
  console.log(`Setting of this environment (${e.file}; not shared through git)`);
  console.log(`Language of the panels: ${LANGUAGES[languageOf()]} (${languageOf()}), ${languageSet() ? 'set by you' : 'none set'}; change it with: buddy tools language <en|es>`);
  console.log(`Tools found: ${e.found.map(t => TOOLS[t]).join(', ') || 'none'}. Buddy runs in ${TOOLS[e.runsIn]}.`);
  console.log(`Dev builds with ${TOOLS[e.dev]}, and a fresh session of it reviews (a review by the other tool is yours to run at will).`);
  for (const t of e.found) {
    const o = offers(t);
    console.log(`\n${TOOLS[t]} offers: ${o.models.join(', ') || '(no list)'}${o.error ? ` [${o.error}]` : ''}\n  efforts: ${o.efforts.join(', ') || 'none'}`);
    for (const l of LEVELS) { const r = resolveLevel(t, l, { offer: o, save: false }); const w = e.levels[t][l]; console.log(`  ${l.padEnd(10)} word ${w.word ?? '(tool default)'}${w.effort ? ` + ${w.effort}` : ''} -> ${r.model ?? 'tool default'}${r.effort ? ` (effort ${r.effort})` : ''}${r.notes.length ? `   note: ${r.notes.join('; ')}` : ''}`); }
  }
  for (const n of e.notes) console.log(`\nChanged by Buddy: ${n}`);
} catch (e) { console.error(`error: ${e.message}`); process.exit(1); }
