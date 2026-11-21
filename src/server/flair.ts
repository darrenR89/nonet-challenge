// Streak flair: from three days in a row, a player's user flair in the subreddit shows their streak,
// and after a missed day it shows their best. Flair a player or a mod set some other way is left alone.
import {reddit, redis} from '@devvit/web/server'
import type {Streak} from '../shared/api.ts'
import {CREW_MARK, crewFlair} from '../shared/crew.ts'
import {addDays} from '../shared/scoring.ts'
import {getStreak, namesOf} from './board.ts'

/** Streak flair starts at this many days in a row. */
export const FLAIR_FROM = 3
/** Lapsed streaks moved to "best" each night, at most; the rest wait for the next night. */
export const LAPSE_MAX = 100

/** The flair for a streak as it stands, or undefined for none yet. */
export function streakFlair(st: Streak): string | undefined {
  if (st.current >= FLAIR_FROM) return `Nonet · ${st.current}-day streak`
  if (st.best >= FLAIR_FROM) return `Nonet · best streak ${st.best}`
  return undefined
}

// userId → the flair text the app last set, or OFF once someone else changed it
const flairKey = 'flair'
const OFF = '-'
// players showing a live streak: userId → the day number it was last set
const liveKey = 'flair:live'
const dayNo = (day: string): number =>
  Date.parse(`${day}T00:00:00Z`) / 86_400_000

async function flairNow(uid: string, sub: string): Promise<string | undefined> {
  const user = await reddit.getUserById(uid as `t2_${string}`)
  const f = await user?.getUserFlairBySubreddit(sub)
  return f?.flairText || undefined
}

/** Sets a player's flair, unless it was changed by someone else since the app last set it. */
async function setFlair(
  uid: string,
  name: string,
  sub: string,
  text: string,
): Promise<boolean> {
  const mine = await redis.hGet(flairKey, uid)
  if (mine === OFF) return false
  if (mine === text) return true
  const now = await flairNow(uid, sub)
  if (now && now !== mine) {
    await redis.hSet(flairKey, {[uid]: OFF})
    await redis.zRem(liveKey, [uid])
    return false
  }
  await reddit.setUserFlair({
    subredditName: sub,
    username: name,
    text,
    backgroundColor: '#121316',
    textColor: 'light',
  })
  await redis.hSet(flairKey, {[uid]: text})
  return true
}

/** Updates a player's flair after a counted run. */
export async function flairAfterSolve(
  day: string,
  uid: string,
  name: string,
  sub: string,
  st: Streak,
  wrap?: (streak: string | undefined) => string,
): Promise<void> {
  const text = wrap ? wrap(streakFlair(st)) : streakFlair(st)
  if (!text) return
  const set = await setFlair(uid, name, sub, text)
  if (set && st.current >= FLAIR_FROM)
    await redis.zAdd(liveKey, {member: uid, score: dayNo(day)})
}

/** At the start of a day: streak flair for anyone who missed yesterday moves to their best. */
export async function lapseFlair(day: string, sub: string): Promise<void> {
  const cutoff = dayNo(addDays(day, -1))
  const rows = await redis.zRange(liveKey, 0, LAPSE_MAX - 1, {by: 'rank'})
  const gone = rows.filter(r => r.score < cutoff).map(r => r.member)
  const names = await namesOf(gone)
  for (const [i, uid] of gone.entries()) {
    await redis.zRem(liveKey, [uid])
    const name = names[i]
    const streak = streakFlair(await getStreak(day, uid))
    // a crew member's flair keeps the crew's name in front
    const mine = await redis.hGet(flairKey, uid)
    const crew = mine?.startsWith(`${CREW_MARK} `)
      ? mine.slice(CREW_MARK.length + 1).split(' · ')[0]
      : undefined
    const text = crew ? crewFlair(crew, streak) : streak
    if (name && text)
      await setFlair(uid, name, sub, text).catch(err =>
        console.warn(`flair for ${name} failed: ${err}`),
      )
  }
}
