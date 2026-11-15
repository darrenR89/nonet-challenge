// The daily cube: one seeded cube per day (midnight to midnight Pacific), the same for every player,
// stored in Redis so it never changes once made, and never a repeat.
import {redis} from '@devvit/web/server'
import {type Base, fingerprint, makeDay, type Puzzle} from '../shared/model.js'
import {dayOfYear, levelOf} from '../shared/scoring.ts'

/** A day's cube: its fill level (0 Easy, 1 Medium, 2 Hard) and one puzzle per tier (0 to 3 turns). */
export type Day = {base: Base; level: number; tiers: Puzzle[]; seed: string}

// v2: cubes have a fill level, and tier n means n turns (v1 tiers were 1 to 4 turns)
// Cubes made before layouts have no layout field and were made on Mirror; the game reads that as Mirror,
// so stored cubes stay valid and the key doesn't change.
const cubeKey = (day: string): string => `cube:v2:${day}`
/** Answer fingerprints already used, to keep cubes from repeating. */
const seenKey = 'seen'
/** A secret per subreddit, so nobody can build tomorrow's cube from the code. */
const secretKey = 'secret'

async function secret(): Promise<string> {
  const have = await redis.get(secretKey)
  if (have) return have
  const fresh = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
  await redis.set(secretKey, fresh, {nx: true})
  return (await redis.get(secretKey)) ?? fresh
}

/** Gets a day's cube, making and storing it the first time it's asked for. */
export async function ensureDay(day: string): Promise<Day> {
  const stored = await redis.get(cubeKey(day))
  if (stored) return JSON.parse(stored) as Day
  const sec = await secret()
  for (let salt = 0; salt < 50; salt++) {
    const seed = `${sec}:${day}:${salt}`
    const made = makeDay(seed, levelOf(day))
    const fp = fingerprint(made.base.sol)
    const owner = await redis.hGet(seenKey, fp)
    if (owner && owner !== day) continue
    await redis.hSetNX(seenKey, fp, day)
    const value: Day = {...made, seed}
    // if another request made it first, keep theirs so everyone plays one cube
    await redis.set(cubeKey(day), JSON.stringify(value), {nx: true})
    const saved = await redis.get(cubeKey(day))
    return saved ? (JSON.parse(saved) as Day) : value
  }
  throw Error(`no fresh cube for ${day}`)
}

export async function dayPuzzle(day: string, tier: number): Promise<Puzzle> {
  const d = await ensureDay(day)
  const p = d.tiers[tier]
  if (!p) throw Error(`no tier ${tier}`)
  return p
}

/** Empty squares a solver fills in Stage 2 at this tier. */
export const blanksOf = (p: Readonly<Puzzle>): number =>
  p.given.filter(v => !v).length

/** Today's cube number: its day of the year, so 1 January is cube 1. */
export const cubeNumber = (day: string): number => dayOfYear(day)
