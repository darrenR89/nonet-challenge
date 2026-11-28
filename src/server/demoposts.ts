// Demo posts: one per kind of post the app makes, each filled with sample players so a
// moderator can see it at full effect, for a review or screenshots. A demo post carries
// `{demo: kind}` as its post data and every number on it is made up on the spot from the
// sample players. Nothing is written to the real boards, crews, challenges or records, so the
// demo can't leak into them, and removing the demo posts clears the demo away.
import {redis} from '@devvit/web/server'
import type {RaceRow, RaceRsp, ReplayRsp} from '../shared/api.ts'
import {makeDay, type Puzzle} from '../shared/model.js'
import {code, type MoveLog} from '../shared/replay.ts'
import {
  addDays,
  dayOfYear,
  levelOf,
  maxTurns,
  type RunStats,
  scoreRun,
  weekday,
  weekKey,
} from '../shared/scoring.ts'
import {BOARD_TOP} from './board.ts'
import {NAMES, noise, scoreOf} from './demo.ts'

/** The kinds of post the app makes, each with a demo. */
export const DEMO_KINDS = ['daily', 'race', 'replay'] as const
export type DemoKind = (typeof DEMO_KINDS)[number]

/** The demo kind of the open post, or undefined for a real post. */
export function demoKindOf(postData: unknown): DemoKind | undefined {
  const k = (postData as {demo?: unknown} | undefined)?.demo
  return DEMO_KINDS.find(d => d === k)
}

/** Every demo post made, by post id, so they can all be removed at once. */
const DEMO_POSTS = 'demo:posts'

export async function noteDemoPost(id: string, kind: DemoKind): Promise<void> {
  await redis.hSet(DEMO_POSTS, {[id]: kind})
}

/** The demo posts made so far, as post ids. */
export async function demoPosts(): Promise<string[]> {
  return Object.keys(await redis.hGetAll(DEMO_POSTS))
}

export async function forgetDemoPosts(ids: string[]): Promise<void> {
  if (ids.length) await redis.hDel(DEMO_POSTS, ids)
}

/** Last week's Monday: the demo race shows a whole week, as the Monday post does. */
export const lastWeekFrom = (day: string): string =>
  addDays(day, 1 - weekday(day) - 7)

type Race = NonNullable<RaceRsp['race']>

/**
 * Last week as a race: nine sample players whose days rise and fall, so places swap as it plays
 * back, with a rest day here and there. The viewer is just off the board, to show their own bar.
 */
export function demoRace(day: string, myName: string | undefined): Race {
  const from = lastWeekFrom(day)
  const week = weekKey(from)
  const days = Array.from({length: 7}, (_, i) => addDays(from, i))
  const pointsOf = (name: string, form: number): number[] =>
    days.map(d =>
      // about one day in eight is missed; form spreads the totals apart
      noise(name, `${d}:rest`) < 0.12
        ? 0
        : Math.round(scoreOf(name, d) * (0.7 + form)),
    )
  const rows: RaceRow[] = NAMES.slice(0, BOARD_TOP + 3)
    .map((name, i) => ({name, points: pointsOf(name, 0.6 - i * 0.03)}))
    .sort((a, b) => total(b) - total(a))
    .slice(0, BOARD_TOP)
  const ninth = total(rows[BOARD_TOP - 1] ?? {name: '', points: []})
  // the viewer: a good week, a few hundred points short of the board
  const mine = pointsOf(myName ?? 'you', 0.1)
  const scale = (ninth * 0.82) / Math.max(1, total({name: '', points: mine}))
  const me = {
    name: myName ?? 'you',
    points: mine.map(p => Math.round(p * scale)),
    rank: 14,
  }
  const top = rows[0]?.name ?? NAMES[0]
  return {
    week,
    from,
    final: true,
    players: 2310,
    rows,
    me: myName ? me : undefined,
    myName: undefined,
    streak: {name: rows[2]?.name ?? top, days: 23},
    crew: {name: 'Night Owls', points: 41_870},
  }
}

const total = (r: RaceRow): number => r.points.reduce((n, p) => n + p, 0)

/** a[i], or a thrown error: the sample run is built from a cube that always has it. */
function at<T>(a: readonly T[], i: number): T {
  const v = a[i]
  if (v === undefined) throw Error(`no entry ${i}`)
  return v
}

/** The demo cube for a day: made from a fixed seed, never stored, never a real day's cube. */
const cubes = new Map<string, Puzzle>()
function demoCube(day: string): Puzzle {
  const have = cubes.get(day)
  if (have) return have
  const level = levelOf(day)
  const p = at(makeDay(`nonet-demo:${day}`, level).tiers, maxTurns(level))
  cubes.set(day, p)
  return p
}

/**
 * A sample run on a demo cube, as the game would log it: the dial-in with one wrong turn put
 * right, the ★ squares first, one miss, and the fill at a person's pace. It passes checkLog.
 */
export function demoRun(p: Readonly<Puzzle>): {
  log: MoveLog
  stats: RunStats
} {
  const log: MoveLog = []
  const pace = (i: number, lo: number, hi: number): number =>
    Math.round(lo + (hi - lo) * noise(`pace${i}`, p.sol.join('')))
  let t = 40
  // a wrong turn first, then straight back
  const first = at(p.moves, 0)
  const wrong = [(first[0] + 1) % 3, first[1], first[2]] as const
  log.push(t, code.turn(wrong))
  t += 25
  log.push(t, code.turn([wrong[0], wrong[1], -wrong[2]]))
  for (const [i, m] of p.moves.slice().reverse().entries()) {
    t += pace(i, 30, 90)
    log.push(t, code.turn([m[0], m[1], -m[2]]))
  }
  t += 20
  const t1 = t / 10
  log.push(t, code.dial)
  for (const s of p.stars) log.push(t, code.star(s))
  const blanks = p.given.map((v, c) => (v ? -1 : c)).filter(c => c >= 0)
  const order = [...p.stars, ...blanks.filter(c => !p.stars.includes(c))]
  let wrongLocks = 0
  for (const [i, c] of order.entries()) {
    t += pace(100 + i, 18, 75)
    // one miss a third of the way in, on a square that isn't a ★
    if (i === Math.floor(order.length / 3)) {
      log.push(t, code.miss(c, (at(p.sol, c) % 9) + 1))
      wrongLocks++
      t += 22
    }
    log.push(t, code.lock(c, at(p.sol, c)))
  }
  return {
    log,
    stats: {
      turns: p.moves.length + 2,
      t1,
      t2: t / 10 - t1,
      blanks: blanks.length,
      wrong: wrongLocks,
      hintsUsed: 0,
      starsWon: 3,
    },
  }
}

/** The demo play of the week: a sample player's run on last Thursday's demo cube. */
export function demoPlay(day: string): NonNullable<ReplayRsp['play']> {
  const d = addDays(lastWeekFrom(day), 3)
  const p = demoCube(d)
  const {log, stats} = demoRun(p)
  const level = levelOf(d)
  return {
    name: 'pivot_pat',
    day: d,
    cubeNo: dayOfYear(d),
    level,
    tier: p.tier,
    score: scoreRun(level, p.tier, stats).total,
    time: Math.round(stats.t1 + stats.t2),
    stars: stats.starsWon,
    wrong: stats.wrong,
    log,
    start: p.start,
    layout: p.layout ?? 'mirror',
  }
}
