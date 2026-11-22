#!/usr/bin/env node
// usage: node core/bin/view.mjs --dir <folder with the change's records> [--slice <id>] [--scope scope.json] [--evidence evidence.json]
//        [--repo <dir> --base <ref> [--head <ref>]] [--out view.html] [--text]
// Writes one static HTML page (no external assets) or, with --text, prints the business-terms summary.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { loadStory } from '../src/story.mjs';
import { renderView, summaryText } from '../src/view.mjs';
import { branchState } from '../src/proc.mjs';

const argv = process.argv.slice(2); const o = {}; for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) { const k = argv[i].slice(2); o[k] = k === 'text' ? true : argv[++i]; }
if (!o.dir) { console.error('usage: view.mjs --dir <records folder> [--slice id] [--scope f.json] [--evidence f.json] [--repo d --base ref] [--out f.html] [--text]'); process.exit(2); }
try {
  const story = loadStory(o.dir, { slice: o.slice });
  const json = f => (f ? JSON.parse(fs.readFileSync(f, 'utf8')) : undefined);
  const scope = json(o.scope); const evidence = json(o.evidence);
  let commits = [];
  if (o.repo && o.base) commits = execFileSync('git', ['log', '--reverse', '--format=%h%x1f%s', `${o.base}..${o.head || 'HEAD'}`], { cwd: o.repo, encoding: 'utf8' }).trim().split('\n').filter(Boolean).map(l => { const [h, s] = l.split('\x1f'); return { h, s }; });
  for (const e of story.errors) console.error('warning: ' + e);
  const merge = o.repo && story.slice.accepted ? branchState(o.repo, story.slice.branch) : undefined;      // read from git when asked, never stored (R63)
  if (o.text) console.log(summaryText(story, { scope, merge }));
  else { const out = o.out || 'view.html'; fs.writeFileSync(out, renderView(story, { scope, evidence, commits, merge })); console.log(`wrote ${out}`); }
} catch (e) { console.error(`error: ${e.message}`); process.exit(1); }
