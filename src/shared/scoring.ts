// Scoring and calendar helpers shared by the game and the server, so both
// get the same total from the same run.

/** Fill difficulty names, by level: 0 Easy, 1 Medium, 2 Hard. */
export const LEVEL_NAMES = ['Easy', 'Medium', 'Hard'] as const

/**
 * Score multiplier by level, then turns (0 to 3). Fewer clues make a scramble harder to read,
 * so the same turns are worth more on a harder cube. Hard stops at 2 turns: with 3 there are
 * hundreds of look-alike arrangements, so it turns into guessing.
 */
export const TURN_MULT: readonly (readonly number[])[] = [
  [1, 1.25, 1.5, 2],
  [1, 1.5, 2, 3],
  [1, 2, 3],
]

/** The most turns a level offers. */
export const maxTurns = (level: number): number =>
  (TURN_MULT[level]?.length ?? 1) - 1

/** True if a tier (turns 0 to 3) is offered at a level. */
export const tierAllowed = (level: number, tier: number): boolean =>
  Number.isInteger(tier) && tier >= 0 && tier <= maxTurns(level)

/** The multiplier for a level and tier; 1 if the pair isn't offered. */
export const multOf = (level: number, tier: number): number =>
  TURN_MULT[level]?.[tier] ?? 1

/** Each week's mix of fill difficulties: two Easy days, three Medium and two Hard. */
export const WEEK_MIX = [0, 0, 1, 1, 1, 2, 2] as const

/** The old fixed order, Monday first, kept for days before the shuffle started so past cubes keep their level. */
const OLD_WEEK = [0, 0, 1, 1, 2, 2, 1] as const

/** The first Monday whose week is shuffled. */
export const SHUFFLE_FROM = '2026-11-23'

/** A small seeded random number generator (mulberry32), so a week shuffles the same everywhere. */
function rng(seed: string): () => number {
  let h = 2166136261
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return () => {
    h = (h + 0x6d2b79f5) | 0
    let t = Math.imul(h ^ (h >>> 15), 1 | h)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A day's week of fill difficulties, Monday first: the week's mix in an order picked at random for that week. */
export function weekLevels(day: string): number[] {
  const dow = (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7
  if (addDays(day, -dow) < SHUFFLE_FROM) return [...OLD_WEEK]
  const next = rng(`nonet:${weekKey(day)}`)
  const week: number[] = [...WEEK_MIX]
  for (let i = week.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1))
    ;[week[i], week[j]] = [week[j] ?? 0, week[i] ?? 0]
  }
  return week
}

/** The fill difficulty for a YYYY-MM-DD day. */
export function levelOf(day: string): number {
  const dow = (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7
  return weekLevels(day)[dow] ?? 0
}

/** What a finished run reports. Times are in seconds. */
export type RunStats = {
  /** Turns used in Stage 1. */
  turns: number
  /** Stage 1 time. */
  t1: number
  /** Stage 2 time. */
  t2: number
  /** Empty squares at the start of Stage 2. */
  blanks: number
  /** Wrong locks in Stage 2. */
  wrong: number
  /** Suggested turns used. */
  hintsUsed: number
  /** ★ opening squares locked before any other square, 0 to 3. */
  starsWon: number
}

export type ScoreBreakdown = {
  turnPts: number
  sp1: number
  sp2: number
  acc: number
  bonus: number
  starPts: number
  raw: number
  total: number
  /** Stage 1 target time. */
  T1: number
  /** Stage 2 target time. */
  T2: number
  par: number
  mult: number
}

const speedPts = (max: number, target: number, t: number): number =>
  Math.round(max * Math.max(0, Math.min(1, (3 * target - t) / (2 * target))))

/**
 * Scores a run at a level and tier (turns 0 to 3). Practice runs are never sent here.
 * With no turns there is no Stage 1, so its points (turns, speed, no suggested turns) aren't on offer.
 */
export function scoreRun(
  level: number,
  tier: number,
  s: Readonly<RunStats>,
): ScoreBreakdown {
  const par = tier
  const mult = multOf(level, tier)
  const turnPts = par
    ? Math.round(300 * Math.min(1, par / Math.max(1, s.turns)))
    : 0
  const T1 = 20 * par
  const sp1 = par ? speedPts(200, T1, s.t1) : 0
  const T2 = 6 * s.blanks
  const sp2 = speedPts(300, T2, s.t2)
  const acc = Math.max(0, 200 - 25 * s.wrong)
  const bonus = par && s.hintsUsed === 0 ? 100 : 0
  const starPts = 50 * s.starsWon
  const raw = turnPts + sp1 + sp2 + acc + bonus + starPts
  return {
    turnPts,
    sp1,
    sp2,
    acc,
    bonus,
    starPts,
    raw,
    total: Math.round(raw * mult),
    T1,
    T2,
    par,
    mult,
  }
}

/** A clean run's total at a level and tier: fewest turns, on target, no misses. */
export function cleanRun(level: number, tier: number): number {
  return Math.round((tier ? 1000 : 500) * multOf(level, tier))
}

/** The game's clock: a new day, and a new cube, starts at midnight Pacific time. */
export const GAME_TZ = 'America/Los_Angeles'

const dayParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: GAME_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** The puzzle day at a moment, as YYYY-MM-DD in Pacific time. */
export function dayKey(date: Date = new Date()): string {
  const p = Object.fromEntries(
    dayParts.formatToParts(date).map(x => [x.type, x.value]),
  )
  return `${p.year}-${p.month}-${p.day}`
}

/** Adds whole days to a YYYY-MM-DD day. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Milliseconds from a moment until the next puzzle day starts. */
export function msUntilNextDay(now: Date = new Date()): number {
  const next = addDays(dayKey(now), 1)
  // midnight Pacific is 07:00 or 08:00 UTC; take the first of the two that falls on the new day
  for (const h of [7, 8]) {
    const t = Date.parse(`${next}T0${h}:00:00Z`)
    if (dayKey(new Date(t)) === next) return t - now.getTime()
  }
  return Date.parse(`${next}T08:00:00Z`) - now.getTime()
}

/** A day's cube number is its day of the year: 1 on 1 January, 365 on 31 December, 366 in a leap year. */
export function dayOfYear(day: string): number {
  const t = (d: string) => Date.parse(`${d}T00:00:00Z`)
  return Math.round((t(day) - t(`${day.slice(0, 4)}-01-01`)) / 86400000) + 1
}

/** A puzzle number padded to three digits: 1 -> "001". */
export const padNo = (n: number): string => String(n).padStart(3, '0')

const KANJI = '〇一二三四五六七八九'

/** The same number in kanji digits, read digit by digit: 27 -> "〇二七". */
export function kanjiNo(n: number): string {
  return padNo(n).replace(/\d/g, d => KANJI[Number(d)] ?? d)
}

/** A day as it reads on a post, like "Sat 14 Nov". */
export function shortDate(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
}

/** The ISO week a day falls in, as YYYY-Www. Weeks start on Monday. */
export function weekKey(day: string): string {
  const d = new Date(`${day}T00:00:00Z`)
  const dow = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - dow + 3)
  const year = d.getUTCFullYear()
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const week =
    1 +
    Math.round(
      ((d.getTime() - jan4.getTime()) / 86400000 -
        3 +
        ((jan4.getUTCDay() + 6) % 7)) /
        7,
    )
  return `${year}-W${String(week).padStart(2, '0')}`
}

/** Day of the week, 1 (Monday) to 7 (Sunday). */
export function weekday(day: string): number {
  return ((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7) + 1
}

/** True if day is between from and to, both included. */
export function inRange(day: string, from: string, to: string): boolean {
  return day >= from && day <= to
}

export const isDay = (s: unknown): s is string =>
  typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
