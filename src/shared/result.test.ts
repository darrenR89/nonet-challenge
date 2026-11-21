import assert from 'node:assert/strict'
import {test} from 'node:test'
import {resultCommentText} from './result.ts'

test('the result comment', () => {
  const r = {
    cubeNo: 325,
    tier: 2,
    time: 247,
    points: 1840,
    stars: 2,
    rank: 12,
    players: 340,
  }
  assert.equal(
    resultCommentText(r),
    'Nonet No.325 · 2 turns · 4:07 · 1,840 pts · #12 of 340\n\n★★☆',
  )
})

test('the result comment leaves out a rank with no one to rank against', () => {
  const r = {
    cubeNo: 1,
    tier: 1,
    time: 60,
    points: 900,
    stars: 0,
    rank: 1,
    players: 1,
  }
  assert.equal(
    resultCommentText(r),
    'Nonet No.1 · 1 turn · 1:00 · 900 pts\n\n☆☆☆',
  )
})
