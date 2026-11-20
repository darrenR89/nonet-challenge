import assert from 'node:assert/strict'
import {test} from 'node:test'
import {postUrl, shareText} from './share.ts'
import {cellKinds, detailLine, faceTransform, iso} from './share-card.ts'

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

test('squares show who filled them, never the digit', () => {
  const clue = [true, false, true, false]
  assert.deepEqual(cellKinds(clue, [1]), ['clue', 'star', 'clue', 'fill'])
})

test('the three visible faces meet at one corner and do not overlap', () => {
  const top = faceTransform((i, j) => [i - 1, -1, j - 1], 1, 0, 0)
  const front = faceTransform((i, j) => [i - 1, j - 1, 1], 1, 0, 0)
  const right = faceTransform((i, j) => [1, j - 1, 1 - i], 1, 0, 0)
  const at = (t: number[], u: number, v: number): [number, number] => [
    (t[0] ?? 0) * u + (t[2] ?? 0) * v + (t[4] ?? 0),
    (t[1] ?? 0) * u + (t[3] ?? 0) * v + (t[5] ?? 0),
  ]
  const near = (a: number[], b: number[]): void => {
    assert.ok(Math.abs((a[0] ?? 0) - (b[0] ?? 0)) < 1e-9, `${a} vs ${b}`)
    assert.ok(Math.abs((a[1] ?? 0) - (b[1] ?? 0)) < 1e-9, `${a} vs ${b}`)
  }
  // the near corner (x 1.5, y -1.5, z 1.5) is the top's far grid corner, the front's top right
  // and the right face's top left
  const corner = iso([1.5, -1.5, 1.5])
  near(at(top, 3, 3), corner)
  near(at(front, 3, 0), corner)
  near(at(right, 0, 0), corner)
  // the top sits above the front and right faces
  assert.ok(at(top, 1.5, 1.5)[1] < at(front, 1.5, 1.5)[1])
  assert.ok(at(top, 1.5, 1.5)[1] < at(right, 1.5, 1.5)[1])
})

test('the detail line reads cleanly', () => {
  const d = {levelName: 'Medium', mode: '1 rotation', wrong: 0, hints: 1}
  assert.equal(
    detailLine(d),
    'Medium · 1 rotation · no wrong locks · 1 suggestion',
  )
})
