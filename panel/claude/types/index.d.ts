// What the panel keeps: the last reading of Buddy's board, cut to what the panel shows.
// `text` is what the board says in English; the panel shows it in Spanish (words.js) and asks Buddy with `ref`.
export type Waiting = { kind: string; text: string; ref: string | null; under?: Waiting[] }
// A change, or a piece of one with its change's title and its place; its tasks done out of how many; its state when it comes next.
// `label` is set when it is not a change: a hito that comes next.
export type Item = { id: string; title: string; label?: string; of: { title: string; n: number; total: number } | null; done: number; total: number; status: string }
// The open milestone: how many changes it has and how many are in each group of the board page's bar (done, your turn, in progress, to define).
export type Milestone = { id: string; title: string; total: number; groups: { done: number; owner: number; agent: number; define: number } }
export type Snapshot = {
  at: string
  lang: 'en' | 'es'
  current: Item[]
  // The stage of discovering the product (1 to 3) while nothing is being built, or null.
  discovery?: 1 | 2 | 3 | null
  next: Item | null
  milestone: Milestone | null
  waiting: Waiting[]
  // What went wrong, as a code the panel words in the person's language (`detail` is the program's own text).
  error: { code: 'noBuddy' | 'noProgram' | 'noAnswer'; detail?: string } | null
}

declare module 'claude-code' {
  interface PluginState {
    'buddy-panel': { snapshot: Shaped<Snapshot | null> }
  }
}
