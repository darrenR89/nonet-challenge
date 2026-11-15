// Types for model.js, the cube model shared by the game and the server.

/** A layer turn: axis 0..2, layer -1..1, direction ±1. */
export type Move = [number, number, number]

/** A tier: how many turns scramble the cube (0 to 3), or Practice (4). */
export type Tier = {
  name: string
  k: number
  tutorial?: boolean
}

/**
 * How the lines run. Mirror: the back face is a mirror copy of the front (Easy).
 * Spread: no face copies another (Medium and Hard).
 */
export type Layout = 'mirror' | 'spread'

/** A fill difficulty: the day's cube starts with lo to hi clues. */
export type Level = {name: string; lo: number; hi: number}

/** The day's cube before tiers: the full answer and its clues. */
export type Base = {sol: number[]; given: number[]}

/** One playable cube. Arrays are 54 long, 0 for empty. */
export type Puzzle = {
  sol: number[]
  given: number[]
  start: number[]
  moves: Move[]
  tier: number
  k: number
  /** Fill difficulty: 0 Easy, 1 Medium, 2 Hard. */
  level: number
  /** The three ★ opening squares (cell indexes). */
  stars: number[]
  /** Which faces the lines skip. Missing on cubes made before layouts: those are Mirror. */
  layout?: Layout
}

export declare const N: number
/** The layout a fill level uses: Easy is Mirror, Medium and Hard are Spread. */
export declare function layoutOf(level: number): Layout
/** Rebuilds the lines for a layout. Everything that reads lines, peers or the solver follows it. */
export declare function setLayout(name: Layout): void
export declare function getLayout(): Layout
export declare function withLayout<T>(name: Layout, fn: () => T): T
/** Each face's 9 cell indexes (0 to 5), then the 18 lines of 9. */
/** The 54 squares: face normal n and block position c, each as [x, y, z]. */
export declare const cells: {n: number[]; c: number[]}[]
export declare const groups: number[][]
export declare const lines: number[][]
export declare const TIERS: Tier[]
export declare const PRACTICE: number
export declare const LEVELS: Level[]
export declare const PRACTICE_CLUES: number
export declare function makeBase(level?: number): Base
export declare function makeTier(
  base: Base,
  tier: number,
  level?: number,
): Puzzle
export declare function makePuzzle(tier: number, level?: number): Puzzle
export declare function makePractice(): Puzzle
export declare function makeDay(
  seed: string,
  level?: number,
): {base: Base; level: number; tiers: Puzzle[]}
export declare function isDailyAnswer(sol: readonly number[]): boolean
export declare function clueCount(given: readonly number[]): number
export declare function singlesOnly(given: readonly number[]): boolean
export declare function withSeed<T>(seed: string, fn: () => T): T
export declare function fingerprint(sol: readonly number[]): string
export declare function solveCount(
  grid: readonly number[],
  limit: number,
  budget?: number,
): [number, number[] | null]
export declare function singlesOrder(given: readonly number[]): number[]
