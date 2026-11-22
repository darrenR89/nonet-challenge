import assert from 'node:assert/strict'
import {test} from 'node:test'
import {
  FLAIR_WIDGET,
  flairWidget,
  topOrder,
  WIKI_WIDGET,
  wikiWidget,
} from './widgets.ts'

test('the wiki button opens the Nonet wiki of this subreddit', () => {
  const w = wikiWidget('nonet_challenge_dev')
  assert.equal(w.type, 'button')
  assert.equal(w.shortName, WIKI_WIDGET)
  assert.ok(w.type === 'button')
  assert.equal(w.buttons.length, 1)
  assert.equal(w.buttons[0]?.text, 'How to play: Nonet wiki')
  assert.equal(
    w.buttons[0]?.url,
    'https://www.reddit.com/r/nonet_challenge_dev/wiki/nonet',
  )
})

test('the flair widget lists the app flairs in the order given', () => {
  const w = flairWidget('sub', ['a', 'b', 'c'])
  assert.ok(w.type === 'post-flair')
  assert.equal(w.shortName, FLAIR_WIDGET)
  assert.equal(w.display, 'list')
  assert.deepEqual(w.order, ['a', 'b', 'c'])
})

test('new widgets go to the top, the rest keep their order', () => {
  assert.deepEqual(topOrder(['x', 'y', 'w', 'f'], ['w', 'f']), [
    'w',
    'f',
    'x',
    'y',
  ])
  assert.deepEqual(topOrder(['x', 'y'], []), ['x', 'y'])
})
