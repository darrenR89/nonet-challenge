// Challenges: one player dares another to beat their score on today's cube.
// Shared by the server (rules) and the game (wording).

/** How many players one person can challenge in a day. */
export const MAX_CHALLENGES = 5

export type DuelResult = 'pending' | 'won' | 'lost' | 'tied'

/** Wins, losses and ties between two players, from one side. */
export type Record3 = {won: number; lost: number; tied: number}

/** A head-to-head on one day's cube, seen from the asker's side. */
export type Duel = {
  day: string
  /** The other player's Reddit username. */
  them: string
  /** True if the asker sent the challenge, false if they received it. */
  sent: boolean
  /** Each side's score today, once they've finished. */
  mine: number | undefined
  theirs: number | undefined
  result: DuelResult
  /** Every settled challenge between the two, from the asker's side. */
  record: Record3
}

/** The result from one side, once both scores are in. */
export function duelResult(
  mine: number | undefined,
  theirs: number | undefined,
): DuelResult {
  if (mine === undefined || theirs === undefined) return 'pending'
  if (mine > theirs) return 'won'
  if (mine < theirs) return 'lost'
  return 'tied'
}

/** A typed username without "u/" or "@", or undefined if it can't be a Reddit username. */
export function cleanName(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return
  const name = raw
    .trim()
    .replace(/^\/?u\//i, '')
    .replace(/^@/, '')
  return /^[A-Za-z0-9_-]{3,20}$/.test(name) ? name : undefined
}

/** The comment that tags the challenged player. */
export function challengeText(
  from: string,
  to: string,
  score: number,
  cubeNo: number,
): string {
  return `u/${to}, u/${from} scored ${score.toLocaleString('en-GB')} on Nonet #${cubeNo} and challenges you to beat it. Today's cube is in this post.`
}

/** A record line such as "You lead 3–2" or "Level at 1–1, 1 tie". */
export function recordText(r: Readonly<Record3>): string {
  const ties = r.tied ? `, ${r.tied} tie${r.tied === 1 ? '' : 's'}` : ''
  if (!r.won && !r.lost && !r.tied) return 'First meeting'
  if (r.won > r.lost) return `You lead ${r.won}–${r.lost}${ties}`
  if (r.won < r.lost) return `They lead ${r.lost}–${r.won}${ties}`
  return `Level at ${r.won}–${r.lost}${ties}`
}
