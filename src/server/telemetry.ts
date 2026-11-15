// Devvit Journeys: the game's play sessions as analytics events. The browser
// talks to /api/telemetry/journey/*; these routes pass each event to Devvit.
// Telemetry must never get in the way of play, so every call here is caught,
// and a failure just returns an empty receipt.
import {telemetry} from '@devvit/analytics/server/reddit'

export type Receipt = {status: string; message?: string}
type Rsp = {journeyId?: string; receipt?: Receipt}

const UNSPECIFIED: Receipt = {status: 'JOURNEY_RECEIPT_UNSPECIFIED'}

async function safe(what: string, fn: () => Promise<Rsp>): Promise<Rsp> {
  try {
    const rsp = await fn()
    if (process.env.NODE_ENV !== 'production' && rsp.receipt)
      console.log(`journey ${what}: ${rsp.receipt.status}`)
    return rsp
  } catch (err) {
    console.warn(
      `journey ${what} failed: ${err instanceof Error ? err.message : err}`,
    )
    return {receipt: UNSPECIFIED}
  }
}

const str = (x: unknown): string | undefined =>
  typeof x === 'string' && x.trim() ? x.trim().slice(0, 64) : undefined

export const journey = {
  start: (): Promise<Rsp> => safe('start', () => telemetry.startJourney()),
  appReady: (): Promise<Rsp> => safe('app-ready', () => telemetry.appReady()),
  progress: (b: Record<string, unknown>): Promise<Rsp> => {
    const journeyId = str(b.journeyId)
    const progress = Number(b.progress)
    if (!journeyId || !(progress >= 0 && progress <= 1))
      return Promise.resolve({receipt: {status: 'JOURNEY_RECEIPT_INVALID'}})
    const action = str(b.action)
    const actionDetails = str(b.actionDetails)
    return safe('progress', () =>
      telemetry.journeyProgress({
        journeyId,
        progress,
        ...(action ? {action} : {}),
        ...(actionDetails ? {actionDetails} : {}),
      }),
    )
  },
  interaction: (b: Record<string, unknown>): Promise<Rsp> => {
    const action = str(b.action)
    if (!action)
      return Promise.resolve({receipt: {status: 'JOURNEY_RECEIPT_INVALID'}})
    return safe(`interaction ${action}`, () =>
      telemetry.journeyInteraction({
        journeyId: str(b.journeyId) ?? '',
        action,
        actionDetails: str(b.actionDetails) ?? '',
      }),
    )
  },
  /** Ends a journey. Scored runs are ended by the score route with the server's total. */
  end: (
    journeyId: string | undefined,
    complete: boolean,
    game?: {win: boolean; score: number},
  ): Promise<Rsp> => {
    if (!journeyId) return Promise.resolve({receipt: UNSPECIFIED})
    return safe('end', () =>
      telemetry.endJourney({journeyId, complete, ...(game ? {game} : {})}),
    )
  },
}
