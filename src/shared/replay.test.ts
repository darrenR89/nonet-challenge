import assert from 'node:assert/strict'
import {test} from 'node:test'
import {makeDay, type Puzzle} from './model.js'
import {checkLog, code, decodeLog, type MoveLog} from './replay.ts'
import type {RunStats} from './scoring.ts'

/** a[i], failing the test if it's missing. */
function at<T>(a: readonly T[], i: number): T {
  const v = a[i]
  assert.ok(v !== undefined, `nothing at ${i}`)
  return v
}

const day = makeDay('2026-11-18', 1)
const p: Puzzle = at(day.tiers, 2)

/** A clean run: undo the scramble, lock the ★ squares, then the rest, one a second. */
function run(): {log: MoveLog; stats: RunStats} {
  const log: MoveLog = []
  let t = 20
  for (const m of p.moves.slice().reverse()) {
    log.push(t, code.turn([m[0], m[1], -m[2]]))
    t += 30
  }
  const t1 = t / 10
  log.push(t, code.dial)
  for (const s of p.stars) log.push(t, code.star(s))
  const blanks = p.given.map((v, c) => (v ? -1 : c)).filter(c => c >= 0)
  const order = [...p.stars, ...blanks.filter(c => !p.stars.includes(c))]
  for (const c of order) {
    t += 10
    log.push(t, code.lock(c, at(p.sol, c)))
  }
  return {
    log,
    stats: {
      turns: p.moves.length,
      t1,
      t2: t / 10 - t1,
      blanks: blanks.length,
      wrong: 0,
      hintsUsed: 0,
      starsWon: 3,
    },
  }
}

test('a clean run checks out', () => {
  const {log, stats} = run()
  assert.equal(checkLog(p, stats, log), undefined)
})

test('a log reads back as the moves it was written from', () => {
  const m = at(p.moves, 0)
  const ev = decodeLog([5, code.turn(m), 9, code.miss(53, 9), 12, code.help])
  assert.deepEqual(ev, [
    {t: 5, kind: 'turn', move: m},
    {t: 9, kind: 'miss', cell: 53, digit: 9},
    {t: 12, kind: 'help'},
  ])
})

test('junk logs are refused', () => {
  const {stats} = run()
  for (const bad of [
    undefined,
    'x',
    [1],
    [1, 99999],
    [5, 0, 4, 0],
    [1.5, 0],
    {},
  ])
    assert.equal(checkLog(p, stats, bad), 'unreadable')
})

test('a log that does not match its totals is refused', () => {
  const {log, stats} = run()
  assert.equal(checkLog(p, {...stats, turns: stats.turns + 1}, log), 'turns')
  assert.equal(checkLog(p, {...stats, wrong: 1}, log), 'misses')
  assert.equal(checkLog(p, {...stats, starsWon: 2}, log), 'stars')
  assert.equal(checkLog(p, {...stats, hintsUsed: 1}, log), 'help')
  assert.equal(checkLog(p, {...stats, t2: stats.t2 + 30}, log), 'run time')
})

test('a wrong digit, an unfinished cube or a skipped turn is refused', () => {
  const {log, stats} = run()
  const last = log.length - 1
  const c = Math.floor((at(log, last) - 1000) / 9)
  const wrongDigit = log.slice()
  wrongDigit[last] = code.lock(c, (at(p.sol, c) % 9) + 1)
  assert.equal(checkLog(p, stats, wrongDigit), 'not solved')
  assert.equal(checkLog(p, stats, log.slice(0, -2)), 'not solved')
  const noTurn = log.slice(2)
  assert.equal(
    checkLog(p, {...stats, turns: stats.turns - 1}, noTurn),
    'not dialled in',
  )
})

test('misses, suggestions and ★ order are counted like the game counts them', () => {
  const {log, stats} = run()
  const i =
    log.findIndex((c, k) => k % 2 === 1 && c === code.dial) +
    1 +
    2 * p.stars.length
  // a miss on the first ★ square, then a suggestion locks the second ★ (no bonus for it)
  const s0 = at(p.stars, 0)
  const s1 = at(p.stars, 1)
  const withMiss = log.slice()
  withMiss.splice(i, 0, at(log, i), code.miss(s0, (at(p.sol, s0) % 9) + 1))
  const j = withMiss.indexOf(code.lock(s1, at(p.sol, s1)))
  withMiss[j] = code.helpLock(s1, at(p.sol, s1))
  assert.equal(
    checkLog(p, {...stats, wrong: 1, hintsUsed: 1, starsWon: 2}, withMiss),
    undefined,
  )
})
