// Nonet Crew: a standing team of up to three. Each member plays the daily cube on their
// own time, and the crew's score for a day is the sum of its members' scores.
// Shared by the server (rules) and the game (wording).

/** Members in a full crew. */
export const CREW_SIZE = 3

/** Invites one crew can send in a day. */
export const MAX_CREW_INVITES = 5

/** The kanji the crew is dressed with: 連, ren, a linked group. */
export const CREW_MARK = '連'

/** One member of a crew, as the asker sees them today. */
export type CrewMember = {
  id: string
  name: string
  /** Their score today, once they've finished. */
  score: number | undefined
  /** True for the asker. */
  me: boolean
  /** True if someone in the crew already nudged them today. */
  nudged: boolean
}

/** The asker's crew, as it stands today. */
export type Crew = {
  id: string
  name: string
  members: CrewMember[]
  /** Crew points today: the sum of the members' scores. */
  today: number
  /** Crew points this week, Monday to Sunday. */
  week: number
  /** Place among this week's crews, 1 for the top; undefined before any points. */
  rank: number | undefined
  /** Crews with points this week. */
  crews: number
  /** Days in a row every member played. 0 once a day is missed. */
  streak: number
  best: number
}

/** An invitation to join someone's crew. */
export type CrewInvite = {crewId: string; crew: string; from: string}

/** The asker's crew, if any, and the invitations waiting for them. */
export type CrewInfo = {crew: Crew | undefined; invites: CrewInvite[]}

export const NO_CREW: CrewInfo = {crew: undefined, invites: []}

/** A crew name, tidied: 2 to 24 letters, digits, spaces and a little punctuation. */
export function cleanCrewName(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return
  const name = raw.trim().replace(/\s+/g, ' ')
  if (name.length < 2 || name.length > 24) return
  return /^[\p{L}\p{N}][\p{L}\p{N} '.&!-]*$/u.test(name) ? name : undefined
}

/** How many of the crew have played today, as "2 of 3 played". */
export function playedText(c: Readonly<Crew>): string {
  const n = c.members.filter(m => m.score !== undefined).length
  return `${n} of ${c.members.length} played`
}

/** The comment that tags the invited players. */
export function crewInviteText(
  from: string,
  to: readonly string[],
  crew: string,
): string {
  const who = to.map(n => `u/${n}`).join(' and ')
  return `${who}, u/${from} wants you in their Nonet crew ${CREW_MARK} ${crew}. Open today's cube in this post to join.`
}

/** The private message a nudge sends. */
export function nudgeText(
  from: string,
  crew: string,
  played: number,
  of: number,
): {subject: string; text: string} {
  return {
    subject: `${CREW_MARK} ${crew} is waiting on you`,
    text: `u/${from} nudged you: ${played} of ${of} in ${crew} have played today's Nonet cube. Play it before midnight Pacific to keep the crew streak going.`,
  }
}

/** One crew's line in the weekly post. */
export function crewRowText(
  rank: number,
  name: string,
  points: number,
  members: readonly string[],
): string {
  return `${rank}. ${CREW_MARK} ${name} · ${points.toLocaleString('en-GB')} (${members.map(m => `u/${m}`).join(', ')})`
}
