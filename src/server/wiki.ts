// The subreddit's Nonet wiki: a home page and pages for how to play, scoring, streaks, challenges
// and crews, records and questions. The app writes every page, on install, every Monday and from
// the moderator menu.
import {reddit} from '@devvit/web/server'
import type {Board} from '../shared/api.ts'
import {RETRY_MULT} from '../shared/api.ts'
import {
  CREW_BOARD_FROM,
  CREW_MARK,
  CREW_SIZE,
  QUIET_DAYS,
} from '../shared/crew.ts'
import {MAX_CHALLENGES} from '../shared/duel.ts'
import {
  LEVEL_NAMES,
  maxTurns,
  scoreRun,
  shortDate,
  TURN_MULT,
  WEEK_MIX,
} from '../shared/scoring.ts'
import {boardKey, readBoard} from './board.ts'
import {FLAIR_FROM, FOUNDERS} from './flair.ts'
import {longestStreaks, pastWeeks, type WeekRecord} from './records.ts'
import {markdownToHtml} from './wikihtml.ts'

export const WIKI_PAGE = 'nonet'
/** Past weeks listed on the page, newest first. */
export const WIKI_WEEKS = 12

/**
 * A page of the Nonet wiki on old Reddit, where it is shown as written. The newer wiki that
 * reddit.com shows displays pages written by apps as plain text, so links go to old Reddit.
 */
export const wikiUrl = (sub: string, page = WIKI_PAGE): string =>
  `https://old.reddit.com/r/${sub}/wiki/${page}`

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
  /** Founder flair is on. */
  founders?: boolean
  streaks: Board
  all: Board
  weeks: WeekRecord[]
}

/** The wiki's pages, under the main one: path after `nonet/`, and the title in the contents. */
export const WIKI_PAGES = [
  ['how-to-play', 'How to play'],
  ['scoring', 'Scoring'],
  ['streaks', 'Streaks and flair'],
  ['challenges-and-crews', 'Challenges and crews'],
  ['records', 'Records'],
  ['faq', 'Questions'],
] as const
export type WikiPage = (typeof WIKI_PAGES)[number][0]

/** A page's full name: `nonet`, or `nonet/scoring` and so on. */
export const pageName = (page?: WikiPage): string =>
  page ? `${WIKI_PAGE}/${page}` : WIKI_PAGE

/** A link to another page of the Nonet wiki. */
const link = (sub: string, page: WikiPage | undefined, text?: string): string =>
  `[${text ?? WIKI_PAGES.find(([p]) => p === page)?.[1] ?? 'Nonet'}](/r/${sub}/wiki/${pageName(page)})`

/** Every page ends with the way around and a note that the app writes it. */
function foot(d: WikiData, sub: string): string {
  const nav = [
    link(sub, undefined, 'Nonet wiki home'),
    ...WIKI_PAGES.map(([p]) => link(sub, p)),
  ].join(' · ')
  return `---

${nav}

*Written by the Nonet app, last updated ${shortDate(d.day)}. The app rewrites these pages every Monday, so edits here are replaced. Keep your own notes on another wiki page.*
`
}

function levelTable(): string {
  const rows = LEVEL_NAMES.map((name, lv) => {
    const days = WEEK_MIX.filter(l => l === lv).length
    return `| ${name} | ${days} | 0 to ${maxTurns(lv)} |`
  }).join('\n')
  return `| Fill | Days a week | Turns on offer |\n|:--|--:|:--|\n${rows}`
}

function multTable(): string {
  const rows = [0, 1, 2, 3]
    .map(t => {
      const cells = TURN_MULT.map(m =>
        m[t] === undefined ? 'not offered' : `×${m[t]}`,
      )
      return `| ${t} | ${cells.join(' | ')} |`
    })
    .join('\n')
  return `| Turns | ${LEVEL_NAMES.join(' | ')} |\n|:--|:--|:--|:--|\n${rows}`
}

/** A worked example: 2 turns on a Medium day, a little slow on the fill, one wrong lock. */
function example(): string {
  const s = scoreRun(1, 2, {
    turns: 3,
    t1: 30,
    t2: 300,
    blanks: 40,
    wrong: 1,
    hintsUsed: 0,
    starsWon: 2,
  })
  const line = (what: string, n: number): string => `| ${what} | ${pts(n)} |`
  return `Say it's a Medium day and you pick 2 turns. You dial in with 3 turns (one more than you needed) in 30 seconds, then fill the 40 empty squares in 5 minutes with one wrong lock, using no helpers and locking two of the ★ squares first.

| | Points |
|:--|--:|
${line('Fewest turns (2 needed, 3 used)', s.turnPts)}
${line(`Dial-in speed (target ${s.T1} seconds)`, s.sp1)}
${line(`Fill-in speed (target ${Math.round(s.T2 / 60)} minutes)`, s.sp2)}
${line('Accuracy (one wrong lock)', s.acc)}
${line('No helpers', s.bonus)}
${line('Two ★ squares', s.starPts)}
${line('Before the multiplier', s.raw)}
| **×${s.mult} for 2 turns on Medium** | **${pts(s.total)}** |`
}

function home(d: WikiData, sub: string): string {
  const contents = WIKI_PAGES.map(
    ([p, t]) => `- ${link(sub, p, t)}: ${BLURBS[p]}`,
  ).join('\n')
  return `# Nonet

Nonet is a daily sudoku challenge with a twist: it's a 3D cube. Nonet is the sudoku word for a group of nine, and every face of the cube is one. There's one cube a day, the same for everyone, and a new one comes out at midnight Pacific time. Open today's pinned post and press Play.

## A day of Nonet

1. **Pick your turns.** Before you play, choose how far today's cube is scrambled, from 0 to 3 turns. More turns are harder and worth more. Your choice is set until tomorrow.
2. **Dial in.** Rotate rows of the cube until no number clashes on a face or a line.
3. **Fill in.** Every face holds 1 to 9 once, and every line of nine across three faces holds 1 to 9 once.

Your first finished run each day is the one that counts. New here? Press Play and the game starts you on a guided practice cube, with no clock and no score.

${levelTable()}

## In this wiki

${contents}

${foot(d, sub)}`
}

const BLURBS: Record<WikiPage, string> = {
  'how-to-play': 'the two stages, the controls, ★ squares and the helpers.',
  scoring:
    'where every point comes from, the multipliers and a worked example.',
  streaks:
    'keeping a streak going, the rest day, and streak and founder flair.',
  'challenges-and-crews':
    'daring other players, Nonet Crews and the weekly post.',
  records: 'longest streaks, all-time points and past weeks.',
  faq: 'short answers to common questions.',
}

function howToPlay(d: WikiData, sub: string): string {
  return `# How to play

## 1. Dial in

The cube starts scrambled by the number of turns you picked, so some bold clues clash: the same number twice on a face or on a line. Tap a square and use the arrows on its edges to rotate its row or column one step. Keep going until nothing clashes. The grid flashes yellow and you're on to Fill in.

With 0 turns there's nothing to dial in, and you go straight to filling.

## 2. Fill in

Each face holds 1 to 9 once. So does each **line of nine**: a long row that runs straight across three faces. Tap a square to light up its two lines in blue.

- **Pencil or Lock in.** Pencil numbers in as notes, or switch to Lock in when you're sure. A wrong lock shakes, won't stay, and costs 25 points.
- **★ Lock-first squares.** Three squares carry a star. Lock all three before any other square for +50 each, and a look at tomorrow's clues.
- **Dashed squares.** Each ring of twelve squares around the cube holds two lines that share six squares. So the three squares on a line's middle face hold the same three numbers as three squares across the cube. Tap one of those middle squares and both sets of three are dashed.
- **Easy days.** On Easy cubes the back face is a copy of the front.

Drag anywhere to turn the whole cube and look at its other sides.

## Helpers

You get 3 helpers per cube. Using none adds 100 points.

- **Suggest a move** shows a turn to make while dialling in. While filling in, it locks in a square where only one number fits.
- **Flatten cube** stops the clock for 5 seconds while you tap a square, then lays its two lines out flat for 20 seconds, with the numbers its dashed squares allow.

## Pausing, retrying and giving up

- **Pause** stops the clock, and today's cube waits behind the start screen until you come back.
- **Retry** starts today's cube again, once a day. It multiplies the day's total by ${RETRY_MULT}.
- **Give up** shows the answer. A run you give up on isn't scored.

## Practice

"Practice cube" on the start screen is a guided walkthrough on a small cube: one turn to undo, then a half-filled cube. It has no clock and no score, and you can play it any time.

${foot(d, sub)}`
}

function scoring(d: WikiData, sub: string): string {
  return `# Scoring

Your first finished run each day is the one that counts. Practice runs are never scored.

| Points for | Up to | How |
|:--|--:|:--|
| Fewest turns | 300 | All 300 if you dial in with no more turns than you picked; fewer the more extra turns you use. |
| Dial-in speed | 200 | All 200 within 20 seconds a turn, falling to 0 at three times that. |
| Fill-in speed | 300 | All 300 within 6 seconds an empty square, falling to 0 at three times that. |
| Accuracy | 200 | 25 off for each wrong lock. |
| No helpers | 100 | For using neither Suggest a move nor Flatten cube. |
| ★ lock-first squares | 150 | 50 for each ★ square you lock before any other square. |

With 0 turns there's no dialling in, so only the fill, accuracy and ★ points are on offer.

## The multiplier

Then the total is multiplied by how far you had the cube turned and how hard the day is:

${multTable()}

Hard days stop at 2 turns: with 3 there are hundreds of look-alike arrangements, so it turns into guessing.

## The week's difficulty

${levelTable()}

The order is shuffled at random every week, the same for everyone, so a Hard day can come on a Monday. The post says which today is. Hard days have fewer clues.

## A worked example

${example()}

## Retry

You get one retry a day. It multiplies that day's total by ${RETRY_MULT}.

${foot(d, sub)}`
}

function streaks(d: WikiData, sub: string): string {
  const flair = d.flair
    ? `\n\n## Streak flair\n\nFrom ${FLAIR_FROM} days in a row your user flair here shows it, like "Nonet · ${FLAIR_FROM}-day streak". Once the streak ends it shows your best instead. Flair you or the mods set yourselves is left alone.`
    : ''
  const founders = d.founders
    ? `\n\n## Founders\n\nThe first ${FOUNDERS} players to finish a cube here are its founders. Their flair says so, "Nonet founder #1" onwards, for good.`
    : ''
  return `# Streaks and flair

Finish a cube on days in a row to build a streak. Your streak and your best show on the start screen.

## The rest day

You can take one day off a week, Monday to Sunday, without losing your streak. Miss a second day in the same week and the streak starts again.

## A look at tomorrow

Lock all three ★ lock-first squares before any other square and you get a look at tomorrow's clues.${flair}${founders}

${foot(d, sub)}`
}

function challenges(d: WikiData, sub: string): string {
  return `# Challenges and crews

## Challenges

Once you've finished today's cube you can dare another player to beat your score. They have to accept before they play today's cube, and it settles once you've both finished. You can send up to ${MAX_CHALLENGES} a day, and each pair keeps a running record of wins, losses and ties.

## Nonet Crews (${CREW_MARK})

Team up with up to ${CREW_SIZE - 1} friends in a crew of ${CREW_SIZE}.

- Your daily scores add up, and your crew streak grows every day you all play.
- You can nudge a crewmate who hasn't played yet, and turn nudges off for yourself.
- A crew's line-up locks for the week: someone who joins an older crew mid-week counts from the next Monday.
- If a member misses ${QUIET_DAYS} days in a row, the others can open their seat.
- The crew board shows once ${CREW_BOARD_FROM} crews have played in a week.

## Posting your result

At the end of a run, "Post in the comments" puts your result in today's post as a comment from you: your turns, time, points, rank and stars. It shows you the comment first, and it's once a day.

## The week

Every day's points add up on the weekly board, Monday to Sunday. Each Monday the weekly top nine go up in a post with the solve of the week: the highest score on a single day. Past weeks are on the ${link(sub, 'records', 'records page')}.

${foot(d, sub)}`
}

function records(d: WikiData, sub: string): string {
  const weeks = d.weeks.slice(0, WIKI_WEEKS)
  const past = weeks.length
    ? `| Week of | The week's top player | Solve of the week | Players |\n|:--|:--|:--|--:|\n${weeks.map(weekRow).join('\n')}`
    : 'The first week is still going.'
  return `# Records

## Longest streaks

${rows(d.streaks, 'day')}

## All-time points

${rows(d.all)}

## Past weeks

${past}

${foot(d, sub)}`
}

function faq(d: WikiData, sub: string): string {
  const q = (question: string, answer: string): string =>
    `**${question}**\n\n${answer}`
  return `# Questions

${[
  q(
    'When does the new cube come out?',
    'At midnight Pacific time, every day. Once you have played, the start screen counts down to the next one.',
  ),
  q(
    'Is it the same cube for everyone?',
    'Yes. Everyone plays the same cube each day, so scores compare fairly.',
  ),
  q(
    'Can I play again today?',
    `Your first finished run is the one that counts. You get one retry a day, which multiplies the day's total by ${RETRY_MULT}. After that, "See your solved cube" shows today's cube as you finished it.`,
  ),
  q(
    'Why can I only pick up to 2 turns today?',
    'Hard days stop at 2 turns. With 3 there are hundreds of look-alike arrangements, so it turns into guessing.',
  ),
  q(
    'Why was yesterday Hard and today Easy?',
    `Each week has two Easy days, three Medium and two Hard, shuffled into a random order. See ${link(sub, 'scoring')}.`,
  ),
  q(
    'Does pausing stop the clock?',
    'Yes. Leave the game or press pause and the clock stops until you come back.',
  ),
  q(
    'Can I play without a Reddit account?',
    'Yes, logged out you can play free. Sign up at the end to save your score, join a crew and start a streak.',
  ),
  q(
    'I missed a day. Is my streak gone?',
    `Not if it's your first missed day this week (Monday to Sunday). See ${link(sub, 'streaks')}.`,
  ),
  q(
    'What counts as a line?',
    'A row of nine running straight across three faces. Tap a square to light up its two lines.',
  ),
  q(
    'Can I edit this wiki?',
    'The app rewrites these pages every Monday, so edits are replaced. Keep your own notes on another wiki page.',
  ),
].join('\n\n')}

${foot(d, sub)}`
}

/** Every page of the Nonet wiki, keyed by page name. Pure, for tests. */
export function wikiPages(d: WikiData, sub: string): Map<string, string> {
  return new Map<string, string>([
    [pageName(), home(d, sub)],
    [pageName('how-to-play'), howToPlay(d, sub)],
    [pageName('scoring'), scoring(d, sub)],
    [pageName('streaks'), streaks(d, sub)],
    [pageName('challenges-and-crews'), challenges(d, sub)],
    [pageName('records'), records(d, sub)],
    [pageName('faq'), faq(d, sub)],
  ])
}

/**
 * The subreddit's wiki front page, `index`, when it has none: the page Reddit's own Wiki link
 * opens. It points to the Nonet pages. The app writes it only once, so a mod's own front page is
 * never replaced. Pure, for tests.
 */
export function indexPage(sub: string): string {
  const contents = WIKI_PAGES.map(([p]) => `- ${link(sub, p)}`).join('\n')
  return `# r/${sub} wiki

## ${link(sub, undefined, 'Nonet: the daily 3D sudoku')}

Rules, scoring, streaks, crews and records for the game in today's pinned post.

${contents}
`
}

/** Writes every page, making each on the first run. Only mods and approved editors can change them. */
export async function publishWiki(
  day: string,
  sub: string,
  flair: boolean,
  founders = false,
): Promise<void> {
  const pages = wikiPages(
    {
      day,
      flair,
      founders,
      streaks: await longestStreaks(),
      all: await readBoard(boardKey.all, 'All time', undefined),
      weeks: await pastWeeks(),
    },
    sub,
  )
  // old Reddit reads the v1 wiki; reddit.com and the apps read v2 where the subreddit has it on.
  // The two are separate wikis, so the pages are written to each.
  const v2 = await reddit.isWikiV2Enabled(sub).catch(err => {
    console.warn(`wiki v2 check failed: ${err}`)
    return false
  })
  for (const wikiVersion of v2 ? (['v1', 'v2'] as const) : (['v1'] as const))
    await writePages(sub, pages, wikiVersion)
}

/** Writes the pages to one version of the wiki, and its front page when it has none. */
async function writePages(
  sub: string,
  pages: Map<string, string>,
  wikiVersion: 'v1' | 'v2',
): Promise<void> {
  const reason = 'Nonet: rules and records'
  const has = (page: string): Promise<boolean> =>
    reddit
      .getWikiPage(sub, page, {wikiVersion})
      .then(() => true)
      .catch(() => false)
  // the newer wiki doesn't parse markdown from apps (a Devvit bug) but shows basic HTML
  const body = (md: string): string =>
    wikiVersion === 'v2' ? markdownToHtml(md) : md
  for (const [page, md] of pages) {
    const content = body(md)
    if (await has(page)) {
      await reddit.updateWikiPage({
        subredditName: sub,
        page,
        content,
        reason,
        wikiVersion,
      })
      continue
    }
    await reddit.createWikiPage({
      subredditName: sub,
      page,
      content,
      reason,
      wikiVersion,
    })
    await reddit
      .updateWikiPageSettings({
        subredditName: sub,
        page,
        listed: true,
        // approved contributors only (the enum is exported as a type only)
        permLevel: 1,
        wikiVersion,
      })
      .catch(err => console.warn(`wiki ${wikiVersion} settings failed: ${err}`))
  }
  // the front page: made when this wiki has none, and rewritten only while it is still one the
  // app wrote (it starts with the app's title), so a mod's own front page is never replaced
  const front = await reddit
    .getWikiPage(sub, 'index', {wikiVersion})
    .then(p => p.content)
    .catch(() => undefined)
  const content = body(indexPage(sub))
  // the markdown or HTML front page, or the one-line pointer an earlier version wrote
  const ours = [
    `# r/${sub} wiki`,
    `<h1>r/${sub} wiki</h1>`,
    'The Nonet wiki is on old Reddit',
  ].some(mark => front?.startsWith(mark))
  const write =
    front === undefined
      ? reddit.createWikiPage({
          subredditName: sub,
          page: 'index',
          content,
          reason,
          wikiVersion,
        })
      : ours && front !== content
        ? reddit.updateWikiPage({
            subredditName: sub,
            page: 'index',
            content,
            reason,
            wikiVersion,
          })
        : undefined
  await write?.catch(err =>
    console.warn(`wiki ${wikiVersion} index failed: ${err}`),
  )
}
