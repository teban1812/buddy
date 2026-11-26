import test from 'node:test';
import assert from 'node:assert/strict';
import { ES } from '../src/board.mjs';
import { ES as PANEL_ES, es, shown, actOf } from '../../panel/claude/hooks/words.js';

// Claude Code's panel shows what waits for the owner in Spanish with the board page's own table (core/src/board.mjs, ES). The panel is installed apart and cannot
// import from core, so it keeps a copy; this test fails when the two differ, so there is one wording (buddy-mod, build-claude-panel).
const LINES = [
  'try and accept: Drop a step [drop-a-voided-step] (1 departure from the prototype to decide; the reviews left 3 notes)',
  'try and accept: Save books [save-books] (the reviews left 1 note)', 'decide: Save books [save-books]: the work stopped after several reviews and needs your decision',
  'accept the milestone: Version 2 [v2]', 'answer: Which database? [q1] (for Save books [save-books])',
  'merge branch feature/x into main: 1 slice accepted', 'merge branch feature/x into main: 3 slices accepted',
  'Version 0.5.0 [v0-5-0]: 4 changes wait for your acceptance (see each and answer: buddy milestone review v0-5-0)',
  'Outside any milestone: 2 changes wait for your acceptance (see them: buddy slice list, then buddy slice accept-card <change>)',
  'the work needs 2 departures from the prototype to decide', 'risk appetite: not confirmed',
  'risk appetite: 2 risk-appetite line(s) not confirmed by the owner and not accepted as assumed',
  'risk appetite: 1 risk-appetite line(s) not confirmed by the owner and not accepted as assumed',
  'risk appetite: the "Risk appetite" section has no line yet',
  'risk appetite: the context has no "Risk appetite" section',
  'risk appetite: the context names "Apetito de riesgo" as its risk section (risk_section in its header), and the section has no line yet',
  'risk appetite: the context names "Apetito de riesgo" as its risk section (risk_section in its header), and it has no section with that heading',
  '1 of what you asked for has no destination yet: Export CSV [RQ1]',
  '5 of what you asked for have no destination yet: A [RQ1] | B [RQ2] | C [RQ3] | and 2 more (buddy requests list --open)',
  '1 Must of what you asked for has no destination yet: Sign in [RQ1]',
  '4 Must of what you asked for have no destination yet: A [RQ1] | B [RQ2] | C [RQ3] | and 1 more (buddy requests list --open)',
];

test('the panel\'s Spanish for what waits is the board page\'s table', () => {
  assert.deepEqual(PANEL_ES.map(([re]) => re.source), ES.map(([re]) => re.source));
  for (const l of LINES) assert.equal(es(l), ES.reduce((s, [re, to]) => s.replace(re, to), l), l);
  assert.match(es(LINES[0]), /^prueba y acepta: .*1 desviación del prototipo por decidir; las revisiones dejaron 3 notas/);
});

// R259: a line of what waits drops the command the text board adds in brackets, in both languages, and a button names its act.
test('the panel drops the board\'s bracketed command and names each act', () => {
  assert.equal(shown(LINES[7], 'en'), 'Version 0.5.0: 4 changes wait for your acceptance');
  assert.equal(shown(LINES[7], 'es'), 'Version 0.5.0: 4 cambios esperan tu aceptación');
  assert.equal(shown(LINES[8], 'es'), 'Sin hito: 2 cambios esperan tu aceptación');
  assert.equal(shown(LINES[1], 'es'), 'prueba y acepta: Save books [save-books] (las revisiones dejaron 1 nota)');
  const w = (kind, text, ref = 'x') => ({ kind, text, ref });
  assert.deepEqual([w('accept', LINES[7]), w('accept', LINES[8], null), w('accept', LINES[3]), w('accept', LINES[2]), w('accept', LINES[1]), w('answer', LINES[4]), w('merge', LINES[5]), w('other', 'x')].map(actOf),
    ['group', 'groupNone', 'milestone', 'decide', 'accept', 'answer', 'merge', 'other']);
});

// R259, review: no line shows a command of Buddy's program, whatever the line, and a group line shows no milestone code.
test('no line of what waits shows a command, in either language', () => {
  const cases = [
    ['3 priorities proposed by Buddy wait for your confirmation (buddy requests confirm --priorities, or change the ones you disagree with)', '3 priorities proposed by Buddy wait for your confirmation'],
    ['2 dependencies Buddy proposed wait for your confirmation (buddy requests list to see them, then buddy requests confirm --dependencies, or confirm <RQ> one by one)', '2 dependencies Buddy proposed wait for your confirmation'],
    ['2 line(s) of s1.md, the record of the step s1, wait for your confirmation: line 3 (a), line 4 (b); confirm or correct each with buddy context confirm s1.md --line <n> --by owner, then read it whole and approve it with buddy context approve s1.md --by owner', '2 line(s) of s1.md, the record of the step s1, wait for your confirmation: line 3 (a), line 4 (b)'],
    ['s1.md, the record of the step s1, changed after you approved it (2026-11-01): read it whole and approve it with buddy context approve s1.md --by owner again', 's1.md, the record of the step s1, changed after you approved it (2026-11-01)'],
    ['s1.md, the record of the step s1, waits for your approval: read it whole and approve it with buddy context approve s1.md --by owner', 's1.md, the record of the step s1, waits for your approval'],
    [LINES[7], 'Version 0.5.0: 4 changes wait for your acceptance'], [LINES[8], 'Outside any milestone: 2 changes wait for your acceptance'],
  ];
  for (const [line, want] of cases) { assert.equal(shown(line, 'en'), want); assert.doesNotMatch(shown(line, 'es'), /buddy [a-z]|--by|--line/); }
  assert.equal(shown(LINES[7], 'es'), 'Version 0.5.0: 4 cambios esperan tu aceptación');
  assert.equal(shown(LINES[0], 'en'), LINES[0], 'a single change keeps its ref and notes');
});

// R276 AC1: in Spanish, the panels show the lines of the risk appetite and of requests with no destination in Spanish.
test('risk appetite and requests with no destination are shown in Spanish', () => {
  assert.equal(shown('risk appetite: 2 risk-appetite line(s) not confirmed by the owner and not accepted as assumed', 'es'),
    'apetito de riesgo: 2 líneas sin confirmar por el dueño ni aceptadas como supuestas');
  assert.equal(shown('risk appetite: 1 risk-appetite line(s) not confirmed by the owner and not accepted as assumed', 'es'),
    'apetito de riesgo: 1 línea sin confirmar por el dueño ni aceptada como supuesta');
  assert.equal(shown('risk appetite: the "Risk appetite" section has no line yet', 'es'),
    'apetito de riesgo: la sección "Risk appetite" aún no tiene líneas');
  assert.equal(shown('risk appetite: the context has no "Risk appetite" section', 'es'),
    'apetito de riesgo: el contexto no tiene sección "Risk appetite"');
  assert.equal(shown('risk appetite: the context names "Apetito de riesgo" as its risk section (risk_section in its header), and the section has no line yet', 'es'),
    'apetito de riesgo: el contexto nombra "Apetito de riesgo" como su sección de riesgo (risk_section en su encabezado), y la sección aún no tiene líneas');
  assert.equal(shown('1 of what you asked for has no destination yet: Export CSV [RQ1]', 'es'),
    '1 de lo que pediste aún no tiene destino: Export CSV [RQ1]');
  assert.equal(shown('5 of what you asked for have no destination yet: A [RQ1] | B [RQ2] | C [RQ3] | and 2 more (buddy requests list --open)', 'es'),
    '5 de lo que pediste aún no tienen destino: A [RQ1] | B [RQ2] | C [RQ3] | y 2 más');
  assert.equal(shown('1 Must of what you asked for has no destination yet: Sign in [RQ1]', 'es'),
    '1 Must de lo que pediste aún no tiene destino: Sign in [RQ1]');
});
