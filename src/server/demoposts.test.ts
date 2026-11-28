import assert from 'node:assert/strict'
import {test} from 'node:test'
import {makeDay} from '../shared/model.js'
import {checkLog} from '../shared/replay.ts'
import {scoreRun} from '../shared/scoring.ts'
import {
  demoKindOf,
  demoPlay,
  demoRace,
  demoRun,
  lastWeekFrom,
} from './demoposts.ts'

test('only a known demo kind marks a post as a demo', () => {
  assert.equal(demoKindOf({demo: 'race'}), 'race')
  assert.equal(demoKindOf({demo: 'daily'}), 'daily')
  for (const real of [
    undefined,
    {},
    {day: '2026-11-14'},
    {demo: 'x'},
    {demo: 1},
  ])
    assert.equal(demoKindOf(real), undefined)
})

test("the demo run is a real run on its cube: it passes the server's checks", () => {
  for (const level of [0, 1, 2]) {
    const day = makeDay(`demo-test-${level}`, level)
    const p = day.tiers.at(-1)
    assert.ok(p)
    const {log, stats} = demoRun(p)
    assert.equal(checkLog(p, stats, log), undefined, `level ${level}`)
    assert.equal(stats.wrong, 1)
    assert.ok(stats.t1 + stats.t2 > 120, 'at a person’s pace')
  }
})

test('the demo replay is last Thursday, scored as the game scores it', () => {
  const play = demoPlay('2026-11-28')
  assert.equal(play.day, '2026-11-19')
  assert.equal(play.cubeNo > 0, true)
  assert.ok(play.score > 0)
  assert.ok(play.time > 0)
  assert.equal(demoPlay('2026-11-28').score, play.score, 'holds still')
  assert.equal(
    scoreRun(play.level, play.tier, {
      turns: 0,
      t1: 0,
      t2: 0,
      blanks: 0,
      wrong: 0,
      hintsUsed: 0,
      starsWon: 0,
    }).mult > 0,
    true,
  )
})

test("the demo race is last week's top nine, best first, with the viewer just off it", () => {
  assert.equal(lastWeekFrom('2026-11-28'), '2026-11-16')
  assert.equal(lastWeekFrom('2026-11-23'), '2026-11-16', 'on a Monday too')
  const race = demoRace('2026-11-28', 'darren')
  const totals = race.rows.map(r => r.points.reduce((a, b) => a + b, 0))
  assert.deepEqual(
    totals,
    totals.slice().sort((a, b) => b - a),
  )
  const mine = race.me?.points.reduce((a, b) => a + b, 0) ?? 0
  assert.ok(mine > 0 && mine < (totals.at(-1) ?? 0))
  assert.equal(demoRace('2026-11-28', undefined).me, undefined)
})
