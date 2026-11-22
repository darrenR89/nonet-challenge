import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import type {AddressInfo, Server} from 'node:net'
import {after, before, beforeEach, test} from 'node:test'
import {telemetry} from '@devvit/analytics/server/reddit'
import {
  type Context,
  notifications,
  reddit,
  redis,
  runWithContext,
  settings,
} from '@devvit/web/server'
import {
  type CardRsp,
  type ChallengeRsp,
  type CrewRsp,
  type DailyRsp,
  Endpoint,
  EndpointMethod,
  type ErrorRsp,
  type JoinTeamRsp,
  type RaceRsp,
  type ReplayRsp,
  type ResultCommentRsp,
  type ScoreReq,
  type ScoreRsp,
  type StartRsp,
} from '../shared/api.ts'
import type {Puzzle} from '../shared/model.js'
import {code, type MoveLog} from '../shared/replay.ts'
import {type RunStats, weekKey} from '../shared/scoring.ts'
import {eventsSwitch} from './events.ts'
import {clock, onReq, runDaily} from './server.ts'
import {
  clearFakeRedis,
  installFakeRedis,
  removeFakeRedis,
} from './test/fake-redis.ts'

let server: Server
let serverURL: string
let user: {userId?: string; username?: string} = {}
/** The open post's data, as Devvit passes it: daily posts carry their day. */
let postData:
  | {day?: string; play?: string; race?: string; from?: string; final?: boolean}
  | undefined
let now = new Date('2026-11-14T12:00:00Z')
const posts: string[] = []
/** Each interactive post's entrypoint and data, in order. */
const customPosts: {entry?: string; postData?: unknown}[] = []
/** Text post bodies, in order. */
const texts: string[] = []
/** Pinned posts, as "title @ slot". */
const pins: string[] = []
/** User flair in the subreddit, by user id. */
const flairs = new Map<string, string>()
/** The wiki pages as the app last wrote them, and how many pages were created. */
const wiki = {pages: new Map<string, string>(), created: 0}
/** Pages in the v2 wiki (reddit.com and the apps) are kept under `v2:` + their name. */
const wikiKey = (page: string, o?: {wikiVersion?: string}): string =>
  o?.wikiVersion === 'v2' ? `v2:${page}` : page
let autoPost: boolean | undefined = true
let pinPosts: boolean | undefined = true
let crewFlair = false
let founderFlair = false
/** Post flair the app set, as [post id, template id]; and templates it made. */
const postFlairs: [string, string][] = []
const templates: {id: string; text: string}[] = []
const SUB = 'nonetdaily'
/** Journey events the server sent to Devvit, in order. */
const journeys: {kind: string; body: unknown}[] = []
let optedIn = false
const pushed: string[] = []
/** Comments the app made, as [post id, text]. */
const comments: [string, string][] = []
/** Who each comment was posted as, in order. */
const commentAs: (string | undefined)[] = []
let commentFails = false
/** Private messages the app sent, as [to, subject]. */
const messages: [string, string][] = []

const r = reddit as unknown as Record<string, unknown>
const s = settings as unknown as Record<string, unknown>
const was = {
  submitCustomPost: r.submitCustomPost,
  submitPost: r.submitPost,
  getUserByUsername: r.getUserByUsername,
  submitComment: r.submitComment,
  sendPrivateMessage: r.sendPrivateMessage,
  getUserById: r.getUserById,
  setUserFlair: r.setUserFlair,
  getPostFlairTemplates: r.getPostFlairTemplates,
  createPostFlairTemplate: r.createPostFlairTemplate,
  setPostFlair: r.setPostFlair,
  getWikiPage: r.getWikiPage,
  createWikiPage: r.createWikiPage,
  updateWikiPage: r.updateWikiPage,
  updateWikiPageSettings: r.updateWikiPageSettings,
  get: s.get,
}

/** A post as Reddit returns it, enough to pin. */
const madePost = (id: string, url: string, title: string) => ({
  id,
  url,
  sticky: async (slot: number) => {
    pins.push(`${title} @ ${slot}`)
  },
})

/** The midnight job, run as the scheduler runs it: in the subreddit, with no user. */
const daily = (): Promise<void> =>
  runWithContext(
    {appName: 'nonet-challenge', subredditName: SUB} as unknown as Context,
    runDaily,
  )

before(async () => {
  installFakeRedis()
  clock.now = () => now
  r.submitCustomPost = async (o: {
    title: string
    entry?: string
    postData?: unknown
    textFallback?: {text?: string}
  }) => {
    posts.push(o.title)
    customPosts.push({entry: o.entry, postData: o.postData})
    if (o.textFallback?.text) texts.push(o.textFallback.text)
    return madePost('t3_post', 'https://reddit.com/x', o.title)
  }
  r.submitPost = async (o: {title: string; text: string}) => {
    posts.push(o.title)
    texts.push(o.text)
    return madePost('t3_text', 'https://reddit.com/y', o.title)
  }
  s.get = async (name: string) =>
    name === 'pinPosts'
      ? pinPosts
      : name === 'autoPost'
        ? autoPost
        : name === 'crewFlair'
          ? crewFlair
          : name === 'founderFlair'
            ? founderFlair
            : true
  r.getUserById = async (id: string) => ({
    getUserFlairBySubreddit: async () => ({flairText: flairs.get(id)}),
  })
  r.setUserFlair = async (o: {username: string; text: string}) => {
    flairs.set(`t2_${o.username}`, o.text)
  }
  r.getPostFlairTemplates = async () => templates
  r.createPostFlairTemplate = async (o: {text: string}) => {
    const t = {id: `tpl${templates.length + 1}`, text: o.text}
    templates.push(t)
    return t
  }
  r.setPostFlair = async (o: {postId: string; flairTemplateId: string}) => {
    postFlairs.push([o.postId, o.flairTemplateId])
  }
  r.isWikiV2Enabled = async () => true
  r.getWikiPage = async (
    _sub: string,
    page: string,
    o?: {wikiVersion?: string},
  ) => {
    const content = wiki.pages.get(wikiKey(page, o))
    if (content === undefined) throw new Error('PAGE_NOT_FOUND')
    return {content}
  }
  r.createWikiPage = async (o: {
    page: string
    content: string
    wikiVersion?: string
  }) => {
    wiki.created++
    wiki.pages.set(wikiKey(o.page, o), o.content)
  }
  r.updateWikiPage = async (o: {
    page: string
    content: string
    wikiVersion?: string
  }) => {
    wiki.pages.set(wikiKey(o.page, o), o.content)
  }
  r.updateWikiPageSettings = async () => ({})
  // every name is a Reddit user except "ghost"
  r.getUserByUsername = async (name: string) =>
    name.toLowerCase() === 'ghost'
      ? undefined
      : {id: `t2_${name.toLowerCase()}`, username: name.toLowerCase()}
  r.submitComment = async (o: {id: string; text: string; runAs?: string}) => {
    if (commentFails) throw new Error('not allowed')
    comments.push([o.id, o.text])
    commentAs.push(o.runAs)
    return {id: 't1_c'}
  }
  r.sendPrivateMessage = async (o: {to: string; subject: string}) => {
    messages.push([o.to, o.subject])
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
        postData,
        subredditName: SUB,
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
    sendPrivateMessage: was.sendPrivateMessage,
    getUserById: was.getUserById,
    setUserFlair: was.setUserFlair,
    getPostFlairTemplates: was.getPostFlairTemplates,
    createPostFlairTemplate: was.createPostFlairTemplate,
    setPostFlair: was.setPostFlair,
    getWikiPage: was.getWikiPage,
    createWikiPage: was.createWikiPage,
    updateWikiPage: was.updateWikiPage,
    updateWikiPageSettings: was.updateWikiPageSettings,
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
  customPosts.length = 0
  texts.length = 0
  pins.length = 0
  flairs.clear()
  wiki.pages.clear()
  wiki.created = 0
  pinPosts = true
  crewFlair = false
  founderFlair = false
  postFlairs.length = 0
  templates.length = 0
  journeys.length = 0
  pushed.length = 0
  comments.length = 0
  commentAs.length = 0
  commentFails = false
  messages.length = 0
  optedIn = false
  autoPost = true
  now = new Date('2026-11-14T12:00:00Z')
  eventsSwitch.on = false
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

const sumOf = (xs: unknown): number =>
  (xs as number[]).reduce((a, b) => a + b, 0)

/** A clean run of a cube and its move log: undo the scramble, then lock ★ squares first, a square a second. */
function cleanRun(p: Puzzle): {stats: RunStats; log: MoveLog} {
  const log: MoveLog = []
  let t = 0
  for (const m of p.moves.slice().reverse()) {
    t += 100
    log.push(t, code.turn([m[0], m[1], -m[2]]))
  }
  const t1 = t / 10
  log.push(t, code.dial)
  for (const s of p.stars) log.push(t, code.star(s))
  const blanks = p.given.map((v, c) => (v ? -1 : c)).filter(c => c >= 0)
  for (const c of [...p.stars, ...blanks.filter(c => !p.stars.includes(c))]) {
    t += 30
    log.push(t, code.lock(c, p.sol[c] ?? 0))
  }
  const stats = run({turns: p.moves.length, t1, t2: t / 10 - t1})
  return {stats: {...stats, blanks: blanks.length}, log}
}

test('a run’s move log is kept when it matches the run', async () => {
  const start = await post<StartRsp>(Endpoint.Start, {tier: 2})
  const {stats, log} = cleanRun(start.body.puzzle)
  later(stats.t1 + stats.t2 + 5)
  const day = now.toISOString().slice(0, 10)
  const r = await post<ScoreRsp>(Endpoint.Score, {day, tier: 2, stats, log})
  assert.equal(r.body.counted, true)
  const kept = JSON.parse(
    (await redis.hGet(`runlog:${day}`, 't2_ann')) ?? '',
  ) as {log: number[]; score: number; tier: number}
  assert.deepEqual(kept.log, log)
  assert.equal(kept.score, r.body.total)
  assert.equal(kept.tier, 2)

  // a log that doesn't match is dropped, and the run still counts
  as('t2_bob', 'bob')
  const s2 = await post<StartRsp>(Endpoint.Start, {tier: 2})
  const bad = cleanRun(s2.body.puzzle)
  later(bad.stats.t1 + bad.stats.t2 + 5)
  const r2 = await post<ScoreRsp>(Endpoint.Score, {
    day,
    tier: 2,
    stats: {...bad.stats, wrong: 1},
    log: bad.log,
  })
  assert.equal(r2.body.counted, true)
  assert.equal(await redis.hGet(`runlog:${day}`, 't2_bob'), undefined)
})

test('the play of the week posts the best run with a replay, skipping players who switched it off', async () => {
  const day = now.toISOString().slice(0, 10)
  /** Plays today's 2-turn cube cleanly as this player, `secs` a square, and sends the log. */
  const playLogged = async (secs: number): Promise<ScoreRsp> => {
    const start = await post<StartRsp>(Endpoint.Start, {tier: 2})
    const p = start.body.puzzle
    const clean = cleanRun(p)
    // spread the fill out: each lock `secs` apart
    const log = clean.log.slice()
    const dialAt = log.findIndex((c, i) => i % 2 === 1 && c === code.dial) - 1
    let k = 0
    for (let i = dialAt + 2; i < log.length; i += 2)
      if ((log[i + 1] ?? 0) >= 1000)
        log[i] = (log[dialAt] ?? 0) + ++k * secs * 10
      else log[i] = log[dialAt] ?? 0
    const t2 = ((log.at(-2) ?? 0) - (log[dialAt] ?? 0)) / 10
    const stats = {...clean.stats, t2}
    later(stats.t1 + t2 + 5)
    return (await post<ScoreRsp>(Endpoint.Score, {day, tier: 2, stats, log}))
      .body
  }
  const ann = await playLogged(12)
  as('t2_bob', 'bob')
  const bob = await playLogged(5)
  assert.ok(bob.total > ann.total, 'bob is faster, so scores more')
  // bob switches featuring off
  assert.deepEqual((await post(Endpoint.Feature, {on: false})).body, {
    feature: false,
  })
  assert.equal((await get<DailyRsp>(Endpoint.Daily)).body.feature, false)

  const menu = await post<{showToast?: {text: string}}>(
    Endpoint.OnMenuReplayPost,
  )
  assert.equal(menu.body.showToast?.text, 'The play of the week is posted.')
  assert.match(posts.at(-1) ?? '', /^Nonet · play of the week · u\/ann on cube/)
  const week = weekKey(day)
  assert.deepEqual(customPosts.at(-1), {
    entry: 'replay',
    postData: {play: week},
  })

  // the post plays ann's run back, from the cube as it started
  postData = {play: week}
  const rp = (await get<ReplayRsp>(Endpoint.Replay)).body
  postData = undefined
  assert.equal(rp.play?.name, 'ann')
  assert.equal(rp.play?.score, ann.total)
  assert.equal(rp.play?.tier, 2)
  assert.equal(rp.play?.start.length, 54)
  assert.ok((rp.play?.log.length ?? 0) > 40)
  // a post without a week shows nothing
  assert.equal((await get<ReplayRsp>(Endpoint.Replay)).body.play, undefined)
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

test('streaks grow on days in a row, ride out one miss a week, and lapse after another', async () => {
  await playDay(0, run())
  now = new Date('2026-11-15T12:00:00Z')
  const two = await playDay(0, run())
  assert.equal(two.body.streak.current, 2)
  assert.equal(two.body.streak.restUsed, false)
  // missed Monday 16 Nov: the week's rest day covers it
  now = new Date('2026-11-17T12:00:00Z')
  const rested = await get<DailyRsp>(Endpoint.Daily)
  assert.equal(rested.body.streak.current, 2)
  const three = await playDay(0, run())
  assert.equal(three.body.streak.current, 3)
  assert.equal(three.body.streak.restUsed, true)
  // missed Wednesday 18 Nov, same week: no rest day left
  now = new Date('2026-11-19T12:00:00Z')
  const daily = await get<DailyRsp>(Endpoint.Daily)
  assert.equal(daily.body.streak.current, 0)
  assert.equal(daily.body.streak.best, 3)
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

test('the weekly top nine post plays the week back from each day’s points', async () => {
  // Saturday 14 Nov: ann and bob play; Sunday: only bob
  const sat = await playDay(2, run())
  as('t2_bob', 'bob')
  const bobSat = await playDay(0, run({wrong: 4}))
  now = new Date('2026-11-15T12:00:00Z')
  const bobSun = await playDay(1, run())
  postData = {race: weekKey('2026-11-15'), from: '2026-11-09', final: true}
  const r = (await get<RaceRsp>(Endpoint.Race)).body.race
  postData = undefined
  assert.equal(r?.players, 2)
  assert.deepEqual(
    r?.rows.map(x => [x.name, x.points]),
    [
      ['bob', [0, 0, 0, 0, 0, bobSat.body.total, bobSun.body.total]],
      ['ann', [0, 0, 0, 0, 0, sat.body.total, 0]],
    ].sort((a, b) => sumOf(b[1]) - sumOf(a[1])),
  )
  assert.equal(r?.myName, 'bob')
  assert.equal(r?.me, undefined)
  assert.deepEqual(r?.streak, {name: 'bob', days: 2})
  // a post that isn't a weekly post has no race
  assert.equal((await get<RaceRsp>(Endpoint.Race)).body.race, undefined)
})

test('events are switched off: a saved event shows nowhere', async () => {
  await post(Endpoint.OnFormNewEvent, {
    title: 'Big Game Week',
    start: '2026-11-13',
    end: '2026-11-16',
    teams: 'Chiefs\nEagles',
  })
  const daily = await get<DailyRsp>(Endpoint.Daily)
  assert.equal(daily.body.event, undefined)
  const join = await post<ErrorRsp>(Endpoint.JoinTeam, {
    eventId: '2026-11-13-big-game-week',
    team: 'eagles',
  })
  assert.equal(join.status, 404)
  const played = await playDay(1, run())
  assert.equal(played.body.event, undefined)
  // switched back on, the saved event is there as it was
  eventsSwitch.on = true
  assert.ok((await get<DailyRsp>(Endpoint.Daily)).body.event)
})

test('a team event: create, pick a side once, points count for it', async () => {
  eventsSwitch.on = true
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
  await daily()
  await daily()
  assert.equal(posts.length, 2)
  assert.match(posts[0] ?? '', /^Nonet: today's cube · Mon 16 Nov/)
  assert.match(posts[1] ?? '', /^Nonet · weekly top nine · week of Mon 9 Nov$/)
  autoPost = false
  now = new Date('2026-11-17T08:01:00Z')
  await daily()
  assert.equal(posts.length, 2)
})

test('the daily post waits for midnight Pacific and is dated that day', async () => {
  now = new Date('2026-11-14T08:01:00Z') // 12:01 AM Saturday in California
  await daily()
  assert.equal(posts.length, 1)
  assert.match(posts[0] ?? '', /^Nonet: today's cube · Sat 14 Nov$/)
  now = new Date('2026-11-15T00:03:00Z') // 4:03 PM Saturday: midnight UTC, still Saturday here
  await daily()
  now = new Date('2026-11-15T07:01:00Z') // the summer-time run, 11:01 PM Saturday in winter
  await daily()
  assert.equal(posts.length, 1)
  now = new Date('2026-11-15T08:01:00Z')
  await daily()
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
  await daily()
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
    played: 0,
    fastest: 0,
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
  assert.equal(done.body.played, 2)
  assert.equal(done.body.fastest, 180, "bob's 40 + 140 seconds")
  assert.equal(done.body.streak, 1)
  assert.ok((done.body.score ?? 0) > 0)
  assert.ok(done.body.rank === 1 || done.body.rank === 2)

  later(2 * 86400)
  const lapsed = await get<CardRsp>(Endpoint.Card)
  assert.equal(
    lapsed.body.streak,
    1,
    "the week's rest day covers one missed day",
  )
  assert.equal(lapsed.body.no, 320)
  assert.equal(lapsed.body.solves, 0, 'a new day starts at zero')
})

test("an older day's post keeps its date, and links to today's post", async () => {
  as('t2_ann', 'ann')
  const day = (await get<CardRsp>(Endpoint.Card)).body.day
  await playDay(0, run())
  postData = {day}
  assert.equal((await get<CardRsp>(Endpoint.Card)).body.past, undefined)
  later(86400)
  await daily()
  const old = (await get<CardRsp>(Endpoint.Card)).body
  assert.equal(old.past, true)
  assert.equal(old.day, day, "the post's own day, not today")
  assert.ok((old.score ?? 0) > 0, 'how you did that day')
  assert.match(old.todayPost ?? '', /^t3_/, "today's auto post")
  const game = (await get<DailyRsp>(Endpoint.Daily)).body
  assert.equal(
    game.past,
    true,
    "the game in an old post won't start today's cube",
  )
  assert.equal(game.todayPost, old.todayPost)
  assert.equal(game.pastBoards?.day.players, 1, "that day's board")
  assert.equal(game.boards.day.players, 0, "today's board is separate")
  later(86400)
  as('t2_new', 'new')
  const missed = (await get<CardRsp>(Endpoint.Card)).body
  assert.equal(missed.past, true)
  assert.equal(missed.score, undefined, 'never played that day')
  postData = undefined
})

test('a finished player posts their result as their own comment, once a day', async () => {
  const early = await post<ErrorRsp>(Endpoint.ResultComment, {})
  assert.equal(early.status, 409, 'not before finishing')
  as('t2_bob', 'bob')
  await playDay(0, run({t1: 10, t2: 50}))
  as('t2_ann', 'ann')
  const ann = await playDay(1, run({t1: 60, t2: 187, starsWon: 2}))

  commentFails = true
  const failed = await post<ErrorRsp>(Endpoint.ResultComment, {})
  assert.equal(failed.status, 502)
  commentFails = false

  const posted = await post<ResultCommentRsp>(Endpoint.ResultComment, {})
  assert.equal(posted.status, 200, 'the failed try gave the claim back')
  assert.equal(comments.length, 1)
  assert.equal(comments[0]?.[0], 't3_123')
  assert.equal(commentAs[0], 'USER', 'posted as the player, not the app')
  const text = comments[0]?.[1] ?? ''
  assert.match(
    text,
    /^Nonet No\.318 · 1 turn · 4:07 · ([\d,]+) pts · #\d of 2\n\n★★☆$/,
  )
  assert.equal(
    text.match(/([\d,]+) pts/)?.[1],
    ann.body.total.toLocaleString('en-GB'),
  )
  assert.equal((await get<DailyRsp>(Endpoint.Daily)).body.my.commented, true)
  const again = await post<ErrorRsp>(Endpoint.ResultComment, {})
  assert.equal(again.status, 409, 'once a day')
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

test('a crew: start one, invite by name, join, and scores add up', async () => {
  const rude = await post<ErrorRsp>(Endpoint.CrewCreate, {name: 'Sh1t Kickers'})
  assert.equal(rude.status, 400)
  assert.match(rude.body.error, /can't be posted/)
  const made = await post<CrewRsp>(Endpoint.CrewCreate, {
    name: ' Night  Owls ',
    invite: ['u/Bob', 'cat'],
  })
  assert.equal(made.status, 200)
  assert.equal(made.body.crew?.name, 'Night Owls')
  assert.deepEqual(
    made.body.crew?.members.map(m => m.name),
    ['ann'],
  )
  assert.equal(made.body.note, undefined)
  assert.equal(comments.length, 1, 'one comment tags both')
  assert.match(comments[0]?.[1] ?? '', /^u\/bob and u\/cat, u\/ann wants you/)

  // ann plays before anyone joins; her run counts for the crew
  const ann = await playDay(0, run())
  assert.equal(ann.body.crew.crew?.today, ann.body.total)

  as('t2_bob', 'bob')
  const open = await get<DailyRsp>(Endpoint.Daily)
  const inv = open.body.crew.invites[0]
  assert.deepEqual(inv && {crew: inv.crew, from: inv.from}, {
    crew: 'Night Owls',
    from: 'ann',
  })
  const joined = await post<CrewRsp>(Endpoint.CrewAnswer, {
    crewId: inv?.crewId,
    accept: true,
  })
  assert.deepEqual(
    joined.body.crew?.members.map(m => m.name),
    ['ann', 'bob'],
    'in the order they joined',
  )
  assert.deepEqual(joined.body.invites, [])
  const bob = await playDay(0, run({wrong: 2}))
  const crew = bob.body.crew.crew
  assert.equal(crew?.today, ann.body.total + bob.body.total)
  assert.equal(crew?.week, crew?.today)
  assert.equal(crew?.rank, undefined, 'no ranks until there are 5 crews')
  assert.equal(crew?.streak, 1, 'everyone in the crew played')

  // cat declines; the invite goes
  as('t2_cat', 'cat')
  const no = await post<CrewRsp>(Endpoint.CrewAnswer, {
    crewId: inv?.crewId,
    accept: false,
  })
  assert.equal(no.body.crew, undefined)
  assert.deepEqual(no.body.invites, [])

  // the next day only ann plays: no streak yet, and bob can be nudged once
  now = new Date('2026-11-15T12:00:00Z')
  as('t2_ann', 'ann')
  const day2 = await playDay(0, run())
  assert.equal(
    day2.body.crew.crew?.streak,
    1,
    'streak holds until the day ends',
  )
  const bobId = day2.body.crew.crew?.members.find(m => m.name === 'bob')?.id
  const nudged = await post<CrewRsp>(Endpoint.CrewNudge, {to: bobId})
  assert.equal(nudged.status, 200)
  assert.deepEqual(messages, [['bob', '連 Night Owls is waiting on you']])
  assert.equal(
    nudged.body.crew?.members.find(m => m.name === 'bob')?.nudged,
    true,
  )
  const again = await post<ErrorRsp>(Endpoint.CrewNudge, {to: bobId})
  assert.equal(again.status, 409)
  as('t2_bob', 'bob')
  const bob2 = await playDay(0, run())
  assert.equal(bob2.body.crew.crew?.streak, 2)

  // with one crew, Monday's post leaves the crew board out
  now = new Date('2026-11-16T08:01:00Z')
  await daily()
  const weekPost = texts.find(t => t.startsWith("The week's top nine"))
  assert.doesNotMatch(weekPost ?? '', /top crews/)
})

/** Signs in as a player, accepts their first crew invitation, and returns the crew. */
async function joinFirstInvite(id: string, name: string) {
  as(id, name)
  const d = await get<DailyRsp>(Endpoint.Daily)
  const r = await post<CrewRsp>(Endpoint.CrewAnswer, {
    crewId: d.body.crew.invites[0]?.crewId,
    accept: true,
  })
  return r.body.crew
}

test('the crew board ranks and posts once there are five crews', async () => {
  const players = ['ann', 'bob', 'cat', 'dan', 'eve']
  for (const [i, name] of players.entries()) {
    as(`t2_${name}`, name)
    await post<CrewRsp>(Endpoint.CrewCreate, {name: `Crew ${i + 1}`})
    const r = await playDay(0, run({wrong: i}))
    if (i < 4) assert.equal(r.body.crew.crew?.rank, undefined)
    else assert.ok(r.body.crew.crew?.rank, 'the fifth crew brings ranks in')
  }
  now = new Date('2026-11-16T08:01:00Z')
  await daily()
  const weekPost = texts.find(t => t.startsWith("The week's top nine"))
  assert.match(
    weekPost ?? '',
    /The top crews:\n\n1\. 連 Crew 1 · [\d,]+ \(u\/ann\)/,
  )
})

test("joining an older crew mid-week counts from Monday, so the week's line-up is fixed", async () => {
  await post<CrewRsp>(Endpoint.CrewCreate, {name: 'Owls'}) // Saturday 14th
  now = new Date('2026-11-18T12:00:00Z') // the next Wednesday
  as('t2_ann', 'ann')
  await post<CrewRsp>(Endpoint.CrewInvite, {names: ['bob']})
  const joined = await joinFirstInvite('t2_bob', 'bob')
  const bobRow = joined?.members.find(m => m.name === 'bob')
  assert.equal(bobRow?.countsFrom, '2026-11-23')
  const bob = await playDay(0, run())
  assert.equal(bob.body.crew.crew?.today, 0, "bob's run waits for Monday")
  as('t2_ann', 'ann')
  const ann = await playDay(0, run())
  assert.equal(ann.body.crew.crew?.today, ann.body.total)
  assert.equal(
    ann.body.crew.crew?.streak,
    1,
    'the streak only needs members who count',
  )

  now = new Date('2026-11-23T12:00:00Z')
  as('t2_bob', 'bob')
  const monday = await playDay(0, run())
  const crew = monday.body.crew.crew
  assert.equal(crew?.members.find(m => m.name === 'bob')?.countsFrom, undefined)
  assert.equal(crew?.today, monday.body.total, 'from Monday bob counts')
})

test('a crewmate quiet for three days can have their seat opened, and is told', async () => {
  await post<CrewRsp>(Endpoint.CrewCreate, {name: 'Owls', invite: ['bob']})
  await joinFirstInvite('t2_bob', 'bob')
  await playDay(0, run())
  as('t2_ann', 'ann')
  await playDay(0, run())
  // bob misses the 15th and 16th: not yet
  now = new Date('2026-11-17T12:00:00Z')
  const d = await get<DailyRsp>(Endpoint.Daily)
  const bobRow = d.body.crew.crew?.members.find(m => m.name === 'bob')
  assert.equal(bobRow?.missed, 2)
  const early = await post<ErrorRsp>(Endpoint.CrewSeat, {to: bobRow?.id})
  assert.equal(early.status, 409)
  // and the 17th: now his seat can open
  now = new Date('2026-11-18T12:00:00Z')
  const opened = await post<CrewRsp>(Endpoint.CrewSeat, {to: bobRow?.id})
  assert.equal(opened.status, 200)
  assert.deepEqual(
    opened.body.crew?.members.map(m => m.name),
    ['ann'],
  )
  assert.deepEqual(messages, [['bob', 'Your seat in 連 Owls is open']])
  as('t2_bob', 'bob')
  assert.equal((await get<DailyRsp>(Endpoint.Daily)).body.crew.crew, undefined)
})

test('nudges can be turned off, and the crew posts its result once everyone has played', async () => {
  await post<CrewRsp>(Endpoint.CrewCreate, {name: 'Owls', invite: ['bob']})
  comments.length = 0
  const crew = await joinFirstInvite('t2_bob', 'bob')
  const off = await post<CrewRsp>(Endpoint.CrewNudges, {on: false})
  assert.equal(off.body.crew?.members.find(m => m.me)?.nudgesOff, true)
  as('t2_ann', 'ann')
  const bobId = crew?.members.find(m => m.name === 'bob')?.id
  const nudge = await post<ErrorRsp>(Endpoint.CrewNudge, {to: bobId})
  assert.equal(nudge.status, 409)
  assert.match(nudge.body.error, /turned crew nudges off/)
  assert.equal(messages.length, 0)

  await playDay(0, run())
  const early = await post<ErrorRsp>(Endpoint.CrewPost)
  assert.equal(early.status, 409, 'not until bob has played')
  as('t2_bob', 'bob')
  await playDay(0, run())
  const posted = await post<CrewRsp>(Endpoint.CrewPost)
  assert.equal(posted.status, 200)
  assert.equal(posted.body.crew?.posted, true)
  assert.equal(comments.length, 1)
  assert.match(
    comments[0]?.[1] ?? '',
    /^連 Owls: 2 of 2 played · [\d,]+ crew points\.$/,
  )
  as('t2_ann', 'ann')
  assert.equal(
    (await post<ErrorRsp>(Endpoint.CrewPost)).status,
    409,
    'once a day',
  )
})

test('crew flair, when the subreddit turns it on, shows the crew with the streak', async () => {
  crewFlair = true
  await post<CrewRsp>(Endpoint.CrewCreate, {name: 'Owls'})
  await playDay(1, run())
  assert.equal(flairs.get('t2_ann'), '連 Owls')
  for (const day of ['15', '16']) {
    now = new Date(`2026-11-${day}T12:00:00Z`)
    await playDay(1, run())
  }
  assert.equal(flairs.get('t2_ann'), '連 Owls · 3-day streak')
  now = new Date('2026-11-19T08:01:00Z')
  await daily()
  assert.equal(flairs.get('t2_ann'), '連 Owls · best streak 3')
})

test('one crew at a time, and leaving keeps the points with the crew', async () => {
  await post<CrewRsp>(Endpoint.CrewCreate, {name: 'Owls'})
  const second = await post<ErrorRsp>(Endpoint.CrewCreate, {name: 'Larks'})
  assert.equal(second.status, 409)

  as('t2_bob', 'bob')
  await post<CrewRsp>(Endpoint.CrewCreate, {name: 'Larks'})
  const bobPlays = await playDay(0, run())
  as('t2_ann', 'ann')
  const busy = await post<ErrorRsp>(Endpoint.CrewInvite, {names: ['bob']})
  assert.equal(busy.status, 400)
  assert.match(busy.body.error, /u\/bob is already in a crew/)

  // bob leaves Larks after playing, and joins Owls: his run already counted for Larks
  as('t2_bob', 'bob')
  const left = await post<CrewRsp>(Endpoint.CrewLeave)
  assert.equal(left.body.crew, undefined)
  as('t2_ann', 'ann')
  await post<CrewRsp>(Endpoint.CrewInvite, {names: ['bob']})
  as('t2_bob', 'bob')
  const daily = await get<DailyRsp>(Endpoint.Daily)
  const joined = await post<CrewRsp>(Endpoint.CrewAnswer, {
    crewId: daily.body.crew.invites[0]?.crewId,
    accept: true,
  })
  assert.equal(joined.body.crew?.name, 'Owls')
  assert.equal(joined.body.crew?.today, 0, 'counted once, for Larks')
  assert.ok(bobPlays.body.crew.crew?.today)
})

test('crew requests explain what is wrong', async () => {
  as(undefined)
  const out = await post<ErrorRsp>(Endpoint.CrewCreate, {name: 'Owls'})
  assert.equal(out.status, 401)
  assert.deepEqual((await get<DailyRsp>(Endpoint.Daily)).body.crew, {
    invites: [],
  })
  as('t2_ann', 'ann')
  const bad = await post<ErrorRsp>(Endpoint.CrewCreate, {name: '!'})
  assert.equal(bad.status, 400)
  const none = await post<ErrorRsp>(Endpoint.CrewLeave)
  assert.equal(none.status, 409)
  const made = await post<CrewRsp>(Endpoint.CrewCreate, {
    name: 'Owls',
    invite: ['ghost'],
  })
  assert.equal(made.status, 200, 'the crew stands without the invite')
  assert.match(made.body.note ?? '', /no u\/ghost/)
  assert.equal(comments.length, 0)
  const self = await post<ErrorRsp>(Endpoint.CrewInvite, {names: ['ann']})
  assert.match(self.body.error, /invite yourself/)
  // fill the crew, then a third invite is refused
  await post<CrewRsp>(Endpoint.CrewInvite, {names: ['bob', 'cat']})
  for (const [id, name] of [
    ['t2_bob', 'bob'],
    ['t2_cat', 'cat'],
  ] as const) {
    as(id, name)
    const d = await get<DailyRsp>(Endpoint.Daily)
    await post(Endpoint.CrewAnswer, {
      crewId: d.body.crew.invites[0]?.crewId,
      accept: true,
    })
  }
  as('t2_ann', 'ann')
  const full = await post<ErrorRsp>(Endpoint.CrewInvite, {names: ['dan']})
  assert.equal(full.status, 400)
  assert.match(full.body.error, /already has 3 players/)
})

test('streak flair from three days in a row, then the best once it lapses', async () => {
  // cat has flair from the mods, which stays
  flairs.set('t2_cat', 'Puzzle mod')
  for (const day of ['14', '15', '16']) {
    now = new Date(`2026-11-${day}T12:00:00Z`)
    as('t2_ann', 'ann')
    await playDay(1, run())
    as('t2_cat', 'cat')
    await playDay(1, run())
    if (day === '15') assert.equal(flairs.get('t2_ann'), undefined)
  }
  assert.equal(flairs.get('t2_ann'), 'Nonet · 3-day streak')
  assert.equal(flairs.get('t2_cat'), 'Puzzle mod')

  // ann misses the 17th, which the week's rest day covers, then the 18th; the job on the 19th
  // moves her flair to her best
  now = new Date('2026-11-17T08:01:00Z')
  await daily()
  assert.equal(flairs.get('t2_ann'), 'Nonet · 3-day streak')
  now = new Date('2026-11-18T08:01:00Z')
  await daily()
  assert.equal(
    flairs.get('t2_ann'),
    'Nonet · 3-day streak',
    'the rest day covers the 17th',
  )
  now = new Date('2026-11-19T08:01:00Z')
  await daily()
  assert.equal(flairs.get('t2_ann'), 'Nonet · best streak 3')

  // flair she changes herself is hers from then on
  flairs.set('t2_ann', 'sudoku fan')
  for (const day of ['18', '19', '20', '21']) {
    now = new Date(`2026-11-${day}T12:00:00Z`)
    as('t2_ann', 'ann')
    await playDay(1, run())
  }
  assert.equal(flairs.get('t2_ann'), 'sudoku fan')
})

test('the first players to finish are numbered founders, in front of their streak', async () => {
  founderFlair = true
  // cat has flair from the mods, which stays, but cat still takes a founder place
  flairs.set('t2_cat', 'Puzzle mod')
  for (const day of ['14', '15', '16']) {
    now = new Date(`2026-11-${day}T12:00:00Z`)
    as('t2_ann', 'ann')
    await playDay(1, run())
    if (day === '14') assert.equal(flairs.get('t2_ann'), 'Nonet founder #1')
    as('t2_cat', 'cat')
    await playDay(1, run())
  }
  assert.equal(flairs.get('t2_ann'), 'Nonet founder #1 · 3-day streak')
  assert.equal(flairs.get('t2_cat'), 'Puzzle mod')
  // the lapse keeps the founder number
  now = new Date('2026-11-19T08:01:00Z')
  await daily()
  assert.equal(flairs.get('t2_ann'), 'Nonet founder #1 · best streak 3')
  // a third player is #3: places are handed out in finishing order
  as('t2_bob', 'bob')
  now = new Date('2026-11-19T12:00:00Z')
  await playDay(1, run())
  assert.equal(flairs.get('t2_bob'), 'Nonet founder #3')
})

test('founder places run out at 100', async () => {
  founderFlair = true
  await redis.hSet('founderSeq', {n: '100'})
  now = new Date('2026-11-14T12:00:00Z')
  await playDay(1, run())
  assert.equal(flairs.get('t2_ann'), undefined)
})

test("the app's posts get mod-only post flair, made once and then reused", async () => {
  now = new Date('2026-11-16T08:01:00Z') // Monday: the daily cube and the week's post
  await daily()
  assert.deepEqual(
    templates.map(t => t.text),
    ['Daily cube', 'Weekly top nine'],
  )
  assert.deepEqual(postFlairs, [
    ['t3_post', 'tpl1'],
    ['t3_post', 'tpl2'],
  ])
  now = new Date('2026-11-17T08:01:00Z')
  await daily()
  assert.equal(templates.length, 2, 'no new template the second day')
  assert.deepEqual(postFlairs.at(-1), ['t3_post', 'tpl1'])
})

test("Monday's post has the weekly top nine and the solve of the week, is pinned, and the wiki is written", async () => {
  now = new Date('2026-11-16T12:00:00Z') // Monday, week of 16 Nov
  const ann = await playDay(1, run())
  as('t2_bob', 'bob')
  const bob = await playDay(3, run({turns: 3, t1: 30, t2: 100}))
  assert.ok(bob.body.total > ann.body.total)
  now = new Date('2026-11-18T12:00:00Z')
  as('t2_ann', 'ann')
  await playDay(1, run())

  now = new Date('2026-11-23T08:01:00Z') // the next Monday, just after midnight Pacific
  await daily()
  assert.deepEqual(posts, [
    "Nonet: today's cube · Mon 23 Nov",
    'Nonet · weekly top nine · week of Mon 16 Nov',
  ])
  // the week's post plays the week back; the text is what old Reddit shows
  assert.deepEqual(customPosts.at(-1), {
    entry: 'race',
    postData: {race: weekKey('2026-11-16'), from: '2026-11-16', final: true},
  })
  assert.deepEqual(pins, [
    "Nonet: today's cube · Mon 23 Nov @ 1",
    'Nonet · weekly top nine · week of Mon 16 Nov @ 2',
  ])
  const text = texts[0] ?? ''
  assert.match(text, /from 2 players/)
  assert.match(
    text,
    new RegExp(
      `\\*\\*Solve of the week\\.\\*\\* u/bob scored ${bob.body.total.toLocaleString('en-GB')} on Mon 16 Nov \\(cube #320\\): 3 turns, 2:10, all three ★, no misses\\.`,
    ),
  )
  assert.match(
    text,
    /\[the Nonet wiki\]\(https:\/\/old\.reddit\.com\/r\/nonetdaily\/wiki\/nonet\)/,
  )

  assert.equal(
    wiki.created,
    16,
    'the home page, six more and a front page, in both the old and the new wiki',
  )
  assert.match(
    wiki.pages.get('v2:nonet/records') ?? '',
    /^<h1>Records<\/h1>/,
    'the new wiki gets the pages as HTML',
  )
  assert.match(
    wiki.pages.get('v2:index') ?? '',
    /<a href="https:\/\/www\.reddit\.com\/r\/nonetdaily\/wiki\/nonet">/,
  )
  assert.match(
    wiki.pages.get('index') ?? '',
    /\(\/r\/nonetdaily\/wiki\/nonet\)/,
  )
  assert.match(
    wiki.pages.get('nonet/records') ?? '',
    /\| Mon 16 Nov \| u\/(ann|bob) · [\d,]+ \| u\/bob · /,
  )
  assert.match(
    wiki.pages.get('nonet/records') ?? '',
    /## Longest streaks\n\n1\. u\/ann · 2 days\n2\. u\/bob · 1 day\n/,
  )

  // the moderator menu rewrites the same page
  const menu = await post<{showToast?: {text: string}; navigateTo?: string}>(
    Endpoint.OnMenuWiki,
  )
  assert.equal(
    menu.body.navigateTo,
    'https://old.reddit.com/r/nonetdaily/wiki/nonet',
  )
  assert.equal(wiki.created, 16, 'the menu rewrites the same pages')
})

test('a mod can message themselves the cube list; players never get it', async () => {
  await daily()
  as('t2_mod', 'themod')
  const sent = messages.length
  const menu = await post<{showToast?: {text: string}}>(Endpoint.OnMenuCubes)
  assert.equal(menu.body.showToast?.text, 'Sent: check your Reddit messages.')
  assert.deepEqual(messages.slice(sent), [['themod', 'Nonet cube list']])
})

test('pinning can be turned off', async () => {
  pinPosts = false
  now = new Date('2026-11-16T08:01:00Z')
  await daily()
  assert.equal(posts.length, 2)
  assert.deepEqual(pins, [])
})

test('demo mode fills the boards and walks a mod through a crew invite and challenges, for them alone', async () => {
  // the mod has already played today for real
  const real = await playDay(1, run())
  assert.equal(real.body.counted, true)
  const menu = await post<{showToast?: {text: string}}>(Endpoint.OnMenuDemo)
  assert.match(menu.body.showToast?.text ?? '', /Demo mode is on/)
  const d = (await get<DailyRsp>(Endpoint.Daily)).body
  assert.ok(d.asNew, 'they start as a new player')
  assert.equal(d.my.score, undefined, 'with no run today')
  assert.equal(d.puzzle, undefined)
  assert.equal(d.streak.played, 0)
  const card = (await get<CardRsp>(Endpoint.Card)).body
  assert.equal(card.streak, 0)
  assert.equal(card.score, undefined)
  assert.equal(card.firstTime, true, 'the card offers the practice')
  assert.equal(card.solves, 1031)
  assert.equal(d.boards.day.players, 1284)
  assert.equal(d.boards.day.top.length, 9)
  assert.equal(d.crew.invites[0]?.crew, 'Night Owls')
  assert.ok(d.duels.some(x => !x.sent && x.status === 'offered'))

  // accepting the invite puts them in the sample crew, with a crewmate to nudge
  const joined = await post<CrewRsp>(Endpoint.CrewAnswer, {
    crewId: 'demo-crew',
    accept: true,
  })
  assert.equal(joined.body.crew?.members.length, 3)
  const away = joined.body.crew?.members.find(m => m.missed >= 3)
  assert.ok(away)
  const nudged = await post<CrewRsp>(Endpoint.CrewNudge, {to: away?.id})
  assert.equal(
    nudged.body.crew?.members.find(m => m.id === away?.id)?.nudged,
    true,
  )
  const opened = await post<CrewRsp>(Endpoint.CrewSeat, {to: away?.id})
  assert.equal(opened.body.crew?.members.length, 2)

  // a challenge they received can be accepted
  const offer = d.duels.find(x => !x.sent)
  const answered = await post<ChallengeRsp>(Endpoint.Answer, {
    from: offer?.themId,
    accept: true,
  })
  assert.equal(
    answered.body.duels.find(x => x.themId === offer?.themId)?.status,
    'accepted',
  )

  // none of it touched the real crews or anyone else's view
  assert.equal(
    (await get<DailyRsp>(Endpoint.Daily)).body.crew.crew?.members.length,
    2,
    'the demo copy remembers',
  )

  // they play today again, as a new player: scored on the demo copy, real record untouched
  const again = await playDay(0, run())
  assert.equal(again.status, 200)
  assert.equal(again.body.counted, true)
  assert.equal(again.body.streak.current, 1)
  assert.equal(again.body.boards.day.players, 1284)
  const after = (await get<CardRsp>(Endpoint.Card)).body
  assert.equal(after.score, again.body.total, 'the card shows the demo run')
  assert.equal(after.firstTime, undefined)
  // turning demo mode on again starts them over
  await post(Endpoint.OnMenuDemo)
  assert.equal((await get<DailyRsp>(Endpoint.Daily)).body.my.score, undefined)

  as('t2_bob', 'bob')
  const bob = (await get<DailyRsp>(Endpoint.Daily)).body
  assert.equal(bob.stats.solves, 1, 'the real day has only the real run')
  assert.equal(bob.asNew, undefined)
  assert.equal(bob.crew.crew, undefined)
  assert.equal(bob.crew.invites.length, 0)
  assert.notEqual(bob.boards.day.players, 1284)
})

test('junk from the browser gets a 4xx, never a crash, and never corrupts what players see', async () => {
  const JUNK: unknown[] = [
    null,
    [],
    'x',
    42,
    {},
    {day: 7, tier: 'one', stats: 'fast', name: {}, user: [], team: null},
    {tier: -1},
    {tier: 1e9},
    {tier: Number.NaN},
    {
      tier: 1.5,
      stats: {
        turns: -5,
        t1: 'a',
        t2: null,
        blanks: 1e12,
        wrong: -1,
        starsWon: 99,
      },
    },
    {name: 'x'.repeat(10_000), user: 'x'.repeat(10_000), id: '../../etc'},
    {__proto__: {admin: true}, constructor: {prototype: {admin: true}}},
    {
      day: '2026-11-14',
      tier: 0,
      stats: {
        turns: 0,
        t1: 1,
        t2: 1,
        blanks: 0,
        wrong: 0,
        hintsUsed: 0,
        starsWon: 3,
      },
    },
  ]
  const posts = Object.values(Endpoint).filter(
    // joining the subreddit takes no body, and the test server can't reach Reddit for it
    e =>
      e.startsWith('api/') &&
      e !== Endpoint.JoinSub &&
      EndpointMethod[e] === 'POST',
  )
  for (const who of [undefined, 't2_ann'] as const) {
    as(who)
    for (const e of posts)
      for (const body of JUNK) {
        const rsp = await fetch(`${serverURL}/${e}`, {
          body: JSON.stringify(body),
          headers: {'Content-Type': 'application/json'},
          method: 'POST',
        })
        const text = await rsp.text()
        assert.ok(
          rsp.status < 500,
          `${who ?? 'logged out'} ${e} ${JSON.stringify(body)?.slice(0, 80)} → ${rsp.status} ${text.slice(0, 200)}`,
        )
        assert.doesNotMatch(
          text,
          /NaN|\[object Object\]|undefined/,
          `${e} answered ${text.slice(0, 200)}`,
        )
      }
    // a body that isn't JSON at all
    const bad = await fetch(`${serverURL}/${Endpoint.Score}`, {
      body: '{"tier":',
      headers: {'Content-Type': 'application/json'},
      method: 'POST',
    })
    assert.ok(bad.status < 500, `broken JSON → ${bad.status}`)
  }
  // and the day still reads cleanly afterwards
  as('t2_ann', 'ann')
  for (const e of [Endpoint.Daily, Endpoint.Card]) {
    const rsp = await fetch(`${serverURL}/${e}`)
    const text = await rsp.text()
    assert.equal(rsp.status, 200, `${e} → ${text.slice(0, 200)}`)
    assert.doesNotMatch(
      text,
      /NaN|\[object Object\]/,
      `${e} answered ${text.slice(0, 300)}`,
    )
  }
  const day = (await get<DailyRsp>(Endpoint.Daily)).body
  assert.ok(
    day.my.score === undefined || Number.isInteger(day.my.score),
    `score ${day.my.score}`,
  )
})
