import assert from 'node:assert/strict'
import {test} from 'node:test'
import {cleanCrewName} from './crew.ts'
import {isOffensive} from './names.ts'

test('offensive names are caught, disguised or not', () => {
  for (const n of [
    'Fuck Yeah',
    'F.u.u.c.k',
    'Sh1t Crew',
    'Dumb Ass',
    'a s s',
    'Ass Kickers',
    'Füçk',
    'Holy $h!t',
    'KKK',
    'Fucktards',
    'Pussy Cats',
  ])
    assert.equal(isOffensive(n), true, n)
})

test('ordinary names that hide a bad word are allowed', () => {
  for (const n of [
    'Night Owls',
    'Grape Escape',
    'Dickens Fans',
    'Raccoon Gang',
    'Scunthorpe',
    'Class Act',
    'Peacock Club',
    'Essex Nine',
    'Cocktail Hour',
    'Assassins',
    'Titans',
    'Shiitake Squad',
    'Mississippi',
    'Spice Girls',
    'Bass Line',
    'Therapists',
    'Torpedo Bay',
    'Swanky',
    'Nigeria Nine',
    'Cucumber',
  ])
    assert.equal(isOffensive(n), false, n)
})

test('a crew name that fails the check is refused', () => {
  assert.equal(cleanCrewName('Fuck Squad'), undefined)
  assert.equal(cleanCrewName('Night Owls'), 'Night Owls')
})
