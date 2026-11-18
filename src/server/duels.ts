// Challenges between players on the day's cube. Everyone plays the same cube, so two
// scores on one day compare fairly. A challenge settles once both players have finished,
// and adds to the pair's all-time record.
import {redis} from '@devvit/web/server'
import {
  type Duel,
  duelResult,
  MAX_CHALLENGES,
  type Record3,
} from '../shared/duel.ts'
import {DAY_TTL, getDayRecord, namesOf} from './board.ts'

/** A player's challenges on a day: other player's id → 'out' (sent) or 'in' (received). */
const mineKey = (day: string, uid: string): string => `duel:${day}:${uid}`
/** Pairs already settled on a day, so a record only counts once. */
const settledKey = (day: string): string => `duel:${day}:settled`
/** Two players' record. Fields: each player's id for their wins, and 'tie'. */
const recordKey = (a: string, b: string): string =>
  a < b ? `h2h:${a}:${b}` : `h2h:${b}:${a}`
const pairOf = (a: string, b: string): string =>
  a < b ? `${a}:${b}` : `${b}:${a}`

export type AddDuel = 'ok' | 'again' | 'full'

/** Records a challenge from one player to another. Each pair meets once a day. */
export async function addDuel(
  day: string,
  from: string,
  to: string,
): Promise<AddDuel> {
  const mine = await redis.hGetAll(mineKey(day, from))
  if (mine[to] !== undefined) return 'again'
  const sent = Object.values(mine).filter(v => v === 'out').length
  if (sent >= MAX_CHALLENGES) return 'full'
  // if the other player got there first, theirs stands
  if (!(await redis.hSetNX(mineKey(day, to), from, 'in'))) return 'again'
  await redis.hSet(mineKey(day, from), {[to]: 'out'})
  await redis.expire(mineKey(day, from), DAY_TTL)
  await redis.expire(mineKey(day, to), DAY_TTL)
  return 'ok'
}

const scoreOf = async (
  day: string,
  uid: string,
): Promise<number | undefined> => {
  const s = (await getDayRecord(day, uid)).score
  return s === undefined || s === '' ? undefined : Number(s)
}

/** Settles every challenge of a player's that now has both scores. Safe to call again. */
export async function settleDuels(day: string, uid: string): Promise<void> {
  const mine = await scoreOf(day, uid)
  if (mine === undefined) return
  for (const other of Object.keys(await redis.hGetAll(mineKey(day, uid)))) {
    const theirs = await scoreOf(day, other)
    const result = duelResult(mine, theirs)
    if (result === 'pending') continue
    if (!(await redis.hSetNX(settledKey(day), pairOf(uid, other), '1')))
      continue
    await redis.expire(settledKey(day), DAY_TTL)
    const field = result === 'won' ? uid : result === 'lost' ? other : 'tie'
    await redis.hIncrBy(recordKey(uid, other), field, 1)
  }
}

export async function recordOf(uid: string, other: string): Promise<Record3> {
  const h = await redis.hGetAll(recordKey(uid, other))
  return {
    won: Number(h[uid] ?? 0),
    lost: Number(h[other] ?? 0),
    tied: Number(h.tie ?? 0),
  }
}

/** A player's challenges on a day, sent and received, with scores and records. */
export async function duelsFor(day: string, uid: string): Promise<Duel[]> {
  const mine = await redis.hGetAll(mineKey(day, uid))
  const ids = Object.keys(mine)
  const names = await namesOf(ids)
  const myScore = await scoreOf(day, uid)
  const out: Duel[] = []
  for (const [i, other] of ids.entries()) {
    const theirs = await scoreOf(day, other)
    out.push({
      day,
      them: names[i] ?? 'someone',
      sent: mine[other] === 'out',
      mine: myScore,
      theirs,
      result: duelResult(myScore, theirs),
      record: await recordOf(uid, other),
    })
  }
  return out
}
