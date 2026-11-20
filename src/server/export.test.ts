import assert from 'node:assert/strict'
import {test} from 'node:test'
import {dayText, faces} from './export.ts'

test('a cube reads as six faces of nine, with dots for empty squares', () => {
  const cells = Array.from({length: 54}, (_, i) => (i % 2 ? 0 : (i % 9) + 1))
  const f = faces(cells)
  assert.equal(f.split(' ').length, 6)
  assert.equal(f.split(' ')[0], '1.3.5.7.9')
})

test("a day's entry has its number, date, level, clues and answer", () => {
  const sol = Array.from({length: 54}, (_, i) => (i % 9) + 1)
  const given = sol.map((v, i) => (i < 9 ? v : 0))
  const t = dayText('2026-11-20', {base: {sol, given}, level: 2})
  assert.match(t, /^\*\*#324 · Fri 20 Nov · Hard\*\* \(2026-11-20\)/)
  assert.match(t, /clues {3}123456789 \.{9}/)
  assert.match(t, /answer {2}123456789 123456789/)
})
