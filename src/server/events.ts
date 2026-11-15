// Events: themed date ranges with their own board and, optionally, teams
// (a Super Bowl side against side, a country against country...).
import {redis} from '@devvit/web/server'
import type {EventState, GameEvent, Team, TeamStanding} from '../shared/api.ts'
import {inRange, isDay} from '../shared/scoring.ts'
import {boardKey, readBoard} from './board.ts'

const eventsKey = 'events'
const teamOfKey = (id: string): string => `ev:${id}:team`
const teamScoreKey = (id: string): string => `ev:${id}:tscore`
const teamCountKey = (id: string): string => `ev:${id}:tcount`
// players on each side who have scored at least once; averages divide by these
const teamScorersKey = (id: string): string => `ev:${id}:tscorers`
const scoredKey = (id: string): string => `ev:${id}:scored`

export async function listEvents(): Promise<GameEvent[]> {
  const all = await redis.hGetAll(eventsKey)
  return Object.values(all)
    .map(v => JSON.parse(v) as GameEvent)
    .sort((a, b) => a.start.localeCompare(b.start))
}

export async function getEvent(id: string): Promise<GameEvent | undefined> {
  const v = await redis.hGet(eventsKey, id)
  return v ? (JSON.parse(v) as GameEvent) : undefined
}

/** The event running on a day. If two overlap, the one that started last. */
export async function activeEvent(day: string): Promise<GameEvent | undefined> {
  const live = (await listEvents()).filter(e => inRange(day, e.start, e.end))
  return live.at(-1)
}

export async function saveEvent(e: GameEvent): Promise<void> {
  await redis.hSet(eventsKey, {[e.id]: JSON.stringify(e)})
}

/** Ends an event today by moving its last day; its board stays readable. */
export async function endEvent(id: string, day: string): Promise<boolean> {
  const e = await getEvent(id)
  if (!e) return false
  // days are YYYY-MM-DD, so string order is date order: clamp today into the event's range
  const [end] = [[day, e.start].sort().at(-1) ?? day, e.end].sort()
  await saveEvent({...e, end: end ?? e.end})
  return true
}

export async function deleteEvent(id: string): Promise<void> {
  await redis.hDel(eventsKey, [id])
}

const daysBetween = (a: string, b: string): number =>
  Math.round(
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000,
  )

/** Joins a team. A player's first pick holds for the whole event. */
export async function joinTeam(
  e: GameEvent,
  uid: string,
  team: string,
): Promise<string> {
  if (!e.teams.some(t => t.id === team)) throw Error('no such team')
  const set = await redis.hSetNX(teamOfKey(e.id), uid, team)
  if (set) {
    await redis.hIncrBy(teamCountKey(e.id), team, 1)
    return team
  }
  return (await redis.hGet(teamOfKey(e.id), uid)) ?? team
}

/** Adds a scored run to the event: its board and the player's team. */
export async function addToEvent(
  e: GameEvent,
  uid: string,
  total: number,
): Promise<void> {
  const pts = Math.round(total * (e.bonusMult || 1))
  await redis.zIncrBy(boardKey.event(e.id), uid, pts)
  if (!e.teams.length) return
  const team = await redis.hGet(teamOfKey(e.id), uid)
  if (!team) return
  await redis.hIncrBy(teamScoreKey(e.id), team, pts)
  if (await redis.hSetNX(scoredKey(e.id), uid, team))
    await redis.hIncrBy(teamScorersKey(e.id), team, 1)
}

export async function teamStandings(e: GameEvent): Promise<TeamStanding[]> {
  if (!e.teams.length) return []
  const scores = await redis.hGetAll(teamScoreKey(e.id))
  const counts = await redis.hGetAll(teamCountKey(e.id))
  const scorers = await redis.hGetAll(teamScorersKey(e.id))
  const rows = e.teams.map(team => {
    const sum = Number(scores[team.id] ?? 0)
    const players = Number(counts[team.id] ?? 0)
    const scored = Number(scorers[team.id] ?? 0)
    const score =
      e.teamScoring === 'avg' ? (scored ? Math.round(sum / scored) : 0) : sum
    return {team, score, players, rank: 0}
  })
  rows.sort((a, b) => b.score - a.score)
  rows.forEach((r, i) => {
    r.rank = i
      ? r.score === rows[i - 1]?.score
        ? (rows[i - 1]?.rank ?? 1)
        : i + 1
      : 1
  })
  return rows
}

export async function eventState(
  e: GameEvent,
  day: string,
  uid: string | undefined,
): Promise<EventState> {
  const board = await readBoard(boardKey.event(e.id), e.title, uid)
  const myTeam = uid ? await redis.hGet(teamOfKey(e.id), uid) : undefined
  return {
    event: e,
    dayOf: Math.max(1, daysBetween(e.start, day) + 1),
    days: daysBetween(e.start, e.end) + 1,
    board,
    teams: await teamStandings(e),
    myTeam: myTeam ?? undefined,
  }
}

const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24) || 'team'

/**
 * Teams from text, one per line: a name, then optionally a colour.
 * "Chiefs #E31837" becomes {id: chiefs, name: Chiefs, color: #E31837}.
 */
export function parseTeams(text: string): Team[] {
  const out: Team[] = []
  for (const raw of text.split(/\r?\n|,/)) {
    const line = raw.trim()
    if (!line) continue
    const m = line.match(/^(.*?)\s*(#[0-9a-f]{3,8})?$/i)
    const name = (m?.[1] ?? line).trim()
    if (!name) continue
    let id = slug(name)
    while (out.some(t => t.id === id)) id += '-2'
    out.push({id, name, color: m?.[2] ?? ''})
  }
  return out
}

export type EventForm = {
  title?: unknown
  tagline?: unknown
  start?: unknown
  end?: unknown
  teams?: unknown
  teamScoring?: unknown
  accent?: unknown
  bonusMult?: unknown
  postTitle?: unknown
}

/** Builds an event from the moderator's form, or explains what's wrong. */
export function eventFromForm(v: EventForm, today: string): GameEvent | string {
  const str = (x: unknown): string => (typeof x === 'string' ? x.trim() : '')
  const pick = (x: unknown): string => (Array.isArray(x) ? str(x[0]) : str(x))
  const title = str(v.title)
  if (!title) return 'Give the event a title.'
  const start = str(v.start) || today
  const end = str(v.end) || start
  if (!isDay(start) || !isDay(end))
    return 'Dates must look like 2027-02-07 (year-month-day, Pacific time).'
  if (end < start) return 'The end date is before the start date.'
  const teams = parseTeams(str(v.teams))
  if (teams.length === 1)
    return 'Add at least two teams, or none for a solo event.'
  const accent = str(v.accent)
  if (accent && !/^#[0-9a-f]{3,8}$/i.test(accent))
    return 'The accent colour must be a hex colour like #d50a0a.'
  const mult = Number(v.bonusMult ?? 1)
  return {
    id: `${start}-${slug(title)}`,
    title,
    tagline: str(v.tagline),
    start,
    end,
    accent,
    teams,
    teamScoring: pick(v.teamScoring) === 'sum' ? 'sum' : 'avg',
    bonusMult: Number.isFinite(mult) && mult > 0 ? Math.min(mult, 5) : 1,
    postTitle: str(v.postTitle),
  }
}
