// Devvit Journeys from the game: one journey per play session, from Play to
// solved or given up. Every call is fire-and-forget and never throws, so
// analytics can't slow or break play. Events for apps Reddit hasn't approved
// yet are dropped on Reddit's side; that's expected in playtests.
import {telemetry} from '@devvit/analytics/client/reddit'

const quiet = (p: () => Promise<unknown>): void => {
  try {
    p().catch(() => {})
  } catch {
    // no telemetry here (offline, local test page)
  }
}

let started = false
let lastProgress = 0

export const journey = {
  /** The splash is drawn and Play works. */
  ready(): void {
    quiet(() => telemetry.appReady())
  },
  /** The player pressed Play (or Resume after leaving). */
  start(): void {
    started = true
    lastProgress = 0
    quiet(() => telemetry.startJourney())
  },
  /** A milestone: 0.5 when the clues line up, 0.75 at half filled. */
  progress(progress: number, action: string): void {
    if (!started || progress <= lastProgress) return
    lastProgress = progress
    quiet(() => telemetry.progress({progress, action}))
  },
  /** A committed tap: pause, resume, retry, hint, give_up, share, join... */
  interaction(action: string, actionDetails?: string): void {
    quiet(() =>
      telemetry.interaction(actionDetails ? {action, actionDetails} : {action}),
    )
  },
  /** The id to send with a scored run, so the server ends the journey itself. */
  id(): string | undefined {
    try {
      return telemetry.getActiveJourneyId()
    } catch {
      return undefined
    }
  },
  /** After the server ended the journey (a scored run or a give-up). */
  endedByServer(): void {
    started = false
    try {
      telemetry.clearJourneyId()
    } catch {
      // nothing stored
    }
  },
  /** Ends an unscored run here: practice, offline, or leaving mid-cube. */
  end(complete: boolean, win: boolean, score: number): void {
    if (!started) return
    started = false
    quiet(() => telemetry.endJourney({complete, game: {win, score}}))
  },
  get active(): boolean {
    return started
  },
}
