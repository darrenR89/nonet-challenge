import assert from 'node:assert/strict'
import {test} from 'node:test'
import {challengeText, cleanName, duelResult, recordText} from './duel.ts'

test('a duel is pending until both scores are in, then higher wins', () => {
  assert.equal(duelResult(undefined, 400), 'pending')
  assert.equal(duelResult(400, undefined), 'pending')
  assert.equal(duelResult(500, 400), 'won')
  assert.equal(duelResult(0, 400), 'lost')
  assert.equal(duelResult(400, 400), 'tied')
})

test('usernames lose u/ and @, and junk is refused', () => {
  assert.equal(cleanName('u/Some_User'), 'Some_User')
  assert.equal(cleanName(' /u/ab-c '), 'ab-c')
  assert.equal(cleanName('@bob99'), 'bob99')
  assert.equal(cleanName('ab'), undefined)
  assert.equal(cleanName('has space'), undefined)
  assert.equal(cleanName('a'.repeat(21)), undefined)
  assert.equal(cleanName(42), undefined)
})

test('the comment tags the player and gives the score to beat', () => {
  assert.equal(
    challengeText('ann', 'bob', 1234, 322),
    "u/bob, u/ann scored 1,234 on Nonet #322 and challenges you to beat it. Today's cube is in this post.",
  )
})

test('the record reads from your side', () => {
  assert.equal(recordText({won: 0, lost: 0, tied: 0}), 'First meeting')
  assert.equal(recordText({won: 3, lost: 2, tied: 0}), 'You lead 3–2')
  assert.equal(recordText({won: 1, lost: 4, tied: 1}), 'They lead 4–1, 1 tie')
  assert.equal(recordText({won: 2, lost: 2, tied: 2}), 'Level at 2–2, 2 ties')
})
