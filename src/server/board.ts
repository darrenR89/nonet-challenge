// Players, streaks and boards. Boards are Redis sorted sets of userId → points.
import {redis} from '@devvit/web/server'
import type {
  Board,
  BoardRow,
  DayStats,
  MyDay,
  Streak,
  TierStats,
} from '../shared/api.ts'
import {weekKey} from '../shared/scoring.ts'
import {
  liveStreak,
  playStreak,
  restUsed,
  type StreakState,
} from '../shared/streak.ts'

/** A stored streak hash as the shared streak rules read it. */
export const stateOf = (h: Record<string, string>): StreakState => ({
  last: h.last ?? '',
  count: Number(h.streak ?? 0),
  restWeek: h.restWeek ?? '',
})

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
    commented: h.commented === '1',
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
  /** False for a demo run, which is left out of the day's numbers. */
  counts = true,
): Promise<number> {
  const key = userDayKey(day, uid)
  const set = await redis.hSetNX(key, 'tier', String(tier))
  if (set) {
    await redis.hSet(key, {started: String(nowMs)})
    await redis.expire(key, DAY_TTL)
    if (counts) await addPick(day, tier)
    return tier
  }
  return Number(await redis.hGet(key, 'tier'))
}

// A run started while logged out: its tier and start time, kept two days under a random id, so
// the player's run can be claimed once they sign up and the server still knows when it began.
const guestKey = (day: string, id: string): string => `guest:${day}:${id}`

/** Notes a logged-out start and returns its id. */
export async function startGuest(
  day: string,
  tier: number,
  nowMs: number,
): Promise<string> {
  const id = crypto.randomUUID()
  await redis.hSet(guestKey(day, id), {
    tier: String(tier),
    started: String(nowMs),
  })
  await redis.expire(guestKey(day, id), DAY_TTL)
  return id
}

/** The logged-out run with this id, removed so it's claimed once. */
export async function takeGuest(
  day: string,
  id: string,
): Promise<{tier: number; started: number} | undefined> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return
  const h = await redis.hGetAll(guestKey(day, id))
  if (h.tier === undefined) return
  await redis.del(guestKey(day, id))
  return {tier: Number(h.tier), started: Number(h.started)}
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

/** Keeps the counted run's solve time on the day record, for the result comment. */
export async function noteRunTime(
  day: string,
  uid: string,
  time: number,
): Promise<void> {
  await redis.hSet(userDayKey(day, uid), {time: String(Math.round(time))})
}

/** Claims today's result comment. False if it was already posted. */
export async function claimComment(day: string, uid: string): Promise<boolean> {
  return (await redis.hSetNX(userDayKey(day, uid), 'commented', '1')) > 0
}

/** Gives the claim back when Reddit didn't take the comment, so the player can try again. */
export async function releaseComment(day: string, uid: string): Promise<void> {
  await redis.hDel(userDayKey(day, uid), ['commented'])
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

/** A streak counts days in a row with a finished, scored cube, with one rest day a week. */
export async function bumpStreak(day: string, uid: string): Promise<Streak> {
  const h = await redis.hGetAll(userKey(uid))
  const last = h.last ?? ''
  const st = playStreak(stateOf(h), day)
  const best = Math.max(st.count, Number(h.best ?? 0))
  const played = Number(h.played ?? 0) + (last === day ? 0 : 1)
  await redis.hSet(userKey(uid), {
    streak: String(st.count),
    best: String(best),
    played: String(played),
    last: day,
    restWeek: st.restWeek,
  })
  return {current: st.count, best, played, restUsed: restUsed(st, day)}
}

/** The streak as it stands today: it lapses after a missed day the week's rest day can't cover. */
export async function getStreak(day: string, uid: string): Promise<Streak> {
  const h = await redis.hGetAll(userKey(uid))
  const st = stateOf(h)
  return {
    current: liveStreak(st, day),
    best: Number(h.best ?? 0),
    played: Number(h.played ?? 0),
    restUsed: restUsed(st, day),
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

/** Forgets a player's run for the day: used to start a demo run afresh. */
export async function clearDay(day: string, uid: string): Promise<void> {
  await redis.del(userDayKey(day, uid))
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

/** Counts a player setting today to `tier` rotations. Call once, when the tier locks. */
export async function addPick(day: string, tier: number): Promise<void> {
  await redis.hIncrBy(statsKey(day), `t${tier}:picks`, 1)
}

/** Adds a ranked solve to the day's count, total time and fastest time, overall and for its tier. */
export async function addSolve(
  day: string,
  seconds: number,
  tier: number,
  score: number,
): Promise<DayStats> {
  const s = Math.round(seconds)
  const k = statsKey(day)
  await redis.hIncrBy(k, 'solves', 1)
  await redis.hIncrBy(k, 'time', s)
  const was = Number((await redis.hGet(k, 'fastest')) ?? 0)
  if (!was || s < was) await redis.hSet(k, {fastest: String(s)})
  await redis.hIncrBy(k, `t${tier}:solves`, 1)
  await redis.hIncrBy(k, `t${tier}:time`, s)
  await redis.hIncrBy(k, `t${tier}:score`, Math.round(score))
  const best = Number((await redis.hGet(k, `t${tier}:best`)) ?? 0)
  if (score > best) await redis.hSet(k, {[`t${tier}:best`]: String(score)})
  return getDayStats(day)
}

/** Reads the day's stats as `addPick` and `addSolve` left them. Pure, for tests. */
export function dayStatsOf(h: Record<string, string>): DayStats {
  const n = (f: string): number => Number(h[f] ?? 0)
  const solves = n('solves')
  const tiers: TierStats[] = [0, 1, 2, 3].map(tier => {
    const sv = n(`t${tier}:solves`)
    return {
      tier,
      picks: n(`t${tier}:picks`),
      solves: sv,
      avgTime: sv ? Math.round(n(`t${tier}:time`) / sv) : 0,
      avgScore: sv ? Math.round(n(`t${tier}:score`) / sv) : 0,
      best: n(`t${tier}:best`),
    }
  })
  return {
    solves,
    avgTime: solves ? Math.round(n('time') / solves) : 0,
    fastest: n('fastest'),
    tiers,
  }
}

export async function getDayStats(day: string): Promise<DayStats> {
  return dayStatsOf(await redis.hGetAll(statsKey(day)))
}

/** Share of the other players on a board that a rank beats, 0 to 100. */
export function beatPct(rank: number, players: number): number {
  if (players <= 1) return 100
  return Math.round(((players - rank) / (players - 1)) * 100)
}
