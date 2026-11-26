#!/usr/bin/env node
// usage (also as `buddy requests ...`): the map of what was asked, docs/buddy/requests.md, one per project
//   requests.mjs add "<text>" --source "<where it comes from>"     a requirement of the inputs; prints its new id (RQ1, RQ2...)
//   requests.mjs set <RQ id> --to <change or milestone>             covered by it
//                            | --excluded "<reason, or the change or milestone that leaves it out>"
//                            | --deferred "<reason>" | --waiting <question id>
//   requests.mjs priority <RQ id> must|should|could|none [--why "<reason>"]   the owner's MoSCoW priority (Won't is what is excluded or deferred)
//                            | --from-prd "<citation>"              stated by the PRD (a newer one replaces it); never over the owner's
//                            | --proposed --why "<reason>"          proposed by Buddy until the owner confirms it; never over the owner's or the PRD's
//   requests.mjs why <RQ id>                                        its priority, where it comes from and why, in one line
//   requests.mjs depend <RQ id> --on <RQ id> [--on ...] [--assumed] what it needs first; --assumed: Buddy's proposal, not the owner's word
//   requests.mjs undepend <RQ id> --on <RQ id> [--on ...]          it no longer depends on them
//   requests.mjs confirm <RQ id>                                    the owner confirms its assumed dependencies
//   requests.mjs confirm --priorities                               the owner confirms every priority Buddy proposed
//   requests.mjs confirm --dependencies                             the owner confirms every dependency Buddy proposed, on every request
//   requests.mjs order [--json]                                     the order of the work and its warnings; writes nothing
//   requests.mjs list [--open] [--json]                             every item with its destination (--open: those with no destination yet)
//   requests.mjs remove <RQ id>                                     only while it has no destination and nothing depends on it
//   all take [--repo <dir>]
import { listSlices, listMilestones } from '../src/slicestore.mjs';
import { refreshIndex } from '../src/index.mjs';
import { recordApproval } from '../src/proc.mjs';
import { REQUESTS, addRequest, setRequest, removeRequest, listRequests, destinationText, requestTotals, requestTotalsText, setPriority, confirmPriorities, priorityWhyText, priorityOrigin, dependRequest, undependRequest, confirmRequest, confirmDependencies, confirmedDependenciesText, requestOrder, itemText, priorityText, dependsText } from '../src/requests.mjs';

const argv = process.argv.slice(2); const pos = []; const o = { on: [] }; const bool = new Set(['json', 'open', 'assumed', 'proposed', 'priorities', 'dependencies']);
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith('--')) { pos.push(argv[i]); continue; }
  const k = argv[i].slice(2); const v = bool.has(k) ? true : argv[++i] ?? true;
  if (k === 'on') { if (v !== true) o.on.push(v); } else o[k] = v;
}
const repo = o.repo || process.cwd(); const cmd = pos.shift();
const need = (v, what) => { if (!v || v === true) { console.error(`missing ${what}`); process.exit(2); } return v; };
const out = (obj, text) => console.log(o.json ? JSON.stringify(obj, null, 1) : text);
const line = x => `${x.id}  ${itemText(x)}`;
try {
  if (cmd === 'add') {
    const r = addRequest(repo, need(pos[0], '"<text>"'), need(o.source, '--source "<where it comes from>"'));
    out(r, r.id);
  } else if (cmd === 'set') {
    const r = setRequest(repo, need(pos[0], '<RQ id>'), { to: o.to, excluded: o.excluded, deferred: o.deferred, waiting: o.waiting });
    out(r, `${r.id} ${destinationText(r)}`);
  } else if (cmd === 'priority') {
    const word = x => x.priority[0].toUpperCase() + x.priority.slice(1);
    const r = setPriority(repo, need(pos[0], '<RQ id>'), need(pos[1], 'must|should|could|none'), { fromPrd: o['from-prd'] === undefined ? undefined : need(o['from-prd'], '--from-prd "<citation>"'), proposed: !!o.proposed, why: o.why === undefined ? undefined : need(o.why, '--why "<reason>"') });
    out(r, `${r.id} ${r.priority && priorityText(r) === "Won't" ? `${r.priority}, read as Won't while ${destinationText(r)}` : priorityText(r) ?? 'no priority'}${{ prd: ' from the PRD', assumed: ' proposed' }[r.priority_origin] ?? ''}${r.was ? ` (changed from ${word(r.was)}, ${r.was.priority_why}, to ${word(r)}, ${r.priority_why})` : ''}`);
  } else if (cmd === 'why') {
    const id = need(pos[0], '<RQ id>'); const it = listRequests(repo).items.find(x => x.id === id);
    if (!it) throw new Error(`no request ${id}`); out({ id, priority: it.priority ?? null, priority_origin: priorityOrigin(it), priority_why: it.priority_why ?? null }, priorityWhyText(it));
  } else if (cmd === 'depend' || cmd === 'undepend') {
    const id = need(pos[0], '<RQ id>'); if (!o.on.length) need(null, '--on <RQ id>');
    const r = cmd === 'depend' ? dependRequest(repo, id, o.on, { assumed: !!o.assumed }) : undependRequest(repo, id, o.on);
    out(r, `${r.id} ${dependsText(r) ?? 'depends on nothing'}`);
  } else if (cmd === 'confirm' && [pos.length > 0, !!o.priorities, !!o.dependencies].filter(Boolean).length > 1) {
    throw new Error('confirm <RQ id> (its dependencies), --priorities (every priority Buddy proposed) or --dependencies (every dependency Buddy proposed): not more than one');
  } else if (cmd === 'confirm' && o.dependencies) {
    const done = confirmDependencies(repo); out({ confirmed: done }, confirmedDependenciesText(done)); recordApproval(repo, [REQUESTS], 'confirmation of the dependencies Buddy proposed');
  } else if (cmd === 'confirm' && o.priorities) {
    const ids = confirmPriorities(repo); out({ confirmed: ids }, ids.length ? `confirmed ${ids.length} ${ids.length === 1 ? 'priority' : 'priorities'} proposed by Buddy (${ids.join(', ')}): now yours` : 'no priority proposed by Buddy waits for confirmation'); recordApproval(repo, [REQUESTS], 'confirmation of the priorities Buddy proposed');
  } else if (cmd === 'confirm') {
    const r = confirmRequest(repo, need(pos[0], '<RQ id>')); out(r, `${r.id} ${dependsText(r)} (confirmed ${r.confirmed.join(', ')})`); recordApproval(repo, [REQUESTS], `confirmation of the dependencies of ${r.id}`);
  } else if (cmd === 'remove') {
    const r = removeRequest(repo, need(pos[0], '<RQ id>')); out(r, `removed ${r.id}`);
  } else if (cmd === 'order') {
    const { index } = refreshIndex(repo); const bad = index.problems.find(p => p.file === 'docs/buddy/requests.md');   // read from the index (R138)
    if (bad) throw new Error(`docs/buddy/requests.md: ${bad.message}`);
    const r = requestOrder(index.requests || []);
    out({ order: r.order.map(x => x.id), warnings: r.warnings, cycles: r.cycles }, !r.order.length ? '(nothing to build: no request that is not excluded or deferred)'
      : [...r.order.map((x, i) => `${i + 1}. ${line(x)}`), ...(r.warnings.length ? ['', `Warnings (${r.warnings.length})`, ...r.warnings.map(w => `  - ${w}`)] : [])].join('\n'));
  } else if (cmd === 'list') {
    const all = listRequests(repo); const items = (o.open ? all.items.filter(x => !x.destination) : all.items).map(x => (x.priority ? { ...x, priority_origin: priorityOrigin(x) } : x));
    const t = requestTotals(all.items, new Map([...listMilestones(repo), ...listSlices(repo)].map(s => [s.data.id, s.data.status])));
    out(items, !all.exists ? '(no map of what was asked yet: buddy requests add "<text>" --source "<where>")'
      : [...items.map(line), ...(t ? [...(items.length ? [''] : []), requestTotalsText(t)] : [])].join('\n'));
  } else { console.error('usage: requests.mjs add "<text>" --source "<where>" | set <RQ id> --to|--excluded|--deferred|--waiting <...> | priority <RQ id> must|should|could|none [--from-prd "<citation>" | --proposed --why "<reason>" | --why "<reason>"] | why <RQ id> | depend <RQ id> --on <RQ id>... [--assumed] | undepend <RQ id> --on <RQ id>... | confirm <RQ id> | confirm --priorities | confirm --dependencies | order [--json] | list [--open] [--json] | remove <RQ id>'); process.exit(2); }
} catch (e) { console.error(`refused: ${e.message}`); process.exit(1); }
