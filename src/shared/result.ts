// The result comment a player can post on the day's post: how the run went, with nothing from
// the cube itself, so no spoilers. Shared by the game (for the preview) and the server.

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
export function resultCommentText(r: ResultLine): string {
  const turns = `${r.tier} turn${r.tier === 1 ? '' : 's'}`
  const rank = r.rank && r.players > 1 ? ` · #${r.rank} of ${r.players}` : ''
  const stars = '★'.repeat(r.stars) + '☆'.repeat(Math.max(0, 3 - r.stars))
  return `Nonet No.${r.cubeNo} · ${turns} · ${clock(r.time)} · ${r.points.toLocaleString('en-GB')} pts${rank}\n\n${stars}`
}
