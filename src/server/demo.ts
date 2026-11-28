// Demo mode: for an hour, a moderator sees today's post as if the subreddit were busy. The
// boards are full, a crew invites them, and other players have challenged them. Everything
// they do to the crew or the challenges changes only their own demo copy, kept in Redis for
// the hour. Their own runs, scores and streak are real and untouched; nobody else sees any of it.
//
// A demo daily post (see demoposts.ts) uses the same sample, as a regular on a busy day: every
// viewer is already in the sample crew, with challenges both ways. Their copy is kept a day.
import {redis} from '@devvit/web/server'
import type {
  AnswerReq,
  Board,
  BoardRow,
  ChallengeReq,
  CrewAnswerReq,
  CrewCreateReq,
  CrewInviteReq,
  CrewNudgeReq,
  CrewNudgesReq,
  CrewSeatReq,
} from '../shared/api.ts'
import {Endpoint} from '../shared/api.ts'
import {
  CREW_SIZE,
  type Crew,
  type CrewInfo,
  type CrewMember,
  cleanCrewName,
} from '../shared/crew.ts'
import {type Duel, duelResult, MAX_CHALLENGES} from '../shared/duel.ts'
import {BOARD_TOP} from './board.ts'

/** How long demo mode lasts once a moderator turns it on. */
export const DEMO_SECONDS = 60 * 60
/** How long a viewer's copy of a demo post's crew and challenges is kept. */
const DEMO_POST_SECONDS = 24 * 60 * 60

/** Demo mode's copy, or a demo post's: the two never share. */
const demoKey = (uid: string, post: boolean | undefined): string =>
  post ? `demo-post:${uid}` : `demo:${uid}`

/** Sample players, as Reddit usernames. */
export const NAMES = [
  'sudo_ku',
  'pivot_pat',
  'blockparty',
  'tessellate',
  'turnbuckle',
  'pencilmark',
  'quietfox',
  'rowan_col',
  'lattice_lou',
  'hanafuda',
  'mochi_math',
  'ninefold',
  'cubist_kay',
  'gridlock_g',
  'paper_crane',
  'lantern_owl',
  'kitsune_k',
  'tofu_tile',
  'wasabi_wes',
  'origami_oz',
  'nori_nine',
  'sumi_ink',
  'koi_pond',
  'bento_box',
  'ramen_rae',
  'zen_garden',
  'shogi_sam',
  'go_stone',
  'kanji_kid',
  'yuzu_yen',
] as const

/** The asker's demo copy of the social side: their crew and today's challenges. */
type DemoState = {
  /** When the hour is up, in ms. */
  until: number
  /** 'invited': an invite is waiting. 'member': in the sample crew. 'none': no crew. 'own': a crew they started. */
  crew: 'invited' | 'member' | 'none' | 'own'
  crewName: string
  /** Crewmates the asker invited to their own crew; they stay invited. */
  invited: string[]
  nudged: string[]
  nudgesOff: boolean
  seatOpened: string[]
  posted: boolean
  duels: Duel[]
}

/** A number from 0 to 1 for a name and a day, so the sample scores hold still all day. */
export function noise(name: string, day: string): number {
  let h = 2166136261
  for (const ch of `${name}:${day}`)
    h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return ((h >>> 0) % 10000) / 10000
}

export const scoreOf = (name: string, day: string): number =>
  Math.round(600 + 2200 * noise(name, day) ** 1.4)

/** Who has played today: most of them, and the rest later. */
const playedToday = (name: string, day: string): boolean =>
  noise(name, `${day}:p`) < 0.75

function board(
  label: string,
  scores: [string, number][],
  me: {name: string; score: number | undefined},
  players: number,
): Board {
  const all = [...scores]
  if (me.score !== undefined) all.push([me.name, me.score])
  all.sort((a, b) => b[1] - a[1])
  const rows: BoardRow[] = all.map(([name, score], i) => ({
    rank: i + 1,
    name,
    score,
  }))
  const mine =
    me.score === undefined ? undefined : rows.find(r => r.name === me.name)
  // the sample players stand in for the top of a much bigger board
  const extra = players - all.length
  const meRow =
    mine && mine.rank > BOARD_TOP
      ? {...mine, rank: mine.rank + Math.round(extra * 0.6)}
      : mine
  return {
    key: `demo:${label}`,
    label,
    top: rows.slice(0, BOARD_TOP),
    me: meRow,
    players: Math.max(players, all.length),
  }
}

/** Today's board and the week's, full of sample players, with the asker's real scores in among them. */
export function demoBoards(
  day: string,
  me: {name: string; today: number | undefined; week: number | undefined},
): {day: Board; week: Board} {
  const today = NAMES.filter(n => playedToday(n, day)).map(
    n => [n, scoreOf(n, day)] as [string, number],
  )
  const week = NAMES.map(
    n =>
      [n, Math.round(scoreOf(n, day) * (2 + 4 * noise(n, 'week')))] as [
        string,
        number,
      ],
  )
  return {
    day: board('Today', today, {name: me.name, score: me.today}, 1284),
    week: board('This week', week, {name: me.name, score: me.week}, 2310),
  }
}

/** The all-time board, full of sample players, with the asker's demo total in among them. */
export function demoAllBoard(
  day: string,
  me: {name: string; score: number | undefined},
): Board {
  const all = NAMES.map(
    n =>
      [n, Math.round(scoreOf(n, day) * (30 + 90 * noise(n, 'all')))] as [
        string,
        number,
      ],
  )
  const mine = me.score === undefined ? undefined : me.score + 61_480
  return board('All time', all, {name: me.name, score: mine}, 6021)
}

/** The sample crew the invite is for: two crewmates, one played and one away for three days. */
const MATES = ['pivot_pat', 'quietfox'] as const

function crewOf(
  st: DemoState,
  day: string,
  me: {id: string; name: string; score: number | undefined},
): Crew {
  const mate = (name: string, i: number): CrewMember => ({
    id: `t2_demo_${name}`,
    name,
    score: i === 0 ? scoreOf(name, day) : undefined,
    me: false,
    nudged: st.nudged.includes(`t2_demo_${name}`),
    nudgesOff: false,
    countsFrom: undefined,
    missed: i === 0 ? 0 : 3,
  })
  const mates =
    st.crew === 'own'
      ? []
      : MATES.filter(n => !st.seatOpened.includes(`t2_demo_${n}`)).map(mate)
  const members: CrewMember[] = [
    {
      id: me.id,
      name: me.name,
      score: me.score,
      me: true,
      nudged: false,
      nudgesOff: st.nudgesOff,
      countsFrom: undefined,
      missed: 0,
    },
    ...mates,
  ]
  const today = members.reduce((n, m) => n + (m.score ?? 0), 0)
  return {
    id: 'demo-crew',
    name: st.crewName,
    members,
    today,
    week: today * 4 + 5210,
    rank: st.crew === 'own' ? undefined : 4,
    crews: 23,
    streak: st.crew === 'own' ? 0 : 6,
    best: st.crew === 'own' ? 0 : 11,
    posted: st.posted,
  }
}

function crewInfo(
  st: DemoState,
  day: string,
  me: {id: string; name: string; score: number | undefined},
): CrewInfo {
  if (st.crew === 'invited')
    return {
      crew: undefined,
      invites: [{crewId: 'demo-crew', crew: st.crewName, from: MATES[0]}],
    }
  if (st.crew === 'none') return {crew: undefined, invites: []}
  return {crew: crewOf(st, day, me), invites: []}
}

/**
 * A fresh demo copy. Demo mode starts with an invite waiting; a demo post starts already in the
 * crew, mid streak, with a challenge waiting, one won and one still out.
 */
function freshState(
  day: string,
  myScore: number | undefined,
  post?: boolean,
): DemoState {
  const duel = (
    them: string,
    sent: boolean,
    status: Duel['status'],
    theirs: number | undefined,
  ): Duel => ({
    day,
    them,
    themId: `t2_demo_${them}`,
    sent,
    mine: myScore,
    theirs,
    status,
    result: status === 'accepted' ? duelResult(myScore, theirs) : 'pending',
    record: post ? {won: 5, lost: 2, tied: 1} : {won: 2, lost: 1, tied: 0},
  })
  return {
    until: Date.now() + (post ? DEMO_POST_SECONDS : DEMO_SECONDS) * 1000,
    crew: post ? 'member' : 'invited',
    crewName: 'Night Owls',
    invited: [],
    nudged: [],
    nudgesOff: false,
    seatOpened: [],
    posted: false,
    duels: [
      duel('blockparty', false, 'offered', undefined),
      duel('tessellate', true, 'accepted', scoreOf('tessellate', day)),
      ...(post ? [duel('lattice_lou', true, 'offered', undefined)] : []),
    ],
  }
}

/** Turns demo mode on for an hour, starting from a fresh sample. */
export async function startDemo(
  uid: string,
  day: string,
  myScore: number | undefined,
): Promise<void> {
  const st = freshState(day, myScore)
  await save({id: uid, name: '', day, score: myScore, week: undefined}, st)
}

/** The asker's demo copy. On a demo post there always is one: the first look makes it. */
async function load(me: DemoMe): Promise<DemoState | undefined> {
  const raw = await redis.get(demoKey(me.id, me.post))
  const st = raw ? (JSON.parse(raw) as DemoState) : undefined
  if (st && st.until > Date.now()) return st
  if (!me.post) return
  const fresh = freshState(me.day, me.score, true)
  await save(me, fresh)
  return fresh
}

async function save(me: DemoMe, st: DemoState): Promise<void> {
  // keeps the time that's left
  await redis.set(demoKey(me.id, me.post), JSON.stringify(st), {
    expiration: new Date(st.until),
  })
}

export type DemoMe = {
  id: string
  name: string
  day: string
  score: number | undefined
  week: number | undefined
  /** True on a demo daily post, where every viewer sees the sample as a regular. */
  post?: boolean
}

/** The parts of today's response demo mode replaces, or undefined when it's off. */
export async function demoDaily(
  me: DemoMe,
): Promise<
  {boards: {day: Board; week: Board}; crew: CrewInfo; duels: Duel[]} | undefined
> {
  const st = await load(me)
  if (!st) return
  const duels = st.duels.map(d => ({
    ...d,
    mine: me.score,
    result: d.status === 'accepted' ? duelResult(me.score, d.theirs) : d.result,
  }))
  return {
    boards: demoBoards(me.day, {name: me.name, today: me.score, week: me.week}),
    crew: crewInfo(st, me.day, me),
    duels,
  }
}

/** Answers a crew or challenge request from demo state, or undefined to let the real route run. */
export async function demoRoute(
  endpoint: Endpoint,
  body: unknown,
  me: DemoMe,
): Promise<object | undefined> {
  const st = await load(me)
  if (!st) return
  const crew = (note?: string): object => ({
    ...crewInfo(st, me.day, me),
    ...(note ? {note} : {}),
  })
  switch (endpoint) {
    case Endpoint.CrewAnswer: {
      st.crew = (body as CrewAnswerReq).accept ? 'member' : 'none'
      break
    }
    case Endpoint.CrewCreate: {
      const name = cleanCrewName((body as CrewCreateReq).name)
      if (!name)
        return {error: 'Pick a crew name of 2 to 24 letters.', status: 400}
      st.crew = 'own'
      st.crewName = name
      break
    }
    case Endpoint.CrewInvite: {
      const names = (body as CrewInviteReq).names ?? []
      st.invited.push(...names.slice(0, CREW_SIZE - 1))
      await save(me, st)
      return crew(
        `Demo: ${names.map(n => `u/${n}`).join(' and ')} would be tagged in a comment.`,
      )
    }
    case Endpoint.CrewLeave:
      st.crew = 'none'
      break
    case Endpoint.CrewNudge:
      st.nudged.push((body as CrewNudgeReq).to)
      break
    case Endpoint.CrewSeat:
      st.seatOpened.push((body as CrewSeatReq).to)
      break
    case Endpoint.CrewNudges:
      st.nudgesOff = !(body as CrewNudgesReq).on
      break
    case Endpoint.CrewPost:
      st.posted = true
      break
    case Endpoint.Challenge: {
      if (me.score === undefined)
        return {error: 'Finish today’s cube first.', status: 400}
      if (st.duels.filter(d => d.sent).length >= MAX_CHALLENGES)
        return {
          error: `That's ${MAX_CHALLENGES} challenges today. Try again tomorrow.`,
          status: 400,
        }
      const them =
        String((body as ChallengeReq).name ?? '')
          .replace(/^u\//i, '')
          .trim() || 'someone'
      st.duels.push({
        day: me.day,
        them,
        themId: `t2_demo_${them}`,
        sent: true,
        mine: me.score,
        theirs: undefined,
        status: 'offered',
        result: 'pending',
        record: {won: 0, lost: 0, tied: 0},
      })
      await save(me, st)
      return {duels: st.duels}
    }
    case Endpoint.Answer: {
      const a = body as AnswerReq
      st.duels = st.duels.map(d =>
        d.themId === a.from
          ? {
              ...d,
              status: a.accept ? 'accepted' : 'declined',
              theirs: a.accept ? scoreOf(d.them, me.day) : d.theirs,
            }
          : d,
      )
      await save(me, st)
      return {duels: st.duels}
    }
    default:
      return
  }
  await save(me, st)
  return crew()
}
