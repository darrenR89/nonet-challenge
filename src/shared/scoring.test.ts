import assert from 'node:assert/strict'
import {test} from 'node:test'
import {
  addDays,
  cleanRun,
  dayKey,
  dayOfYear,
  kanjiNo,
  levelOf,
  maxTurns,
  msUntilNextDay,
  multOf,
  padNo,
  SHUFFLE_FROM,
  scoreRun,
  shortDate,
  tierAllowed,
  weekday,
  weekKey,
  weekLevels,
} from './scoring.ts'

const perfect = (turns: number) => ({
  turns,
  t1: 20 * turns,
  t2: 6 * 30,
  blanks: 30,
  wrong: 0,
  hintsUsed: 0,
  starsWon: 3,
})

test('a perfect run: 1000 for the stages, 100 no-hint, 150 stars, times the multiplier', () => {
  const s = scoreRun(1, 3, perfect(3))
  assert.equal(s.raw, 1250)
  assert.equal(s.mult, 3)
  assert.equal(s.total, 3750)
  assert.equal(cleanRun(0, 1), 1250)
})

test('no turns: Stage 2 and stars only, at x1 on every level', () => {
  for (const level of [0, 1, 2]) {
    const s = scoreRun(level, 0, perfect(0))
    assert.equal(s.turnPts, 0)
    assert.equal(s.sp1, 0)
    assert.equal(s.bonus, 0)
    assert.equal(s.raw, 650)
    assert.equal(s.total, 650)
    assert.equal(cleanRun(level, 0), 500)
  }
})

test('turn multipliers grow faster on harder cubes, and Hard stops at 2 turns', () => {
  assert.deepEqual(
    [0, 1, 2, 3].map(t => multOf(0, t)),
    [1, 1.25, 1.5, 2],
  )
  assert.deepEqual(
    [0, 1, 2, 3].map(t => multOf(1, t)),
    [1, 1.5, 2, 3],
  )
  assert.deepEqual(
    [0, 1, 2].map(t => multOf(2, t)),
    [1, 2, 3],
  )
  assert.equal(maxTurns(0), 3)
  assert.equal(maxTurns(2), 2)
  assert.ok(tierAllowed(1, 3))
  assert.ok(!tierAllowed(2, 3))
  assert.ok(!tierAllowed(0, 4))
  assert.ok(!tierAllowed(0, -1))
})

const weekOf = (monday: string): number[] =>
  [0, 1, 2, 3, 4, 5, 6].map(i => levelOf(addDays(monday, i)))

test('weeks before the shuffle keep their old order, so past cubes keep their level', () => {
  assert.deepEqual(weekOf('2026-11-16'), [0, 0, 1, 1, 2, 2, 1])
})

test('every week has two Easy, three Medium and two Hard days, in a random order', () => {
  const orders = new Set<string>()
  for (let w = 0; w < 52; w++) {
    const week = weekOf(addDays(SHUFFLE_FROM, w * 7))
    assert.deepEqual([...week].sort(), [0, 0, 1, 1, 1, 2, 2])
    orders.add(week.join(''))
  }
  assert.ok(orders.size > 20, `only ${orders.size} different orders in a year`)
  // the week doesn't simply get harder: some week has a Hard day before an Easy one
  assert.ok([...orders].some(o => o.indexOf('2') < o.lastIndexOf('0')))
})

test('a week shuffles the same every time it is asked', () => {
  const day = addDays(SHUFFLE_FROM, 21)
  assert.deepEqual(weekLevels(day), weekLevels(addDays(day, 3)))
  assert.deepEqual(weekLevels(day), weekLevels(day))
})

test('weeks start on Monday, ISO numbered', () => {
  assert.equal(weekKey('2026-11-16'), '2026-W47')
  assert.equal(weekKey('2026-11-15'), '2026-W46')
  assert.equal(weekKey('2027-01-01'), '2026-W53')
  assert.equal(weekday('2026-11-16'), 1)
  assert.equal(weekday('2026-11-15'), 7)
  assert.equal(addDays('2026-12-31', 1), '2027-01-01')
})

test('the day turns over at midnight Pacific, not midnight UTC', () => {
  // 4:03 PM Saturday in California is already Sunday in UTC
  assert.equal(dayKey(new Date('2026-11-15T00:03:00Z')), '2026-11-14')
  assert.equal(dayKey(new Date('2026-11-15T07:59:00Z')), '2026-11-14')
  assert.equal(dayKey(new Date('2026-11-15T08:00:00Z')), '2026-11-15')
  // summer time: midnight Pacific is 07:00 UTC
  assert.equal(dayKey(new Date('2026-07-04T06:59:00Z')), '2026-07-03')
  assert.equal(dayKey(new Date('2026-07-04T07:00:00Z')), '2026-07-04')
  assert.equal(shortDate('2026-11-14'), 'Sat 14 Nov')
})

test('time until the next cube counts to midnight Pacific', () => {
  assert.equal(
    msUntilNextDay(new Date('2026-11-15T00:03:00Z')),
    (7 * 60 + 57) * 60000,
  )
  assert.equal(msUntilNextDay(new Date('2026-07-04T06:00:00Z')), 3600000)
  // the night the clocks go back (1 Nov 2026): Sunday starts at 07:00 UTC, Monday at 08:00 UTC
  assert.equal(msUntilNextDay(new Date('2026-11-01T06:00:00Z')), 3600000)
  assert.equal(msUntilNextDay(new Date('2026-11-01T12:00:00Z')), 20 * 3600000)
})

test('a cube is numbered by its day of the year, in digits and kanji', () => {
  assert.equal(dayOfYear('2026-01-01'), 1)
  assert.equal(dayOfYear('2026-11-15'), 319)
  assert.equal(dayOfYear('2026-12-31'), 365)
  assert.equal(dayOfYear('2028-12-31'), 366)
  assert.equal(dayOfYear('2027-01-01'), 1)
  assert.equal(padNo(27), '027')
  assert.equal(kanjiNo(1), '〇〇一')
  assert.equal(kanjiNo(27), '〇二七')
  assert.equal(kanjiNo(310), '三一〇')
  assert.equal(kanjiNo(365), '三六五')
})
