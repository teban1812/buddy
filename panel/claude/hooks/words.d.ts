export const ES: [RegExp, string | ((...m: string[]) => string)][]
export function es(text: string): string
export type Lang = 'en' | 'es'
export function lang(code: unknown): Lang
export const TEXT: Record<Lang, any>
export function shown(text: string, code: unknown): string
export function actOf(w: { kind: string; text: string; ref?: string | null }): string
export type Groups = { done: number; owner: number; agent: number; define: number }
export const GROUPS: (keyof Groups)[]
export function groupsOf(m: { groups?: Groups; changes: { accepted: number; total: number } }): Groups
