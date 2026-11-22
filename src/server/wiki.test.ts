import assert from 'node:assert/strict'
import {test} from 'node:test'
import type {Board} from '../shared/api.ts'
import {crewFlair} from '../shared/crew.ts'
import {streakFlair} from './flair.ts'
import {clockTime, spotText} from './records.ts'
import {indexPage, pageName, WIKI_PAGES, wikiPages} from './wiki.ts'

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

test('founder flair goes in front of the streak', () => {
  assert.equal(
    streakFlair({current: 0, best: 0, played: 1}, 7),
    'Nonet founder #7',
  )
  assert.equal(
    streakFlair({current: 4, best: 4, played: 4}, 7),
    'Nonet founder #7 · 4-day streak',
  )
  assert.equal(
    crewFlair('Owls', streakFlair({current: 4, best: 4, played: 4}, 7)),
    '連 Owls · founder #7 · 4-day streak',
  )
})

const data = {
  day: '2026-11-23',
  flair: true,
  founders: true,
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
}

test('the wiki is a home page and a page for each part, all linked', () => {
  const pages = wikiPages(data, 'nonetdaily')
  assert.deepEqual(
    [...pages.keys()],
    ['nonet', ...WIKI_PAGES.map(([p]) => `nonet/${p}`)],
  )
  for (const [name, md] of pages) {
    assert.match(md, /^# /, `${name} starts with a title`)
    for (const [p] of WIKI_PAGES)
      assert.ok(
        md.includes(`(/r/nonetdaily/wiki/nonet/${p})`),
        `${name} links to ${p}`,
      )
    assert.match(md, /last updated Mon 23 Nov/)
  }
  const home = pages.get(pageName()) ?? ''
  assert.match(home, /\| Easy \| 2 \| 0 to 3 \|/)
  assert.match(home, /guided practice cube/)
})

test('scoring has the multipliers, the week and a worked example that adds up', () => {
  const md = wikiPages(data, 's').get(pageName('scoring')) ?? ''
  assert.match(md, /\| Medium \| 3 \| 0 to 3 \|/)
  assert.match(md, /\| Hard \| 2 \| 0 to 2 \|/)
  assert.match(md, /\| 3 \| ×2 \| ×3 \| not offered \|/)
  const rows = [...md.matchAll(/^\| [^|*]+ \| ([\d,]+) \|$/gm)].map(m =>
    Number(m[1]?.replace(/,/g, '')),
  )
  const raw = rows.pop() ?? 0
  assert.equal(
    rows.reduce((a, b) => a + b, 0),
    raw,
    'the example lines add up',
  )
  const total = Number(
    md
      .match(/\*\*×2 for 2 turns on Medium\*\* \| \*\*([\d,]+)\*\*/)?.[1]
      ?.replace(/,/g, ''),
  )
  assert.equal(total, raw * 2)
})

test('streaks, flair, crews and records each have their page', () => {
  const pages = wikiPages(data, 's')
  const streaks = pages.get(pageName('streaks')) ?? ''
  assert.match(streaks, /one day off a week/)
  assert.match(streaks, /Nonet · 3-day streak/)
  assert.match(streaks, /first 100 players .* "Nonet founder #1"/)
  assert.match(pages.get(pageName('challenges-and-crews')) ?? '', /crew of 3/)
  const rec = pages.get(pageName('records')) ?? ''
  assert.match(rec, /1\. u\/ann · 12 days/)
  assert.match(rec, /## All-time points\n\nNobody yet\./)
  assert.match(
    rec,
    /\| Mon 16 Nov \| u\/bob · 14,000 \| u\/ann · 2,850 on Fri 20 Nov \| 1,204 \|/,
  )
  const quiet = wikiPages({...data, flair: false, founders: false}, 's')
  for (const md of quiet.values())
    assert.doesNotMatch(md, /flair here|founder #/)
})

test('the wiki front page links to the Nonet home page and each of its pages', () => {
  const md = indexPage('nonet_challenge_dev')
  assert.ok(md.includes('(/r/nonet_challenge_dev/wiki/nonet)'))
  for (const [p] of WIKI_PAGES)
    assert.ok(
      md.includes(`(/r/nonet_challenge_dev/wiki/${pageName(p)})`),
      `no link to ${p}`,
    )
})
