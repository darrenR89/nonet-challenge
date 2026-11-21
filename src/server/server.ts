import {once} from 'node:events'
import type {IncomingMessage, ServerResponse} from 'node:http'
import {
  context,
  notifications,
  reddit,
  redis,
  settings,
} from '@devvit/web/server'
import type {
  PartialJsonValue,
  TriggerResponse,
  UiResponse,
} from '@devvit/web/shared'
import {
  type AnswerReq,
  type Board,
  type BoardReq,
  type BoardRsp,
  type CardRsp,
  type ChallengeReq,
  type ChallengeRsp,
  type CrewAnswerReq,
  type CrewCreateReq,
  type CrewInviteReq,
  type CrewNudgeReq,
  type CrewNudgesReq,
  type CrewRsp,
  type CrewSeatReq,
  type DailyRsp,
  type DayStats,
  Endpoint,
  EndpointMethod,
  type ErrorRsp,
  type EventState,
  type GameEvent,
  type JoinRsp,
  type JoinTeamReq,
  type JoinTeamRsp,
  type NotifyReq,
  type NotifyRsp,
  type Preview,
  RETRY_MULT,
  type RetryRsp,
  type ScoreReq,
  type ScoreRsp,
  type StartReq,
  type StartRsp,
  type Streak,
} from '../shared/api.ts'
import {
  CREW_SIZE,
  type CrewInfo,
  cleanCrewName,
  crewFlair,
  crewInviteText,
  crewResultText,
  crewRowText,
  MAX_CREW_INVITES,
  NO_CREW,
  nudgeText,
  QUIET_DAYS,
  seatText,
} from '../shared/crew.ts'
import {challengeText, cleanName, MAX_CHALLENGES} from '../shared/duel.ts'
import {isOffensive} from '../shared/names.ts'
import {
  addDays,
  dayKey,
  levelOf,
  maxTurns,
  type RunStats,
  scoreRun,
  shortDate,
  tierAllowed,
  weekday,
  weekKey,
} from '../shared/scoring.ts'
import {
  addSolve,
  addToBoards,
  BOARD_TOP,
  beatPct,
  boardKey,
  bumpStreak,
  getDayRecord,
  getDayStats,
  getMyDay,
  getStreak,
  lockTier,
  markScored,
  namesOf,
  rankOn,
  readBoard,
  rememberName,
  startGuest,
  takeGuest,
  useRetry,
} from './board.ts'
import {
  addToCrew,
  answerInvite,
  type CrewError,
  claimCrewPost,
  createCrew,
  crewInfo,
  crewOf,
  inviteToCrew,
  leaveCrew,
  nudge,
  openSeat,
  setNudges,
  topCrews,
} from './crews.ts'
import {blanksOf, cubeNumber, dayPuzzle, ensureDay} from './cube.ts'
import {addDuel, answerDuel, duelsFor, settleDuels} from './duels.ts'
import {
  activeEvent,
  addToEvent,
  type EventForm,
  endEvent,
  eventFromForm,
  eventState,
  eventsSwitch,
  getEvent,
  joinTeam,
  listEvents,
  saveEvent,
} from './events.ts'
import {cubeList} from './export.ts'
import {flairAfterSolve, lapseFlair} from './flair.ts'
import {
  getSpot,
  noteBestStreak,
  noteSolve,
  saveWeek,
  spotText,
} from './records.ts'
import {journey} from './telemetry.ts'
import {publishWiki, wikiPath} from './wiki.ts'

/** The clock, swappable in tests. */
export const clock = {now: (): Date => new Date()}
const today = (): string => dayKey(clock.now())

class HttpError extends Error {
  readonly status: number
  constructor(status: number, msg: string) {
    super(msg)
    this.status = status
  }
}

type AnyRsp =
  | DailyRsp
  | StartRsp
  | ScoreRsp
  | JoinTeamRsp
  | BoardRsp
  | RetryRsp
  | NotifyRsp
  | JoinRsp
  | ChallengeRsp
  | CrewRsp
  | Record<string, unknown>
  | UiResponse
  | TriggerResponse
  | ErrorRsp

export async function onReq(
  reqMsg: IncomingMessage,
  rspMsg: ServerResponse,
): Promise<void> {
  try {
    await route(reqMsg, rspMsg)
  } catch (err) {
    if (err instanceof HttpError) {
      writeJson<ErrorRsp>(
        err.status,
        {error: err.message, status: err.status},
        rspMsg,
      )
      return
    }
    const msg = `server error; ${err instanceof Error ? err.stack : err}`
    console.error(msg)
    writeJson<ErrorRsp>(500, {error: msg, status: 500}, rspMsg)
  }
}

async function route(
  reqMsg: IncomingMessage,
  rspMsg: ServerResponse,
): Promise<void> {
  const endpoint = reqMsg.url?.slice(1).split('?')[0] as Endpoint
  const method = EndpointMethod[endpoint]

  let rsp: AnyRsp
  if (method !== reqMsg.method) {
    rsp = {error: 'not found', status: 404}
  } else {
    switch (endpoint) {
      case Endpoint.Daily:
        rsp = await routeDaily()
        break
      case Endpoint.Card:
        rsp = await routeCard()
        break
      case Endpoint.Start:
        rsp = await routeStart(await readJson<StartReq>(reqMsg))
        break
      case Endpoint.Score:
        rsp = await routeScore(
          await readJson<ScoreReq>(reqMsg),
          journeyIdOf(reqMsg),
        )
        break
      case Endpoint.Retry:
        rsp = await routeRetry()
        break
      case Endpoint.Notify:
        rsp = await routeNotify(await readJson<NotifyReq>(reqMsg))
        break
      case Endpoint.JoinSub:
        rsp = await routeJoinSub()
        break
      case Endpoint.Challenge:
        rsp = await routeChallenge(await readJson<ChallengeReq>(reqMsg))
        break
      case Endpoint.Answer:
        rsp = await routeAnswer(await readJson<AnswerReq>(reqMsg))
        break
      case Endpoint.CrewCreate:
        rsp = await routeCrewCreate(await readJson<CrewCreateReq>(reqMsg))
        break
      case Endpoint.CrewInvite:
        rsp = await routeCrewInvite(await readJson<CrewInviteReq>(reqMsg))
        break
      case Endpoint.CrewAnswer:
        rsp = await routeCrewAnswer(await readJson<CrewAnswerReq>(reqMsg))
        break
      case Endpoint.CrewLeave:
        rsp = await routeCrewLeave()
        break
      case Endpoint.CrewNudge:
        rsp = await routeCrewNudge(await readJson<CrewNudgeReq>(reqMsg))
        break
      case Endpoint.CrewSeat:
        rsp = await routeCrewSeat(await readJson<CrewSeatReq>(reqMsg))
        break
      case Endpoint.CrewNudges:
        rsp = await routeCrewNudges(await readJson<CrewNudgesReq>(reqMsg))
        break
      case Endpoint.CrewPost:
        rsp = await routeCrewPost()
        break
      case Endpoint.TelemetryStart:
        rsp = await journey.start()
        break
      case Endpoint.TelemetryAppReady:
        rsp = await journey.appReady()
        break
      case Endpoint.TelemetryProgress:
        rsp = await journey.progress(await readJson(reqMsg))
        break
      case Endpoint.TelemetryInteraction:
        rsp = await journey.interaction(await readJson(reqMsg))
        break
      case Endpoint.TelemetryEnd: {
        // the browser ends unscored runs (practice, offline); scored runs end in routeScore
        const b = await readJson<Record<string, unknown>>(reqMsg)
        const game = b.game as {win?: unknown; score?: unknown} | undefined
        rsp = await journey.end(
          typeof b.journeyId === 'string' ? b.journeyId : undefined,
          b.complete === true,
          game
            ? {win: game.win === true, score: Number(game.score) || 0}
            : undefined,
        )
        break
      }
      case Endpoint.JoinTeam:
        rsp = await routeJoinTeam(await readJson<JoinTeamReq>(reqMsg))
        break
      case Endpoint.Board:
        rsp = await routeBoard(await readJson<BoardReq>(reqMsg))
        break
      case Endpoint.OnMenuNewPost:
        rsp = await routeMenuNewPost()
        break
      case Endpoint.OnAppInstall:
        rsp = await routeAppInstall()
        break
      case Endpoint.OnMenuNewEvent:
        rsp = routeMenuNewEvent()
        break
      case Endpoint.OnMenuEndEvent:
        rsp = await routeMenuEndEvent()
        break
      case Endpoint.OnMenuWeekPost:
        rsp = await routeMenuWeekPost()
        break
      case Endpoint.OnMenuWiki:
        rsp = await routeMenuWiki()
        break
      case Endpoint.OnMenuCubes:
        rsp = await routeMenuCubes()
        break
      case Endpoint.OnFormNewEvent:
        rsp = await routeFormNewEvent(await readJson<unknown>(reqMsg))
        break
      case Endpoint.OnFormEndEvent:
        rsp = await routeFormEndEvent(await readJson<unknown>(reqMsg))
        break
      case Endpoint.OnCronDaily:
        await runDaily()
        rsp = {}
        break
      default:
        endpoint satisfies never
        rsp = {error: 'not found', status: 404}
        break
    }
  }

  const status =
    'status' in rsp && typeof rsp.status === 'number' ? rsp.status : 200
  writeJson(status, rsp as PartialJsonValue, rspMsg)
}

// ---------- players ----------

async function who(): Promise<string | undefined> {
  const uid = context.userId
  if (uid && context.username) await rememberName(uid, context.username)
  return uid
}

async function needUser(): Promise<string> {
  const uid = await who()
  if (!uid) throw new HttpError(401, 'Log in to Reddit to play for points.')
  return uid
}

async function dayBoards(
  day: string,
  uid: string | undefined,
  labels: [string, string] = ['Today', 'This week'],
): Promise<{day: Board; week: Board}> {
  return {
    day: await readBoard(boardKey.day(day), labels[0], uid),
    week: await readBoard(boardKey.week(weekKey(day)), labels[1], uid),
  }
}

async function eventFor(
  day: string,
  uid: string | undefined,
): Promise<EventState | undefined> {
  const e = await activeEvent(day)
  return e ? eventState(e, day, uid) : undefined
}

/** Tomorrow's clues, for a player who locked all three ★ today. */
async function previewFor(
  day: string,
  uid: string | undefined,
): Promise<Preview | undefined> {
  if (!uid) return
  const rec = await getDayRecord(day, uid)
  if (rec.stars !== '3') return
  const next = addDays(day, 1)
  const d = await ensureDay(next)
  return {day: next, given: d.base.given}
}

const NO_STREAK: Streak = {current: 0, best: 0, played: 0}
const ZERO_RUN: RunStats = {
  turns: 0,
  t1: 0,
  t2: 0,
  blanks: 0,
  wrong: 8,
  hintsUsed: 3,
  starsWon: 0,
}

/** Where each day's post is, so an older post can send players on to today's. */
const DAILY_POSTS = 'posts:daily'

/**
 * The day a daily post is for, when it is an earlier day than today. Each daily post is
 * fixed to its own date: an older one shows how that day went and links to today's post.
 */
export function pastDayOf(postData: unknown, now: string): string | undefined {
  const d = (postData as {day?: unknown} | undefined)?.day
  return typeof d === 'string' && /^\d{4}-\d\d-\d\d$/.test(d) && d < now
    ? d
    : undefined
}

async function routeDaily(): Promise<DailyRsp> {
  const day = today()
  const past = pastDayOf(context.postData, day)
  const uid = await who()
  const my = uid
    ? await getMyDay(day, uid)
    : {tier: undefined, score: undefined, starsWon: undefined, retries: 0}
  return {
    day,
    weekday: weekday(day),
    week: weekKey(day),
    level: levelOf(day),
    puzzle: my.tier !== undefined ? await dayPuzzle(day, my.tier) : undefined,
    my,
    streak: uid ? await getStreak(day, uid) : NO_STREAK,
    preview: await previewFor(day, uid),
    boards: await dayBoards(day, uid),
    event: await eventFor(day, uid),
    loggedIn: !!uid,
    cubeNo: cubeNumber(day),
    stats: await getDayStats(day),
    subreddit: context.subredditName ?? '',
    notify: uid
      ? await notifications.isOptedIn(uid as `t2_${string}`).catch(() => false)
      : false,
    duels: uid ? await duelsFor(day, uid) : [],
    crew: uid ? await crewInfo(day, uid) : NO_CREW,
    ...(past
      ? {
          past: true,
          todayPost: (await redis.hGet(DAILY_POSTS, day)) ?? '',
          pastBoards: await dayBoards(past, uid, [
            shortDate(past),
            `Week of ${shortDate(addDays(past, 1 - weekday(past)))}`,
          ]),
        }
      : {}),
  }
}

/** The feed card: the post's own day's number, how many solved, and the asker's streak and result. */
async function routeCard(): Promise<CardRsp> {
  const now = today()
  const past = pastDayOf(context.postData, now)
  const day = past ?? now
  // no rememberName here: the card is read on every scroll past
  const uid = context.userId
  const score = uid ? (await getMyDay(day, uid)).score : undefined
  const st = await getDayStats(day)
  return {
    day,
    no: cubeNumber(day),
    loggedIn: !!uid,
    solves: st.solves,
    played: (st.tiers ?? []).reduce((n, t) => n + t.picks, 0),
    fastest: st.fastest,
    streak: uid ? (await getStreak(now, uid)).current : 0,
    score,
    rank:
      uid && score !== undefined
        ? await rankOn(boardKey.day(day), uid)
        : undefined,
    ...(past
      ? {past: true, todayPost: (await redis.hGet(DAILY_POSTS, now)) ?? ''}
      : {}),
  }
}

async function routeStart(req: StartReq): Promise<StartRsp> {
  const uid = await who()
  const day = today()
  const level = levelOf(day)
  if (typeof req.tier !== 'number' || !tierAllowed(level, req.tier))
    throw new HttpError(400, `Pick 0 to ${maxTurns(level)} turns.`)
  // logged out: today's cube to play, and an id to claim the run with after signing up
  if (!uid) {
    const guest = await startGuest(day, req.tier, clock.now().getTime())
    return {tier: req.tier, puzzle: await dayPuzzle(day, req.tier), guest}
  }
  const tier = await lockTier(day, uid, req.tier, clock.now().getTime())
  return {tier, puzzle: await dayPuzzle(day, tier)}
}

/** Checks a reported run is possible; returns clean numbers or throws. */
export function checkStats(
  s: Partial<RunStats> | undefined,
  blanks: number,
  elapsed: number,
): RunStats {
  const n = (x: unknown, lo: number, hi: number, what: string): number => {
    if (typeof x !== 'number' || !Number.isFinite(x) || x < lo || x > hi)
      throw new HttpError(400, `bad ${what}`)
    return x
  }
  const stats: RunStats = {
    turns: Math.round(n(s?.turns, 0, 500, 'turns')),
    t1: n(s?.t1, 0, 86400, 'time'),
    t2: n(s?.t2, 0, 86400, 'time'),
    blanks,
    wrong: Math.round(n(s?.wrong, 0, 500, 'wrong locks')),
    hintsUsed: Math.round(n(s?.hintsUsed, 0, 3, 'hints')),
    starsWon: Math.round(n(s?.starsWon, 0, 3, 'stars')),
  }
  // a run can't take longer than the time since Play, nor fill faster than a person taps
  if (stats.t1 + stats.t2 > elapsed + 15)
    throw new HttpError(400, 'The run is longer than the time since Play.')
  if (stats.t2 < blanks * 0.4)
    throw new HttpError(400, 'The fill is faster than anyone can tap.')
  return stats
}

function journeyIdOf(reqMsg: IncomingMessage): string | undefined {
  const h = reqMsg.headers['x-devvit-journey-id']
  return typeof h === 'string' && h ? h : undefined
}

async function routeScore(
  req: ScoreReq,
  journeyId: string | undefined,
): Promise<ScoreRsp> {
  const uid = await needUser()
  const day = today()
  if (req.day !== day)
    throw new HttpError(409, "That was yesterday's cube. Today's is ready.")
  let rec = await getDayRecord(day, uid)
  // a run played logged out, claimed after signing up: it takes today's place as if
  // started at the logged-out start, so the timing checks still hold
  if (rec.tier === undefined && typeof req.guest === 'string') {
    const g = await takeGuest(day, req.guest)
    if (!g) throw new HttpError(409, 'That run has expired.')
    await lockTier(day, uid, g.tier, g.started)
    rec = await getDayRecord(day, uid)
  }
  if (rec.tier === undefined) throw new HttpError(409, 'Press Play first.')
  const tier = Number(rec.tier)
  if (req.tier !== tier)
    throw new HttpError(
      409,
      `Today is set to ${tier} turn${tier === 1 ? '' : 's'}.`,
    )
  const level = levelOf(day)
  const penalty = Number(rec.retries ?? 0) > 0 ? RETRY_MULT : 1
  if (req.forfeit) {
    // giving up uses today's run: nothing on the boards, and no later run counts
    await markScored(day, uid, 0, 0)
    await settleDuels(day, uid)
    await journey.end(journeyId, false, {win: false, score: 0})
    const fresh = await getDayRecord(day, uid)
    const boards = await dayBoards(day, uid)
    return {
      counted: false,
      breakdown: scoreRun(level, tier, ZERO_RUN),
      total: Number(fresh.score ?? 0),
      rawTotal: 0,
      penalty,
      beatPct: 0,
      stats: await getDayStats(day),
      streak: await getStreak(day, uid),
      boards,
      event: await eventFor(day, uid),
      preview: undefined,
      duels: await duelsFor(day, uid),
      crew: await crewInfo(day, uid),
    }
  }
  const puzzle = await dayPuzzle(day, tier)
  const elapsed = (clock.now().getTime() - Number(rec.started ?? 0)) / 1000
  const stats = checkStats(req.stats, blanksOf(puzzle), elapsed)
  const breakdown = scoreRun(level, tier, stats)
  const total = Math.round(breakdown.total * penalty)

  const counted = await markScored(day, uid, total, stats.starsWon)
  const event = await activeEvent(day)
  let streak: Streak
  let dayStats: DayStats
  if (counted) {
    await addToBoards(day, uid, total)
    if (event) await addToEvent(event, uid, total)
    streak = await bumpStreak(day, uid)
    await noteBestStreak(uid, streak.best)
    await noteSolve(day, uid, {
      score: total,
      tier,
      time: stats.t1 + stats.t2,
      stars: stats.starsWon,
      wrong: stats.wrong,
    })
    await flairSolve(day, uid, streak)
    dayStats = await addSolve(day, stats.t1 + stats.t2, tier, total)
    await settleDuels(day, uid)
    await addToCrew(day, uid)
    // the journey ends here, with the total the server worked out, not the browser's
    await journey.end(journeyId, true, {win: true, score: total})
  } else {
    streak = await getStreak(day, uid)
    dayStats = await getDayStats(day)
    await journey.end(journeyId, true, {win: true, score: 0})
  }
  const boards = await dayBoards(day, uid)
  const me = boards.day.me
  return {
    counted,
    breakdown,
    total: counted ? total : Number(rec.score ?? total),
    rawTotal: breakdown.total,
    penalty,
    beatPct: me ? beatPct(me.rank, boards.day.players) : 0,
    stats: dayStats,
    streak,
    boards,
    event: event ? await eventState(event, day, uid) : undefined,
    preview: await previewFor(day, uid),
    duels: await duelsFor(day, uid),
    crew: await crewInfo(day, uid),
  }
}

/**
 * Challenges a player to beat the asker's score on today's cube, and tags them in a
 * comment on this post. The asker must have finished today; the score is the server's.
 */
async function routeChallenge(req: ChallengeReq): Promise<ChallengeRsp> {
  const uid = await needUser()
  const day = today()
  const score = (await getDayRecord(day, uid)).score
  if (score === undefined)
    throw new HttpError(409, "Finish today's cube first.")
  const name = cleanName(req.name)
  if (!name) throw new HttpError(400, "That isn't a Reddit username.")
  if (name.toLowerCase() === (context.username ?? '').toLowerCase())
    throw new HttpError(400, "You can't challenge yourself.")
  const them = await reddit.getUserByUsername(name).catch(() => undefined)
  if (!them) throw new HttpError(404, `There's no u/${name} on Reddit.`)
  if (them.id === uid) throw new HttpError(400, "You can't challenge yourself.")
  await rememberName(them.id, them.username)
  if ((await getDayRecord(day, them.id)).score !== undefined)
    throw new HttpError(
      409,
      `u/${them.username} has already played today's cube. Challenge them tomorrow.`,
    )
  const added = await addDuel(day, uid, them.id)
  if (added === 'again')
    throw new HttpError(
      409,
      `You and u/${them.username} already have a challenge today.`,
    )
  if (added === 'full')
    throw new HttpError(
      429,
      `That's ${MAX_CHALLENGES} challenges today. Try again tomorrow.`,
    )
  const postId = context.postId
  if (postId)
    await reddit
      .submitComment({
        id: postId as `t3_${string}`,
        text: challengeText(
          context.username ?? 'someone',
          them.username,
          Number(score),
          cubeNumber(day),
        ),
      })
      .catch(err => console.warn(`challenge comment failed: ${err}`))
  return {duels: await duelsFor(day, uid)}
}

/** Accepts or declines a challenge. It has to be before playing, so nobody accepts a sure win. */
async function routeAnswer(req: AnswerReq): Promise<ChallengeRsp> {
  const uid = await needUser()
  const day = today()
  const r = await answerDuel(day, uid, String(req.from), req.accept === true)
  if (r === 'none') throw new HttpError(404, 'No such challenge today.')
  if (r === 'played')
    throw new HttpError(409, 'Challenges are accepted before you play.')
  if (r === 'answered')
    throw new HttpError(409, "You've already answered that challenge.")
  return {duels: await duelsFor(day, uid)}
}

// ---------- crews ----------

const CREW_ERRORS: Record<CrewError, [number, string]> = {
  'in-crew': [409, "You're already in a crew. Leave it first."],
  'no-crew': [409, "You're not in a crew."],
  full: [409, `That crew already has ${CREW_SIZE} players.`],
  'no-invite': [404, 'That invitation has gone.'],
  'too-many': [
    429,
    `That's ${MAX_CREW_INVITES} invites today. Try again tomorrow.`,
  ],
  played: [409, "They've already played today."],
  nudged: [409, 'They were already nudged today.'],
  'nudges-off': [409, 'They turned crew nudges off.'],
  'not-quiet': [
    409,
    `A seat opens after ${QUIET_DAYS} days in a row without playing.`,
  ],
  'not-all-played': [409, 'Post the crew result once everyone has played.'],
  posted: [409, "Your crew's result is already posted today."],
}

function crewFail(e: CrewError): never {
  const [status, msg] = CREW_ERRORS[e]
  throw new HttpError(status, msg)
}

/**
 * Invites players by username and tags them in one comment on this post. Returns a
 * note for the names that didn't work; throws if none did.
 */
async function invite(
  day: string,
  uid: string,
  raw: unknown,
): Promise<string | undefined> {
  const list = (Array.isArray(raw) ? raw : []).slice(0, CREW_SIZE - 1)
  const sent: string[] = []
  const problems: string[] = []
  let crew = ''
  for (const r of list) {
    if (typeof r === 'string' && !r.trim()) continue
    const name = cleanName(r)
    if (!name) {
      problems.push(`"${String(r).slice(0, 24)}" isn't a Reddit username.`)
      continue
    }
    const them = await reddit.getUserByUsername(name).catch(() => undefined)
    if (!them) {
      problems.push(`There's no u/${name} on Reddit.`)
      continue
    }
    if (them.id === uid) {
      problems.push("You can't invite yourself.")
      continue
    }
    await rememberName(them.id, them.username)
    const r2 = await inviteToCrew(day, uid, them.id)
    if (typeof r2 === 'string') {
      if (r2 === 'in-crew')
        problems.push(`u/${them.username} is already in a crew.`)
      else problems.push(CREW_ERRORS[r2][1])
      continue
    }
    crew = r2.crew
    sent.push(them.username)
  }
  const postId = context.postId
  if (sent.length && postId)
    await reddit
      .submitComment({
        id: postId as `t3_${string}`,
        text: crewInviteText(context.username ?? 'someone', sent, crew),
      })
      .catch(err => console.warn(`crew invite comment failed: ${err}`))
  if (!problems.length) return
  if (!sent.length && list.length) throw new HttpError(400, problems.join(' '))
  return problems.join(' ')
}

const withNote = (info: CrewInfo, note: string | undefined): CrewRsp =>
  note ? {...info, note} : info

async function routeCrewCreate(req: CrewCreateReq): Promise<CrewRsp> {
  const uid = await needUser()
  const day = today()
  const name = cleanCrewName(req.name)
  if (!name && typeof req.name === 'string' && isOffensive(req.name))
    throw new HttpError(
      400,
      "That crew name can't be posted here. Pick another.",
    )
  if (!name)
    throw new HttpError(
      400,
      'Give the crew a name of 2 to 24 letters, numbers or spaces.',
    )
  const made = await createCrew(day, uid, name)
  if (made === 'in-crew') crewFail(made)
  let note: string | undefined
  try {
    note = await invite(day, uid, req.invite)
  } catch (err) {
    // the crew stands; the invites can be sent again from the crew row
    note = err instanceof Error ? err.message : String(err)
  }
  return withNote(await crewInfo(day, uid), note)
}

async function routeCrewInvite(req: CrewInviteReq): Promise<CrewRsp> {
  const uid = await needUser()
  const day = today()
  if (!(await crewOf(uid))) crewFail('no-crew')
  const note = await invite(day, uid, req.names)
  return withNote(await crewInfo(day, uid), note)
}

async function routeCrewAnswer(req: CrewAnswerReq): Promise<CrewRsp> {
  const uid = await needUser()
  const day = today()
  const r = await answerInvite(
    day,
    uid,
    String(req.crewId),
    req.accept === true,
  )
  if (r !== 'ok') crewFail(r)
  return crewInfo(day, uid)
}

async function routeCrewLeave(): Promise<CrewRsp> {
  const uid = await needUser()
  const day = today()
  const r = await leaveCrew(day, uid)
  if (r !== 'ok') crewFail(r)
  return crewInfo(day, uid)
}

/** Sends a crewmate who hasn't played today a private message, once a day at most. */
async function routeCrewNudge(req: CrewNudgeReq): Promise<CrewRsp> {
  const uid = await needUser()
  const day = today()
  const them = String(req.to)
  const r = await nudge(day, uid, them)
  if (typeof r === 'string') crewFail(r)
  const [name] = await namesOf([them])
  if (name)
    await reddit
      .sendPrivateMessage({
        to: name,
        ...nudgeText(context.username ?? 'A crewmate', r.crew, r.played, r.of),
      })
      .catch(err => console.warn(`nudge failed: ${err}`))
  return crewInfo(day, uid)
}

/** Opens a quiet crewmate's seat, and lets them know by private message. */
async function routeCrewSeat(req: CrewSeatReq): Promise<CrewRsp> {
  const uid = await needUser()
  const day = today()
  const them = String(req.to)
  const r = await openSeat(day, uid, them)
  if (typeof r === 'string') crewFail(r)
  const [name] = await namesOf([them])
  if (name)
    await reddit
      .sendPrivateMessage({to: name, ...seatText(r.crew)})
      .catch(err => console.warn(`seat message failed: ${err}`))
  return crewInfo(day, uid)
}

async function routeCrewNudges(req: CrewNudgesReq): Promise<CrewRsp> {
  const uid = await needUser()
  await setNudges(uid, req.on === true)
  return crewInfo(today(), uid)
}

/** Posts the crew's result for today as a comment on this post, once a crew, once everyone has played. */
async function routeCrewPost(): Promise<CrewRsp> {
  const uid = await needUser()
  const day = today()
  const postId = context.postId
  if (!postId) throw new HttpError(409, 'Open the daily post to share.')
  const r = await claimCrewPost(day, uid)
  if (typeof r === 'string') crewFail(r)
  await reddit
    .submitComment({
      id: postId as `t3_${string}`,
      text: crewResultText(r.name, r.today, r.of, r.streak),
    })
    .catch(err => console.warn(`crew result comment failed: ${err}`))
  return crewInfo(day, uid)
}

/** Uses today's one retry. The run restarts on the same cube and tier. */
async function routeRetry(): Promise<RetryRsp> {
  const uid = await needUser()
  const day = today()
  const rec = await getDayRecord(day, uid)
  if (rec.tier === undefined) throw new HttpError(409, 'Press Play first.')
  if (rec.score !== undefined)
    throw new HttpError(409, 'Today is already done.')
  const used = await useRetry(day, uid)
  if (!used) throw new HttpError(409, "You've used today's retry.")
  return {retries: used, penalty: RETRY_MULT}
}

/** Turns the "new cube is out" push notification on or off. */
async function routeNotify(req: NotifyReq): Promise<NotifyRsp> {
  const uid = await needUser()
  const r = req.on
    ? await notifications.optInCurrentUser()
    : await notifications.optOutCurrentUser()
  if (!r.success)
    throw new HttpError(502, r.message ?? 'Notifications are unavailable.')
  return {
    notify: await notifications
      .isOptedIn(uid as `t2_${string}`)
      .catch(() => req.on),
  }
}

async function routeJoinSub(): Promise<JoinRsp> {
  await needUser()
  await reddit.subscribeToCurrentSubreddit()
  return {joined: true}
}

async function routeJoinTeam(req: JoinTeamReq): Promise<JoinTeamRsp> {
  const uid = await needUser()
  const e = eventsSwitch.on ? await getEvent(String(req.eventId)) : undefined
  const day = today()
  if (!e || day > e.end) throw new HttpError(404, 'That event is over.')
  try {
    await joinTeam(e, uid, String(req.team))
  } catch {
    throw new HttpError(400, 'No such team.')
  }
  return {event: await eventState(e, day, uid)}
}

async function routeBoard(req: BoardReq): Promise<BoardRsp> {
  const uid = await who()
  const day = today()
  switch (req.kind) {
    case 'day': {
      const d = req.key ?? day
      return {board: await readBoard(boardKey.day(d), d, uid)}
    }
    case 'week': {
      const wk = req.key ?? weekKey(day)
      return {board: await readBoard(boardKey.week(wk), wk, uid)}
    }
    case 'all':
      return {board: await readBoard(boardKey.all, 'All time', uid)}
    case 'event': {
      const e = !eventsSwitch.on
        ? undefined
        : req.key
          ? await getEvent(req.key)
          : await activeEvent(day)
      if (!e) throw new HttpError(404, 'No such event.')
      return {board: await readBoard(boardKey.event(e.id), e.title, uid)}
    }
    default:
      throw new HttpError(400, 'Unknown board.')
  }
}

/**
 * Updates the player's flair after a counted run: their streak, and their crew's name when the
 * subreddit turned crew flair on. A failure never stops the score.
 */
async function flairSolve(day: string, uid: string, st: Streak): Promise<void> {
  const sub = context.subredditName
  const name = context.username
  if (!sub || !name) return
  const streaks = await setting('streakFlair')
  const crewId = (await setting('crewFlair')) ? await crewOf(uid) : undefined
  const crew = crewId ? (await crewInfo(day, uid)).crew?.name : undefined
  if (!streaks && !crew) return
  const shown: Streak = streaks ? st : {...st, current: 0, best: 0}
  const wrap = crew
    ? (text: string | undefined): string => crewFlair(crew, text)
    : undefined
  await flairAfterSolve(day, uid, name, sub, shown, wrap).catch(err =>
    console.warn(`flair failed: ${err}`),
  )
}

// ---------- posts ----------

/** A yes/no subreddit setting; on unless a moderator turned it off. */
async function setting(
  name: 'autoPost' | 'pinPosts' | 'streakFlair' | 'crewFlair',
): Promise<boolean> {
  const v = await settings.get<boolean>(name).catch(() => undefined)
  // crew flair is opt-in; the rest are on unless a moderator turned them off
  return name === 'crewFlair' ? v === true : v !== false
}

/** Pins a post as a community highlight, if the subreddit wants that. */
async function pin(
  post: {sticky(position?: 1 | 2): Promise<void>},
  slot: 1 | 2,
): Promise<void> {
  if (!(await setting('pinPosts'))) return
  await post.sticky(slot).catch(err => console.warn(`pin failed: ${err}`))
}

export function dailyTitle(day: string, e: GameEvent | undefined): string {
  const date = shortDate(day)
  if (e?.postTitle) return `${e.postTitle} · ${date}`
  if (e) return `Nonet · ${e.title} · ${date}`
  return `Nonet: today's cube · ${date}`
}

async function postDaily(day: string): Promise<{url: string; id: string}> {
  const e = await activeEvent(day)
  const post = await reddit.submitCustomPost({
    title: dailyTitle(day, e),
    postData: {day},
  })
  await redis.hSet(DAILY_POSTS, {[day]: post.id})
  await pin(post, 1)
  return {url: post.url, id: post.id}
}

/** Tells everyone who opted in that today's cube is out, linking to its post. */
async function notifyNewCube(day: string, post: {id: string}): Promise<void> {
  const n = cubeNumber(day)
  let after: string | undefined
  for (let page = 0; page < 50; page++) {
    const list = await notifications
      .listOptedInUsers({limit: 1000, after})
      .catch(() => undefined)
    if (!list?.userIds.length) return
    await notifications
      .enqueue({
        title: `Nonet #${n} is out`,
        body: 'A new cube is ready. Keep your streak going.',
        recipients: list.userIds.map(userId => ({
          userId: userId as `t2_${string}`,
          link: post.id as `t3_${string}`,
          data: {},
        })),
      })
      .catch(err => console.warn(`notify failed: ${err}`))
    if (!list.next) return
    after = list.next
  }
}

/** Claims a once-only job, such as today's post. True for the first caller. */
async function claim(what: string, id: string): Promise<boolean> {
  return (await redis.hSetNX(`once:${what}`, id, '1')) === 1
}

async function routeMenuNewPost(): Promise<UiResponse> {
  const day = today()
  await ensureDay(day)
  const {url} = await postDaily(day)
  await claim('post', day)
  return {
    showToast: {text: "Today's cube is posted.", appearance: 'success'},
    navigateTo: url,
  }
}

async function routeAppInstall(): Promise<TriggerResponse> {
  const day = today()
  await ensureDay(day)
  if (await claim('post', day)) await postDaily(day)
  await writeWiki(day).catch(err => console.warn(`wiki failed: ${err}`))
  return {}
}

async function writeWiki(day: string): Promise<string | undefined> {
  const sub = context.subredditName
  if (!sub) return
  await publishWiki(day, sub, await setting('streakFlair'))
  return `https://www.reddit.com${wikiPath(sub)}`
}

function boardText(b: Board): string {
  if (!b.top.length) return 'Nobody played.'
  return b.top
    .map(r => `${r.rank}. u/${r.name} · ${r.score.toLocaleString('en-GB')}`)
    .join('\n\n')
}

export function crewsText(
  crews: {name: string; points: number; members: string[]}[],
): string {
  if (!crews.length) return ''
  const rows = crews
    .map((c, i) => crewRowText(i + 1, c.name, c.points, c.members))
    .join('\n\n')
  return `The top crews:\n\n${rows}`
}

/**
 * The week's top nine and its solve of the week, pinned second. `final` is the Monday post for the
 * week just ended; otherwise it's a moderator's post of the week so far.
 */
async function postWeekResults(
  week: string,
  from: string,
  final: boolean,
): Promise<string> {
  const b = await readBoard(boardKey.week(week), week, undefined)
  const spot = await getSpot(week)
  const crews = crewsText(await topCrews(week, BOARD_TOP))
  const sub = context.subredditName
  const text = [
    `The week's top nine${final ? '' : ' so far'}, from ${b.players.toLocaleString('en-GB')} players.`,
    boardText(b),
    crews,
    spot ? `**Solve of the week.** ${spotText(spot)}` : '',
    final
      ? "A new week starts today. Every day's cube adds to your total."
      : 'The week ends Sunday at midnight Pacific time.',
    sub
      ? `Rules, records and past weeks are on [the Nonet wiki](${wikiPath(sub)}).`
      : '',
  ]
  const post = await reddit.submitPost({
    title: `Nonet · weekly top nine${final ? '' : ' so far'} · week of ${shortDate(from)}`,
    text: text.filter(Boolean).join('\n\n'),
  })
  await pin(post, 2)
  return post.url
}

async function postEventResults(e: GameEvent): Promise<void> {
  const st = await eventState(e, e.end, undefined)
  const per = e.teamScoring === 'avg' ? ' a player' : ''
  const teams = st.teams.length
    ? `${st.teams
        .map(
          t =>
            `${t.rank}. ${t.team.name} · ${t.score.toLocaleString('en-GB')}${per} (${t.players} players)`,
        )
        .join('\n\n')}\n\n`
    : ''
  await reddit.submitPost({
    title: `Nonet · ${e.title}: results`,
    text: `${e.tagline ? `${e.tagline}\n\n` : ''}${teams}Top players:\n\n${boardText(st.board)}`,
  })
}

async function routeMenuWeekPost(): Promise<UiResponse> {
  const day = today()
  const url = await postWeekResults(
    weekKey(day),
    addDays(day, 1 - weekday(day)),
    false,
  )
  return {
    showToast: {text: "This week's board is posted.", appearance: 'success'},
    navigateTo: url,
  }
}

/** Sends the mod who asked a private message with the stored cubes. Players never see it. */
async function routeMenuCubes(): Promise<UiResponse> {
  const name = context.username
  if (!name) return {showToast: 'Log in to get the cube list.'}
  try {
    await reddit.sendPrivateMessage({to: name, ...(await cubeList())})
    return {
      showToast: {
        text: 'Sent: check your Reddit messages.',
        appearance: 'success',
      },
    }
  } catch (err) {
    console.warn(`cube list failed: ${err}`)
    return {showToast: "The cube list couldn't be sent."}
  }
}

async function routeMenuWiki(): Promise<UiResponse> {
  try {
    const url = await writeWiki(today())
    return {
      showToast: {
        text: 'The Nonet wiki page is up to date.',
        appearance: 'success',
      },
      ...(url ? {navigateTo: url} : {}),
    }
  } catch (err) {
    console.warn(`wiki failed: ${err}`)
    return {
      showToast: "The wiki couldn't be written. Check the app can edit it.",
    }
  }
}

/**
 * Runs just after midnight Pacific (the cron fires at 07:01 and 08:01 UTC to cover summer
 * time, and the once-only claims make the second run a no-op): makes today's and tomorrow's cubes,
 * moves lapsed streak flair to best, posts today's cube, and on the right days posts week and
 * event results. On Mondays it also saves last week's records and rewrites the wiki.
 */
export async function runDaily(): Promise<void> {
  const day = today()
  await ensureDay(day)
  await ensureDay(addDays(day, 1))
  const sub = context.subredditName
  if (sub && (await setting('streakFlair')))
    await lapseFlair(day, sub).catch(err =>
      console.warn(`flair failed: ${err}`),
    )
  const auto = await setting('autoPost')
  if (auto && (await claim('post', day)))
    await notifyNewCube(day, await postDaily(day))
  const yesterday = addDays(day, -1)
  const lastWeek = weekKey(yesterday)
  if (weekday(day) === 1 && (await claim('week', lastWeek))) {
    await saveWeek(lastWeek, addDays(day, -7))
    if (auto) await postWeekResults(lastWeek, addDays(day, -7), true)
    await writeWiki(day).catch(err => console.warn(`wiki failed: ${err}`))
  }
  if (!auto) return
  if (!eventsSwitch.on) return
  for (const e of await listEvents())
    if (e.end === yesterday && (await claim('event', e.id)))
      await postEventResults(e)
}

// ---------- moderator tools ----------

const NEW_EVENT_FORM = 'newEvent'
const END_EVENT_FORM = 'endEvent'

function routeMenuNewEvent(): UiResponse {
  const day = today()
  return {
    showForm: {
      name: NEW_EVENT_FORM,
      form: {
        title: 'New Nonet event',
        description:
          'An event has its own board for its dates. Add teams to make it side against side: each player picks a side once, and their points count for it.',
        acceptLabel: 'Create event',
        fields: [
          {type: 'string', name: 'title', label: 'Title', required: true},
          {
            type: 'string',
            name: 'tagline',
            label: 'Tagline',
            helpText: 'One line shown under the title.',
          },
          {
            type: 'string',
            name: 'start',
            label: 'First day (Pacific)',
            defaultValue: day,
            helpText: 'Year-month-day, like 2027-02-07.',
          },
          {
            type: 'string',
            name: 'end',
            label: 'Last day (Pacific)',
            defaultValue: addDays(day, 6),
          },
          {
            type: 'paragraph',
            name: 'teams',
            label: 'Teams',
            helpText:
              'One per line, with an optional colour: "Chiefs #E31837". Leave empty for a solo event.',
          },
          {
            type: 'select',
            name: 'teamScoring',
            label: 'Rank teams by',
            options: [
              {
                label: 'Average points a player (fair to smaller sides)',
                value: 'avg',
              },
              {label: 'Total points (rewards bringing fans)', value: 'sum'},
            ],
            defaultValue: ['avg'],
          },
          {
            type: 'string',
            name: 'accent',
            label: 'Accent colour',
            helpText: 'A hex colour for the event look, like #d50a0a.',
          },
          {
            type: 'number',
            name: 'bonusMult',
            label: 'Event points multiplier',
            defaultValue: 1,
            helpText: '1 is normal. 2 doubles points on the event board.',
          },
          {
            type: 'string',
            name: 'postTitle',
            label: 'Daily post title during the event',
            helpText: 'Optional. The date is added on the end.',
          },
        ],
      },
    },
  }
}

function formValues(body: unknown): Record<string, unknown> {
  const b = (body ?? {}) as Record<string, unknown>
  const inner = b.values
  return inner && typeof inner === 'object'
    ? (inner as Record<string, unknown>)
    : b
}

async function routeFormNewEvent(body: unknown): Promise<UiResponse> {
  const made = eventFromForm(formValues(body) as EventForm, today())
  if (typeof made === 'string')
    return {showToast: {text: made, appearance: 'neutral'}}
  await saveEvent(made)
  const sides = made.teams.length
    ? ` ${made.teams.map(t => t.name).join(' v ')}.`
    : ''
  return {
    showToast: {
      text: `${made.title} runs ${made.start} to ${made.end}.${sides}`,
      appearance: 'success',
    },
  }
}

async function routeMenuEndEvent(): Promise<UiResponse> {
  const day = today()
  const open = (await listEvents()).filter(e => e.end >= day)
  if (!open.length) return {showToast: 'No running or planned events.'}
  return {
    showForm: {
      name: END_EVENT_FORM,
      form: {
        title: 'End an event',
        description:
          'Ending makes today its last day. Its board stays, and the results post goes up tomorrow.',
        acceptLabel: 'End event',
        fields: [
          {
            type: 'select',
            name: 'id',
            label: 'Event',
            required: true,
            options: open.map(e => ({
              label: `${e.title} (${e.start} to ${e.end})`,
              value: e.id,
            })),
          },
        ],
      },
    },
  }
}

async function routeFormEndEvent(body: unknown): Promise<UiResponse> {
  const v = formValues(body)
  const id = Array.isArray(v.id) ? String(v.id[0]) : String(v.id ?? '')
  const ok = await endEvent(id, today())
  return {
    showToast: ok
      ? {text: 'The event ends today.', appearance: 'success'}
      : 'That event was not found.',
  }
}

// ---------- http ----------

async function readJson<T>(reqMsg: IncomingMessage): Promise<T> {
  const chunks: Uint8Array[] = []
  reqMsg.on('data', chunk => chunks.push(chunk))
  await once(reqMsg, 'end')
  const text = `${Buffer.concat(chunks)}`
  if (!text) return {} as T
  try {
    return JSON.parse(text) as T
  } catch {
    throw new HttpError(400, 'bad JSON')
  }
}

function writeJson<T extends PartialJsonValue>(
  status: number,
  json: Readonly<T>,
  rsp: ServerResponse,
): void {
  const body = JSON.stringify(json)
  const len = Buffer.byteLength(body)
  rsp.writeHead(status, {
    'Content-Length': len,
    'Content-Type': 'application/json',
  })
  rsp.end(body)
}
