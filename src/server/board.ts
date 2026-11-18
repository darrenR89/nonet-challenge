// Players, streaks and boards. Boards are Redis sorted sets of userId → points.
import {redis} from '@devvit/web/server'
import type {Board, BoardRow, DayStats, MyDay, Streak} from '../shared/api.ts'
import {addDays, weekKey} from '../shared/scoring.ts'

export const BOARD_TOP = 9

export const boardKey = {
  day: (day: string): string => `lb:d:${day}`,
  week: (week: string): string => `lb:w:${week}`,
  all: 'lb:all',
  event: (id: string): string => `lb:e:${id}`,
}
const namesKey = 'names'
const userKey = (uid: string): string => `u:${uid}`
const userDayKey = (day: string, uid: string): string => `ud:${day}:${uid}`
/** Per-day records expire after this long; boards and streaks stay. */
export const DAY_TTL = 60 * 60 * 24 * 21

export async function rememberName(uid: string, name: string): Promise<void> {
  await redis.hSet(namesKey, {[uid]: name})
}

/** Usernames for user ids, in order; undefined for anyone never seen. */
export async function namesOf(ids: string[]): Promise<(string | undefined)[]> {
  if (!ids.length) return []
  return (await redis.hMGet(namesKey, ids)).map(n => n ?? undefined)
}

export async function getMyDay(day: string, uid: string): Promise<MyDay> {
  const h = await redis.hGetAll(userDayKey(day, uid))
  const num = (s: string | undefined): number | undefined =>
    s === undefined || s === '' ? undefined : Number(s)
  return {
    tier: num(h.tier),
    score: num(h.score),
    starsWon: num(h.stars),
    retries: Number(h.retries ?? 0),
  }
}

export async function getDayRecord(
  day: string,
  uid: string,
): Promise<Record<string, string>> {
  return redis.hGetAll(userDayKey(day, uid))
}

/** Locks the tier for the day. Returns the tier that holds, new or earlier. */
export async function lockTier(
  day: string,
  uid: string,
  tier: number,
  nowMs: number,
): Promise<number> {
  const key = userDayKey(day, uid)
  const set = await redis.hSetNX(key, 'tier', String(tier))
  if (set) {
    await redis.hSet(key, {started: String(nowMs)})
    await redis.expire(key, DAY_TTL)
    return tier
  }
  return Number(await redis.hGet(key, 'tier'))
}

/** Marks today's run done. False if it was already done (only one counts). */
export async function markScored(
  day: string,
  uid: string,
  total: number,
  starsWon: number,
): Promise<boolean> {
  const key = userDayKey(day, uid)
  const first = await redis.hSetNX(key, 'score', String(total))
  if (!first) return false
  await redis.hSet(key, {stars: String(starsWon)})
  return true
}

export async function addToBoards(
  day: string,
  uid: string,
  total: number,
): Promise<void> {
  await redis.zAdd(boardKey.day(day), {member: uid, score: total})
  await redis.zIncrBy(boardKey.week(weekKey(day)), uid, total)
  await redis.zIncrBy(boardKey.all, uid, total)
}

/** A streak counts days in a row with a finished, scored cube. */
export async function bumpStreak(day: string, uid: string): Promise<Streak> {
  const h = await redis.hGetAll(userKey(uid))
  let current = Number(h.streak ?? 0)
  const last = h.last ?? ''
  if (last === day) {
    // already counted today
  } else if (last === addDays(day, -1)) current += 1
  else current = 1
  const best = Math.max(current, Number(h.best ?? 0))
  const played = Number(h.played ?? 0) + (last === day ? 0 : 1)
  await redis.hSet(userKey(uid), {
    streak: String(current),
    best: String(best),
    played: String(played),
    last: day,
  })
  return {current, best, played}
}

/** The streak as it stands today: it lapses after a missed day. */
export async function getStreak(day: string, uid: string): Promise<Streak> {
  const h = await redis.hGetAll(userKey(uid))
  const last = h.last ?? ''
  const alive = last === day || last === addDays(day, -1)
  return {
    current: alive ? Number(h.streak ?? 0) : 0,
    best: Number(h.best ?? 0),
    played: Number(h.played ?? 0),
  }
}

/** The top of a board, plus the asker's own row if they're on it. */
export async function readBoard(
  key: string,
  label: string,
  uid: string | undefined,
  top: number = BOARD_TOP,
): Promise<Board> {
  const players = await redis.zCard(key)
  const rows = players
    ? await redis.zRange(key, 0, top - 1, {by: 'rank', reverse: true})
    : []
  const ids = rows.map(r => r.member)
  if (uid && !ids.includes(uid)) ids.push(uid)
  const names = ids.length ? await redis.hMGet(namesKey, ids) : []
  const nameOf = (id: string): string => names[ids.indexOf(id)] ?? 'someone'
  const out: BoardRow[] = rows.map((r, i) => ({
    rank: i + 1,
    name: nameOf(r.member),
    score: Math.round(r.score),
  }))
  let me: BoardRow | undefined
  if (uid) {
    const score = await redis.zScore(key, uid)
    const asc = await redis.zRank(key, uid)
    if (score !== undefined && asc !== undefined)
      me = {rank: players - asc, name: nameOf(uid), score: Math.round(score)}
  }
  return {key, label, top: out, me, players}
}

/** A player's place on a board, 1 for the top, or undefined if they're not on it. */
export async function rankOn(
  key: string,
  uid: string,
): Promise<number | undefined> {
  const asc = await redis.zRank(key, uid)
  if (asc === undefined) return
  return (await redis.zCard(key)) - asc
}

/** Uses the day's one retry. Returns retries used after the call, or 0 if none left. */
export async function useRetry(day: string, uid: string): Promise<number> {
  const key = userDayKey(day, uid)
  const used = await redis.hIncrBy(key, 'retries', 1)
  if (used > 1) {
    await redis.hIncrBy(key, 'retries', -1)
    return 0
  }
  return used
}

const statsKey = (day: string): string => `stats:${day}`

/** Adds a ranked solve to the day's count, total time and fastest time. */
export async function addSolve(
  day: string,
  seconds: number,
): Promise<DayStats> {
  const s = Math.round(seconds)
  const solves = await redis.hIncrBy(statsKey(day), 'solves', 1)
  const time = await redis.hIncrBy(statsKey(day), 'time', s)
  const was = Number((await redis.hGet(statsKey(day), 'fastest')) ?? 0)
  const fastest = was && was <= s ? was : s
  if (fastest !== was)
    await redis.hSet(statsKey(day), {fastest: String(fastest)})
  return {solves, avgTime: Math.round(time / solves), fastest}
}

export async function getDayStats(day: string): Promise<DayStats> {
  const h = await redis.hGetAll(statsKey(day))
  const solves = Number(h.solves ?? 0)
  return {
    solves,
    avgTime: solves ? Math.round(Number(h.time ?? 0) / solves) : 0,
    fastest: Number(h.fastest ?? 0),
  }
}

/** Share of the other players on a board that a rank beats, 0 to 100. */
export function beatPct(rank: number, players: number): number {
  if (players <= 1) return 100
  return Math.round(((players - rank) / (players - 1)) * 100)
}
