// What waits for the owner is composed in English by Buddy's program (`buddy board --json`: `view`, else `waiting`); the panel shows it in
// Spanish with the same table as the board's page (`ES` in core/src/board.mjs). The panel cannot import from core (it is installed apart),
// so this is a copy, and core/test/panelwords.test.mjs fails when the two differ: change both together.
const n1 = (n, one, many) => (n === '1' ? one : many)
export const ES = [[/^try and accept: /, 'prueba y acepta: '], [/^decide: /, 'decide: '], [/^accept the milestone: /, 'acepta el hito: '], [/^answer: /, 'responde: '],
  [/: the work stopped after several reviews and needs your decision$/, ': el trabajo se detuvo tras varias revisiones y necesita tu decisión'],
  [/^merge branch (.+) into (.+): (\d+) slices? accepted$/, (_, br, tr, n) => `integra la rama ${br} en ${tr}: ${n} ${n1(n, 'cambio aceptado', 'cambios aceptados')}`],
  [/: (\d+) changes wait for your acceptance \(see each and answer: /, ': $1 cambios esperan tu aceptación (míralos y responde: '],
  [/^Outside any milestone: (\d+) changes wait for your acceptance \(see them: /, 'Sin hito: $1 cambios esperan tu aceptación (míralos: '],
  [/(\d+) departures? from the prototype to decide/, (_, n) => `${n} ${n1(n, 'desviación', 'desviaciones')} del prototipo por decidir`],
  [/the reviews left (\d+) notes?/, (_, n) => `las revisiones dejaron ${n} ${n1(n, 'nota', 'notas')}`],
  [/^risk appetite: /, 'apetito de riesgo: '],
  [/(\d+) risk-appetite line\(s\) not confirmed by the owner and not accepted as assumed$/, (_, n) => `${n} ${n1(n, 'línea sin confirmar por el dueño ni aceptada como supuesta', 'líneas sin confirmar por el dueño ni aceptadas como supuestas')}`],
  [/the "([^"]+)" section has no line yet$/, 'la sección "$1" aún no tiene líneas'],
  [/the context has no "([^"]+)" section$/, 'el contexto no tiene sección "$1"'],
  [/the context names "([^"]+)" as its risk section \(risk_section in its header\), and (the section has no line yet|it has no section with that heading)$/, (_, name, why) => `el contexto nombra "${name}" como su sección de riesgo (risk_section en su encabezado), y ${why.startsWith('the') ? 'la sección aún no tiene líneas' : 'no tiene ninguna sección con ese título'}`],
  [/^(\d+)( Must)? of what you asked for (?:has|have) no destination yet: /, (_, n, m) => `${n}${m || ''} de lo que pediste aún no ${n1(n, 'tiene', 'tienen')} destino: `],
  [/ \| and (\d+) more\b/, ' | y $1 más']]
export const es = text => ES.reduce((s, [re, to]) => s.replace(re, to), text)
// What a line of "what waits" shows: no command of Buddy's program (the button does it) and no code of a milestone on a group line. The board adds the commands in
// brackets or as a clause ("; confirm or correct each with buddy ...", ": read it whole and approve it with buddy ..."); they are cut here, after `es` (whose
// table needs the English bracket to match). The text board and the page keep them.
export const shown = (text, code) => (code === 'es' ? es(text) : text)
  .replace(/\s*\([^()]*\bbuddy [^()]*\)/g, '')
  .replace(/;\s*confirm or correct each with buddy .*$/, '')
  .replace(/[:,]\s*(?:then )?read it whole and approve it with buddy .*$/, '')
  .replace(/ \[[^\]]*\](?=: \d+ (?:changes wait for your|cambios esperan tu))/, '')
// The act a button names, by what waits: the same rules as the request it writes (register.tsx `ask`, view.js `ask`).
export const actOf = w => {
  if (w.kind === 'accept' && /^accept the milestone:/.test(w.text)) return 'milestone'
  if (w.kind === 'accept' && /^decide:/.test(w.text)) return 'decide'
  if (w.kind === 'accept' && /changes wait for your acceptance/.test(w.text)) return w.ref ? 'group' : 'groupNone'
  if (w.kind === 'accept') return 'accept'
  if (w.kind === 'answer') return 'answer'
  if (w.kind === 'merge') return 'merge'
  return 'other'
}

// The panel's own words, English by default and Spanish when the person set it (`buddy tools language es`). A hito is a milestone, a change may be
// cut into pieces, and a piece or a change is built task by task (R241). Anything else, or no language set, is English.
export const lang = code => (code === 'es' ? 'es' : 'en')
// The open milestone's bar (R285): the groups of the board page's bar, in its order (BARS in core/src/board.mjs: done, your turn, in progress, to define),
// counted by the board (`groups` of each milestone). A board from an older Buddy program has no groups: its accepted changes are done, the rest to define.
export const GROUPS = ['done', 'owner', 'agent', 'define']
export const groupsOf = m => m.groups ?? { done: m.changes.accepted, owner: 0, agent: 0, define: m.changes.total - m.changes.accepted }
const counts = (g, name) => GROUPS.filter(k => g[k]).map(k => `${g[k]} ${name(k, g[k])}`).join(' · ')
const G_EN = { done: 'done', owner: 'your turn', agent: 'in progress', define: 'to define' }
const G_ES = { done: 'hecho', owner: 'te toca a ti', agent: 'en marcha', define: 'por definir' }
export const TEXT = {
  en: {
    waits: 'Waiting for you', nothingWaits: 'Nothing is waiting for you.', now: 'Now', idle: 'Nothing is being built.', discovering: n => `Discovering the product: stage ${n} of 3 (${['research and brief', 'flows and wireframes', 'prototype and its test'][n - 1]})`, next: 'Next', queue: 'Nothing queued.',
    milestone: 'Milestone', change: 'Change', reading: 'Reading the board…', opened: 'Buddy panel opened.',
    piece: (n, t) => `Piece ${n} of ${t} of the change `, tasks: (d, t) => (d === t ? 'all tasks done; the review is left' : `${d} of ${t} tasks done`), progress: (g, t) => (t ? `${counts(g, k => G_EN[k])}, of ${t}` : 'no changes yet'),
    status: { refining: 'being defined', ready: 'ready', building: 'being built', blocked: 'blocked', delivered: 'delivered', rework: 'in rework', waits: 'waits for your go-ahead' },
    act: { group: 'Review the milestone', groupNone: 'Review the changes', milestone: 'Accept the milestone', decide: 'Decide', accept: 'Try and accept', answer: 'Answer', merge: 'Merge', other: 'Look at it' }, refresh: 'Refresh', page: 'Open the full board', time: 'en',
    noBuddy: 'This project has no Buddy (there is no docs/buddy).', noProgram: "I did not find Buddy's program: install his plugin (claude plugin install buddy@buddy) or open Buddy's project.",
    noAnswer: m => `The board did not answer: ${m}`, noPage: 'I could not open the board.',
    request: {
      milestone: r => `I want to accept the milestone ${r}`, decide: r => `I want to decide about ${r}`, group: r => `I want to review the changes of the milestone ${r}`, groupNone: 'Show me the changes waiting for my acceptance',
      accept: r => `Show me the summary to accept ${r}`, answer: r => `I want to answer the question ${r}`, merge: r => `What is needed to merge the branch ${r}?`, other: r => `What do you need from me about ${r}?`,
    },
  },
  es: {
    waits: 'Espera por ti', nothingWaits: 'Nada espera por ti.', now: 'Ahora', idle: 'Nadie está construyendo.', discovering: n => `Descubriendo el producto: etapa ${n} de 3 (${['investigación y brief', 'flujos y wireframes', 'prototipo y su prueba'][n - 1]})`, next: 'Sigue', queue: 'No hay nada en cola.',
    milestone: 'Hito', change: 'Cambio', reading: 'Leyendo el tablero…', opened: 'Panel de Buddy abierto.',
    piece: (n, t) => `Pieza ${n} de ${t} del cambio `, tasks: (d, t) => (d === t ? 'todas las tareas hechas; falta la revisión' : `${d} de ${t} tareas hechas`), progress: (g, t) => (t ? `${counts(g, (k, n) => (k === 'done' && n !== 1 ? 'hechos' : G_ES[k]))}, de ${t}` : 'aún sin cambios'),
    status: { refining: 'por definir', ready: 'lista', building: 'en construcción', blocked: 'bloqueada', delivered: 'entregada', rework: 'en retrabajo', waits: 'espera tu visto bueno' },
    act: { group: 'Revisar el hito', groupNone: 'Revisar los cambios', milestone: 'Aceptar el hito', decide: 'Decidir', accept: 'Probar y aceptar', answer: 'Responder', merge: 'Integrar', other: 'Verlo' }, refresh: 'Actualizar', page: 'Abrir el tablero completo', time: 'es',
    noBuddy: 'Este proyecto no tiene Buddy (no hay docs/buddy).', noProgram: 'No encontré el programa de Buddy: instala su plugin (claude plugin install buddy@buddy) o abre el proyecto de Buddy.',
    noAnswer: m => `El tablero no respondió: ${m}`, noPage: 'No pude abrir el tablero.',
    request: {
      milestone: r => `Quiero aceptar el hito ${r}`, decide: r => `Quiero decidir sobre ${r}`, group: r => `Quiero revisar los cambios del hito ${r}`, groupNone: 'Muéstrame los cambios que esperan mi aceptación',
      accept: r => `Muéstrame el resumen para aceptar ${r}`, answer: r => `Quiero responder la pregunta ${r}`, merge: r => `¿Qué hace falta para integrar la rama ${r}?`, other: r => `¿Qué necesitas de mí sobre ${r}?`,
    },
  },
}
