import assert from 'node:assert/strict'
import {test} from 'node:test'
import {postUrl, shareText} from './share.ts'
import {detailLine} from './share-card.ts'

test('the post link is built from the post id, with or without the subreddit', () => {
  assert.equal(
    postUrl('nonet_challenge', 't3_1abc23'),
    'https://www.reddit.com/r/nonet_challenge/comments/1abc23/',
  )
  assert.equal(
    postUrl(undefined, 't3_1abc23'),
    'https://www.reddit.com/comments/1abc23/',
  )
  assert.equal(postUrl('x', undefined), undefined)
  assert.equal(postUrl('x', 't3_../../evil'), undefined)
})

test('the share text carries the result, the dare and the link', () => {
  const t = shareText(
    'Nonet No.323 · 1 rotation',
    'https://www.reddit.com/comments/a/',
  )
  assert.equal(
    t,
    "Nonet No.323 · 1 rotation\nCan you beat it? Play today's cube: https://www.reddit.com/comments/a/",
  )
  assert.equal(shareText('r', undefined), 'r\nCan you beat it?')
})

test('the detail line reads cleanly', () => {
  const d = {levelName: 'Medium', mode: '1 rotation', wrong: 0, hints: 1}
  assert.equal(
    detailLine(d),
    'Medium · 1 rotation · no wrong locks · 1 suggestion',
  )
})
