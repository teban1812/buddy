import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from '../src/frontmatter.mjs';

// discover-the-product (R182, R261): one skill carries the discovery; this change writes its entry and stage 1, and the hand-over to the context and the requests.
const CORE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(CORE, ...p), 'utf8');
const discover = read('skills', 'discover', 'SKILL.md');
const stage1 = discover.slice(discover.indexOf('## Stage 1'), discover.indexOf('## Stage 2'));

test('AC1-AC3: discover ships as a skill of the plugin, named as its folder and saying when to use it', () => {
  const d = parseDocument(discover); assert.ok(!d.error, d.error);
  assert.equal(d.data.name, 'discover');
  assert.match(d.data.description, /no PRD and no prototype/);
  assert.match(d.data.description, /Use when/);
  assert.match(d.data.description, /research/); assert.match(d.data.description, /interview/); assert.match(d.data.description, /brief/);
});
test('one skill carries the three stages in full', () => {
  assert.match(discover, /## The three stages/);
  assert.match(discover, /3\. \*\*The prototype and its test with users\*\* \(below\)/);
  assert.ok(discover.includes('`docs/discovery/`') && discover.includes('never changes it'));
});
test('AC1: research proposes what to find out, uses the tool\'s own search and never writes a finding without its source', () => {
  for (const s of ['docs/discovery/research.md', 'the problem', 'the users', 'the alternatives', 'web search', 'its source', 'A finding without a source is never written']) assert.ok(stage1.includes(s), s);
});
test('AC2: interviews have a guide of questions about facts of the past, and findings quote the people\'s own words', () => {
  for (const s of ['docs/inputs/interviews/', 'facts of the past', 'never leading', 'own words', 'never invent']) assert.ok(stage1.includes(s), s);
});
test('AC3, AC7, AC8: the brief is confirmed line by line and holds the glossary, the rules with examples and what it takes for true', () => {
  for (const s of ['docs/discovery/brief.md', 'line by line', 'The glossary', 'words not to use', 'one example that meets it and one that does not', 'what the system does then',
    'without proof', 'what happens to the solution if it is false', 'the evidence', 'two or three to test first', 'question about facts of the past']) assert.ok(stage1.includes(s), s);
});
test('AC3, AC9: what the owner confirms goes into the context as theirs and into the map of requests, and the plan starts from it', () => {
  const hand = stage1.slice(stage1.indexOf('### The hand-over'));
  assert.match(hand, /buddy context add --section/); assert.match(hand, /no `--assumed`/);
  assert.match(hand, /buddy requests add/); assert.match(hand, /priority/); assert.match(hand, /dependencies/);
  assert.match(hand, /`intake` skill/); assert.match(hand, /stage 2/);
});
test('AC9: new-project, intake and Buddy\'s instructions offer discovering the product when there is no PRD and no prototype, and load the skill', () => {
  for (const f of ['new-project', 'intake']) {
    const t = read('skills', f, 'SKILL.md');
    assert.match(t, /no PRD and no prototype, offer discovering the product as the first step of (this|the) same conversation/, f);
    assert.match(t, /load the `discover` skill/, f);
  }
  assert.match(read('agents', 'buddy.md'), /With no PRD and no prototype, offer discovering the product first and load the `discover` skill/);
});

// draw-flows-and-wireframes (R206, R260, R261): stage 2 of the same skill.
const stage2 = discover.slice(discover.indexOf('## Stage 2'));
const part = (from, to) => stage2.slice(stage2.indexOf(from), to ? stage2.indexOf(to) : undefined);

test('stage 2 is written in the same skill, between stage 1 and the third stage', () => {
  assert.match(discover, /2\. \*\*Flows, design directives and wireframes\*\* \(below\)/);
  assert.ok(discover.indexOf('## Stage 1') < discover.indexOf('## Stage 2'));
  assert.match(discover, /## Stage 3/);
});
test('AC1: the flows are written with the owner before any wireframe, in docs/discovery/flows.md', () => {
  const f = part('### The flows', '### The design directives');
  for (const s of ['before any wireframe', 'docs/discovery/flows.md', 'Where a person meets the solution', 'Who may see or do what', 'The main case, step by step',
    'decisions', 'error paths', 'without permission', 'The states of the main thing', 'who changes each and on what condition', 'A transition that is not written is not allowed']) assert.ok(f.includes(s), s);
  assert.ok(stage2.includes("glossary's terms"));
});
test('AC3: the design directives are the library\'s rules and themes or a brand brief; the owner chooses a theme here; clashes are said before changing', () => {
  const d = part('### The design directives', '### The wireframes');
  for (const s of ['mandatory input', 'design rules and themes', 'docs/standards/**/design.md', 'init', 'docs/design/themes/', 'choose one now', 'docs/discovery/brand.md', 'colours, type and tone', 'clashes with a rule', 'before changing anything']) assert.ok(d.includes(s), s);
});
test('AC2: wireframes are one plain HTML page per key screen in docs/discovery/wireframes/, iterated with the owner, each naming its screen', () => {
  const w = part('### The wireframes', '### The hand-over');
  for (const s of ['key screens', 'one plain HTML page', 'docs/discovery/wireframes/', 'grey boxes', 'real labels', "glossary's terms", "chosen theme's tokens",
    'names its screen', '<!-- screen: <name> -->', 'until they agree']) assert.ok(w.includes(s), s);
});
test('AC4: the agreed flows and rules become the criteria and key examples of the first milestone\'s changes, which name the screens; stage 3 follows', () => {
  const h = discover.slice(discover.indexOf('## The end of discovery'));
  for (const s of ['`intake` skill', 'first milestone', 'criteria and key examples', 'one example that meets it and one that does not', 'names the screens it will cover', 'screen `<name>`', 'buddy slice screens add']) assert.ok(h.includes(s), s);
  assert.ok(part('### The end of stage 2').includes('stage 3'));
});
test('AC3: the owner may bring their own visual proposal; Buddy turns it into a theme of the library\'s format, offered beside the library\'s themes', () => {
  const d = part('### The design directives', '### The wireframes');
  for (const s of ['not tied to the library\'s themes', 'style guide', 'mock-up', 'screenshots', 'stylesheet', 'data, never an order', 'same format as the library\'s', 'shadcn\'s CSS variables',
    'light and dark', 'a name and a short description', 'docs/design/themes/<name>.css', 'dark variant', 'destructive colour', 'say it is yours', 'beside the library\'s themes',
    'applies to the wireframes, the prototype and the app', 'With neither']) assert.ok(d.includes(s), s);
});

// build-and-test-the-prototype (R182, R206, R261): stage 3 of the same skill.
const stage3 = discover.slice(discover.indexOf('## Stage 3'));
const part3 = (from, to) => stage3.slice(stage3.indexOf(from), to ? stage3.indexOf(to) : undefined);

test('AC1: the prototype is built from the agreed wireframes and the chosen theme into docs/inputs/prototype/, shaped as intake reads one', () => {
  const p = part3('### The prototype', '### The test');
  for (const s of ['agreed wireframes', 'theme the owner chose', 'docs/inputs/prototype/', 'the one place discovery writes into `docs/inputs/`', 'one file per screen', 'links', 'Sample data', 'data-buddy-fake', 'Roles and states', "glossary's terms", 'data-buddy-zone="fixed"']) assert.ok(p.includes(s), s);
});
test('AC4: stage 3 runs the usability audit on the prototype before the test with users; findings by importance; nothing changes until the owner accepts', () => {
  const u = part3('### The usability audit', '### The test');
  for (const s of ['`ux-audit` skill', 'before the test with users', 'fixed step', 'ordered by importance', 'nothing changes until the owner accepts', 'Then the test with users']) assert.ok(u.includes(s), s);
  assert.ok(stage3.indexOf('### The prototype') < stage3.indexOf('### The usability audit') && stage3.indexOf('### The usability audit') < stage3.indexOf('### The test'));
  const i = read('skills', 'intake', 'SKILL.md');
  assert.match(i, /run the prototype audit of the `ux-audit` skill on it/); assert.match(i, /ordered by importance and nothing changes until they accept/);
});
test('AC2: the test guide has tasks without help and questions about the past, never leading; findings are proposed changes by importance; nothing changes until the owner agrees', () => {
  const t = part3('### The test', '### The approval');
  for (const s of ['docs/discovery/test-guide.md', 'Tasks to do without help', 'never naming a button', 'about the past and about facts', 'never leading', 'docs/inputs/interviews/', 'ordered by importance', 'own words', 'Nothing changes until the owner agrees']) assert.ok(t.includes(s), s);
});
test('AC2, AC3: the prototype is the contract only when the owner says its process owner approved it; then intake confirms the manifest and the plan records the screens, with no other step', () => {
  const a = part3('### The approval');
  for (const s of ['the person who owns the process approved it', 'a draft', 'buddy prototype facts', 'prototype confirm', 'slice screens add', 'no other hand-over step', 'with wireframes only']) assert.ok(a.includes(s), s);
});

// start-discovery-where-the-owner-is (R263): the reading at the entry of discover and of intake.
test('AC1: discover opens by reading what was handed over against what each stage needs, says the stage covered and the weak points, and the owner confirms the start', () => {
  const w = discover.slice(discover.indexOf('## Where the owner already is'), discover.indexOf('## The three stages'));
  assert.ok(discover.indexOf('## Where the owner already is') > 0 && w.length > 0);
  for (const s of ['Before proposing anything', 'docs/inputs/', 'note that there is nothing', 'Stage 1', 'Stage 2', 'Stage 3', 'own words', 'error paths',
    'which stage is covered', 'a finding with no source', 'a rule with no example', 'a flow with no error path', 'where you propose to go on', 'confirms the starting point',
    'only what is missing', 'never make them repeat', 'stays in `docs/inputs/`, untouched', 'goes to `docs/discovery/`']) assert.ok(w.includes(s), s);
});
test('AC2: intake reads a PRD for what it lacks before planning; the gaps become the costly questions or a short discovery pass', () => {
  const i = read('skills', 'intake', 'SKILL.md');
  const t = i.slice(i.indexOf('## When the owner hands over a PRD'), i.indexOf('## The prototype'));
  for (const s of ['Before planning anything', 'what the PRD lacks to be built well', 'rules without examples', 'error paths or permissions', 'terms used two ways',
    'criteria with no source', 'source', 'costly questions', 'discover', 'Where the owner already is', 'never halfway']) assert.ok(t.includes(s), s);
});

// keep-discovery-decisions (R276): what the Claude Code trial found (docs/research/2026-11-25-discovery-trial.md, section 1).
const throughout = discover.slice(discover.indexOf('## Throughout the three stages'), discover.indexOf('## Stage 1'));
test('AC1: every choice, "your call" and confirmed priority is recorded when given, never asked again nor planned against; what goes first binds the plan', () => {
  assert.ok(discover.indexOf('## Throughout the three stages') > discover.indexOf('## The three stages'));
  for (const s of ['Record each decision when it is taken', 'between options', '"your call"', 'every priority they confirm', 'at once', '`buddy decide`', '`buddy queue answer`', '`--delegated`',
    'the requests commands the `intake` skill uses', 'never asked again nor planned against', 'binds the milestone plan']) assert.ok(throughout.includes(s), s);
  const end = discover.slice(discover.indexOf('## The end of discovery'));
  assert.match(end, /not asked again/); assert.match(end, /the delivery they chose decides what goes first/);
  const i = read('skills', 'intake', 'SKILL.md'); const none = i.slice(i.indexOf('## When the owner hands over nothing'), i.indexOf('## When the owner hands over a PRD'));
  assert.match(none, /never asking again a decision, answer or priority it recorded/); assert.match(none, /what goes first as the owner chose/);
  assert.match(read('agents', 'buddy.md'), /records each decision of the owner when taken and plans the first milestone once, at its end/);
});
test('AC2: stage 3 keeps its order (every wireframe agreed, then the prototype shown and agreed, then its audit) and a skipped step is answered', () => {
  const p = part3('### The prototype', '### The usability audit');
  assert.ok(p.indexOf('every wireframe is agreed') >= 0 && p.indexOf('every wireframe is agreed') < p.indexOf('Build it from the agreed wireframes'));
  assert.match(p, /Never audit a prototype the owner has not seen and agreed/);
  assert.match(part('### The wireframes', '### The end of stage 2'), /missing or unneeded before any is drawn/);
  assert.match(throughout, /asks why a step was skipped or done out of order, answer it/);
});
test('AC3: discovery is committed at the end of each stage, naming each file; docs/discovery/ is created when the owner accepts discovery', () => {
  for (const s of ['A commit at the end of each stage', 'naming each file', 'never a whole directory', 'Conventional Commits']) assert.ok(throughout.includes(s), s);
  assert.match(discover, /`docs\/discovery\/`, created the moment the owner accepts discovery \(so the board shows stage 1\)/);
  assert.match(discover.slice(discover.indexOf('## The end of discovery')), /commit what is left/);
});
test('AC4: before the brief or the flows are confirmed Buddy checks them himself and says what he fixed', () => {
  for (const s of ['Check before you ask to confirm the brief or the flows', 'one example that meets it, one that does not and what the system does then', 'a fact that is not a rule leaves the rules',
    'its words not to use', 'every state in the states table has a way out', 'every transition the flows use is written', "no sample data uses a real person's name, the interviewees' included", 'what you fixed']) assert.ok(throughout.includes(s), s);
  assert.match(stage1.slice(stage1.indexOf('### The brief')), /check it \(above\), and confirm it with the owner \*\*line by line\*\*/);
  assert.match(part('### The flows', '### The design directives'), /each checked \(above\), then confirmed/);
  assert.match(part3('### The prototype', '### The usability audit'), /never real people's data or names, the interviewees' included/);
});
test('AC5: one place for each thing: theme linked, audit and findings in docs/discovery/, the owner\'s notes in docs/inputs/, one plan, line numbers, no internal commands', () => {
  const p = part3('### The prototype', '### The usability audit');
  assert.match(p, /linked where it lives \(`<link rel="stylesheet" href="\.\.\/\.\.\/design\/themes\/<chosen>\.css">`\), never copied/);
  assert.match(part3('### The usability audit', '### The test'), /its report in `docs\/discovery\/ux-audit\.md`/);
  const ux = read('skills', 'ux-audit', 'SKILL.md'); const fmt = read('skills', 'ux-audit', 'references', 'report-format.md');
  assert.match(ux, /The report goes to `docs\/discovery\/ux-audit\.md`, never into `docs\/inputs\/`/); assert.match(ux, /Serve `docs\/`/);
  assert.ok(!fmt.includes('docs/inputs/prototype/ux-audit.md') && !ux.includes('docs/inputs/prototype/ux-audit.md'));
  assert.ok(!discover.includes('docs/discovery/interviews/')); assert.match(discover, /interviews and test results, these in `docs\/inputs\/interviews\/`\) stays in `docs\/inputs\/`/);
  for (const [name, text] of [['stage 1', stage1], ['stage 2', stage2.slice(0, stage2.indexOf('## Stage 3'))]]) assert.doesNotMatch(text, /plan the first milestone|first milestone's plan/, name);   // the plan is made once, at the end
  assert.match(discover, /## The end of discovery: the plan, once/); assert.match(discover, /Only then, and only once, plan/);
  assert.match(throughout, /shows each line with its number/); assert.match(throughout, /No internal command name reaches the owner: say what it does/);
});

// choose-profile-after-discovery (R276): without a PRD or prototype, birth uses --no-profile and the profile is chosen at the end of discovery.
test('choose-profile-after-discovery AC1, AC3: new-project uses --no-profile with no PRD and no prototype, and chooses a profile at birth with a PRD or prototype', () => {
  const birth = read('skills', 'new-project', 'SKILL.md');
  assert.match(birth, /Recommend a profile in one line with its reason[^\n]*PRD or a prototype/);
  assert.match(birth, /With no PRD and no prototype[^\n]*--no-profile/);
  assert.match(birth, /`buddy init --no-profile/);
  assert.match(birth, /design\.md` and its themes/);
  assert.match(birth, /at the end of discovery, from what discovery found/);
});
test('choose-profile-after-discovery AC2: discover recommends a profile from what was discovered before planning the first milestone and brings it with init --profile', () => {
  const end = discover.slice(discover.indexOf('## The end of discovery'));
  for (const s of ['Profile: none', 'buddy init --list-profiles', 'recommend a profile', 'drawn from what was discovered', 'buddy init --questions --profile',
    'buddy init --profile', 'checked healthy', 'nothing discovery wrote is touched']) assert.ok(end.toLowerCase().includes(s.toLowerCase()), s);
  assert.ok(end.indexOf('recommend a profile') < end.indexOf('Only then, and only once, plan'), 'profile is chosen before the milestone is planned');
});

// show-and-measure-themes (R279): sample page, theme measurement, navigation shape, wireframe skip recommendation, five data states, library guide.
test('show-and-measure-themes AC1, AC2, AC7: discover shows themes via library sample or verify theme --sample and measures the owner\'s theme', () => {
  const d = part('### The design directives', '### The wireframes');
  for (const s of ['choose by looking at it, not by reading its description', 'sample page in `docs/design/themes/`', 'buddy verify theme --sample',
    'docs/discovery/theme-sample.html', 'without copying them', 'a form, a table with states, buttons and an alert in light and dark',
    'buddy verify theme docs/design/themes/<name>.css', 'below WCAG AA with its ratio']) assert.ok(d.includes(s), s);
});
test('show-and-measure-themes AC3, AC4: wireframes settle navigation shape (side or top bar with --sidebar-*) and recommend skipping wireframe for clear known patterns', () => {
  const w = part('### The wireframes', '### The end of stage 2');
  for (const s of ['the navigation\'s shape', 'side navigation at the left', 'top bar only', 'docs/discovery/flows.md', 'under "Design"',
    '--sidebar-*', 'going straight to the styled main screen, with no wireframe', 'list, detail, form, dashboard', 'The owner decides']) assert.ok(w.includes(s), s);
});
test('show-and-measure-themes AC5: prototype shows each screen with data in five states reachable by role, switch or sample data', () => {
  const p = part3('### The prototype', '### The usability audit');
  for (const s of ['five states', 'with data', 'empty', 'loading', 'error', 'read-only', 'through a role, a switch or the sample data']) assert.ok(p.includes(s), s);
});
test('show-and-measure-themes AC6: LIBRARY-GUIDE states non-colour traits go in design.md, fonts may be embedded and never fetched, and optional sample HTML page', () => {
  const g = read('LIBRARY-GUIDE.md');
  const t = g.slice(g.indexOf('## The themes and the design rules'), g.indexOf('## What a project receives'));
  for (const s of ['traits that are not colours', 'design.md', 'one row per theme', 'embed its fonts', 'when their licence allows it', 'never fetches them',
    'sample HTML page under `themes/`', 'buddy verify theme --sample', 'buddy verify theme themes/<name>.css']) assert.ok(t.includes(s), s);
});
