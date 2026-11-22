#!/usr/bin/env node
// usage: node core/bin/scope.mjs --repo <dir> --base <ref> [--head <ref>] [--request <text>|--request-file <f>]
//        [--answers <answers.json>] [--batch <question-batch.md>]... [--context <context.md>] [--judge|--judge-request] [--json]
// Without --head the working tree (staged and unstaged) is compared with --base.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { traceScope, describe } from '../src/scope.mjs';
import { readContext, riskSources } from '../src/context.mjs';
import { answersFromBatch } from '../src/batch.mjs';
import { claudeJudge } from '../src/judge.mjs';

const argv = process.argv.slice(2); const o = { batch: [] }; const flags = new Set();
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]; if (!a.startsWith('--')) continue; const k = a.slice(2);
  if (['judge', 'judge-request', 'json'].includes(k)) flags.add(k); else if (k === 'batch') o.batch.push(argv[++i]); else o[k] = argv[++i];
}
if (!o.base) { console.error('usage: scope.mjs --repo <dir> --base <ref> [--head <ref>] [--request t] [--answers f.json] [--batch f.md] [--context f.md] [--judge|--judge-request] [--json]'); process.exit(2); }
const repo = o.repo || process.cwd();
const git = args => execFileSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 28 });
const diff = git(['diff', '-U0', o.base, ...(o.head ? [o.head] : [])]);

const answers = [...(o.answers ? JSON.parse(fs.readFileSync(o.answers, 'utf8')) : []), ...o.batch.flatMap(answersFromBatch)];
const risks = o.context ? riskSources(readContext(o.context)) : [];
const request = o['request-file'] ? fs.readFileSync(o['request-file'], 'utf8') : (o.request || '');
let cost = 0;
const result = await traceScope(diff, { request, answers, risks }, flags.has('judge') || flags.has('judge-request') ? { judgeRequest: flags.has('judge-request'), judge: claudeJudge({ onCost: c => { cost += c; } }) } : {});
if (cost) result.judge_cost_usd = Number(cost.toFixed(4));
console.log(flags.has('json') ? JSON.stringify(result, null, 1) : describe(result) + (cost ? `\n(judge cost ${cost.toFixed(4)} USD)` : ''));
