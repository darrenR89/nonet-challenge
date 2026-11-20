import assert from 'node:assert/strict'
import {test} from 'node:test'
import type {Board} from '../shared/api.ts'
import {streakFlair} from './flair.ts'
import {clockTime, spotText} from './records.ts'
import {wikiText} from './wiki.ts'

const board = (rows: [string, number][]): Board => ({
  key: 'k',
  label: 'l',
  top: rows.map(([name, score], i) => ({rank: i + 1, name, score})),
  me: undefined,
  players: rows.length,
})

test('streak flair starts at three days and falls back to the best', () => {
  assert.equal(streakFlair({current: 2, best: 2, played: 9}), undefined)
  assert.equal(
    streakFlair({current: 3, best: 5, played: 9}),
    'Nonet · 3-day streak',
  )
  assert.equal(
    streakFlair({current: 0, best: 5, played: 9}),
    'Nonet · best streak 5',
  )
  assert.equal(
    streakFlair({current: 1, best: 12, played: 30}),
    'Nonet · best streak 12',
  )
})

test('the solve of the week reads as one sentence', () => {
  assert.equal(clockTime(65), '1:05')
  assert.equal(
    spotText({
      name: 'ann',
      score: 2850,
      day: '2026-11-20',
      tier: 1,
      time: 252,
      stars: 2,
      wrong: 1,
    }),
    'u/ann scored 2,850 on Fri 20 Nov (cube #324): 1 turn, 4:12, 2 ★, 1 miss.',
  )
  assert.match(
    spotText({
      name: 'bo',
      score: 500,
      day: '2026-11-20',
      tier: 0,
      time: 90,
      stars: 3,
      wrong: 0,
    }),
    /no turns, 1:30, all three ★, no misses\.$/,
  )
})

test('the wiki has the week, the multipliers and the records', () => {
  const md = wikiText({
    day: '2026-11-23',
    flair: true,
    streaks: board([['ann', 12]]),
    all: board([]),
    weeks: [
      {
        week: '2026-W47',
        from: '2026-11-16',
        players: 1204,
        winner: {name: 'bob', score: 14000},
        spot: {
          name: 'ann',
          score: 2850,
          day: '2026-11-20',
          tier: 3,
          time: 200,
          stars: 3,
          wrong: 0,
        },
      },
    ],
  })
  assert.match(md, /\| Monday \| Easy \| 0 to 3 \|/)
  assert.match(md, /\| Friday \| Hard \| 0 to 2 \|/)
  assert.match(md, /\| 3 \| ×2 \| ×3 \| not offered \|/)
  assert.match(md, /Nonet · 3-day streak/)
  assert.match(md, /1\. u\/ann · 12 days/)
  assert.match(md, /### All-time points\n\nNobody yet\./)
  assert.match(
    md,
    /\| Mon 16 Nov \| u\/bob · 14,000 \| u\/ann · 2,850 on Fri 20 Nov \| 1,204 \|/,
  )
  assert.match(md, /last updated Mon 23 Nov/)
  assert.doesNotMatch(
    wikiText({
      day: '2026-11-23',
      flair: false,
      streaks: board([]),
      all: board([]),
      weeks: [],
    }),
    /flair/,
  )
})
