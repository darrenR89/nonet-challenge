// Calls to the Nonet server. Each returns undefined on any failure, so the
// game keeps working offline (unscored) when the server can't be reached.
import {
  type AnswerReq,
  type BoardReq,
  type BoardRsp,
  type CardRsp,
  type ChallengeReq,
  type ChallengeRsp,
  type CrewAnswerReq,
  type CrewCreateReq,
  type CrewInviteReq,
  type CrewNudgeReq,
  type CrewRsp,
  type DailyRsp,
  Endpoint,
  type JoinRsp,
  type JoinTeamReq,
  type JoinTeamRsp,
  type NotifyRsp,
  type RetryRsp,
  type ScoreReq,
  type ScoreRsp,
  type StartReq,
  type StartRsp,
} from '../shared/api.ts'

/** The last error message the server sent, for showing to the player. */
export let lastError = ''

async function call<T>(
  url: string,
  body?: unknown,
  extra: Record<string, string> = {},
): Promise<T | undefined> {
  let rsp: Response
  try {
    rsp = await fetch(url, {
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : {'Content-Type': 'application/json'}),
        ...extra,
      },
      method: body === undefined ? 'GET' : 'POST',
      ...(body === undefined ? {} : {body: JSON.stringify(body)}),
    })
  } catch (err) {
    lastError = 'No connection.'
    console.error(`HTTP error: ${err instanceof Error ? err.message : err}`)
    return
  }
  if (!rsp.ok) {
    const text = await rsp.text().catch(() => '')
    try {
      lastError = (JSON.parse(text) as {error?: string}).error ?? text
    } catch {
      lastError = text
    }
    console.error(`HTTP status ${rsp.status}: ${rsp.statusText}; ${text}`)
    return
  }
  lastError = ''
  return (await rsp.json()) as T
}

export const getCard = (): Promise<CardRsp | undefined> =>
  call<CardRsp>(Endpoint.Card)
export const getDaily = (): Promise<DailyRsp | undefined> =>
  call<DailyRsp>(Endpoint.Daily)
export const startDay = (req: StartReq): Promise<StartRsp | undefined> =>
  call<StartRsp>(Endpoint.Start, req)
/** Sends a run. The journey id lets the server end the journey with its own total. */
export const sendScore = (
  req: ScoreReq,
  journeyId?: string,
): Promise<ScoreRsp | undefined> =>
  call<ScoreRsp>(
    Endpoint.Score,
    req,
    journeyId ? {'x-devvit-journey-id': journeyId} : {},
  )
export const useRetry = (): Promise<RetryRsp | undefined> =>
  call<RetryRsp>(Endpoint.Retry, {})
export const setNotify = (on: boolean): Promise<NotifyRsp | undefined> =>
  call<NotifyRsp>(Endpoint.Notify, {on})
export const joinSub = (): Promise<JoinRsp | undefined> =>
  call<JoinRsp>(Endpoint.JoinSub, {})
export const joinTeam = (req: JoinTeamReq): Promise<JoinTeamRsp | undefined> =>
  call<JoinTeamRsp>(Endpoint.JoinTeam, req)
export const getBoard = (req: BoardReq): Promise<BoardRsp | undefined> =>
  call<BoardRsp>(Endpoint.Board, req)
/** Challenges a player to beat today's score; they're tagged in a comment. */
export const challenge = (
  req: ChallengeReq,
): Promise<ChallengeRsp | undefined> =>
  call<ChallengeRsp>(Endpoint.Challenge, req)
/** Accepts or declines a challenge, before playing. */
export const answerChallenge = (
  req: AnswerReq,
): Promise<ChallengeRsp | undefined> => call<ChallengeRsp>(Endpoint.Answer, req)
/** Starts a crew; up to two invited players are tagged in a comment. */
export const createCrew = (req: CrewCreateReq): Promise<CrewRsp | undefined> =>
  call<CrewRsp>(Endpoint.CrewCreate, req)
/** Invites players into the crew's open seats. */
export const inviteCrew = (req: CrewInviteReq): Promise<CrewRsp | undefined> =>
  call<CrewRsp>(Endpoint.CrewInvite, req)
/** Joins or declines a crew invitation. */
export const answerCrew = (req: CrewAnswerReq): Promise<CrewRsp | undefined> =>
  call<CrewRsp>(Endpoint.CrewAnswer, req)
export const leaveCrew = (): Promise<CrewRsp | undefined> =>
  call<CrewRsp>(Endpoint.CrewLeave, {})
/** Nudges a crewmate who hasn't played today, by private message. */
export const nudgeCrew = (req: CrewNudgeReq): Promise<CrewRsp | undefined> =>
  call<CrewRsp>(Endpoint.CrewNudge, req)
