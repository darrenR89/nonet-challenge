import assert from 'node:assert/strict'
import {test} from 'node:test'
import {
  cells,
  clueCount,
  groups,
  isDailyAnswer,
  LEVELS,
  layoutOf,
  lines,
  makeDay,
  makePractice,
  PRACTICE,
  PRACTICE_CLUES,
  singlesOnly,
  solveCount,
  withLayout,
} from './model.js'

test('each level starts in its clue band, with one answer, solvable by singles', () => {
  for (const [level, band] of LEVELS.entries()) {
    for (let i = 0; i < 6; i++) {
      const day = makeDay(`test:${level}:${i}`, level)
      const n = clueCount(day.base.given)
      assert.ok(n >= band.lo && n <= band.hi, `${band.name}: ${n} clues`)
      // the checks run on the lines this level is played on
      withLayout(layoutOf(level), () => {
        assert.ok(singlesOnly(day.base.given))
        assert.equal(solveCount(day.base.given, 2)[0], 1)
      })
      assert.ok(isDailyAnswer(day.base.sol))
    }
  }
})

test('turns never change the clues: every tier scrambles the same ones', () => {
  const day = makeDay('test:tiers', 1)
  for (const p of day.tiers) {
    assert.deepEqual(p.given, day.base.given)
    assert.equal(p.moves.length, p.tier)
    assert.equal(p.level, 1)
  }
  assert.deepEqual(day.tiers[0]?.start, day.base.given)
})

test('practice cubes are half filled, one turn out, and never a daily answer', () => {
  for (let i = 0; i < 8; i++) {
    const p = makePractice()
    assert.equal(p.tier, PRACTICE)
    assert.equal(clueCount(p.given), PRACTICE_CLUES)
    assert.equal(p.moves.length, 1)
    assert.ok(singlesOnly(p.given))
    assert.ok(!isDailyAnswer(p.sol))
  }
})

test('the same seed makes the same day', () => {
  assert.deepEqual(makeDay('test:same', 2), makeDay('test:same', 2))
})

// a cell's place on its face, ignoring which face: for comparing opposite faces square by square
const spot = (i: number): string => {
  const c = cells[i]
  return c ? c.c.map((x, k) => (c.n[k] ? 0 : x)).join() : ''
}
const copiesOpposite = (
  sol: readonly number[],
  a: number,
  b: number,
): boolean =>
  (groups[a] ?? []).every(i => {
    const j = (groups[b] ?? []).find(j => spot(j) === spot(i))
    return j !== undefined && sol[j] === sol[i]
  })

test('Easy uses Mirror and Medium and Hard use Spread; every tier says which', () => {
  for (const level of [0, 1, 2]) {
    const day = makeDay(`test:layout:${level}`, level)
    for (const p of day.tiers) assert.equal(p.layout, layoutOf(level))
  }
  assert.equal(makePractice().layout, 'mirror')
})

test('on Mirror the back face copies the front; on Spread no face copies another', () => {
  const easy = makeDay('test:mirror', 0).base.sol
  withLayout('mirror', () => assert.ok(copiesOpposite(easy, 0, 1)))
  const hard = makeDay('test:spread', 2).base.sol
  withLayout('spread', () => {
    for (const [a, b] of [
      [0, 1],
      [2, 3],
      [4, 5],
    ] as const)
      assert.ok(!copiesOpposite(hard, a, b), `faces ${a} and ${b}`)
    assert.equal(solveCount(hard, 2)[0], 1)
  })
})

test('both lines of a ring share six squares, and each end repeats the other end as a set', () => {
  for (const name of ['mirror', 'spread'] as const) {
    const sol = makeDay(`test:ends:${name}`, name === 'mirror' ? 0 : 1).base.sol
    withLayout(name, () => {
      for (let q = 0; q < 9; q++) {
        const a = lines[2 * q] ?? []
        const b = lines[2 * q + 1] ?? []
        assert.equal(a.filter(i => b.includes(i)).length, 6)
        const endA = a.filter(i => !b.includes(i)).map(i => sol[i])
        const endB = b.filter(i => !a.includes(i)).map(i => sol[i])
        assert.deepEqual(endA.sort(), endB.sort())
      }
    })
  }
})
