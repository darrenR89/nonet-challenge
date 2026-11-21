// A finished run told without spoilers: the journey line (one square per face, in the order
// the faces were finished, coloured by how many wrong locks it took), and the text of the
// result comment a player can post on the day's post. Shared by the game and the server.

/** A face finished with no wrong locks, one, or two or more. */
export const JOURNEY_MARKS = ['🟨', '🟧', '🟥'] as const

/** The cube has six faces. */
export const FACES = 6

/**
 * The journey line: a square per face, in the order finished. Faces missing from `order`
 * (already full of clues, say) go first, as they were done before the player started.
 */
export function journeyLine(
  order: readonly number[],
  wrongByFace: readonly number[],
): string {
  const seen = new Set<number>()
  const done = order.filter(
    f => f >= 0 && f < FACES && !seen.has(f) && seen.add(f),
  )
  const before = [...Array(FACES).keys()].filter(f => !seen.has(f))
  return [...before, ...done]
    .map(f => JOURNEY_MARKS[Math.min(2, Math.max(0, wrongByFace[f] ?? 0))])
    .join('')
}

/** True for a journey line and nothing else, so a comment can only carry squares. */
export function isJourney(s: unknown): s is string {
  if (typeof s !== 'string') return false
  const marks = [...s]
  return (
    marks.length === FACES &&
    marks.every(m => (JOURNEY_MARKS as readonly string[]).includes(m))
  )
}

export type ResultLine = {
  cubeNo: number
  tier: number
  /** Solve time in seconds. */
  time: number
  points: number
  stars: number
  rank: number | undefined
  players: number
}

const clock = (s: number): string =>
  `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, '0')}`

/** The result comment, in Reddit markdown. Every number comes from the server. */
export function resultCommentText(r: ResultLine, journey?: string): string {
  const turns = `${r.tier} turn${r.tier === 1 ? '' : 's'}`
  const rank = r.rank && r.players > 1 ? ` · #${r.rank} of ${r.players}` : ''
  const stars = '★'.repeat(r.stars) + '☆'.repeat(Math.max(0, 3 - r.stars))
  const head = `Nonet No.${r.cubeNo} · ${turns} · ${clock(r.time)} · ${r.points.toLocaleString('en-GB')} pts${rank}`
  return `${head}\n\n${isJourney(journey) ? `${journey} ` : ''}${stars}`
}
