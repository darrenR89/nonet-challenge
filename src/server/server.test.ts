import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import type {AddressInfo, Server} from 'node:net'
import {after, before, beforeEach, test} from 'node:test'
import {telemetry} from '@devvit/analytics/server/reddit'
import {
  type Context,
  notifications,
  reddit,
  runWithContext,
  settings,
} from '@devvit/web/server'
import {
  type CardRsp,
  type ChallengeRsp,
  type DailyRsp,
  Endpoint,
  type ErrorRsp,
  type JoinTeamRsp,
  type ScoreReq,
  type ScoreRsp,
  type StartRsp,
} from '../shared/api.ts'
import type {RunStats} from '../shared/scoring.ts'
import {clock, onReq, runDaily} from './server.ts'
import {
  clearFakeRedis,
  installFakeRedis,
  removeFakeRedis,
} from './test/fake-redis.ts'

let server: Server
let serverURL: string
let user: {userId?: string; username?: string} = {}
let now = new Date('2026-11-14T12:00:00Z')
const posts: string[] = []
let autoPost: boolean | undefined = true
/** Journey events the server sent to Devvit, in order. */
const journeys: {kind: string; body: unknown}[] = []
let optedIn = false
const pushed: string[] = []
/** Comments the app made, as [post id, text]. */
const comments: [string, string][] = []

const r = reddit as unknown as Record<string, unknown>
const s = settings as unknown as Record<string, unknown>
const was = {
  submitCustomPost: r.submitCustomPost,
  submitPost: r.submitPost,
  getUserByUsername: r.getUserByUsername,
  submitComment: r.submitComment,
  get: s.get,
}

before(async () => {
  installFakeRedis()
  clock.now = () => now
  r.submitCustomPost = async (o: {title: string}) => {
    posts.push(o.title)
    return {id: 't3_post', url: 'https://reddit.com/x'}
  }
  r.submitPost = async (o: {title: string}) => {
    posts.push(o.title)
    return {id: 't3_text', url: 'https://reddit.com/y'}
  }
  s.get = async () => autoPost
  // every name is a Reddit user except "ghost"
  r.getUserByUsername = async (name: string) =>
    name.toLowerCase() === 'ghost'
      ? undefined
      : {id: `t2_${name.toLowerCase()}`, username: name.toLowerCase()}
  r.submitComment = async (o: {id: string; text: string}) => {
    comments.push([o.id, o.text])
    return {id: 't1_c'}
  }
  const t = telemetry as unknown as Record<string, unknown>
  const log =
    (kind: string, rsp: Record<string, unknown> = {}) =>
    async (body?: unknown) => {
      journeys.push({kind, body})
      return {receipt: {status: 'JOURNEY_RECEIPT_DENIED_PLAYTEST'}, ...rsp}
    }
  t.startJourney = log('start', {journeyId: 'j_1'})
  t.appReady = log('ready')
  t.journeyProgress = log('progress')
  t.journeyInteraction = log('interaction')
  t.endJourney = log('end')
  const n = notifications as unknown as Record<string, unknown>
  n.optInCurrentUser = async () => {
    optedIn = true
    return {success: true}
  }
  n.optOutCurrentUser = async () => {
    optedIn = false
    return {success: true}
  }
  n.isOptedIn = async () => optedIn
  n.listOptedInUsers = async () => ({userIds: optedIn ? ['t2_ann'] : []})
  n.enqueue = async (o: {title: string}) => {
    pushed.push(o.title)
    return {successCount: 1, failureCount: 0, errors: []}
  }

  server = createServer(async (req, rsp) => {
    await runWithContext(
      {
        appName: 'nonet-challenge',
        postId: 't3_123',
        ...user,
      } as unknown as Context,
      () => onReq(req, rsp),
    )
  })
  await new Promise<void>(resolve => {
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const info = server.address() as AddressInfo
  serverURL = `http://127.0.0.1:${info.port}`
})

after(async () => {
  removeFakeRedis()
  Object.assign(r, {
    submitCustomPost: was.submitCustomPost,
    submitPost: was.submitPost,
    getUserByUsername: was.getUserByUsername,
    submitComment: was.submitComment,
  })
  s.get = was.get
  if (!server.listening) return
  await new Promise<void>((resolve, reject) => {
    server.close(err => (err ? reject(err) : resolve()))
  })
})

beforeEach(() => {
  clearFakeRedis()
  posts.length = 0
  journeys.length = 0
  pushed.length = 0
  comments.length = 0
  optedIn = false
  autoPost = true
  now = new Date('2026-11-14T12:00:00Z')
  as('t2_ann', 'ann')
})

function as(userId: string | undefined, username?: string): void {
  user = userId ? {userId, username: username ?? userId} : {}
}

async function get<T>(path: string): Promise<{status: number; body: T}> {
  const rsp = await fetch(`${serverURL}/${path}`)
  return {status: rsp.status, body: (await rsp.json()) as T}
}

async function post<T>(
  path: string,
  body: unknown = {},
  headers: Record<string, string> = {},
): Promise<{status: number; body: T}> {
  const rsp = await fetch(`${serverURL}/${path}`, {
    body: JSON.stringify(body),
    headers: {'Content-Type': 'application/json', ...headers},
    method: 'POST',
  })
  return {status: rsp.status, body: (await rsp.json()) as T}
}

const later = (secs: number): void => {
  now = new Date(now.getTime() + secs * 1000)
}

/** A believable run: 3 minutes, all three stars, no misses. */
const run = (over: Partial<RunStats> = {}): RunStats => ({
  turns: 2,
  t1: 40,
  t2: 140,
  blanks: 0,
  wrong: 0,
  hintsUsed: 0,
  starsWon: 3,
  ...over,
})

async function playDay(tier: number, stats: RunStats) {
  const start = await post<StartRsp>(Endpoint.Start, {tier})
  assert.equal(start.status, 200)
  later(stats.t1 + stats.t2 + 5)
  const day = now.toISOString().slice(0, 10)
  const req: ScoreReq = {day, tier, stats}
  return post<ScoreRsp>(Endpoint.Score, req)
}

test('everyone gets the same cube on a day, and a new one the next day', async () => {
  const a = await post<StartRsp>(Endpoint.Start, {tier: 1})
  as('t2_bob', 'bob')
  const b = await post<StartRsp>(Endpoint.Start, {tier: 1})
  assert.deepEqual(a.body.puzzle, b.body.puzzle)
  assert.equal(a.body.puzzle.stars.length, 3)
  assert.equal(a.body.puzzle.moves.length, 1)

  as('t2_cat', 'cat')
  const c = await post<StartRsp>(Endpoint.Start, {tier: 2})
  assert.deepEqual(c.body.puzzle.sol, a.body.puzzle.sol, 'tiers share one cube')

  now = new Date('2026-11-15T12:00:00Z')
  const d = await post<StartRsp>(Endpoint.Start, {tier: 1})
  assert.notDeepEqual(d.body.puzzle.sol, a.body.puzzle.sol)
})

test('the day has a fill level, and Hard days stop at 2 turns', async () => {
  // Saturday 14 Nov is Hard
  const daily = await get<DailyRsp>(Endpoint.Daily)
  assert.equal(daily.body.level, 2)
  const three = await post<ErrorRsp>(Endpoint.Start, {tier: 3})
  assert.equal(three.status, 400)
  const none = await post<StartRsp>(Endpoint.Start, {tier: 0})
  assert.equal(none.status, 200)
  assert.equal(none.body.puzzle.moves.length, 0)
  assert.deepEqual(none.body.puzzle.start, none.body.puzzle.given)
  assert.equal(none.body.puzzle.level, 2)
  // Sunday 15 Nov is Medium, with 3 turns on offer
  as('t2_bob', 'bob')
  now = new Date('2026-11-15T12:00:00Z')
  const sunday = await post<StartRsp>(Endpoint.Start, {tier: 3})
  assert.equal(sunday.status, 200)
  assert.equal(sunday.body.puzzle.level, 1)
})

test('no turns scores Stage 2 only, at x1', async () => {
  const r = await playDay(0, run({t1: 0}))
  assert.equal(r.status, 200)
  assert.equal(r.body.breakdown.turnPts, 0)
  assert.equal(r.body.breakdown.sp1, 0)
  assert.equal(r.body.breakdown.bonus, 0)
  assert.equal(r.body.breakdown.mult, 1)
})

test('the tier is locked for the day', async () => {
  await post<StartRsp>(Endpoint.Start, {tier: 2})
  const again = await post<StartRsp>(Endpoint.Start, {tier: 0})
  assert.equal(again.body.tier, 2)
  const daily = await get<DailyRsp>(Endpoint.Daily)
  assert.equal(daily.body.my.tier, 2)
  assert.ok(daily.body.puzzle)
})

test('a run scores, ranks, and only the first one counts', async () => {
  const first = await playDay(1, run())
  assert.equal(first.status, 200)
  assert.equal(first.body.counted, true)
  assert.ok(first.body.total > 0)
  assert.equal(first.body.boards.day.me?.rank, 1)
  assert.equal(first.body.boards.week.me?.score, first.body.total)
  assert.equal(first.body.streak.current, 1)

  later(60)
  const day = now.toISOString().slice(0, 10)
  const second = await post<ScoreRsp>(Endpoint.Score, {
    day,
    tier: 1,
    stats: run({t2: 100}),
  })
  assert.equal(second.body.counted, false)
  assert.equal(second.body.total, first.body.total)
})

test('runs that cannot have happened are refused', async () => {
  await post<StartRsp>(Endpoint.Start, {tier: 0})
  later(30)
  const day = now.toISOString().slice(0, 10)
  const tooLong = await post<ErrorRsp>(Endpoint.Score, {
    day,
    tier: 0,
    stats: run({t1: 200, t2: 200}),
  })
  assert.equal(tooLong.status, 400)
  const wrongTier = await post<ErrorRsp>(Endpoint.Score, {
    day,
    tier: 3,
    stats: run({t1: 5, t2: 20}),
  })
  assert.equal(wrongTier.status, 409)
  const tooFast = await post<ErrorRsp>(Endpoint.Score, {
    day,
    tier: 0,
    stats: run({t1: 1, t2: 1}),
  })
  assert.equal(tooFast.status, 400)
})

test('giving up uses up the day', async () => {
  await post<StartRsp>(Endpoint.Start, {tier: 1})
  later(60)
  const day = now.toISOString().slice(0, 10)
  const gave = await post<ScoreRsp>(Endpoint.Score, {
    day,
    tier: 1,
    stats: run(),
    forfeit: true,
  })
  assert.equal(gave.body.counted, false)
  later(600)
  const after = await post<ScoreRsp>(Endpoint.Score, {
    day,
    tier: 1,
    stats: run(),
  })
  assert.equal(after.body.counted, false)
  assert.equal(after.body.boards.day.players, 0)
})

test('streaks grow on days in a row and lapse after a gap', async () => {
  await playDay(0, run())
  now = new Date('2026-11-15T12:00:00Z')
  const two = await playDay(0, run())
  assert.equal(two.body.streak.current, 2)
  now = new Date('2026-11-17T12:00:00Z')
  const daily = await get<DailyRsp>(Endpoint.Daily)
  assert.equal(daily.body.streak.current, 0)
  assert.equal(daily.body.streak.best, 2)
  const back = await playDay(0, run())
  assert.equal(back.body.streak.current, 1)
})

test('all three stars show tomorrow’s clues; fewer do not', async () => {
  const three = await playDay(1, run({starsWon: 3}))
  assert.equal(three.body.preview?.day, '2026-11-15')
  now = new Date('2026-11-15T08:00:30Z')
  const tomorrow = await post<StartRsp>(Endpoint.Start, {tier: 3})
  assert.deepEqual(three.body.preview?.given, tomorrow.body.puzzle.given)

  as('t2_bob', 'bob')
  now = new Date('2026-11-14T12:00:00Z')
  const two = await playDay(1, run({starsWon: 2}))
  assert.equal(two.body.preview, undefined)
})

test('the week board adds up days and ranks players', async () => {
  await playDay(2, run())
  as('t2_bob', 'bob')
  await playDay(0, run({wrong: 4}))
  const daily = await get<DailyRsp>(Endpoint.Daily)
  assert.equal(daily.body.boards.week.players, 2)
  assert.deepEqual(
    daily.body.boards.week.top.map(r => r.name),
    ['ann', 'bob'],
  )
  assert.equal(daily.body.boards.week.me?.rank, 2)
})

test('a team event: create, pick a side once, points count for it', async () => {
  const made = await post<{showToast?: {text: string}}>(
    Endpoint.OnFormNewEvent,
    {
      title: 'Big Game Week',
      tagline: 'Pick a side',
      start: '2026-11-13',
      end: '2026-11-16',
      teams: 'Chiefs #E31837\nEagles #004C54',
      teamScoring: ['sum'],
      bonusMult: 2,
    },
  )
  assert.match(made.body.showToast?.text ?? '', /Chiefs v Eagles/)

  const daily = await get<DailyRsp>(Endpoint.Daily)
  const ev = daily.body.event
  assert.ok(ev)
  assert.equal(ev.dayOf, 2)
  assert.equal(ev.days, 4)
  assert.equal(ev.myTeam, undefined)

  const join = await post<JoinTeamRsp>(Endpoint.JoinTeam, {
    eventId: ev.event.id,
    team: 'eagles',
  })
  assert.equal(join.body.event.myTeam, 'eagles')
  const switchSides = await post<JoinTeamRsp>(Endpoint.JoinTeam, {
    eventId: ev.event.id,
    team: 'chiefs',
  })
  assert.equal(switchSides.body.event.myTeam, 'eagles', 'first pick holds')

  const played = await playDay(1, run())
  const eagles = played.body.event?.teams.find(t => t.team.id === 'eagles')
  assert.equal(eagles?.score, played.body.total * 2)
  assert.equal(eagles?.rank, 1)
  assert.equal(played.body.event?.board.me?.score, played.body.total * 2)
})

test('event forms explain mistakes', async () => {
  const bad = await post<{showToast?: {text: string}}>(
    Endpoint.OnFormNewEvent,
    {title: 'Solo', start: 'tomorrow'},
  )
  assert.match(bad.body.showToast?.text ?? '', /Dates must look like/)
  const one = await post<{showToast?: {text: string}}>(
    Endpoint.OnFormNewEvent,
    {title: 'One side', teams: 'Chiefs'},
  )
  assert.match(one.body.showToast?.text ?? '', /at least two teams/)
})

test('the daily job posts once a day, and the week on Mondays', async () => {
  now = new Date('2026-11-16T08:01:00Z') // just after midnight Pacific, a Monday
  await runDaily()
  await runDaily()
  assert.equal(posts.length, 2)
  assert.match(posts[0] ?? '', /^Nonet: today's cube · Mon 16 Nov/)
  assert.match(posts[1] ?? '', /the Nine for 2026-W46/)
  autoPost = false
  now = new Date('2026-11-17T08:01:00Z')
  await runDaily()
  assert.equal(posts.length, 2)
})

test('the daily post waits for midnight Pacific and is dated that day', async () => {
  now = new Date('2026-11-14T08:01:00Z') // 12:01 AM Saturday in California
  await runDaily()
  assert.equal(posts.length, 1)
  assert.match(posts[0] ?? '', /^Nonet: today's cube · Sat 14 Nov$/)
  now = new Date('2026-11-15T00:03:00Z') // 4:03 PM Saturday: midnight UTC, still Saturday here
  await runDaily()
  now = new Date('2026-11-15T07:01:00Z') // the summer-time run, 11:01 PM Saturday in winter
  await runDaily()
  assert.equal(posts.length, 1)
  now = new Date('2026-11-15T08:01:00Z')
  await runDaily()
  assert.equal(posts.length, 2)
  assert.match(posts[1] ?? '', /^Nonet: today's cube · Sun 15 Nov$/)
})

test("logged-out players play today's cube, and claim the run after signing up", async () => {
  as(undefined)
  const daily = await get<DailyRsp>(Endpoint.Daily)
  assert.equal(daily.body.loggedIn, false)
  const start = await post<StartRsp>(Endpoint.Start, {tier: 1})
  assert.equal(start.status, 200)
  assert.ok(start.body.guest)
  as('t2_bob', 'bob')
  const same = await post<StartRsp>(Endpoint.Start, {tier: 1})
  assert.deepEqual(
    start.body.puzzle,
    same.body.puzzle,
    'the same cube as everyone',
  )

  // a logged-out score is refused; the player signs up and claims it
  as(undefined)
  later(200)
  const day = now.toISOString().slice(0, 10)
  const req: ScoreReq = {day, tier: 1, stats: run(), guest: start.body.guest}
  assert.equal((await post<ErrorRsp>(Endpoint.Score, req)).status, 401)
  as('t2_new', 'newbie')
  const claim = await post<ScoreRsp>(Endpoint.Score, req)
  assert.equal(claim.status, 200)
  assert.equal(claim.body.counted, true)
  assert.equal(claim.body.streak.current, 1)
  assert.equal(claim.body.boards.day.me?.score, claim.body.total)

  // claimed once: another account can't take the same run
  as('t2_cat', 'cat')
  const again = await post<ErrorRsp>(Endpoint.Score, req)
  assert.equal(again.status, 409)
})

test('a claimed run still has to fit the time since its logged-out start', async () => {
  as(undefined)
  const start = await post<StartRsp>(Endpoint.Start, {tier: 1})
  later(30)
  as('t2_new', 'newbie')
  const day = now.toISOString().slice(0, 10)
  const r = await post<ErrorRsp>(Endpoint.Score, {
    day,
    tier: 1,
    stats: run(),
    guest: start.body.guest,
  })
  assert.equal(r.status, 400)
})

test('wrong method and unknown paths are 404', async () => {
  const rsp = await fetch(`${serverURL}/${Endpoint.Score}`)
  assert.equal(rsp.status, 404)
  const none = await fetch(serverURL)
  assert.deepEqual<ErrorRsp>(await none.json(), {
    error: 'not found',
    status: 404,
  })
})

test('one retry a day, and it costs a fifth of the total', async () => {
  const start = await post<StartRsp>(Endpoint.Start, {tier: 1})
  assert.equal(start.status, 200)
  const retry = await post<{retries: number; penalty: number}>(Endpoint.Retry)
  assert.deepEqual(retry.body, {retries: 1, penalty: 0.8})
  const again = await post<ErrorRsp>(Endpoint.Retry)
  assert.equal(again.status, 409)
  const daily = await get<DailyRsp>(Endpoint.Daily)
  assert.equal(daily.body.my.retries, 1)

  later(200)
  const day = now.toISOString().slice(0, 10)
  const scored = await post<ScoreRsp>(Endpoint.Score, {
    day,
    tier: 1,
    stats: run(),
  })
  assert.equal(scored.body.penalty, 0.8)
  assert.equal(scored.body.total, Math.round(scored.body.rawTotal * 0.8))
  assert.equal(scored.body.boards.day.me?.score, scored.body.total)
  const late = await post<ErrorRsp>(Endpoint.Retry)
  assert.equal(late.status, 409, 'no retry once the day is done')
})

test('today’s solves, average and fastest time, and how many players you beat', async () => {
  as('t2_bob', 'bob')
  await playDay(0, run({t1: 30, t2: 90, wrong: 3}))
  as('t2_ann', 'ann')
  const r = await playDay(2, run({t1: 50, t2: 150}))
  const {tiers, ...overall} = r.body.stats
  assert.deepEqual(overall, {solves: 2, avgTime: 160, fastest: 120})
  assert.equal(r.body.beatPct, 100)
  // each rotation count keeps its own picks, solves, average time and score, and best
  assert.equal(tiers?.length, 4)
  assert.deepEqual(
    tiers?.map(t => [t.tier, t.picks, t.solves, t.avgTime]),
    [
      [0, 1, 1, 120],
      [1, 0, 0, 0],
      [2, 1, 1, 200],
      [3, 0, 0, 0],
    ],
  )
  assert.equal(tiers?.[2]?.best, r.body.total)
  assert.equal(tiers?.[2]?.avgScore, r.body.total)
  const daily = await get<DailyRsp>(Endpoint.Daily)
  assert.deepEqual(daily.body.stats, r.body.stats)
  assert.equal(daily.body.cubeNo, 318, 'cube number is the day of the year')
})

test('journey events pass through, and a scored run ends with the server’s total', async () => {
  const started = await post<{journeyId: string}>(Endpoint.TelemetryStart)
  assert.equal(started.body.journeyId, 'j_1')
  await post(Endpoint.TelemetryProgress, {
    journeyId: 'j_1',
    progress: 0.5,
    action: 'aligned',
  })
  await post(Endpoint.TelemetryInteraction, {action: 'pause'})
  const bad = await post<{receipt: {status: string}}>(
    Endpoint.TelemetryProgress,
    {journeyId: 'j_1', progress: 4},
  )
  assert.equal(bad.body.receipt.status, 'JOURNEY_RECEIPT_INVALID')

  await post<StartRsp>(Endpoint.Start, {tier: 1})
  later(200)
  const day = now.toISOString().slice(0, 10)
  const scored = await post<ScoreRsp>(
    Endpoint.Score,
    {day, tier: 1, stats: run()},
    {'x-devvit-journey-id': 'j_1'},
  )
  assert.deepEqual(
    journeys.map(j => j.kind),
    ['start', 'progress', 'interaction', 'end'],
  )
  assert.deepEqual(journeys.at(-1)?.body, {
    journeyId: 'j_1',
    complete: true,
    game: {win: true, score: scored.body.total},
  })
})

test('giving up ends the journey as a loss', async () => {
  await post<StartRsp>(Endpoint.Start, {tier: 1})
  later(60)
  const day = now.toISOString().slice(0, 10)
  await post(
    Endpoint.Score,
    {day, tier: 1, stats: run(), forfeit: true},
    {'x-devvit-journey-id': 'j_9'},
  )
  assert.deepEqual(journeys.at(-1)?.body, {
    journeyId: 'j_9',
    complete: false,
    game: {win: false, score: 0},
  })
})

test('notify me: opt in, and the daily post pings opted-in players', async () => {
  const on = await post<{notify: boolean}>(Endpoint.Notify, {on: true})
  assert.equal(on.body.notify, true)
  assert.equal((await get<DailyRsp>(Endpoint.Daily)).body.notify, true)
  now = new Date('2026-11-15T08:01:00Z')
  await runDaily()
  assert.deepEqual(pushed, ['Nonet #319 is out'])
  const off = await post<{notify: boolean}>(Endpoint.Notify, {on: false})
  assert.equal(off.body.notify, false)
})

test('the feed card: puzzle number, solves today, and your streak and result', async () => {
  as(undefined)
  const anon = await get<CardRsp>(Endpoint.Card)
  assert.equal(anon.status, 200)
  assert.deepEqual(anon.body, {
    day: '2026-11-14',
    no: 318,
    loggedIn: false,
    solves: 0,
    streak: 0,
  })

  as('t2_bob', 'bob')
  await playDay(0, run())
  as('t2_ann', 'ann')
  const before = await get<CardRsp>(Endpoint.Card)
  assert.equal(before.body.solves, 1)
  assert.equal(before.body.score, undefined, 'not played yet')
  await playDay(2, run({t1: 50, t2: 150}))
  const done = await get<CardRsp>(Endpoint.Card)
  assert.equal(done.body.solves, 2)
  assert.equal(done.body.streak, 1)
  assert.ok((done.body.score ?? 0) > 0)
  assert.ok(done.body.rank === 1 || done.body.rank === 2)

  later(2 * 86400)
  const lapsed = await get<CardRsp>(Endpoint.Card)
  assert.equal(lapsed.body.streak, 0, 'a missed day ends the streak')
  assert.equal(lapsed.body.no, 320)
  assert.equal(lapsed.body.solves, 0, 'a new day starts at zero')
})

test('a challenge is offered, accepted before playing, then settles', async () => {
  const mine = await playDay(0, run())
  const ann = mine.body.total
  const sent = await post<ChallengeRsp>(Endpoint.Challenge, {name: 'u/Bob'})
  assert.equal(sent.status, 200)
  assert.equal(comments.length, 1)
  assert.equal(comments[0]?.[0], 't3_123', 'on this post')
  assert.match(
    comments[0]?.[1] ?? '',
    /^u\/bob, u\/ann scored [\d,]+ on Nonet #318 .* to accept/,
  )
  assert.deepEqual(sent.body.duels, [
    {
      day: '2026-11-14',
      them: 'bob',
      themId: 't2_bob',
      sent: true,
      mine: ann,
      // theirs is missing until they play: JSON drops undefined
      status: 'offered',
      result: 'pending',
      record: {won: 0, lost: 0, tied: 0},
    },
  ])

  as('t2_bob', 'bob')
  const open = await get<DailyRsp>(Endpoint.Daily)
  const offer = open.body.duels[0]
  assert.equal(offer?.them, 'ann')
  assert.equal(offer?.sent, false)
  assert.equal(offer?.status, 'offered')
  assert.equal(offer?.theirs, ann, 'the score to beat')
  const yes = await post<ChallengeRsp>(Endpoint.Answer, {
    from: 't2_ann',
    accept: true,
  })
  assert.equal(yes.body.duels[0]?.status, 'accepted')
  const again = await post<ErrorRsp>(Endpoint.Answer, {
    from: 't2_ann',
    accept: false,
  })
  assert.equal(again.status, 409, 'one answer')
  const bob = await playDay(0, run({wrong: 4}))
  assert.ok(bob.body.total < ann)
  assert.equal(bob.body.duels[0]?.result, 'lost')
  assert.deepEqual(bob.body.duels[0]?.record, {won: 0, lost: 1, tied: 0})

  as('t2_ann', 'ann')
  const back = await get<DailyRsp>(Endpoint.Daily)
  assert.equal(back.body.duels[0]?.result, 'won')
  assert.deepEqual(back.body.duels[0]?.record, {won: 1, lost: 0, tied: 0})

  // the next day they meet again, and the record carries on
  now = new Date('2026-11-15T12:00:00Z')
  as('t2_bob', 'bob')
  await playDay(0, run())
  await post<ChallengeRsp>(Endpoint.Challenge, {name: 'ann'})
  as('t2_ann', 'ann')
  await post<ChallengeRsp>(Endpoint.Answer, {from: 't2_bob', accept: true})
  const two = await playDay(0, run({wrong: 8}))
  assert.equal(two.body.duels[0]?.result, 'lost')
  assert.deepEqual(two.body.duels[0]?.record, {won: 1, lost: 1, tied: 0})
})

test('declined and unanswered challenges never count', async () => {
  await playDay(0, run({wrong: 8}))
  await post(Endpoint.Challenge, {name: 'bob'})
  await post(Endpoint.Challenge, {name: 'cat'})
  as('t2_bob', 'bob')
  const no = await post<ChallengeRsp>(Endpoint.Answer, {
    from: 't2_ann',
    accept: false,
  })
  assert.equal(no.body.duels[0]?.status, 'declined')
  await playDay(0, run())
  as('t2_cat', 'cat')
  await playDay(0, run())
  const late = await post<ErrorRsp>(Endpoint.Answer, {
    from: 't2_ann',
    accept: true,
  })
  assert.equal(late.status, 409, 'too late once you have played')
  as('t2_ann', 'ann')
  const daily = await get<DailyRsp>(Endpoint.Daily)
  const by = Object.fromEntries(daily.body.duels.map(d => [d.them, d]))
  assert.equal(by.bob?.status, 'declined')
  assert.equal(by.cat?.status, 'lapsed')
  for (const d of daily.body.duels) {
    assert.equal(d.result, 'pending')
    assert.deepEqual(d.record, {won: 0, lost: 0, tied: 0})
  }
})

test('challenges explain what is wrong', async () => {
  const early = await post<ErrorRsp>(Endpoint.Challenge, {name: 'bob'})
  assert.equal(early.status, 409, 'finish first')
  as('t2_hal', 'hal')
  await playDay(0, run())
  as('t2_ann', 'ann')
  await playDay(0, run())
  const cases: [unknown, number][] = [
    ['ann', 400],
    ['no spaces', 400],
    [undefined, 400],
    ['ghost', 404],
    ['hal', 409],
  ]
  for (const [name, status] of cases)
    assert.equal(
      (await post<ErrorRsp>(Endpoint.Challenge, {name})).status,
      status,
      String(name),
    )
  assert.equal((await post(Endpoint.Challenge, {name: 'bob'})).status, 200)
  assert.equal(
    (await post<ErrorRsp>(Endpoint.Challenge, {name: 'BOB'})).status,
    409,
    'once a day per pair',
  )
  for (const name of ['cat', 'dan', 'eve', 'fay'])
    assert.equal((await post(Endpoint.Challenge, {name})).status, 200)
  const sixth = await post<ErrorRsp>(Endpoint.Challenge, {name: 'gus'})
  assert.equal(sixth.status, 429)
  assert.equal(comments.length, 5)
  const notMine = await post<ErrorRsp>(Endpoint.Answer, {
    from: 't2_bob',
    accept: true,
  })
  assert.equal(notMine.status, 404, 'only the challenged player answers')

  as(undefined)
  assert.equal((await post(Endpoint.Challenge, {name: 'bob'})).status, 401)
})
