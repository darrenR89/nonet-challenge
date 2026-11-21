// Nonet Crew: a standing team of up to three. Each member plays the daily cube on their
// own time, and the crew's score for a day is the sum of its members' scores.
// Shared by the server (rules) and the game (wording).

/** Members in a full crew. */
export const CREW_SIZE = 3

/** Invites one crew can send in a day. */
export const MAX_CREW_INVITES = 5

/** The crew board (ranks in the game, top crews in Monday's post) shows from this many crews in a week. */
export const CREW_BOARD_FROM = 5

/** After this many missed days in a row, the rest of the crew can open a member's seat. */
export const QUIET_DAYS = 3

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
  /** True if they turned crew nudges off. */
  nudgesOff: boolean
  /** The Monday their runs start counting, for someone who joined an older crew mid-week. */
  countsFrom: string | undefined
  /** Days in a row they haven't played, not counting today. */
  missed: number
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
  /** Place among this week's crews, 1 for the top; undefined before any points or while there are few crews. */
  rank: number | undefined
  /** Crews with points this week. */
  crews: number
  /** Days in a row every member played. 0 once a day is missed. */
  streak: number
  best: number
  /** True once someone in the crew posted today's crew result comment. */
  posted: boolean
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

/** Members whose runs count for the crew today (not those waiting for Monday). */
export const countingMembers = (c: Readonly<Crew>): CrewMember[] =>
  c.members.filter(m => !m.countsFrom)

/** How many of the crew have played today, as "2 of 3 played". */
export function playedText(c: Readonly<Crew>): string {
  const counting = countingMembers(c)
  const n = counting.filter(m => m.score !== undefined).length
  return `${n} of ${counting.length} played`
}

/** True once every member who counts today has played. */
export const allPlayed = (c: Readonly<Crew>): boolean =>
  countingMembers(c).every(m => m.score !== undefined)

/** The comment a crew posts when everyone has played: spoiler-free, no times or numbers placed. */
export function crewResultText(
  name: string,
  points: number,
  of: number,
  streak: number,
): string {
  const bits = [
    `${CREW_MARK} ${name}: ${of} of ${of} played`,
    `${points.toLocaleString('en-GB')} crew points`,
  ]
  if (streak > 1) bits.push(`${streak}-day crew streak`)
  return `${bits.join(' · ')}.`
}

/** A crew's user flair: the crew's name, with the player's streak when they have one. */
export function crewFlair(name: string, streak: string | undefined): string {
  const tail = streak?.replace(/^Nonet · /, '')
  return tail ? `${CREW_MARK} ${name} · ${tail}` : `${CREW_MARK} ${name}`
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

/** The private message to a player whose seat their crew opened. */
export function seatText(crew: string): {subject: string; text: string} {
  return {
    subject: `Your seat in ${CREW_MARK} ${crew} is open`,
    text: `You hadn't played Nonet for ${QUIET_DAYS} days, so ${crew} opened your seat to invite someone else. Your past points stay with the crew. Start or join a crew from any daily cube when you're back.`,
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
