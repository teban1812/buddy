#!/usr/bin/env node
// usage: see USAGE. The library new projects use (R104): kept once per user in the Buddy configuration.
import { setLibrary, unsetLibrary, libraryShowReport, publicUrl, LIBRARY_VAR } from '../src/init.mjs';
import { configFile } from '../src/config.mjs';

const USAGE = 'usage: buddy library --set <git url or folder> [--version <tag>]\n'
  + '       buddy library --show\n'
  + '       buddy library --unset';
const HELP = `${USAGE}
The library a new project takes its standards and base application from, set once for you (in ${configFile()}).
Which library buddy init uses, first match wins: its own --library and --version; the ${LIBRARY_VAR} variable
(<url or folder>, or <url or folder>#<version>); the library set here; Buddy's default library. Without a version,
the library's latest published version (its highest version tag) is used.`;

const argv = process.argv.slice(2);
const bad = m => { console.error(`error: ${m}\n${USAGE}`); process.exit(2); };
try {
  const [cmd, ...rest] = argv;
  if (cmd === '--help' || cmd === 'help') { console.log(HELP); process.exit(0); }
  if (!cmd || cmd === '--show') { if (rest.length) bad('--show takes no arguments'); console.log(libraryShowReport()); process.exit(0); }
  if (cmd === '--unset') {
    if (rest.length) bad('--unset takes no arguments');
    const had = unsetLibrary();
    console.log(had ? `Your Buddy configuration no longer names a library (it named ${publicUrl(had.source)}).` : 'Your Buddy configuration names no library; nothing to undo.');
    console.log(libraryShowReport()); process.exit(0);
  }
  if (cmd === '--set') {
    const [source, ...more] = rest; let version = null;
    if (!source || source.startsWith('--')) bad('--set needs a git url or a folder');
    if (more.length) { if (more[0] !== '--version' || !more[1] || more[1].startsWith('--') || more.length > 2) bad(`unexpected ${more.join(' ')}`); version = more[1]; }
    const l = setLibrary(source, version);
    console.log(`Your library is ${l.shown}${version ? ` at version ${version}` : l.local ? ', read at its last commit' : ', at its latest published version'} (kept in ${configFile()}).`);
    if (process.env[LIBRARY_VAR] && process.env[LIBRARY_VAR].trim()) console.log(`Note: the ${LIBRARY_VAR} variable is set and wins while it is set.`);
    process.exit(0);
  }
  bad(`unknown argument ${cmd}`);
} catch (e) { console.error(`error: ${e.message}`); process.exit(1); }
