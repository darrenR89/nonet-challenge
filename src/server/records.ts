// The subreddit's records: the week's best single solve (the spotlight), the longest streaks,
// and a line per finished week for the wiki's past weeks.
import {redis} from '@devvit/web/server'
import type {Board} from '../shared/api.ts'
import {shortDate, weekKey} from '../shared/scoring.ts'
import {boardKey, namesOf, readBoard} from './board.ts'
import {cubeNumber} from './cube.ts'

/** The highest single-day score in a week, and how it was played. */
export type Spot = {
  name: string
  score: number
  day: string
  tier: number
  /** Seconds, both stages. */
  time: number
  stars: number
  wrong: number
}

/** A finished week, as the wiki lists it. */
export type WeekRecord = {
  week: string
  /** The Monday it started. */
  from: string
  players: number
  winner: {name: string; score: number} | undefined
  spot: Spot | undefined
}

const spotKey = (week: string): string => `spot:${week}`
const logKey = (day: string): string => `runlog:${day}`
/** Checked move logs stay ten days: long enough for the Monday post to pick from the week before. */
const LOG_TTL = 10 * 86400
export const streaksKey = 'streaks:best'
const weeksKey = 'weeks'

/** Keeps a counted run as the week's spotlight if it beats the best so far. Ties keep the first. */
export async function noteSolve(
  day: string,
  uid: string,
  run: {
    score: number
    tier: number
    time: number
    stars: number
    wrong: number
  },
): Promise<void> {
  const key = spotKey(weekKey(day))
  const best = await redis.hGet(key, 'score')
  if (best !== undefined && run.score <= Number(best)) return
  await redis.hSet(key, {
    uid,
    day,
    score: String(run.score),
    tier: String(run.tier),
    time: String(Math.round(run.time)),
    stars: String(run.stars),
    wrong: String(run.wrong),
  })
}

/** A counted run with a checked move log, kept for the play of the week. */
export type LoggedRun = {
  log: number[]
  score: number
  tier: number
  /** Seconds, both stages. */
  time: number
  stars: number
  wrong: number
}

/** The play of the week, as its post shows it. */
export type PlayOfWeek = LoggedRun & {uid: string; name: string; day: string}

const candKey = (week: string): string => `playweek:${week}`
const featuredKey = (week: string): string => `playweek:${week}:post`
const noFeatureKey = 'nofeature'

/** Keeps a counted run's checked move log for ten days, as a candidate for the play of the week. */
export async function saveRunLog(
  day: string,
  uid: string,
  run: LoggedRun,
): Promise<void> {
  await redis.hSet(logKey(day), {[uid]: JSON.stringify(run)})
  await redis.expire(logKey(day), LOG_TTL)
  const cand = candKey(weekKey(day))
  await redis.zAdd(cand, {member: `${day} ${uid}`, score: run.score})
  await redis.expire(cand, LOG_TTL + 7 * 86400)
}

/** A counted run's checked move log, if it was kept. */
export async function runLog(
  day: string,
  uid: string,
): Promise<LoggedRun | undefined> {
  const raw = await redis.hGet(logKey(day), uid)
  if (!raw) return
  try {
    const v = JSON.parse(raw) as Partial<LoggedRun>
    const log = parseLog(JSON.stringify(v.log))
    if (!log) return
    const n = (x: unknown): number => (typeof x === 'number' ? x : 0)
    return {
      log,
      score: n(v.score),
      tier: n(v.tier),
      time: n(v.time),
      stars: n(v.stars),
      wrong: n(v.wrong),
    }
  } catch {
    return
  }
}

/** Whether a player lets the app feature their runs. Everyone does until they switch it off. */
export async function featureOn(uid: string): Promise<boolean> {
  return (await redis.hGet(noFeatureKey, uid)) === undefined
}

export async function setFeature(uid: string, on: boolean): Promise<void> {
  if (on) await redis.hDel(noFeatureKey, [uid])
  else await redis.hSet(noFeatureKey, {[uid]: '1'})
}

/** The week's best run that has a kept log, from a player who hasn't switched featuring off. */
export async function pickPlayOfWeek(
  week: string,
): Promise<PlayOfWeek | undefined> {
  const rows = await redis.zRange(candKey(week), 0, 49, {
    by: 'rank',
    reverse: true,
  })
  for (const {member} of rows) {
    const [day, uid] = member.split(' ')
    if (!day || !uid || !(await featureOn(uid))) continue
    const run = await runLog(day, uid)
    if (!run) continue
    const [name] = await namesOf([uid])
    return {...run, uid, day, name: name ?? 'someone'}
  }
  return
}

/** Keeps the featured run for good, so its post plays the same run after the logs expire. */
export async function keepPlayOfWeek(
  week: string,
  play: PlayOfWeek,
): Promise<void> {
  await redis.hSet(featuredKey(week), {run: JSON.stringify(play)})
}

export async function playOfWeek(
  week: string,
): Promise<PlayOfWeek | undefined> {
  const raw = await redis.hGet(featuredKey(week), 'run')
  if (!raw) return
  try {
    const v = JSON.parse(raw) as PlayOfWeek
    return parseLog(JSON.stringify(v.log)) ? v : undefined
  } catch {
    return
  }
}

function parseLog(raw: string | undefined): number[] | undefined {
  if (!raw) return
  try {
    const v: unknown = JSON.parse(raw)
    return Array.isArray(v) && v.every(Number.isInteger) ? v : undefined
  } catch {
    return
  }
}

export async function getSpot(week: string): Promise<Spot | undefined> {
  const h = await redis.hGetAll(spotKey(week))
  if (!h.uid || !h.day) return
  const [name] = await namesOf([h.uid])
  return {
    name: name ?? 'someone',
    day: h.day,
    score: Number(h.score ?? 0),
    tier: Number(h.tier ?? 0),
    time: Number(h.time ?? 0),
    stars: Number(h.stars ?? 0),
    wrong: Number(h.wrong ?? 0),
  }
}

/** Notes a player's best streak, for the wiki's longest streaks. */
export async function noteBestStreak(uid: string, best: number): Promise<void> {
  await redis.zAdd(streaksKey, {member: uid, score: best})
}

export async function longestStreaks(): Promise<Board> {
  return readBoard(streaksKey, 'Longest streaks', undefined)
}

/** Saves a finished week's line for the wiki, and returns it. */
export async function saveWeek(
  week: string,
  from: string,
): Promise<WeekRecord> {
  const b = await readBoard(boardKey.week(week), week, undefined)
  const top = b.top[0]
  const rec: WeekRecord = {
    week,
    from,
    players: b.players,
    winner: top ? {name: top.name, score: top.score} : undefined,
    spot: await getSpot(week),
  }
  await redis.hSet(weeksKey, {[week]: JSON.stringify(rec)})
  return rec
}

/** Finished weeks, newest first. */
export async function pastWeeks(): Promise<WeekRecord[]> {
  const all = await redis.hGetAll(weeksKey)
  return Object.values(all)
    .map(v => JSON.parse(v) as WeekRecord)
    .sort((a, b) => b.week.localeCompare(a.week))
}

/** Seconds as m:ss. */
export const clockTime = (s: number): string =>
  `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, '0')}`

/** The spotlight in one sentence, for the Monday post. */
export function spotText(s: Spot): string {
  const turns =
    s.tier === 0 ? 'no turns' : `${s.tier} turn${s.tier === 1 ? '' : 's'}`
  const stars = s.stars === 3 ? 'all three ★' : `${s.stars} ★`
  const misses =
    s.wrong === 0 ? 'no misses' : `${s.wrong} miss${s.wrong === 1 ? '' : 'es'}`
  return `u/${s.name} scored ${s.score.toLocaleString('en-GB')} on ${shortDate(s.day)} (cube #${cubeNumber(s.day)}): ${turns}, ${clockTime(s.time)}, ${stars}, ${misses}.`
}
