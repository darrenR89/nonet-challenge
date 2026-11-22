// The weekly top nine post as a race: each top player's points day by day, so the post can play
// the week back. Built from the day boards, which are kept for good, so any past week works.
import {redis} from '@devvit/web/server'
import type {RaceRow, RaceRsp} from '../shared/api.ts'
import {addDays} from '../shared/scoring.ts'
import {BOARD_TOP, boardKey, getStreak, namesOf} from './board.ts'
import {topCrews} from './crews.ts'

type Race = NonNullable<RaceRsp['race']>

/** Each player's points on each of the week's seven days. */
async function pointsOf(from: string, ids: string[]): Promise<number[][]> {
  const days = Array.from({length: 7}, (_, i) => addDays(from, i))
  const out: number[][] = []
  for (const id of ids) {
    const row: number[] = []
    for (const d of days)
      row.push(Math.round((await redis.zScore(boardKey.day(d), id)) ?? 0))
    out.push(row)
  }
  return out
}

/** The week's race, as `uid` sees it. */
export async function weekRace(
  week: string,
  from: string,
  final: boolean,
  uid: string | undefined,
): Promise<Race> {
  const key = boardKey.week(week)
  const players = await redis.zCard(key)
  const top = await redis.zRange(key, 0, BOARD_TOP - 1, {
    by: 'rank',
    reverse: true,
  })
  const ids = top.map(r => r.member)
  const inTop = !!uid && ids.includes(uid)
  const mine = uid && !inTop ? await redis.zScore(key, uid) : undefined
  const all = mine !== undefined && uid ? [...ids, uid] : ids
  const names = await namesOf(all)
  const points = await pointsOf(from, all)
  const rowOf = (i: number): RaceRow => ({
    name: names[i] ?? 'someone',
    points: points[i] ?? [],
  })
  const rows = ids.map((_, i) => rowOf(i))
  let me: Race['me']
  if (mine !== undefined && uid) {
    const asc = (await redis.zRank(key, uid)) ?? 0
    me = {...rowOf(ids.length), rank: players - asc}
  }
  // the longest streak among the top nine, as of the week's last day
  const sunday = addDays(from, 6)
  let streak: Race['streak']
  for (const [i, id] of ids.entries()) {
    const days = (await getStreak(sunday, id)).current
    if (days > (streak?.days ?? 0)) streak = {name: names[i] ?? 'someone', days}
  }
  const crew = (await topCrews(week, 1))[0]
  return {
    week,
    from,
    final,
    players,
    rows,
    me,
    myName: inTop && uid ? names[ids.indexOf(uid)] : undefined,
    streak,
    crew: crew ? {name: crew.name, points: crew.points} : undefined,
  }
}
