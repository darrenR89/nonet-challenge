// A run's move log: what the player did and when, so the run can be checked and replayed.
// No DOM. The browser writes it; the server checks it against the day's cube and keeps it.

import {
  groups,
  type Move,
  N,
  type Puzzle,
  solveCount,
  turnArr,
  withLayout,
} from './model.js'
import type {RunStats} from './scoring.ts'

/**
 * The log is a flat list of number pairs: the run clock in tenths of a second (Dial in and Fill in
 * back to back, pauses left out), then what happened. Codes:
 * - 0 to 17: a turn, axis × 6 + (layer + 1) × 2 + (1 if the direction is +1)
 * - 100: dialled in
 * - 200 + square: a ★ square, given when the fill starts
 * - 1000 + square × 9 + digit − 1: a lock
 * - 2000 + square × 9 + digit − 1: a lock placed by a suggestion
 * - 3000 + square × 9 + digit − 1: a wrong lock (a miss)
 * - 5000: a help used that places nothing (a suggested turn, or the flat cube)
 */
export type MoveLog = number[]

export type LogEvent =
  | {t: number; kind: 'turn'; move: Move}
  | {t: number; kind: 'dial'}
  | {t: number; kind: 'star'; cell: number}
  | {
      t: number
      kind: 'lock' | 'help-lock' | 'miss'
      cell: number
      digit: number
    }
  | {t: number; kind: 'help'}

/** A log longer than this is never kept: 500 turns and every square twice over. */
export const MAX_LOG = 2 * (500 + 3 * N + 20)

export const turnCode = ([a, v, s]: Readonly<Move>): number =>
  a * 6 + (v + 1) * 2 + (s > 0 ? 1 : 0)
const cellCode = (base: number, cell: number, digit: number): number =>
  base + cell * 9 + digit - 1

/** Codes for the browser, which pushes `[tenths, code]` as things happen. */
export const code = {
  turn: turnCode,
  dial: 100,
  star: (cell: number): number => 200 + cell,
  lock: (cell: number, digit: number): number => cellCode(1000, cell, digit),
  helpLock: (cell: number, digit: number): number =>
    cellCode(2000, cell, digit),
  miss: (cell: number, digit: number): number => cellCode(3000, cell, digit),
  help: 5000,
}

const SQUARE_KINDS = [
  [1000, 'lock'],
  [2000, 'help-lock'],
  [3000, 'miss'],
] as const

/** Reads a log, or undefined if any entry is not a known code in time order. */
export function decodeLog(log: unknown): LogEvent[] | undefined {
  if (!Array.isArray(log) || log.length % 2 || log.length > MAX_LOG) return
  const out: LogEvent[] = []
  let last = 0
  for (let i = 0; i < log.length; i += 2) {
    const t = log[i]
    const c = log[i + 1]
    if (!Number.isInteger(t) || !Number.isInteger(c) || t < last) return
    last = t
    if (c >= 0 && c < 18) {
      out.push({
        t,
        kind: 'turn',
        move: [Math.floor(c / 6), (Math.floor(c / 2) % 3) - 1, c % 2 ? 1 : -1],
      })
    } else if (c === 100) out.push({t, kind: 'dial'})
    else if (c >= 200 && c < 200 + N) out.push({t, kind: 'star', cell: c - 200})
    else if (c === 5000) out.push({t, kind: 'help'})
    else {
      const k = SQUARE_KINDS.find(([b]) => c >= b && c < b + 9 * N)
      if (!k) return
      const n = c - k[0]
      out.push({t, kind: k[1], cell: Math.floor(n / 9), digit: (n % 9) + 1})
    }
  }
  return out
}

/** True if no face or line holds a digit twice. */
const clashFree = (g: readonly number[]): boolean =>
  groups.every(gr => {
    const seen = new Set<number>()
    for (const i of gr) {
      if (!g[i]) continue
      if (seen.has(g[i])) return false
      seen.add(g[i])
    }
    return true
  })

/**
 * Checks a log against the cube it was played on and the totals sent with it. Returns why it
 * fails, or undefined if the log is a real, finished run with those totals.
 */
export function checkLog(
  p: Readonly<Puzzle>,
  stats: Readonly<RunStats>,
  log: unknown,
): string | undefined {
  const ev = decodeLog(log)
  if (!ev) return 'unreadable'
  return withLayout(p.layout ?? 'mirror', () => {
    // Dial in: turns (and suggested turns) up to the dial mark
    const dial = ev.findIndex(e => e.kind !== 'turn' && e.kind !== 'help')
    const dialEv = ev[dial]
    if (dialEv?.kind !== 'dial') return 'never dialled in'
    let g = p.start.slice()
    let turns = 0
    let help = 0
    for (const e of ev.slice(0, dial)) {
      if (e.kind === 'turn') {
        g = turnArr(g, ...e.move)
        turns++
      } else help++
    }
    if (turns !== stats.turns) return 'turns'
    if (solveCount(g, 1, 60000)[0] === 0) return 'not dialled in'
    if (Math.abs(dialEv.t / 10 - stats.t1) > 2) return 'dial time'
    if (g.filter(v => !v).length !== stats.blanks) return 'blanks'
    // Fill in: the ★ squares, then locks and misses
    const stars = new Set<number>()
    const misses: {cell: number; digit: number}[] = []
    let starsWon = 0
    let regular = false
    for (const e of ev.slice(dial + 1)) {
      if (e.kind === 'star') {
        if (g[e.cell] || stars.size >= 3) return 'star'
        stars.add(e.cell)
      } else if (e.kind === 'help') help++
      else if (e.kind === 'miss') misses.push(e)
      else if (e.kind === 'lock' || e.kind === 'help-lock') {
        if (g[e.cell]) return 'lock on a full square'
        g[e.cell] = e.digit
        if (e.kind === 'help-lock') help++
        if (!stars.has(e.cell)) regular = true
        else if (e.kind === 'lock' && !regular) starsWon++
      } else return 'out of order'
    }
    if (g.some(v => !v) || !clashFree(g)) return 'not solved'
    if (misses.some(m => g[m.cell] === m.digit)) return 'miss was right'
    if (misses.length !== stats.wrong) return 'misses'
    if (help !== stats.hintsUsed) return 'help'
    if (starsWon !== stats.starsWon) return 'stars'
    const end = (ev.at(-1)?.t ?? 0) / 10
    if (Math.abs(end - stats.t1 - stats.t2) > 2) return 'run time'
    return undefined
  })
}
