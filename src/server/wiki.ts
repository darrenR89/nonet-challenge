// The subreddit's Nonet wiki page: the short rules, the scoring table, and the records. The app
// writes the whole page, on install, every Monday and from the moderator menu.
import {reddit} from '@devvit/web/server'
import type {Board} from '../shared/api.ts'
import {RETRY_MULT} from '../shared/api.ts'
import {
  LEVEL_NAMES,
  maxTurns,
  shortDate,
  TURN_MULT,
  WEEK_LEVELS,
} from '../shared/scoring.ts'
import {boardKey, readBoard} from './board.ts'
import {FLAIR_FROM} from './flair.ts'
import {longestStreaks, pastWeeks, type WeekRecord} from './records.ts'

export const WIKI_PAGE = 'nonet'
/** Past weeks listed on the page, newest first. */
export const WIKI_WEEKS = 12

export const wikiPath = (sub: string): string => `/r/${sub}/wiki/${WIKI_PAGE}`

const DAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
]
const pts = (n: number): string => n.toLocaleString('en-GB')

function rows(b: Board, unit?: string): string {
  if (!b.top.length) return 'Nobody yet.'
  const of = (n: number): string =>
    unit ? ` ${unit}${n === 1 ? '' : 's'}` : ''
  return b.top
    .map(r => `${r.rank}. u/${r.name} · ${pts(r.score)}${of(r.score)}`)
    .join('\n')
}

function weekRow(w: WeekRecord): string {
  const winner = w.winner
    ? `u/${w.winner.name} · ${pts(w.winner.score)}`
    : 'nobody'
  const spot = w.spot
    ? `u/${w.spot.name} · ${pts(w.spot.score)} on ${shortDate(w.spot.day)}`
    : 'none'
  return `| ${shortDate(w.from)} | ${winner} | ${spot} | ${pts(w.players)} |`
}

export type WikiData = {
  day: string
  flair: boolean
  streaks: Board
  all: Board
  weeks: WeekRecord[]
}

/** The page's markdown. Pure, for tests. */
export function wikiText(d: WikiData): string {
  const levels = DAYS.map((name, i) => {
    const lv = WEEK_LEVELS[i] ?? 0
    return `| ${name} | ${LEVEL_NAMES[lv]} | 0 to ${maxTurns(lv)} |`
  }).join('\n')
  const mult = [0, 1, 2, 3]
    .map(t => {
      const cells = TURN_MULT.map(m =>
        m[t] === undefined ? 'not offered' : `×${m[t]}`,
      )
      return `| ${t} | ${cells.join(' | ')} |`
    })
    .join('\n')
  const flair = d.flair
    ? ` From ${FLAIR_FROM} days in a row your user flair here shows it, like "Nonet · ${FLAIR_FROM}-day streak". Miss a day and it shows your best instead. Flair you or the mods set yourselves is left alone.`
    : ''
  const weeks = d.weeks.slice(0, WIKI_WEEKS)
  const past = weeks.length
    ? `| Week of | The week's top player | Solve of the week | Players |\n|:--|:--|:--|--:|\n${weeks.map(weekRow).join('\n')}`
    : 'The first week is still going.'
  return `# Nonet

One cube a day, the same for everyone, new at midnight Pacific time. Open today's pinned post and press Play. The **How to play** screen in the game (the ? button) has the full rules with pictures; this page is the short version, plus the records.

## A day of Nonet

1. **Pick your turns.** Before you play, choose how far today's cube is scrambled. It stays set until tomorrow.
2. **Dial in.** Turn rows and columns to bring the bold clues home.
3. **Fill in.** Every face holds 1 to 9 once, and every line of nine across three faces holds 1 to 9 once.

Your first finished run each day counts. You get one retry a day, and it multiplies the day's total by ${RETRY_MULT}.

| Day | Fill | Turns on offer |
|:--|:--|:--|
${levels}

## Scoring

Up to 300 points for turns and 200 for speed while dialling in, then up to 300 for speed and 200 for accuracy while filling in (a wrong lock costs 25). +100 if you use no suggested turns, and +50 for each ★ opening square you lock before any other square. With no turns there is no dialling in, so only the fill and the ★ squares score.

Then the total is multiplied by how far you had it turned:

| Turns | ${LEVEL_NAMES.join(' | ')} |
|:--|:--|:--|:--|
${mult}

## Streaks

Finish a cube on days in a row to build a streak.${flair} Lock all three ★ opening squares and you get a look at tomorrow's clues.

## The week

Every day's points add up on the weekly board, Monday to Sunday. Each Monday the weekly top nine go up in a post with the solve of the week: the highest score on a single day.

## Challenges and events

Once you've finished today's cube you can dare another player to beat your score; they have to accept before they play. During an event your points also count on its board and, if it has sides, for the side you pick.

## Records

### Longest streaks

${rows(d.streaks, 'day')}

### All-time points

${rows(d.all)}

### Past weeks

${past}

---

*Written by the Nonet app, last updated ${shortDate(d.day)}. The app rewrites this page every Monday, so edits here are replaced. Keep your own notes on another wiki page.*
`
}

/** Writes the page, making it on the first run. Only mods and approved editors can change it. */
export async function publishWiki(
  day: string,
  sub: string,
  flair: boolean,
): Promise<void> {
  const content = wikiText({
    day,
    flair,
    streaks: await longestStreaks(),
    all: await readBoard(boardKey.all, 'All time', undefined),
    weeks: await pastWeeks(),
  })
  const reason = 'Nonet: rules and records'
  const exists = await reddit
    .getWikiPage(sub, WIKI_PAGE)
    .then(() => true)
    .catch(() => false)
  if (exists) {
    await reddit.updateWikiPage({
      subredditName: sub,
      page: WIKI_PAGE,
      content,
      reason,
    })
    return
  }
  await reddit.createWikiPage({
    subredditName: sub,
    page: WIKI_PAGE,
    content,
    reason,
  })
  await reddit.updateWikiPageSettings({
    subredditName: sub,
    page: WIKI_PAGE,
    listed: true,
    // approved contributors only (the enum is exported as a type only)
    permLevel: 1,
  })
}
