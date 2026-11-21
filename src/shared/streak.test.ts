import assert from 'node:assert/strict'
import {test} from 'node:test'
import {liveStreak, playStreak, restDayFor, restUsed} from './streak.ts'

// 2026-11-16 is a Monday (week 2026-W47); 2026-11-23 starts W48.
const s = (last: string, count: number, restWeek = '') => ({
  last,
  count,
  restWeek,
})

test('playing on consecutive days adds one', () => {
  assert.deepEqual(
    playStreak(s('2026-11-17', 4), '2026-11-18'),
    s('2026-11-18', 5),
  )
})

test('playing twice on a day changes nothing', () => {
  assert.deepEqual(
    playStreak(s('2026-11-18', 4), '2026-11-18'),
    s('2026-11-18', 4),
  )
})

test('one missed day is covered and spends that week', () => {
  assert.deepEqual(
    playStreak(s('2026-11-17', 4), '2026-11-19'),
    s('2026-11-19', 5, '2026-W47'),
  )
})

test('a second miss in the same week resets the streak', () => {
  assert.deepEqual(
    playStreak(s('2026-11-19', 5, '2026-W47'), '2026-11-21'),
    s('2026-11-21', 1, '2026-W47'),
  )
})

test('the rest day comes back the next week', () => {
  // missed Monday 23 Nov, in W48, after resting in W47
  assert.deepEqual(
    playStreak(s('2026-11-22', 8, '2026-W47'), '2026-11-24'),
    s('2026-11-24', 9, '2026-W48'),
  )
})

test('the week of the missed day decides, not the day played', () => {
  // missed Sunday 22 Nov (W47) and W47's rest is spent, though today is in W48
  assert.equal(restDayFor('2026-11-21', '2026-11-23', '2026-W47'), undefined)
  assert.equal(restDayFor('2026-11-21', '2026-11-23', ''), '2026-11-22')
})

test('two missed days in a row reset the streak', () => {
  assert.deepEqual(
    playStreak(s('2026-11-17', 4), '2026-11-20'),
    s('2026-11-20', 1),
  )
})

test('a first ever play starts at one', () => {
  assert.deepEqual(playStreak(s('', 0), '2026-11-20'), s('2026-11-20', 1))
})

test('live streak holds through a covered miss and lapses after', () => {
  const st = s('2026-11-17', 4)
  assert.equal(liveStreak(st, '2026-11-18'), 4)
  assert.equal(liveStreak(st, '2026-11-19'), 4)
  assert.equal(liveStreak(st, '2026-11-20'), 0)
  assert.equal(liveStreak(s('2026-11-17', 4, '2026-W47'), '2026-11-19'), 0)
})

test('rest used is per week', () => {
  assert.equal(restUsed(s('2026-11-19', 5, '2026-W47'), '2026-11-20'), true)
  assert.equal(restUsed(s('2026-11-19', 5, '2026-W47'), '2026-11-23'), false)
})
