import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Item, Snapshot, Waiting } from '../types'
import { SCRIPT } from './find.js'
import { TEXT, GROUPS, groupsOf, es, lang, shown, actOf } from './words.js'
import type { Groups, Lang } from './words.js'

// Claude Code's panel of the change `buddy-mod`: it reads Buddy's board (`buddy board --json`) and holds no logic of its own. Its buttons
// never act: they put a request in the text box and the owner sends it, so an acceptance is still said in the conversation (R217, R244).
// Its words are English unless the person set another language on their machine (`buddy tools language es`, read by find.js): this Claude Code's
// mod API gives a mod no language of the viewer to follow.
const PANE = 'buddy-panel'
const TITLE = 'Buddy'
const EVERY_MS = 30_000
const snapshot = atom({ plugin: 'buddy-panel', key: 'snapshot' } as const, null, { shape: 'snapshot-6' })

// Buddy's program is found by hooks/find.js (a small Node program: see there). `json` reads the board; `open` writes its full page and opens it.
const FIND = ['node', '-e', SCRIPT, 'json']
const OPEN = ['node', '-e', SCRIPT, 'open']
const LANGUAGE = ['node', '-e', SCRIPT, 'language']

type Board = {
  now: string
  discovery?: 1 | 2 | 3 | null
  current?: { id: string; title: string; change?: string | null; step?: { n: number; total: number; text: string } | null }[]
  next?: { id: string; title: string; kind?: string; status: string; change?: { id: string; title: string } | null } | null
  milestones?: { id: string; title: string; status: string; changes: { accepted: number; total: number }; groups?: Groups }[]
  waiting?: Waiting[]
  view?: Waiting[]
  slices?: { id: string; title: string; change?: string | null; rank?: number; steps?: { done: number; total: number } }[]
}

const empty = (error: Snapshot['error'], l: Lang): Snapshot => ({ at: '', lang: l, current: [], next: null, milestone: null, waiting: [], error })

// What a piece belongs to: its change's title and its place among the change's pieces, in the board's order.
function pieceOf(b: Board, id: string, change: string | null | undefined): Item['of'] {
  if (!change) return null
  const rows = b.slices ?? []
  const pieces = rows.filter(r => r.change === change).sort((x, y) => (x.rank ?? 0) - (y.rank ?? 0))
  return { title: rows.find(r => r.id === change)?.title ?? change, n: pieces.findIndex(r => r.id === id) + 1, total: pieces.length }
}

function item(b: Board, id: string, title: string, change: string | null | undefined, status = ''): Item {
  // The board names a step only while one is open; the piece's own count says how many are done.
  const steps = (b.slices ?? []).find(r => r.id === id)?.steps
  return { id, title, of: pieceOf(b, id, change), done: steps?.done ?? 0, total: steps?.total ?? 0, status }
}

// What waits for the owner is the board's own list as it says it: `view` (a change once, several of a hito in one line, with what each needs
// under it), else `waiting`. The panel adds nothing and drops nothing.
const lines = (ws: Waiting[]): Waiting[] => ws.map(w => ({ kind: w.kind, text: w.text, ref: w.ref ?? null, under: lines(w.under ?? []) }))

function fromBoard(b: Board, l: Lang): Snapshot {
  const ms = b.milestones ?? []
  const open = ms.find(m => m.status === 'building') ?? ms.find(m => m.status !== 'accepted') ?? null
  const n = b.next
  return {
    at: b.now,
    lang: l,
    current: (b.current ?? []).map(c => item(b, c.id, c.title, c.change)),
    discovery: b.discovery ?? null,
    next: !n ? null : n.kind === 'milestone' ? { ...item(b, n.id, n.title, null, 'waits'), label: 'milestone' } : item(b, n.id, n.title, n.change?.id, n.status),
    milestone: open ? { id: open.id, title: open.title, total: open.changes.total, groups: groupsOf(open) } : null,
    waiting: lines(b.view ?? b.waiting ?? []),
    error: null,
  }
}

// What a button puts in the text box, in the owner's words, for Buddy to answer in the conversation. A line for several changes of a hito
// (the board's group line) asks for the review of that hito, where each one is seen and answered.
function ask(w: Waiting, l: Lang): string {
  const q = TEXT[l].request
  const what = w.ref ? `[${w.ref}]` : `«${l === 'es' ? es(w.text) : w.text}»`
  const v = q[actOf(w)]
  return typeof v === 'function' ? v(what) : v
}
// The board's lines in the order it gives them, a group's own lines right under it, each with how deep it sits.
const flat = (ws: Waiting[], depth = 0): { w: Waiting; depth: number }[] => ws.flatMap(w => [{ w, depth }, ...flat(w.under ?? [], depth + 1)])

// A bar of ten cells, drawn as text so every surface shows it the same.
const bar = (done: number, total: number) => {
  const full = total > 0 ? Math.round((10 * Math.max(0, done)) / total) : 0
  return '●'.repeat(full) + '○'.repeat(10 - full)
}
// The open milestone's bar (R285): ten cells of one glyph, each group in the colour of its group on the board page (the theme's own green, orange, blue
// and grey, so it follows a light or dark terminal), shared out by the counts with every group that has one keeping a cell. One glyph for every
// cell keeps them one size on Windows, where ● and ○ come from different fonts; the counts written beside it carry the groups without colour (DSN-9).
const COLOR: Record<keyof Groups, string> = { done: 'success', owner: 'warning', agent: 'suggestion', define: 'inactive' }
const CELL = '█'
const cells = (g: Groups, n = 10): Groups => {
  const t = GROUPS.reduce((s, k) => s + g[k], 0)
  if (!t) return { done: 0, owner: 0, agent: 0, define: n }
  const c = { ...g }
  for (const k of GROUPS) c[k] = g[k] ? Math.max(1, Math.floor((n * g[k]) / t)) : 0
  const has = GROUPS.filter(k => g[k])
  for (let left = n - has.reduce((s, k) => s + c[k], 0); left !== 0; left += left > 0 ? -1 : 1) {
    const k = left > 0 ? [...has].sort((a, b) => (n * g[b]) / t - c[b] - ((n * g[a]) / t - c[a]))[0] : [...has].sort((a, b) => c[b] - c[a])[0]
    c[k] += left > 0 ? 1 : -1
  }
  return c
}
// Long texts are cut by hand: this Claude Code takes no maxLines on a Text.
const cut = (text: string, room = 200) => (text.length > room ? `${text.slice(0, room - 1)}…` : text)
// The words the panel names things with (R241): a hito holds changes, a change may be cut into pieces, and a piece or a change is built
// task by task (Buddy's steps).
function What({ it, $e, l }: { it: Item; $e: any; l: Lang }) {
  const { Box, Text } = $e
  const w = TEXT[l]
  const tasks = it.total > 0 ? w.tasks(it.done, it.total) : ''
  return (
    <Box flexDirection="column">
      {it.of ? (
        <Text>
          <Text dimColor>{w.piece(it.of.n, it.of.total)}</Text>«{it.of.title}»
        </Text>
      ) : (
        <Text dimColor>{it.label ? w.milestone : w.change}</Text>
      )}
      <Text>
        {it.title}
        {it.status !== '' && <Text dimColor> ({w.status[it.status] ?? it.status})</Text>}
      </Text>
      {tasks !== '' && <Text>{bar(it.done, it.total)} {tasks}</Text>}
    </Box>
  )
}
// The time of the board's last answer, said for what it is ("Updated 10:42"), and the name of each Ask button. The desktop app and VS Code
// draw a Button's label, not its children, and VS Code does not cut a long one at the pane's edge: the label stays short (the change's ref,
// already shown on the line above, else the line cut) and still says which change it asks about.
const UPDATED: Record<Lang, string> = { en: 'Updated', es: 'Actualizado' }
const askLabel = (it: Waiting, l: Lang) => cut(`${TEXT[l].act[actOf(it)]}: ${it.ref ?? shown(it.text, l)}`, 30)
const clock = (iso: string, l: Lang) => (iso ? `${UPDATED[l]} ${new Date(iso).toLocaleTimeString(TEXT[l].time, { hour: '2-digit', minute: '2-digit' })}` : '')

async function refresh($: EngineInterface): Promise<void> {
  let snap: Snapshot
  let l: Lang = 'en'
  try {
    const [r, g] = await Promise.all([$.process.run(FIND, { timeoutMs: 60_000 }), $.process.run(LANGUAGE, { timeoutMs: 10_000 }).catch(() => null)])
    l = lang((g?.stdout ?? '').trim())
    if (r.exitCode === 3) snap = empty({ code: 'noBuddy' }, l)
    else if (r.exitCode === 4) snap = empty({ code: 'noProgram' }, l)
    else if (r.exitCode !== 0) snap = empty({ code: 'noAnswer', detail: (r.stderr || r.stdout).trim().slice(0, 200) }, l)
    else snap = fromBoard(JSON.parse(r.stdout) as Board, l)
  } catch (err) {
    snap = empty({ code: 'noAnswer', detail: String(err).slice(0, 200) }, l)
  }
  await update($, snapshot, () => snap)
}

async function openBoard($: EngineInterface): Promise<void> {
  const s = await read($, snapshot)
  const w = TEXT[s?.lang ?? 'en']
  try {
    const r = await $.process.run(OPEN, { timeoutMs: 60_000 })
    if (r.exitCode !== 0) void $.ui.toast(r.exitCode === 3 ? w.noBuddy : w.noPage)
  } catch {
    void $.ui.toast(w.noPage)
  }
}

// The refresh every 30 seconds. A reload of the mod runs `register` again in a fresh copy (its old timer stops) and may or may not raise
// `session.start` again, so the timer is also started from the first thing the panel does (a command, a drawing): `ensure` starts it when
// this copy has none, `restart` (session.start) always replaces it, so there is never more than one.
let tick: { cancel: () => void } | null = null
function restart($: EngineInterface): void {
  tick?.cancel()
  tick = $.clock.every(EVERY_MS, () => refresh($))
}
function ensure($: EngineInterface): void {
  if (!tick) restart($)
}

export const register: Register = on => {
  // The panel opens by itself only in a Buddy project (the owner, 2026-11-23): the board is read first, and where it says there is no Buddy
  // nothing opens and nothing refreshes; /buddy-panel still opens it and says so.
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'buddy-panel', description: 'Show what Buddy is building and what waits for you in a panel' })
    void (async () => {
      await refresh($)
      if ((await read($, snapshot))?.error?.code === 'noBuddy') return
      restart($)
      void $.ui.open({ id: PANE, title: TITLE })
    })()
    return started
  })

  on('command.run', { command: 'buddy-panel' }, async $ => {
    ensure($)
    await $.ui.open({ id: PANE, title: TITLE })
    await refresh($)
    return { text: TEXT[(await read($, snapshot))?.lang ?? 'en'].opened }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    ensure($)
    const s = await read($, snapshot)
    const fill = (text: string) => $.prompt.fill({ text, mode: 'replace' })

    if (!s) return <Text dimColor>{TEXT.en.reading}</Text>
    const l = s.lang
    const w = TEXT[l]
    if (s.error) {
      return (
        <Box flexDirection="column" gap={1}>
          <Text>{s.error.code === 'noAnswer' ? w.noAnswer(s.error.detail ?? '') : w[s.error.code]}</Text>
          <Button key="refresh" onPress={() => refresh($)}>{w.refresh}</Button>
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text bold>{w.waits}</Text>
          {s.waiting.length === 0 && <Text dimColor>{w.nothingWaits}</Text>}
          {flat(s.waiting).map(({ w: it, depth }, i) => (
            <Box key={`w${i}`} flexDirection="column" paddingLeft={2 * depth}>
              <Text>{cut(shown(it.text, l))}</Text>
              {/* Keyed by the change (its ref), not its place: a surface keeps the focus ring on the key across a redraw, so a line that leaves or arrives must not move it to another change. */}
              <Button key={`ask-${it.kind}-${it.ref ?? `n${i}`}`} label={askLabel(it, l)} variant="primary" onPress={() => fill(ask(it, l))}>
                {w.act[actOf(it)]}
              </Button>
            </Box>
          ))}
        </Box>

        <Box flexDirection="column">
          <Text bold>{w.now}</Text>
          {s.current.length === 0 && <Text dimColor>{s.discovery ? w.discovering(s.discovery) : w.idle}</Text>}
          {s.current.map(c => (
            <Box key={`c-${c.id}`} flexDirection="column">
              {What({ it: c, $e: { Box, Text }, l })}
            </Box>
          ))}
        </Box>

        <Box flexDirection="column">
          <Text bold>{w.next}</Text>
          {s.next ? What({ it: s.next, $e: { Box, Text }, l }) : <Text dimColor>{w.queue}</Text>}
        </Box>

        {s.milestone && (
          <Box flexDirection="column">
            <Text>
              <Text bold>{w.milestone} </Text>{s.milestone.title}
            </Text>
            <Text>
              {(c => GROUPS.filter(k => c[k] > 0).map(k => (
                <Text key={`m-${k}`} color={COLOR[k]}>{CELL.repeat(c[k])}</Text>
              )))(cells(s.milestone.groups))}{' '}
              {w.progress(s.milestone.groups, s.milestone.total)}
            </Text>
          </Box>
        )}

        <Box flexDirection="row" gap={1}>
          <Button key="refresh" onPress={() => refresh($)}>{w.refresh}</Button>
          <Button key="page" onPress={() => openBoard($)}>{w.page}</Button>
          <Text dimColor>{clock(s.at, l)}</Text>
        </Box>
      </Box>
    )
  })
}
