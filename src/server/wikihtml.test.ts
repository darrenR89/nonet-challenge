import assert from 'node:assert/strict'
import {test} from 'node:test'
import {indexPage, WIKI_PAGES, wikiPages} from './wiki.ts'
import {inlineHtml, markdownToHtml} from './wikihtml.ts'

test('bold, italic and links become plain HTML, and text is escaped', () => {
  assert.equal(
    inlineHtml(
      '**Pick.** Then *dial in* & see [Scoring](/r/s/wiki/nonet/scoring) <3',
    ),
    '<strong>Pick.</strong> Then <em>dial in</em> &amp; see <a href="https://www.reddit.com/r/s/wiki/nonet/scoring">Scoring</a> &lt;3',
  )
  // underscores inside words are left alone
  assert.equal(inlineHtml('r/nonet_challenge_dev'), 'r/nonet_challenge_dev')
})

test('headings, lists, tables, rules and paragraphs keep their shape', () => {
  assert.equal(
    markdownToHtml(
      '# Nonet\n\nOne line\nand the next.\n\n1. **Pick.** First\n2. Second\n\n| Fill | Days |\n|:--|--:|\n| Easy | 2 |\n\n- a\n\n---\n\n*Footer.*',
    ),
    [
      '<h1>Nonet</h1>',
      '<p>One line and the next.</p>',
      '<ol><li><strong>Pick.</strong> First</li><li>Second</li></ol>',
      '<table><thead><tr><th>Fill</th><th>Days</th></tr></thead><tbody><tr><td>Easy</td><td>2</td></tr></tbody></table>',
      '<ul><li>a</li></ul>',
      '<hr>',
      '<p><em>Footer.</em></p>',
    ].join('\n'),
  )
})

test('every Nonet page converts with no markdown left showing', () => {
  const b = {key: 'k', label: 'l', top: [], me: undefined, players: 0}
  const pages = wikiPages(
    {
      day: '2026-11-21',
      flair: true,
      founders: true,
      streaks: b,
      all: b,
      weeks: [],
    },
    'sub',
  )
  pages.set('index', indexPage('sub'))
  assert.equal(pages.size, WIKI_PAGES.length + 2)
  for (const [name, md] of pages) {
    const text = markdownToHtml(md).replace(/<[^>]+>/g, '')
    assert.doesNotMatch(text, /\*\*|\]\(|^#|^\|/m, name)
  }
})
