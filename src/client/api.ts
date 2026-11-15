// Calls to the Nonet server. Each returns undefined on any failure, so the
// game keeps working offline (unscored) when the server can't be reached.
import {
  type BoardReq,
  type BoardRsp,
  type CardRsp,
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
