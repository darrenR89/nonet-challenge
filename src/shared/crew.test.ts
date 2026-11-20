import assert from 'node:assert/strict'
import {test} from 'node:test'
import {
  type Crew,
  cleanCrewName,
  crewInviteText,
  crewRowText,
  nudgeText,
  playedText,
} from './crew.ts'

test('crew names are tidied, and junk is refused', () => {
  assert.equal(cleanCrewName('  Night   Owls '), 'Night Owls')
  assert.equal(cleanCrewName("Darren's 3"), "Darren's 3")
  assert.equal(cleanCrewName('連 crew'), '連 crew')
  assert.equal(cleanCrewName('x'), undefined)
  assert.equal(cleanCrewName('a'.repeat(25)), undefined)
  assert.equal(cleanCrewName('-dash first'), undefined)
  assert.equal(cleanCrewName('<b>bold</b>'), undefined)
  assert.equal(cleanCrewName('[link](http://x)'), undefined)
  assert.equal(cleanCrewName(7), undefined)
})

test('the invite comment tags everyone invited and names the crew', () => {
  assert.equal(
    crewInviteText('ann', ['bob', 'cat'], 'Night Owls'),
    "u/bob and u/cat, u/ann wants you in their Nonet crew 連 Night Owls. Open today's cube in this post to join.",
  )
})

test('played counts members with a score today', () => {
  const m = (score: number | undefined) => ({
    id: 'x',
    name: 'x',
    score,
    me: false,
    nudged: false,
  })
  const c = {members: [m(400), m(undefined), m(0)]} as Crew
  assert.equal(playedText(c), '2 of 3 played')
})

test('nudges and weekly rows read plainly', () => {
  const n = nudgeText('ann', 'Night Owls', 2, 3)
  assert.equal(n.subject, '連 Night Owls is waiting on you')
  assert.match(n.text, /^u\/ann nudged you: 2 of 3 in Night Owls/)
  assert.equal(
    crewRowText(1, 'Night Owls', 12345, ['ann', 'bob']),
    '1. 連 Night Owls · 12,345 (u/ann, u/bob)',
  )
})
