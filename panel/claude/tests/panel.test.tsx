import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'buddy-panel',
  component: 'Pane',
  requestId: 'buddy-panel',
  props: { title: 'Buddy', isFocused: false, bodyColumns: 50, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

const BOARD = {
  now: '2026-11-22T23:08:24Z',
  current: [{ id: 'shape', title: 'Tests are classified', change: 'board', step: { n: 2, total: 4, text: 'Measure the slow files' } }],
  slices: [
    { id: 'board', title: 'The board refreshes itself', change: null, rank: 1 },
    { id: 'shape', title: 'Tests are classified', change: 'board', rank: 2, steps: { done: 1, total: 4 } },
    { id: 'later', title: 'Later piece', change: 'board', rank: 3 },
  ],
  next: { id: 'report-work-mix', title: 'See how the work is split', status: 'refining', milestone: 'v0-5-0', waits_for: [] },
  milestones: [
    { id: 'v0-4-0', title: 'Version 0.4.0', status: 'accepted', changes: { accepted: 28, total: 28 } },
    { id: 'v0-5-0', title: 'Version 0.5.0', status: 'building', changes: { accepted: 7, total: 14 }, groups: { done: 7, owner: 3, agent: 2, define: 2 } },
  ],
  // The board's own lines: a change once with its count of review notes (never a piece alone), and several of one hito in one line.
  waiting: [{ kind: 'accept', text: 'try and accept: Drop a step [drop-a-voided-step] (the reviews left 3 notes)', ref: 'drop-a-voided-step', since: null }],
  view: [
    { kind: 'accept', text: 'try and accept: Drop a step [drop-a-voided-step] (the reviews left 3 notes)', ref: 'drop-a-voided-step', since: null },
    {
      kind: 'accept',
      text: 'Version 0.5.0 [v0-5-0]: 2 changes wait for your acceptance (see each and answer: buddy milestone review v0-5-0)',
      ref: 'v0-5-0',
      since: null,
      under: [{ kind: 'accept', text: 'try and accept: Live board [live-board] (1 departure from the prototype to decide)', ref: 'live-board', since: null }],
    },
    { kind: 'answer', text: 'answer: Which database? [q1]', ref: 'q1', since: null },
  ],
}

const ran: string[] = []
const argvs: string[][] = []
const done = (exitCode: number, stdout = '') => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
// `language` is the person's language, as Buddy's setting of the machine holds it (find.js answers it); the board's reads are the other runs.
function engine(on: any, run: () => { value: unknown }, language = '') {
  on('command.register', () => ({ value: { command: 'buddy-panel' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('process.run', (_: unknown, e: { argv: string[] }) => {
    if (e.argv.at(-1) === 'language') return done(0, `${language}\n`)
    ran.push(e.argv.at(-1) ?? ''); argvs.push(e.argv); return run()
  })
  on('clock.every', () => ({ value: {} }))
}

// What the panel says in each language: the board's English lines as they are, or in Spanish with the board page's table; the rest are the panel's own words.
const SAYS = {
  en: {
    note: /^try and accept: Drop a step \[drop-a-voided-step\] \(the reviews left 3 notes\)$/, group: /^Version 0.5.0: 2 changes wait for your acceptance/, departure: /1 departure from the prototype to decide/, answer: /^answer: Which database\?/,
    piece: /^Piece 1 of 2 of the change «The board refreshes itself»$/, tasks: /1 of 4 tasks done$/, milestone: /^Milestone Version 0.5.0$/, accepted: /7 done · 3 your turn · 2 in progress · 2 to define, of 14$/, heads: ['Waiting for you', 'Now', 'Next'], buttons: ['Refresh', 'Open the full board'],
    acts: ['Try and accept', 'Review the milestone', 'Try and accept', 'Answer'],
    ask: ['Show me the summary to accept [drop-a-voided-step]', 'I want to review the changes of the milestone [v0-5-0]', 'Show me the summary to accept [live-board]', 'I want to answer the question [q1]'],
  },
  es: {
    note: /^prueba y acepta: Drop a step \[drop-a-voided-step\] \(las revisiones dejaron 3 notas\)$/, group: /^Version 0.5.0: 2 cambios esperan tu aceptación/, departure: /1 desviación del prototipo por decidir/, answer: /^responde: Which database\?/,
    piece: /^Pieza 1 de 2 del cambio «The board refreshes itself»$/, tasks: /1 de 4 tareas hechas$/, milestone: /^Hito Version 0.5.0$/, accepted: /7 hechos · 3 te toca a ti · 2 en marcha · 2 por definir, de 14$/, heads: ['Espera por ti', 'Ahora', 'Sigue'], buttons: ['Actualizar', 'Abrir el tablero completo'],
    acts: ['Probar y aceptar', 'Revisar el hito', 'Probar y aceptar', 'Responder'],
    ask: ['Muéstrame el resumen para aceptar [drop-a-voided-step]', 'Quiero revisar los cambios del hito [v0-5-0]', 'Muéstrame el resumen para aceptar [live-board]', 'Quiero responder la pregunta [q1]'],
  },
} as const

for (const language of ['en', 'es'] as const) {
  const say = SAYS[language]
  test(`the panel shows what waits, what is built, what comes next and the milestone, on every surface, in ${language === 'en' ? 'English' : 'Spanish'}`, async ($, on) => {
    let filled = ''
    engine(on, () => done(0, JSON.stringify(BOARD)), language)
    on('prompt.fill', (_: unknown, e: { text: string }) => { filled = e.text; return { isFilled: true } })
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await $.command.run({ command: 'buddy-panel', args: '' })

    for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
      const ui = await $.ui.mount({ ...PANE, surface })
      for (const re of [say.note, say.group, say.departure, say.answer, say.piece, say.tasks, say.milestone, say.accepted, /^Tests are classified$/, /See how the work is split/]) expect((await ui.find({ type: 'Text', text: re }))?.text).toBeDefined()
      for (const h of say.heads) expect((await ui.find({ type: 'Text', text: new RegExp(`^${h}$`) }))?.text).toBeDefined()
      if (language === 'es') expect(await ui.find({ type: 'Text', text: /try and accept/ })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: /Measure the slow files/ })).toBeUndefined()
      await ui.unmount()
    }

    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    // R259: each button names its act, with no hint and no command of Buddy's program on the lines.
    const keys = ['ask-accept-drop-a-voided-step', 'ask-accept-v0-5-0', 'ask-accept-live-board', 'ask-answer-q1']
    for (const [i, act] of say.acts.entries()) expect((await ui.find({ type: 'Button', key: keys[i] }))?.props.label).toMatch(new RegExp(`^${act}: `))
    expect(await ui.find({ type: 'Text', text: /goes to the text box|va al cuadro de texto|buddy milestone review|Ask Buddy|Pedírselo/ })).toBeUndefined()
    for (const [i, want] of say.ask.entries()) {
      await ui.press({ key: keys[i] })
      expect(filled).toBe(want)
    }
    await ui.press({ key: 'page' })
    expect(ran).toContain('open')
    expect(argvs.at(-1)?.slice(0, 2)).toEqual(['node', '-e'])
    await ui.unmount()
  })
}

// R285 (show-milestone-progress-in-panel, AC1, AC2): the milestone's bar is ten cells of one glyph, each group in its colour and in the board page's order
// (done, your turn, in progress, to define), shared out by the board's counts; a board from an older program, with no groups, still draws its accepted ones.
test('the milestone bar is one glyph per cell, coloured by group in the page\'s order, with the counts beside it', async ($, on) => {
  let board: object = BOARD
  engine(on, () => done(0, JSON.stringify(board)))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'buddy-panel', args: '' })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const cells = (await ui.findAll({ type: 'Text', text: /^█+$/ })).map(t => [t.props.color, t.text.length])
    expect(cells).toEqual([['success', 5], ['warning', 2], ['suggestion', 2], ['inactive', 1]])
    expect((await ui.find({ type: 'Text', text: /^█{10} 7 done · 3 your turn · 2 in progress · 2 to define, of 14$/ }))?.text).toBeDefined()   // one line, one glyph; a change's tasks keep their own bar (X1)   // one line, one glyph; a change's tasks keep their own bar (X1)
    await ui.unmount()
  }
  board = { ...BOARD, milestones: [{ id: 'v0-5-0', title: 'Version 0.5.0', status: 'building', changes: { accepted: 7, total: 14 } }] }
  await $.command.run({ command: 'buddy-panel', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^█{10} 7 done · 7 to define, of 14$/ }))?.text).toBeDefined()
  expect((await ui.findAll({ type: 'Text', text: /^█+$/ })).map(t => [t.props.color, t.text.length])).toEqual([['success', 5], ['inactive', 5]])
  await ui.unmount()
})

// build-and-test-the-prototype, AC3: with nothing being built, Now says which stage of discovering the product the owner is in.
for (const [language, line] of [['en', 'Discovering the product: stage 2 of 3 (flows and wireframes)'], ['es', 'Descubriendo el producto: etapa 2 de 3 (flujos y wireframes)']] as const) {
  test(`while nothing is built the panel shows the discovery's stage in ${language}`, async ($, on) => {
    engine(on, () => done(0, JSON.stringify({ ...BOARD, current: [], discovery: 2 })), language)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await $.command.run({ command: 'buddy-panel', args: '' })
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect((await ui.find({ type: 'Text', text: new RegExp(`^${line.replace(/[()]/g, '\\$&')}$`) }))?.text).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Nothing is being built|Nadie está construyendo/ })).toBeUndefined()
    await ui.unmount()
  })
}

// AC1/AC5: no language set, an unknown one or an unreadable setting all mean English.
test('with no language set, or one the panel does not know, the panel speaks English', async ($, on) => {
  engine(on, () => done(0, JSON.stringify(BOARD)), 'klingon')
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^Waiting for you$/ }))?.text).toBeDefined()
  expect((await ui.find({ type: 'Button', key: 'refresh' }))).toBeDefined()
  await ui.unmount()
})

test('outside a Buddy project the panel says so instead of failing', async ($, on) => {
  engine(on, () => done(3))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'buddy-panel', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /no Buddy \(there is no docs\/buddy\)/ }))?.text).toBeDefined()
  await ui.unmount()
})

// The owner (2026-11-23): in a project without Buddy the panel does not open by itself and does not refresh; /buddy-panel still opens it.
test('in a project without Buddy the panel opens only when asked', async ($, on) => {
  const clock = mock.clock(on)
  let opened = 0
  let reads = 0
  on('command.register', () => ({ value: { command: 'buddy-panel' } }))
  on('ui.open', () => { opened++; return { value: { isPlaced: true } } })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('process.run', (_: unknown, e: { argv: string[] }) => { if (e.argv.at(-1) === 'language') return done(0, ''); reads++; return done(3) })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()
  expect(opened).toBe(0)
  const before = reads
  await clock.advance(60_000)
  expect(reads).toBe(before)
  await $.command.run({ command: 'buddy-panel', args: '' })
  expect(opened).toBe(1)
})

test('in a Buddy project the panel opens by itself', async ($, on) => {
  const clock = mock.clock(on)
  let opened = 0
  on('command.register', () => ({ value: { command: 'buddy-panel' } }))
  on('ui.open', () => { opened++; return { value: { isPlaced: true } } })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('process.run', (_: unknown, e: { argv: string[] }) => (e.argv.at(-1) === 'language' ? done(0, '') : done(0, JSON.stringify(BOARD))))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()
  expect(opened).toBe(1)
})

test('without the board\'s program the panel says how to get it', async ($, on) => {
  engine(on, () => done(4), 'es')
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'buddy-panel', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /claude plugin install buddy@buddy/ }))?.text).toBeDefined()
  await ui.unmount()
})

// AC3: the panel keeps refreshing by itself, and after the mod reloads (register and session.start run again in a fresh copy) there is
// still exactly one timer: the one reload started, not two and not none.
test('the panel refreshes every 30 seconds, once, and keeps doing so after a reload', async ($, on) => {
  const clock = mock.clock(on)
  let reads = 0
  on('command.register', () => ({ value: { command: 'buddy-panel' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('process.run', (_: unknown, e: { argv: string[] }) => { if (e.argv.at(-1) === 'language') return done(0, 'es'); reads++; return { value: { exitCode: 0, stdout: JSON.stringify(BOARD), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()
  const first = reads
  await clock.advance(29_000)
  expect(reads).toBe(first)
  await clock.advance(1_000)
  expect(reads).toBe(first + 1)
  await clock.advance(30_000)
  expect(reads).toBe(first + 2)

  // The reload: the module starts again and session.start runs again; a second timer would read twice in a period.
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()
  const second = reads
  await clock.advance(30_000)
  expect(reads).toBe(second + 1)
  await clock.advance(30_000)
  expect(reads).toBe(second + 2)
})

// Audit findings (docs/research/2026-11-23-buddy-mod-ux-audit.md): a button is addressed by its change, so a line that arrives above it does not move the focus ring to another
// change; and the time of the last answer says what it is.
test('each Ask button is keyed by its change, not its place, and the time says "Updated"', async ($, on) => {
  const lines = [{ kind: 'answer', text: 'answer: Another? [q9]', ref: 'q9', since: null }, ...BOARD.view]
  engine(on, () => done(0, JSON.stringify({ ...BOARD, view: lines })), 'es')
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  for (const key of ['ask-answer-q9', 'ask-accept-drop-a-voided-step', 'ask-accept-live-board', 'ask-answer-q1']) expect(await ui.find({ type: 'Button', key })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'ask-0' })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /^Actualizado \d/ }))?.text).toBeDefined()
  await ui.unmount()
})

// The desktop app and VS Code draw a Button's label, and VS Code does not cut it at the pane's edge (seen on Windows, 2026-11-23): each Ask
// button's label stays short and still names its change.
test('each Ask button has a short label that names its change', async ($, on) => {
  engine(on, () => done(0, JSON.stringify(BOARD)))
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const asks = (await ui.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('ask-'))
  expect(asks.length).toBeGreaterThan(0)
  for (const b of asks) expect(String(b.props.label).length).toBeLessThanOrEqual(30)
  expect(asks.find(b => b.key === 'ask-accept-live-board')?.props.label).toBe('Try and accept: live-board')
  await ui.unmount()
})

// R259 AC1/AC2: every kind of line gets its own act, in both languages, and no line shows a command of Buddy's program.
const KINDS = [
  { kind: 'accept', text: 'accept the milestone: Version 2 [v2]', ref: 'v2', since: null },
  { kind: 'accept', text: 'decide: Save books [save-books]: the work stopped after several reviews and needs your decision', ref: 'save-books', since: null },
  { kind: 'merge', text: 'merge branch feature/x into main: 3 slices accepted', ref: 'feature/x', since: null },
  { kind: 'answer', text: 'answer: Which database? [q1]', ref: 'q1', since: null },
  { kind: 'accept', text: '2 priorities proposed by Buddy wait for your confirmation (buddy requests confirm --priorities, or change the ones you disagree with)', ref: null, since: null },
  { kind: 'accept', text: 'Version 0.5.0 [v0-5-0]: 4 changes wait for your acceptance (see each and answer: buddy milestone review v0-5-0)', ref: 'v0-5-0', since: null },
  { kind: 'accept', text: 'Outside any milestone: 2 changes wait for your acceptance (see them: buddy slice list, then buddy slice accept-card <change>)', ref: null, since: null },
]
const ACTS = { en: ['Accept the milestone', 'Decide', 'Merge', 'Answer', 'Review the changes', 'Review the milestone'], es: ['Aceptar el hito', 'Decidir', 'Integrar', 'Responder', 'Revisar los cambios', 'Revisar el hito'] }
for (const language of ['en', 'es'] as const) {
  test(`each kind of line names its act and shows no command, in ${language}`, async ($, on) => {
    engine(on, () => done(0, JSON.stringify({ ...BOARD, view: KINDS })), language)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    const labels = (await ui.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('ask-')).map(b => String(b.props.label))
    expect(labels.length).toBe(KINDS.length)
    for (const act of ACTS[language]) expect(labels.some(x => x.startsWith(`${act}`))).toBe(true)
    expect(await ui.find({ type: 'Text', text: /buddy |--priorities|\[v0-5-0\]/ })).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: language === 'en' ? /^Version 0\.5\.0: 4 changes wait for your acceptance$/ : /^Version 0\.5\.0: 4 cambios esperan tu aceptación$/ }))?.text).toBeDefined()
    await ui.unmount()
  })
}
