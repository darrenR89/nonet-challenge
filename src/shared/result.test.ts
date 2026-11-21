import assert from 'node:assert/strict'
import {test} from 'node:test'
import {isJourney, journeyLine, resultCommentText} from './result.ts'

test('the journey line follows the order faces were finished', () => {
  assert.equal(
    journeyLine([2, 0, 1, 3, 4, 5], [1, 0, 3, 0, 0, 0]),
    '🟥🟧🟨🟨🟨🟨',
  )
})

test('faces never finished by the player come first, and repeats are dropped', () => {
  assert.equal(journeyLine([1, 1, 2], [0, 2, 1, 0, 0, 0]), '🟨🟨🟨🟨🟥🟧')
})

test('only a six-square journey line passes', () => {
  assert.equal(isJourney('🟨🟨🟧🟨🟥🟨'), true)
  assert.equal(isJourney('🟨🟨🟧🟨🟥'), false)
  assert.equal(isJourney('🟨🟨🟧🟨🟥x'), false)
  assert.equal(isJourney('the answer is 5'), false)
  assert.equal(isJourney(42), false)
})

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
    resultCommentText(r, '🟨🟨🟧🟨🟨🟨'),
    'Nonet No.325 · 2 turns · 4:07 · 1,840 pts · #12 of 340\n\n🟨🟨🟧🟨🟨🟨 ★★☆',
  )
})

test('the result comment drops a bad journey and a lone rank', () => {
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
    resultCommentText(r, 'spoiler'),
    'Nonet No.1 · 1 turn · 1:00 · 900 pts\n\n☆☆☆',
  )
})
