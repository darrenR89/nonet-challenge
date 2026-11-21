// Streak rules, shared by player streaks and crew streaks. A streak counts days in a row
// with a finished cube, with one rest day a week: a single missed day is covered for free,
// once per Monday-to-Sunday week, so one bad day doesn't wipe out a long run.

import {addDays, weekKey} from './scoring.ts'

/** What's stored for a streak: the last day played, the count, and the week a rest day was last used. */
export type StreakState = {last: string; count: number; restWeek: string}

/**
 * The missed day a rest day would cover today, or undefined if there is none: yesterday was
 * missed, the day before was played, and no rest day was used in yesterday's week.
 */
export function restDayFor(
  last: string,
  day: string,
  restWeek: string,
): string | undefined {
  if (!last || last !== addDays(day, -2)) return undefined
  const missed = addDays(day, -1)
  return restWeek === weekKey(missed) ? undefined : missed
}

/** The streak after playing on `day`. A covered miss keeps the run going and spends that week's rest day. */
export function playStreak(s: StreakState, day: string): StreakState {
  if (s.last === day) return s
  if (s.last === addDays(day, -1))
    return {last: day, count: s.count + 1, restWeek: s.restWeek}
  const rest = restDayFor(s.last, day, s.restWeek)
  if (rest) return {last: day, count: s.count + 1, restWeek: weekKey(rest)}
  return {last: day, count: 1, restWeek: s.restWeek}
}

/** The streak as it stands on `day`, before playing: 0 once it has lapsed. */
export function liveStreak(s: StreakState, day: string): number {
  if (s.last === day || s.last === addDays(day, -1)) return s.count
  return restDayFor(s.last, day, s.restWeek) ? s.count : 0
}

/** True if this week's rest day has been spent. */
export const restUsed = (s: StreakState, day: string): boolean =>
  s.restWeek === weekKey(day)
