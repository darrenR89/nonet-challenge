// The cube list for moderators: each stored day's clues and answer, sent privately to the
// mod who asked. Cubes stay in Redis, which players can't read; this is the only way out.
import {redis} from '@devvit/web/server'
import {LEVEL_NAMES, shortDate} from '../shared/scoring.ts'
import {cubeNumber, type Day, ensureDay} from './cube.ts'

/** How many days a list holds, newest first. Keeps the message under Reddit's limit. */
export const LIST_DAYS = 30

/** A cube's 54 squares as six faces of nine, with a dot for an empty square. */
export function faces(cells: readonly number[]): string {
  const out: string[] = []
  for (let f = 0; f < 6; f++)
    out.push(
      cells
        .slice(f * 9, f * 9 + 9)
        .map(v => (v ? String(v) : '.'))
        .join(''),
    )
  return out.join(' ')
}

/** One day in the list: its number, date and level, then its clues and answer. */
export function dayText(day: string, d: Pick<Day, 'base' | 'level'>): string {
  return [
    `**#${cubeNumber(day)} · ${shortDate(day)} · ${LEVEL_NAMES[d.level] ?? ''}** (${day})`,
    '',
    `    clues   ${faces(d.base.given)}`,
    `    answer  ${faces(d.base.sol)}`,
  ].join('\n')
}

/** The days that have a stored cube, newest first, from the record of cubes already used. */
export async function storedDays(): Promise<string[]> {
  const seen = await redis.hGetAll('seen')
  return [...new Set(Object.values(seen))]
    .filter(d => /^\d{4}-\d\d-\d\d$/.test(d))
    .sort()
    .reverse()
    .slice(0, LIST_DAYS)
}

/** The whole message: a short header, then each stored day. */
export async function cubeList(): Promise<{subject: string; text: string}> {
  const days = await storedDays()
  const parts = [
    `The last ${days.length} Nonet cubes stored in this subreddit, newest first. Faces run 1 to 6, nine squares each, left to right and top to bottom. Clues are the 0-turn cube's; a dot is an empty square. Keep this private: it holds the answers.`,
  ]
  for (const day of days) parts.push(dayText(day, await ensureDay(day)))
  return {subject: 'Nonet cube list', text: parts.join('\n\n')}
}
