import assert from 'node:assert/strict'
import {test} from 'node:test'
import {inline, markdownToRichtext} from './richtext.ts'
import {WIKI_PAGES, wikiPages} from './wiki.ts'

test('bold, italic and links become rich text ranges and links', () => {
  assert.deepEqual(inline('**Pick your turns.** Before you play'), [
    {e: 'text', t: 'Pick your turns. Before you play', f: [[1, 0, 16]]},
  ])
  assert.deepEqual(inline('*Written by the app.*'), [
    {e: 'text', t: 'Written by the app.', f: [[2, 0, 19]]},
  ])
  assert.deepEqual(
    inline('- see [Scoring](/r/sub/wiki/nonet/scoring): points'),
    [
      {e: 'text', t: '- see '},
      {
        e: 'link',
        t: 'Scoring',
        u: 'https://www.reddit.com/r/sub/wiki/nonet/scoring',
      },
      {e: 'text', t: ': points'},
    ],
  )
  // underscores inside words are left alone
  assert.deepEqual(inline('r/nonet_challenge_dev'), [
    {e: 'text', t: 'r/nonet_challenge_dev'},
  ])
})

test('headings, lists, tables, rules and paragraphs keep their shape', () => {
  const doc = JSON.parse(
    markdownToRichtext(
      '# Nonet\n\nOne line\nand the next.\n\n## A day\n\n1. **Pick.** First\n2. Second\n\n| Fill | Days |\n|:--|--:|\n| Easy | 2 |\n\n- [Home](/r/s/wiki/nonet)\n\n---\n\n*Footer.*',
    ),
  )
  assert.deepEqual(
    doc.document.map((b: {e: string}) => b.e),
    ['h', 'par', 'h', 'list', 'table', 'list', 'hr', 'par'],
  )
  assert.deepEqual(doc.document[0], {e: 'h', l: 1, c: [{e: 'raw', t: 'Nonet'}]})
  assert.equal(doc.document[1].c[0].t, 'One line and the next.')
  assert.equal(doc.document[3].o, true)
  assert.equal(doc.document[3].c.length, 2)
  assert.deepEqual(doc.document[4].h, [
    {a: 'L', c: [{e: 'text', t: 'Fill'}]},
    {a: 'R', c: [{e: 'text', t: 'Days'}]},
  ])
  assert.deepEqual(doc.document[4].c, [
    [{c: [{e: 'text', t: 'Easy'}]}, {c: [{e: 'text', t: '2'}]}],
  ])
  assert.equal(doc.document[5].o, false)
})

test('every Nonet page converts with no markdown left showing', () => {
  const pages = wikiPages(
    {
      day: '2026-11-21',
      flair: true,
      founders: true,
      streaks: {key: 's', label: 'Streaks', top: [], me: undefined, players: 0},
      all: {key: 'k', label: 'All time', top: [], me: undefined, players: 0},
      weeks: [],
    },
    'sub',
  )
  assert.equal(pages.size, WIKI_PAGES.length + 1)
  for (const [name, md] of pages) {
    const rt = markdownToRichtext(md)
    const texts = [...rt.matchAll(/"t":"((?:[^"\\]|\\.)*)"/g)].map(
      m => m[1] ?? '',
    )
    for (const t of texts)
      assert.doesNotMatch(t, /\*\*|\]\(|^#|^\|/, `${name}: "${t}"`)
  }
})
