// Nonet Crew: up to three players whose daily scores add up. A player is in one crew
// at a time. A score counts for the crew the player is in when they finish (or join,
// if they finished earlier that day), and for one crew a day at most, so hopping
// between crews can't count a run twice.
import {redis} from '@devvit/web/server'
import {
  CREW_BOARD_FROM,
  CREW_SIZE,
  type Crew,
  type CrewInfo,
  type CrewInvite,
  MAX_CREW_INVITES,
  QUIET_DAYS,
} from '../shared/crew.ts'
import {addDays, weekKey} from '../shared/scoring.ts'
import {DAY_TTL, getDayRecord, namesOf} from './board.ts'

const crewKey = (id: string): string => `crew:${id}`
/** A crew's members: user id → their place in joining order, zero-padded. */
const membersKey = (id: string): string => `crew:${id}:m`
/** Member scores that counted for a crew on a day: user id → score. */
const crewDayKey = (id: string, day: string): string => `crew:${id}:d:${day}`
/** Which crew a player is in: user id → crew id. */
const crewOfKey = 'crewOf'
/** A player's open invitations: crew id → inviter's user id. */
const invitesKey = (uid: string): string => `crewInv:${uid}`
/** Which crew each player's score counted for on a day: user id → crew id. */
const countedKey = (day: string): string => `crewCounted:${day}`
/** Invites each crew sent on a day: crew id → count. */
const sentKey = (day: string): string => `crewSent:${day}`
/** Nudges on a day: user id nudged → who nudged them. */
const nudgeKey = (day: string): string => `crewNudge:${day}`
/** The first day each member's runs count for the crew: user id → day. Joining an older crew mid-week counts from the next Monday. */
const fromKey = (id: string): string => `crew:${id}:from`
/** The last day each member's run counted for the crew: user id → day. */
const lastKey = (id: string): string => `crew:${id}:last`
/** Players who turned crew nudges off: user id → 1. */
const noNudgeKey = 'crewNoNudge'
/** Crews that posted today's result comment: crew id → who posted it. */
const postedKey = (day: string): string => `crewPosted:${day}`
/** The week's crew board: crew id → points. */
export const crewBoardKey = (week: string): string => `lbc:w:${week}`
const INVITE_TTL = 60 * 60 * 24 * 7

export async function crewOf(uid: string): Promise<string | undefined> {
  return (await redis.hGet(crewOfKey, uid)) ?? undefined
}

async function memberIds(id: string): Promise<string[]> {
  return Object.keys(await redis.hGetAll(membersKey(id)))
}

const dayNo = (day: string): number =>
  Math.round(Date.parse(`${day}T00:00:00Z`) / 86_400_000)

/** The Monday after the week `day` falls in. */
const nextMonday = (day: string): string => {
  let d = addDays(day, 1)
  while (weekKey(d) === weekKey(day)) d = addDays(d, 1)
  return d
}

/** Days in a row a member hasn't played since they joined, not counting today. */
function missedDays(
  day: string,
  joined: string | undefined,
  last: string | undefined,
): number {
  if (last === day) return 0
  if (last && (!joined || last >= joined))
    return Math.max(0, dayNo(day) - dayNo(last) - 1)
  return joined ? Math.max(0, dayNo(day) - dayNo(joined)) : 0
}

const scoreOf = async (
  day: string,
  uid: string,
): Promise<number | undefined> => {
  const s = (await getDayRecord(day, uid)).score
  return s === undefined || s === '' ? undefined : Number(s)
}

/** Counts a member's finished run for their crew, once a day. Safe to call again. */
export async function addToCrew(day: string, uid: string): Promise<void> {
  const id = await crewOf(uid)
  if (!id) return
  const score = await scoreOf(day, uid)
  if (score === undefined) return
  // a member who joined an older crew mid-week counts from the next Monday
  const from = await redis.hGet(fromKey(id), uid)
  if (from && day < from) return
  if (!(await redis.hSetNX(countedKey(day), uid, id))) return
  await redis.expire(countedKey(day), DAY_TTL)
  await redis.hSet(crewDayKey(id, day), {[uid]: String(score)})
  await redis.expire(crewDayKey(id, day), DAY_TTL)
  await redis.hSet(lastKey(id), {[uid]: day})
  await redis.zIncrBy(crewBoardKey(weekKey(day)), id, score)
  await bumpCrewStreak(id, day)
}

/** Members whose runs count for the crew today. */
async function countingIds(id: string, day: string): Promise<string[]> {
  const members = await memberIds(id)
  const from = await redis.hGetAll(fromKey(id))
  return members.filter(m => !from[m] || from[m] <= day)
}

/** Moves the crew streak on once every member has played today. */
async function bumpCrewStreak(id: string, day: string): Promise<void> {
  const members = await countingIds(id, day)
  const played = await redis.hGetAll(crewDayKey(id, day))
  if (!members.length || members.some(m => played[m] === undefined)) return
  const h = await redis.hGetAll(crewKey(id))
  const last = h.last ?? ''
  if (last === day) return
  const streak = last === addDays(day, -1) ? Number(h.streak ?? 0) + 1 : 1
  await redis.hSet(crewKey(id), {
    streak: String(streak),
    best: String(Math.max(streak, Number(h.best ?? 0))),
    last: day,
  })
}

export type CrewError =
  | 'in-crew'
  | 'no-crew'
  | 'full'
  | 'no-invite'
  | 'too-many'
  | 'played'
  | 'nudged'
  | 'nudges-off'
  | 'not-quiet'
  | 'not-all-played'
  | 'posted'

/** Starts a crew with the asker in it. */
export async function createCrew(
  day: string,
  uid: string,
  name: string,
): Promise<string | CrewError> {
  if (await crewOf(uid)) return 'in-crew'
  const n = await redis.hIncrBy('crewSeq', 'n', 1)
  const id = `c${n}`
  await redis.hSet(crewKey(id), {name, created: day})
  await join(day, id, uid)
  return id
}

async function join(day: string, id: string, uid: string): Promise<void> {
  const n = await redis.hIncrBy(crewKey(id), 'joins', 1)
  await redis.hSet(membersKey(id), {[uid]: String(n).padStart(4, '0')})
  // a crew's line-up locks for the week: joining a crew from an earlier week counts from Monday
  const created = (await redis.hGet(crewKey(id), 'created')) ?? day
  const from = weekKey(created) === weekKey(day) ? created : nextMonday(day)
  await redis.hSet(fromKey(id), {[uid]: from})
  await redis.hSet(crewOfKey, {[uid]: id})
  await redis.hDel(invitesKey(uid), [id])
  // a run finished before joining counts, unless it already counted for another crew
  await addToCrew(day, uid)
}

/**
 * Invites a player to the asker's crew. Refused if the crew is full, the player is
 * already in a crew, or the crew has sent today's invites.
 */
export async function inviteToCrew(
  day: string,
  uid: string,
  them: string,
): Promise<{crewId: string; crew: string} | CrewError> {
  const id = await crewOf(uid)
  if (!id) return 'no-crew'
  if ((await memberIds(id)).length >= CREW_SIZE) return 'full'
  if (await crewOf(them)) return 'in-crew'
  if ((await redis.hIncrBy(sentKey(day), id, 1)) > MAX_CREW_INVITES)
    return 'too-many'
  await redis.expire(sentKey(day), DAY_TTL)
  await redis.hSet(invitesKey(them), {[id]: uid})
  await redis.expire(invitesKey(them), INVITE_TTL)
  return {crewId: id, crew: (await redis.hGet(crewKey(id), 'name')) ?? 'crew'}
}

/** Accepts or declines an invitation. A player in a crew leaves it first. */
export async function answerInvite(
  day: string,
  uid: string,
  id: string,
  accept: boolean,
): Promise<'ok' | CrewError> {
  if ((await redis.hGet(invitesKey(uid), id)) === undefined) return 'no-invite'
  if (!accept) {
    await redis.hDel(invitesKey(uid), [id])
    return 'ok'
  }
  if (await crewOf(uid)) return 'in-crew'
  // a crew whose members all left is closed, and its invitations with it
  if (await redis.hGet(crewKey(id), 'closed')) {
    await redis.hDel(invitesKey(uid), [id])
    return 'no-invite'
  }
  if ((await memberIds(id)).length >= CREW_SIZE) {
    await redis.hDel(invitesKey(uid), [id])
    return 'full'
  }
  await join(day, id, uid)
  return 'ok'
}

/** Leaves the asker's crew. Their points stay with it; an empty crew closes. */
export async function leaveCrew(
  day: string,
  uid: string,
): Promise<'ok' | CrewError> {
  const id = await crewOf(uid)
  if (!id) return 'no-crew'
  await dropMember(day, id, uid)
  return 'ok'
}

async function dropMember(day: string, id: string, uid: string): Promise<void> {
  await redis.hDel(membersKey(id), [uid])
  await redis.hDel(fromKey(id), [uid])
  await redis.hDel(lastKey(id), [uid])
  await redis.hDel(crewOfKey, [uid])
  if (!(await memberIds(id)).length) {
    await redis.hSet(crewKey(id), {closed: day})
    await redis.zRem(crewBoardKey(weekKey(day)), [id])
  }
}

/**
 * Opens the seat of a crewmate who has missed QUIET_DAYS days in a row, so the crew can
 * invite someone else. Their past points stay with the crew.
 */
export async function openSeat(
  day: string,
  uid: string,
  them: string,
): Promise<{crew: string} | CrewError> {
  const id = await crewOf(uid)
  if (!id || id !== (await crewOf(them)) || uid === them) return 'no-crew'
  const joined = await redis.hGet(fromKey(id), them)
  const last = await redis.hGet(lastKey(id), them)
  const created = await redis.hGet(crewKey(id), 'created')
  if (missedDays(day, joined ?? created, last) < QUIET_DAYS) return 'not-quiet'
  await dropMember(day, id, them)
  return {crew: (await redis.hGet(crewKey(id), 'name')) ?? 'crew'}
}

/** Turns crew nudges to the asker on or off. */
export async function setNudges(uid: string, on: boolean): Promise<void> {
  if (on) await redis.hDel(noNudgeKey, [uid])
  else await redis.hSet(noNudgeKey, {[uid]: '1'})
}

/**
 * Claims today's crew result comment, once every counting member has played. Returns the
 * line to post, or why not.
 */
export async function claimCrewPost(
  day: string,
  uid: string,
): Promise<
  {name: string; today: number; of: number; streak: number} | CrewError
> {
  const id = await crewOf(uid)
  if (!id) return 'no-crew'
  const members = await countingIds(id, day)
  const played = await redis.hGetAll(crewDayKey(id, day))
  if (members.some(m => played[m] === undefined)) return 'not-all-played'
  if (!(await redis.hSetNX(postedKey(day), id, uid))) return 'posted'
  await redis.expire(postedKey(day), DAY_TTL)
  const h = await redis.hGetAll(crewKey(id))
  return {
    name: h.name ?? 'crew',
    today: members.reduce((n, m) => n + Number(played[m] ?? 0), 0),
    of: members.length,
    streak: h.last === day ? Number(h.streak ?? 0) : 0,
  }
}

/** Marks a crewmate nudged today. One nudge a day reaches each player, whoever sends it. */
export async function nudge(
  day: string,
  uid: string,
  them: string,
): Promise<{crew: string; played: number; of: number} | CrewError> {
  const id = await crewOf(uid)
  if (!id || id !== (await crewOf(them)) || uid === them) return 'no-crew'
  if ((await scoreOf(day, them)) !== undefined) return 'played'
  if (await redis.hGet(noNudgeKey, them)) return 'nudges-off'
  if (!(await redis.hSetNX(nudgeKey(day), them, uid))) return 'nudged'
  await redis.expire(nudgeKey(day), DAY_TTL)
  const members = await countingIds(id, day)
  const played = Object.keys(await redis.hGetAll(crewDayKey(id, day)))
  return {
    crew: (await redis.hGet(crewKey(id), 'name')) ?? 'crew',
    played: members.filter(m => played.includes(m)).length,
    of: members.length,
  }
}

/** A player's crew as it stands today, and the invitations waiting for them. */
export async function crewInfo(day: string, uid: string): Promise<CrewInfo> {
  return {crew: await crewFor(day, uid), invites: await invitesFor(uid)}
}

async function invitesFor(uid: string): Promise<CrewInvite[]> {
  const inv = await redis.hGetAll(invitesKey(uid))
  const ids = Object.keys(inv)
  const from = await namesOf(ids.map(id => inv[id] ?? ''))
  const out: CrewInvite[] = []
  for (const [i, id] of ids.entries()) {
    const h = await redis.hGetAll(crewKey(id))
    if (h.closed || !h.name) continue
    out.push({crewId: id, crew: h.name, from: from[i] ?? 'someone'})
  }
  return out
}

async function crewFor(day: string, uid: string): Promise<Crew | undefined> {
  const id = await crewOf(uid)
  if (!id) return
  const h = await redis.hGetAll(crewKey(id))
  const joined = await redis.hGetAll(membersKey(id))
  // in the order they joined
  const ids = Object.keys(joined).sort(
    (a, b) =>
      (joined[a] ?? '').localeCompare(joined[b] ?? '') || a.localeCompare(b),
  )
  const names = await namesOf(ids)
  const counted = await redis.hGetAll(crewDayKey(id, day))
  const nudged = await redis.hGetAll(nudgeKey(day))
  const from = await redis.hGetAll(fromKey(id))
  const last = await redis.hGetAll(lastKey(id))
  const off = await redis.hMGet(noNudgeKey, ids)
  const members = ids.map((m, i) => {
    const s = counted[m]
    const f = from[m]
    return {
      id: m,
      name: names[i] ?? 'someone',
      score: s === undefined ? undefined : Number(s),
      me: m === uid,
      nudged: nudged[m] !== undefined,
      nudgesOff: Boolean(off[i]),
      countsFrom: f && f > day ? f : undefined,
      missed: missedDays(day, f ?? h.created, last[m]),
    }
  })
  const board = crewBoardKey(weekKey(day))
  const week = await redis.zScore(board, id)
  const crews = await redis.zCard(board)
  const asc =
    week === undefined || crews < CREW_BOARD_FROM
      ? undefined
      : await redis.zRank(board, id)
  const lastDay = h.last ?? ''
  const alive = lastDay === day || lastDay === addDays(day, -1)
  return {
    id,
    name: h.name ?? 'crew',
    members,
    today: Object.values(counted).reduce((n, s) => n + Number(s), 0),
    week: Math.round(week ?? 0),
    rank: asc === undefined ? undefined : crews - asc,
    crews,
    streak: alive ? Number(h.streak ?? 0) : 0,
    best: Number(h.best ?? 0),
    posted: (await redis.hGet(postedKey(day), id)) !== undefined,
  }
}

/** The week's top crews, with their current members' names, for the weekly post. */
export async function topCrews(
  week: string,
  top: number,
): Promise<{name: string; points: number; members: string[]}[]> {
  // a crew board with only a handful of crews looks empty, so it waits for a few
  if ((await redis.zCard(crewBoardKey(week))) < CREW_BOARD_FROM) return []
  const rows = await redis.zRange(crewBoardKey(week), 0, top - 1, {
    by: 'rank',
    reverse: true,
  })
  const out: {name: string; points: number; members: string[]}[] = []
  for (const r of rows) {
    const ids = await memberIds(r.member)
    const names = await namesOf(ids)
    out.push({
      name: (await redis.hGet(crewKey(r.member), 'name')) ?? 'crew',
      points: Math.round(r.score),
      members: names.map(n => n ?? 'someone'),
    })
  }
  return out
}
