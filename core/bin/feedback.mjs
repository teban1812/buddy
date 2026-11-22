#!/usr/bin/env node
// usage:
//   feedback.mjs "<text>"            one line to the field log of Buddy's factory; nothing is written into this project
//   feedback.mjs --factory <path>    remember where Buddy's factory is (the BUDDY_FACTORY variable, when set, wins)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { factoryPath, setFactory, appendFeedback, projectName, buddyVersion, configFile } from '../src/feedback.mjs';

const MANIFEST = fileURLToPath(new URL('../.claude-plugin/plugin.json', import.meta.url));
const USAGE = 'usage: buddy feedback "<what happened>"\n       buddy feedback --factory <path of Buddy\'s factory repository>';
const HOW = `Tell Buddy where its factory (the repository where Buddy is built) is, once: buddy feedback --factory <path>\n(or set the BUDDY_FACTORY variable).`;
const argv = process.argv.slice(2);
try {
  if (argv[0] === '--factory') {
    if (!argv[1]) throw new Error(`--factory needs a path\n${USAGE}`);
    const abs = setFactory(argv[1]); console.log(`Buddy's factory is ${abs} (kept in ${configFile()})`);
    if (process.env.BUDDY_FACTORY && path.resolve(process.env.BUDDY_FACTORY) !== abs) console.log(`note: the BUDDY_FACTORY variable is set to ${process.env.BUDDY_FACTORY} and wins while it is set`);
    process.exit(0);
  }
  if (!argv.length || argv[0] === '--help' || argv[0] === 'help') {
    const f = factoryPath(); console.log(`${USAGE}\n\n${f ? `Buddy's factory: ${f.path} (from ${f.from})` : HOW}`); process.exit(argv.length ? 0 : 2);
  }
  if (argv[0].startsWith('--')) throw new Error(`unknown option ${argv[0]}\n${USAGE}`);
  const f = factoryPath(); if (!f) { console.error(`error: Buddy does not know where its factory is.\n${HOW}`); process.exit(1); }
  const r = appendFeedback(f.path, { text: argv.join(' '), project: projectName(), version: buddyVersion(MANIFEST) });
  console.log(`noted in ${r.file}:\n  ${r.line}`);
} catch (e) { console.error(`error: ${e.message}`); process.exit(1); }
