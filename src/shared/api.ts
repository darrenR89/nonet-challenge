import type {Duel} from './duel.ts'
import type {Puzzle} from './model.js'
import type {RunStats, ScoreBreakdown} from './scoring.ts'

/** Generic error detail for all responses. */
export type ErrorRsp = {error: string; status: number}

/** A team in an event, such as one side of a Super Bowl matchup. */
export type Team = {id: string; name: string; color: string}

/**
 * A themed event: a date range with its own board, optional teams and a look.
 * Days are Pacific-time YYYY-MM-DD, both included.
 */
export type GameEvent = {
  id: string
  title: string
  tagline: string
  start: string
  end: string
  /** Accent colour for the event's look, e.g. #d50a0a. Empty for the default. */
  accent: string
  /** Empty for a solo event. Two or more for team against team. */
  teams: Team[]
  /** How teams are ranked: total points, or average points per player who has scored. */
  teamScoring: 'sum' | 'avg'
  /** Points multiplier on the event board, e.g. 2 for double points. */
  bonusMult: number
  /** Optional title for the auto-posted daily posts during the event. */
  postTitle: string
}

export type BoardRow = {rank: number; name: string; score: number}

/** A board: the top rows plus where the asker stands. */
export type Board = {
  key: string
  label: string
  top: BoardRow[]
  me: BoardRow | undefined
  players: number
}

export type TeamStanding = {
  team: Team
  score: number
  players: number
  rank: number
}

export type EventState = {
  event: GameEvent
  /** Day number in the event, 1 based, and how many days it runs. */
  dayOf: number
  days: number
  board: Board
  teams: TeamStanding[]
  /** The asker's team, if they joined one. */
  myTeam: string | undefined
}

export type Streak = {current: number; best: number; played: number}

/** What the asker has done today. */
export type MyDay = {
  /** The tier they locked in for today, if they pressed Play. */
  tier: number | undefined
  /** Their score today, if they finished. */
  score: number | undefined
  starsWon: number | undefined
  /** Retries used today: 0 or 1. A retry scales today's total by RETRY_MULT. */
  retries: number
}

/** A retry restarts today's cube once; the finished total is multiplied by this. */
export const RETRY_MULT = 0.8

/** How today's cube is going for everyone: ranked solves, their average time and the fastest, in seconds (0 before any). */
/** How one rotation count is going today, to help a player pick theirs. */
export type TierStats = {
  tier: number
  /** Players who set today to this many rotations. */
  picks: number
  solves: number
  /** Seconds, 0 with no solves. */
  avgTime: number
  avgScore: number
  best: number
}

export type DayStats = {
  solves: number
  avgTime: number
  fastest: number
  /** Per rotation count, 0 to 3. Missing from older servers. */
  tiers?: TierStats[]
}

/** A look at a coming day's cube: its clues on the solved cube, no answers. */
export type Preview = {day: string; given: number[]}

/** Everything the splash and game need on open. */
export type DailyRsp = {
  day: string
  /** Day of the week, 1 (Monday) to 7. */
  weekday: number
  week: string
  /** Today's fill difficulty: 0 Easy, 1 Medium, 2 Hard. */
  level: number
  /** The cube for today's locked tier, once Play was pressed. */
  puzzle: Puzzle | undefined
  my: MyDay
  streak: Streak
  /** Tomorrow's clues, if the asker locked all three ★ today. */
  preview: Preview | undefined
  boards: {day: Board; week: Board}
  event: EventState | undefined
  /** False when nobody is logged in; scores are not kept. */
  loggedIn: boolean
  /** Today's cube number, counting from the first cube in this subreddit. */
  cubeNo: number
  stats: DayStats
  /** The subreddit, for "Join r/…". */
  subreddit: string
  /** Whether the asker gets a push notification when each new cube is out. */
  notify: boolean
  /** Today's challenges the asker sent or received. */
  duels: Duel[]
}

/** What the feed card shows. Light: a few reads, so it's fine on every scroll past. */
export type CardRsp = {
  day: string
  /** Today's puzzle number, 1 to 365, cycling. */
  no: number
  loggedIn: boolean
  /** Ranked solves of today's cube so far. */
  solves: number
  /** The asker's live streak, 0 when logged out or lapsed. */
  streak: number
  /** The asker's score today, once they've finished. */
  score: number | undefined
  /** Their place on today's board, once they've finished. */
  rank: number | undefined
}

/** Lock today's tier (0 to 3 turns, Hard up to 2) and get its cube. Only the first call each day counts. */
export type StartReq = {tier: number}
export type StartRsp = {
  puzzle: Puzzle
  tier: number
  /** Logged out: the id to claim this run with after signing up. */
  guest?: string
}

/** A finished run. forfeit means the player gave up: today ends at 0, unranked. */
export type ScoreReq = {
  day: string
  tier: number
  stats: RunStats
  forfeit?: boolean
  /** A run played logged out, claimed by the player who just signed up. */
  guest?: string
}
export type ScoreRsp = {
  /** True if this run counted. Only the first finished run each day does. */
  counted: boolean
  breakdown: ScoreBreakdown
  total: number
  streak: Streak
  boards: {day: Board; week: Board}
  event: EventState | undefined
  /** Tomorrow's clues, for players who locked all three ★. */
  preview: Preview | undefined
  /** The total before the retry penalty, and the multiplier (1 with no retry). */
  rawTotal: number
  penalty: number
  /** Share of today's other ranked players this run beat, 0 to 100. */
  beatPct: number
  stats: DayStats
  /** Today's challenges, settled where both players have finished. */
  duels: Duel[]
}

/** Uses today's one retry. */
export type RetryRsp = {retries: number; penalty: number}

export type NotifyReq = {on: boolean}
export type NotifyRsp = {notify: boolean}
export type JoinRsp = {joined: boolean}

/** Challenge a player to beat the asker's score on today's cube. */
export type ChallengeReq = {name: string}
export type ChallengeRsp = {duels: Duel[]}
/** The challenged player accepts or declines, before they play. from is the challenger's user id. */
export type AnswerReq = {from: string; accept: boolean}

export type JoinTeamReq = {eventId: string; team: string}
export type JoinTeamRsp = {event: EventState}

export type BoardReq = {kind: 'day' | 'week' | 'all' | 'event'; key?: string}
export type BoardRsp = {board: Board}

export type Endpoint = (typeof Endpoint)[keyof typeof Endpoint]
export const Endpoint = {
  Daily: 'api/daily',
  Card: 'api/card',
  Start: 'api/daily/start',
  Score: 'api/daily/score',
  JoinTeam: 'api/event/join',
  Board: 'api/board',
  Retry: 'api/daily/retry',
  Notify: 'api/notify',
  JoinSub: 'api/join',
  Challenge: 'api/challenge',
  Answer: 'api/challenge/answer',
  TelemetryStart: 'api/telemetry/journey/start',
  TelemetryProgress: 'api/telemetry/journey/progress',
  TelemetryInteraction: 'api/telemetry/journey/interaction',
  TelemetryEnd: 'api/telemetry/journey/end',
  TelemetryAppReady: 'api/telemetry/journey/app-ready',
  OnAppInstall: 'internal/on/app/install',
  OnMenuNewPost: 'internal/on/menu/new-post',
  OnMenuNewEvent: 'internal/on/menu/new-event',
  OnMenuEndEvent: 'internal/on/menu/end-event',
  OnMenuWeekPost: 'internal/on/menu/week-post',
  OnFormNewEvent: 'internal/form/new-event',
  OnFormEndEvent: 'internal/form/end-event',
  OnCronDaily: 'internal/cron/daily',
} as const

export const EndpointMethod = {
  [Endpoint.Daily]: 'GET',
  [Endpoint.Card]: 'GET',
  [Endpoint.Start]: 'POST',
  [Endpoint.Score]: 'POST',
  [Endpoint.JoinTeam]: 'POST',
  [Endpoint.Board]: 'POST',
  [Endpoint.Retry]: 'POST',
  [Endpoint.Notify]: 'POST',
  [Endpoint.JoinSub]: 'POST',
  [Endpoint.Challenge]: 'POST',
  [Endpoint.Answer]: 'POST',
  [Endpoint.TelemetryStart]: 'POST',
  [Endpoint.TelemetryProgress]: 'POST',
  [Endpoint.TelemetryInteraction]: 'POST',
  [Endpoint.TelemetryEnd]: 'POST',
  [Endpoint.TelemetryAppReady]: 'POST',
  [Endpoint.OnAppInstall]: 'POST',
  [Endpoint.OnMenuNewPost]: 'POST',
  [Endpoint.OnMenuNewEvent]: 'POST',
  [Endpoint.OnMenuEndEvent]: 'POST',
  [Endpoint.OnMenuWeekPost]: 'POST',
  [Endpoint.OnFormNewEvent]: 'POST',
  [Endpoint.OnFormEndEvent]: 'POST',
  [Endpoint.OnCronDaily]: 'POST',
} as const satisfies {[endpoint: string]: 'GET' | 'POST'}
