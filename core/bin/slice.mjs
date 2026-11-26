#!/usr/bin/env node
// usage (also as `buddy start|step|status|move|criteria|excludes|milestone|move-to`):
//   slice.mjs start <title> --request <text> [--name <name>] [--in <change> | --milestone <milestone>] [--kind feat|fix|...] [--ac <text>]... [--exclude <text>]... [--dep <id>]... [--branch <b>] [--repo <dir>] [--json]
//                                      opens a change in the backlog (docs/buddy/backlog/<date>-<name>/change.md), or with --milestone in that
//                                      milestone's changes/ folder, or with --in adds a slice to a change (R87, R118);
//                                      without --name, the name is proposed from the title (R86, R89)
//   slice.mjs milestone card <milestone>                                the card before the go-ahead: what will be built and in what order, the doubts that wait for the owner, the assumptions made
//   slice.mjs milestone review <milestone>                              the script of the review at the end of a milestone: promised and delivered, the order to try, and for each change how to try it and what the checks found
//   slice.mjs milestone goal <milestone> "<text>" --by owner          the owner rewords a milestone's goal, in any state; the earlier wording stays in the record with its date (R250)
//   slice.mjs milestone start <title> --request <goal> [--name <name>] [--ac <text>]... [--exclude <text>]... [--branch <b>] [--repo <dir>] [--json]
//                                      opens a milestone (docs/buddy/milestones/<date>-<name>/milestone.md); it moves through the states with `move`
//   slice.mjs move-to <change> <milestone | backlog> [--repo <dir>] [--json]   moves a change's folder, everything in it, keeping its date and name
//   slice.mjs rank <id> before|after <other-id> [--repo <dir>] [--json]        orders a change before or after another in the same milestone or the backlog
//   slice.mjs list [--repo <dir>] [--json]                              the changes in rank order, under their milestone, then the backlog
//   slice.mjs show <id> [--repo <dir>]
//   slice.mjs rename <id> <new name> [--repo <dir>] [--json]  while refining; a change's folder keeps its date; every record that names it follows
//   slice.mjs accept-card <id>                                          what Buddy presents to the Product Owner before accepting: the assumptions to confirm (R59)
//   slice.mjs move <id> <state> [--by owner] [--channel chat|cli|view] [--repo <dir>] [--json]    a legal move only; `accepted` needs --by owner
//   slice.mjs step add <id> <text> [--under <n>] | step done <id> <n> | step undo <id> <n> | step drop <id> <n> --why "<the decision that voided it>"   [--repo <dir>] [--json]
//   slice.mjs screens add <id> <screen>... | screens remove <id> <screen>...   the prototype's screens a change covers (R107); only while refining, and confirmed ones to be ready
//   slice.mjs divergence add <id> --screen <s> --prototype "<what it does>" --built "<what was built>" --why "<reason>" [--kind improvement|divergence]   Dev declares a departure from the prototype (R127), while building
//   slice.mjs divergence decide <id> <V id | all> accept|reject --by owner [--channel chat|cli|view]   the owner's verdict on the accept card, once delivered; accepting needs every departure accepted
//   slice.mjs divergence remove <id> <V id>                             Dev withdraws one it has undone
//   slice.mjs try set <id> <criterion> --steps "<what to do>" --expect "<what to see>"   how to try one acceptance criterion (Dev writes it while it builds; the milestone review uses it)
//   slice.mjs try remove <id> <criterion>                               withdraws it
//   slice.mjs unverified accept <id> <screen> --by owner [--channel chat|cli|view] [--note "<why>"]   the owner decides nobody tries again to verify a screen the reviewer could not (it never becomes a pass)
//   slice.mjs unverified undo <id> <screen>                              it is a screen to verify again
//   slice.mjs criteria add <id> <text> | criteria edit <id> <AC id> <text> | criteria remove <id> <AC id>   [--repo <dir>] [--json]
//   slice.mjs excludes add <id> <text> | excludes edit <id> <X id> <text> | excludes remove <id> <X id>     [--repo <dir>] [--json]
//                                      only while refining: the goal is fixed when the change is ready (R67, R94, R109)
//   slice.mjs assume <id> "<text>" --if-otherwise "<what changes for the owner>"   announces an assumption before building (R136): at most five, while refining or ready
//   slice.mjs assume <id> none                                          the change was studied and needs no assumption (refused when it has some)
//   slice.mjs assume <id> confirm all|<A id> --by owner | assume <id> correct <A id> --criterion "<text>" | --exclude "<text>" --by owner
//                                      the owner's answer, refused without --by owner (RQ1); a correction carries its text in the same command (exactly one of the two), added as a
//                                      criterion or an exclusion under their rules (only while refining, the vague-words warning) (R139)
//                                      moving to building with assumptions not confirmed prints a warning naming them
//   slice.mjs decision <id> <n> costly|cheap [--by owner]   reclassifies decision n nobody specified, of the slice's latest checkpoint (R136):
//                                      Buddy may only raise one to costly; lowering one to cheap is the owner's, with --by owner (R139);
//                                      it is kept in the slice's record, the evidence stays as the checkpoint wrote it (R140)
//   start, milestone start, criteria add|edit and move <id> ready print a warning line for each vague criterion (fast, easy, TBD...),
//   and `vague` in --json; it never refuses (R94)
import fs from 'node:fs';
import path from 'node:path';
import { milestoneCard } from '../src/startcard.mjs';
import { milestoneReview } from '../src/review.mjs';
import { howtoSet, howtoRemove } from '../src/slicestore.mjs';
import { recordApproval } from '../src/proc.mjs';
import { planFiles, unverifiedAccept, unverifiedUndo, assumeAdd, assumeNone, assumeSet, reclassifyDecision, divergenceDecide, divergenceAdd, divergenceRemove, screensAdd, screensRemove, startSlice, startMilestone, moveChangeTo, rankChange, renameSlice, listSlices, listMilestones, readSlice, moveSlice, stepAddTo, stepSetIn, stepDropIn, stepsOf, acceptCard, goalAdd, goalSet, goalRemove, GOAL_FIELDS, rewordMilestoneGoal } from '../src/slicestore.mjs';

const argv = process.argv.slice(2); const pos = []; const o = { ac: [], exclude: [], dep: [] }; const bool = new Set(['json']);
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith('--')) { pos.push(argv[i]); continue; }
  const k = argv[i].slice(2);
  if (bool.has(k)) o[k] = true; else if (Array.isArray(o[k])) o[k].push(argv[++i]); else o[k] = argv[++i];
}
const repo = o.repo || process.cwd(); const cmd = pos.shift();
const need = (v, what) => { if (!v) { console.error(`missing ${what}`); process.exit(2); } return v; };
const out = (obj, text) => console.log(o.json ? JSON.stringify(obj, null, 1) : text);
// a vague criterion is a warning on the output, never a refusal (R94): one line each, and `vague` in --json
const warned = (text, vague = []) => [text, ...vague.map(v => `warning: ${v.message}`)].join('\n');
try {
  if (cmd === 'start') {
    const r = startSlice({ repo, title: need(pos[0], '<title>'), request: need(o.request, '--request'), name: o.name, kind: o.kind, criteria: o.ac, excludes: o.exclude, inChange: o.in, milestone: o.milestone, dependsOn: o.dep, branch: o.branch });
    out({ id: r.id, file: r.file, change: r.change, milestone: r.milestone, status: r.data.status, rank: r.data.rank, proposed: r.proposed, shortened: r.shortened, vague: r.vague, ...(r.data.screens ? { screens: r.data.screens } : {}) }, warned(`${r.change ? `added ${r.id} to ${r.change}` : `started ${r.id}${r.milestone ? ` in the milestone ${r.milestone}` : ''}`} (${r.data.kind}, refining, rank ${r.data.rank})${r.proposed ? `, name proposed from the title${r.shortened ? ', shortened' : ''}` : ''}${r.data.screens ? `\ncovers its change's screens: ${r.data.screens.join(', ')} (drop the ones it does not build with buddy slice screens remove ${r.id} <screen>)` : ''}\n${r.file}`, r.vague));
  } else if (cmd === 'milestone') {
    const msub = pos.shift();
    if (msub === 'review') { console.log(milestoneReview(repo, need(pos[0], '<milestone>')).trimEnd()); process.exit(0); }   // the script of the review at the end of a milestone
    if (msub === 'card') { console.log(milestoneCard(repo, need(pos[0], '<milestone>')).trimEnd()); process.exit(0); }   // what Buddy presents before the owner gives the go-ahead
    if (msub === 'goal') { const r = rewordMilestoneGoal(repo, need(pos[0], '<milestone>'), need(pos[1], '"<new goal>"'), { by: o.by }); out({ id: r.data.id, request: r.request }, `the goal of ${r.data.id} now reads: ${r.request}`); recordApproval(repo, [r.file], `new goal of the milestone ${r.data.id}`); process.exit(0); }   // the owner's words; the earlier wording stays in the record
    if (msub !== 'start') { console.error('usage: milestone goal <milestone> "<new goal>" --by owner | milestone start <title> --request <goal> [--name <name>] [--ac <text>]... [--exclude <text>]... | milestone card <milestone> | milestone review <milestone>'); process.exit(2); }
    const r = startMilestone({ repo, title: need(pos[0], '<title>'), request: need(o.request, '--request'), name: o.name, criteria: o.ac, excludes: o.exclude, branch: o.branch });
    out({ id: r.id, file: r.file, status: r.data.status, rank: r.data.rank, proposed: r.proposed, shortened: r.shortened, vague: r.vague }, warned(`started the milestone ${r.id} (refining)${r.proposed ? `, name proposed from the title${r.shortened ? ', shortened' : ''}` : ''}\n${r.file}`, r.vague));
  } else if (cmd === 'move-to') {
    const r = moveChangeTo(repo, need(pos[0], '<change>'), need(pos[1], '<milestone name | backlog>'));
    out(r, `${r.id} moved ${r.to ? `into the milestone ${r.to}` : 'to the backlog'}: ${path.relative(repo, r.dir)}`);
  } else if (cmd === 'rank') {
    const r = rankChange(repo, need(pos[0], '<id>'), need(pos[1], 'before | after'), need(pos[2], '<other-id>'));
    out(r, `${r.id} placed ${r.where} ${r.other} (rank ${r.rank}${r.respaced ? ', re-spaced' : ''})`);
  } else if (cmd === 'rename') {
    const r = renameSlice(repo, need(pos[0], '<id>'), need(pos[1], '<new name>'));
    out(r, [`renamed ${r.from} to ${r.to}: ${path.relative(repo, r.file)}`, ...r.changed.map(f => `  followed: ${f}`)].join('\n'));
  } else if (cmd === 'list') {
    const all = listSlices(repo); const ms = listMilestones(repo);
    const line = (s, pad = '') => { const st = stepsOf(s); return `${pad}${s.data.id}  ${s.data.status.padEnd(9)} ${s.data.kind.padEnd(8)} ${s.data.title}${st.length ? `  [${st.filter(x => x.done).length}/${st.length}]` : ''}`; };
    // with milestones: each milestone and its changes, then the backlog (R118); without one, the backlog alone, as before
    const text = !ms.length ? all.map(s => line(s)) : [...ms.flatMap(m => [line(m), ...all.filter(s => s.milestone === m.data.id).map(s => line(s, '  '))]), 'backlog (no milestone)', ...all.filter(s => !s.milestone).map(s => line(s, '  '))];
    out([...ms, ...all].map(s => ({ id: s.data.id, title: s.data.title, kind: s.data.kind, status: s.data.status, rank: s.data.rank, change: s.change, milestone: s.milestone ?? null, steps: stepsOf(s).length, steps_done: stepsOf(s).filter(x => x.done).length })),
      all.length || ms.length ? text.join('\n') : '(no slices)');
  } else if (cmd === 'show') { const s = readSlice(repo, need(pos[0], '<id>')); console.log(o.json ? JSON.stringify({ ...s.data, steps: stepsOf(s) }, null, 1) : fs.readFileSync(s.file, 'utf8')); }
  else if (cmd === 'accept-card') console.log(acceptCard(repo, need(pos[0], '<id>')).trimEnd());
  else if (cmd === 'move') {
    const r = moveSlice(repo, need(pos[0], '<id>'), need(pos[1], '<state>'), { by: o.by, channel: o.channel });
    const unconfirmed = (r.unconfirmed || []).map(a => ({ message: `assumption ${a.id} is not confirmed by the owner: ${a.text}` }));
    out({ id: r.id, status: r.data.status, ...(r.pieces ? { pieces: r.pieces } : {}), ...(r.vague ? { vague: r.vague } : {}), ...(r.unconfirmed ? { unconfirmed: r.unconfirmed } : {}), ...(r.no_screens ? { no_screens: r.no_screens } : {}) }, warned(`${r.id} is now ${r.data.status}${r.pieces?.length ? `, with its delivered pieces: ${r.pieces.join(', ')}` : ''}`, [...(r.vague || []), ...unconfirmed, ...(r.no_screens ? [r.no_screens] : [])]));
    // the owner's acceptance, and his go-ahead for a milestone (recorded by moving it to building), are committed at once (R281)
    const goAhead = r.data.status === 'building' && r.data.kind === 'milestone';   // the go-ahead takes the milestone's whole plan with it (R282)
    const what = r.data.status === 'accepted' ? `acceptance of ${r.id}` : goAhead ? `go-ahead for the milestone ${r.id} and its plan` : null;
    if (what) recordApproval(repo, goAhead ? planFiles(repo, r.id) : r.files || [r.file], what);
  } else if (cmd === 'step') {
    const sub = pos.shift(); const id = need(pos[0], '<id>');
    if (sub === 'add') { const r = stepAddTo(repo, id, need(pos[1], '<text>'), { under: o.under }); out({ id, step: r.num }, `added step ${r.num} to ${id}`); }
    else if (sub === 'done' || sub === 'undo') { const n = need(pos[1], '<n>'); stepSetIn(repo, id, n, sub === 'done'); out({ id, step: n, done: sub === 'done' }, `step ${n} of ${id} ${sub === 'done' ? 'done' : 'reopened'}`); }
    else if (sub === 'drop') { const n = need(pos[1], '<n>'); stepDropIn(repo, id, n, need(o.why, '--why "<the decision that voided it>"')); out({ id, step: n, dropped: true }, `step ${n} of ${id} dropped`); }
    else { console.error('usage: step add <id> <text> [--under n] | step done <id> <n> | step undo <id> <n> | step drop <id> <n> --why "<text>"'); process.exit(2); }
  } else if (cmd === 'divergence') {
    const sub = pos.shift(); const id = need(pos[0], '<id>');
    if (sub === 'add') { const r = divergenceAdd(repo, id, { screen: need(o.screen, '--screen'), prototype: need(o.prototype, '--prototype "what the prototype does"'), built: need(o.built, '--built "what was built"'), why: need(o.why, '--why "<reason>"'), kind: o.kind }); out({ id, departure: r.entry }, `declared ${r.ref} (${r.entry.kind}) on ${r.entry.screen} of ${id}`); }
    else if (sub === 'decide') { const r = divergenceDecide(repo, id, need(pos[1], '<V id> | all'), need(pos[2], 'accept | reject'), { by: o.by, channel: o.channel }); out({ id, decided: r.decided, status: r.status }, `${r.decided.join(', ')} ${r.status} for ${id}`); recordApproval(repo, [r.file], `verdict on departures from the prototype of ${id} (${r.decided.join(', ')} ${r.status})`); }
    else if (sub === 'remove') { const r = divergenceRemove(repo, id, need(pos[1], '<V id>')); out({ id, removed: r.ref }, `withdrew ${r.ref} from ${id}`); }
    else { console.error('usage: divergence add <id> --screen <s> --prototype "<what it does>" --built "<what was built>" --why "<reason>" [--kind improvement|divergence] | divergence remove <id> <V id> | divergence decide <id> <V id | all> accept|reject --by owner'); process.exit(2); }
  } else if (cmd === 'try') {
    const sub = pos.shift(); const id = need(pos[0], '<id>');
    if (sub === 'set') { const r = howtoSet(repo, id, need(pos[1], '<criterion>'), { steps: need(o.steps, '--steps "<what to do>"'), expect: need(o.expect, '--expect "<what to see>"') }); out({ id, criterion: r.criterion }, `how to try ${r.criterion} of ${id} is written`); }
    else if (sub === 'remove') { const r = howtoRemove(repo, id, need(pos[1], '<criterion>')); out({ id, criterion: r.criterion }, `the way to try ${r.criterion} of ${id} is withdrawn`); }
    else { console.error('usage: try set <id> <criterion> --steps "<what to do>" --expect "<what to see>" | try remove <id> <criterion>'); process.exit(2); }
  } else if (cmd === 'unverified') {
    const sub = pos.shift(); const id = need(pos[0], '<id>');
    if (sub === 'accept') { const r = unverifiedAccept(repo, id, need(pos[1], '<screen>'), { by: o.by, channel: o.channel, note: o.note }); out({ id, screen: r.screen }, `${r.screen} of ${id} stays unverified by your decision; the check still reads "not run", never a pass`); recordApproval(repo, [r.file], `decision to leave ${r.screen} of ${id} unverified`); }
    else if (sub === 'undo') { const r = unverifiedUndo(repo, id, need(pos[1], '<screen>')); out({ id, screen: r.screen }, `${r.screen} of ${id} is a screen to verify again`); }
    else { console.error('usage: unverified accept <id> <screen> --by owner [--channel chat|cli|view] [--note "<why>"] | unverified undo <id> <screen>'); process.exit(2); }
  } else if (cmd === 'assume') {
    const id = need(pos[0], '<id>'); const act = { confirm: 'confirmed', correct: 'corrected' }[pos[1]];
    if (act && pos[2] && /^(all|A\d+)$/.test(pos[2])) {
      if (act === 'corrected' && (o.criterion == null) === (!o.exclude.length)) throw new Error(`say the correction of ${pos[2]} in the same command (exactly one): assume ${id} correct ${pos[2]} --criterion "<text>" | --exclude "<text>"`);
      if (o.exclude.length > 1) throw new Error('one --exclude per correction');
      const r = assumeSet(repo, id, pos[2], act, { by: o.by, ...(act === 'corrected' ? (o.criterion != null ? { criterion: o.criterion } : { exclude: o.exclude[0] }) : {}) });
      out({ id, [act]: r.changed, assumptions: r.data.assumptions, ...(r.correction ? { correction: r.correction, vague: r.vague } : {}) }, warned(`${r.changed.join(', ')} ${act} for ${id}${r.correction ? `, written as ${r.field === 'criteria' ? 'criterion' : 'exclusion'} ${r.correction}` : ''}`, r.vague));
      recordApproval(repo, [r.file], `${act === 'confirmed' ? 'confirmation' : 'correction'} of ${r.changed.join(', ')} of ${id}`);
    }
    else if (pos[1] === 'none' && pos.length === 2 && o['if-otherwise'] == null) { assumeNone(repo, id); out({ id, assumptions: [] }, `${id} is studied and needs no assumption`); }
    else { const r = assumeAdd(repo, id, need(pos[1], '"<text>"'), need(o['if-otherwise'], '--if-otherwise "<what changes for the owner>"')); out({ id, assumption: r.entry }, `announced ${r.ref} on ${id} (proposed): ${r.entry.text}`); }
  } else if (cmd === 'decision') {
    const r = reclassifyDecision(repo, need(pos[0], '<id>'), need(pos[1], '<n>'), need(pos[2], 'costly | cheap'), { by: o.by }); out(r, `decision ${r.n} of ${r.id} is now ${r.costly ? 'costly' : 'cheap'}${r.by === 'owner' ? ', by the owner' : ''}: ${r.text}`);
    if (r.by === 'owner') recordApproval(repo, [r.file], `${r.costly ? 'raising' : 'lowering'} of decision ${r.n} of ${r.id} to ${r.costly ? 'costly' : 'cheap'}`);
  } else if (cmd === 'screens') {
    const sub = pos.shift(); const id = need(pos[0], '<id>'); const names = pos.slice(1);
    if (sub === 'add') { const r = screensAdd(repo, id, names); out({ id, screens: r.data.screens }, `${id} covers: ${r.data.screens.join(', ')}`); }
    else if (sub === 'remove') { const r = screensRemove(repo, id, names); out({ id, screens: r.data.screens || [] }, `${id} covers: ${(r.data.screens || []).join(', ') || '(no screens)'}`); }
    else { console.error('usage: screens add <id> <screen>... | screens remove <id> <screen>...'); process.exit(2); }
  } else if (cmd in GOAL_FIELDS) {
    const g = GOAL_FIELDS[cmd]; const sub = pos.shift(); const id = need(pos[0], '<id>'); const ref = `<${g.prefix} id>`;
    if (sub === 'add') { const r = goalAdd(repo, id, cmd, need(pos[1], '<text>')); out({ id, [cmd]: r.data[cmd], ...(cmd === 'criteria' ? { vague: r.vague } : {}) }, warned(`added ${g.one} ${r.ref} to ${id}`, r.vague)); }
    else if (sub === 'edit') { const r = goalSet(repo, id, cmd, need(pos[1], ref), need(pos[2], '<text>')); out({ id, [cmd]: r.data[cmd], ...(cmd === 'criteria' ? { vague: r.vague } : {}) }, warned(`corrected ${g.one} ${r.ref} of ${id}`, r.vague)); }
    else if (sub === 'remove') { const r = goalRemove(repo, id, cmd, need(pos[1], ref)); out({ id, [cmd]: r.data[cmd] || [] }, `removed ${g.one} ${r.ref} from ${id}`); }
    else { console.error(`usage: ${cmd} add <id> <text> | ${cmd} edit <id> ${ref} <text> | ${cmd} remove <id> ${ref}`); process.exit(2); }
  } else { console.error('usage: slice.mjs start|milestone|move-to|rank|list|show|rename|move|step|assume|decision|screens|divergence|try|unverified|criteria|excludes (see the header of this file)'); process.exit(2); }
} catch (e) { console.error(`refused: ${e.message}`); process.exit(1); }
