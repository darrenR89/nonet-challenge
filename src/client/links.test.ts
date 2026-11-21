import assert from 'node:assert/strict'
import {existsSync, readdirSync, readFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {test} from 'node:test'
import {fileURLToPath} from 'node:url'

// Guards against broken links and missing files: every entry page, card button, brand image
// and font the pages ask for has to be there, or Reddit shows "Not Found" or a blank box.

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (p: string): string => readFileSync(join(root, p), 'utf8')

/** The words in the first `[...]` or `new Set([...])` after `marker` in a source file. */
function listAfter(src: string, marker: string): string[] {
  const at = src.indexOf(marker)
  assert.notEqual(at, -1, `${marker} not found`)
  const open = src.indexOf('[', at)
  const close = src.indexOf(']', open)
  return [...src.slice(open, close).matchAll(/'([a-z]+)'/g)].map(
    m => m[1] ?? '',
  )
}

type Devvit = {post: {entrypoints: Record<string, {entry: string}>}}
const devvit = JSON.parse(read('devvit.json')) as Devvit
const entries = devvit.post.entrypoints
const built = listAfter(read('tools/entries.mjs'), 'OPEN_ENTRIES')
const cardKnows = listAfter(read('src/client/splash.ts'), 'OPEN_ENTRIES')

test('every entrypoint is a page in public/, or one the build writes', () => {
  for (const [name, {entry}] of Object.entries(entries)) {
    const m = entry.match(/^open-([a-z]+)\.html$/)
    if (m)
      assert.ok(
        built.includes(m[1] ?? ''),
        `${name}: ${entry} is never written`,
      )
    else
      assert.ok(
        existsSync(join(root, 'public', entry)),
        `${name}: public/${entry} is missing`,
      )
  }
})

test('the card and the build agree on which pages open the game on one thing', () => {
  assert.deepEqual([...cardKnows].sort(), [...built].sort())
  for (const k of built)
    assert.equal(
      entries[k]?.entry,
      `open-${k}.html`,
      `devvit.json has no "${k}" entrypoint`,
    )
})

test('every button on the card opens an entrypoint the game knows', () => {
  const opens = [
    ...read('public/splash.html').matchAll(/data-open="([a-z]+)"/g),
    ...read('src/client/splash.ts').matchAll(/dataset\.open = '([a-z]+)'/g),
  ].map(m => m[1] ?? '')
  assert.ok(opens.length > 0)
  for (const k of opens)
    assert.ok(cardKnows.includes(k), `data-open="${k}" has no entrypoint`)
  // and the game handles each one when it's opened on it
  const game = read('src/client/nonet/game.js')
  const handled = new Set(['rules', 'pastboard', 'practice', 'boards'])
  for (const m of game.matchAll(/dnRow\('([a-z]+)'/g)) handled.add(m[1] ?? '')
  for (const k of built)
    assert.ok(handled.has(k), `the game does nothing when opened on "${k}"`)
})

test('every /brand and /fonts file a page or stylesheet asks for exists', () => {
  const files = [
    'public/splash.html',
    'public/game.html',
    ...readdirSync(join(root, 'src/client/nonet')).map(
      f => `src/client/nonet/${f}`,
    ),
    ...readdirSync(join(root, 'src/client')).map(f => `src/client/${f}`),
  ].filter(f => /\.(html|css|js|ts)$/.test(f) && !f.endsWith('.test.ts'))
  let seen = 0
  for (const f of files)
    for (const m of read(f).matchAll(
      /\/(brand|fonts)\/[\w.-]+\.(svg|jpg|png|webp|woff2)/g,
    )) {
      seen++
      assert.ok(
        existsSync(join(root, 'public', m[0])),
        `${f} asks for ${m[0]}, which isn't in public/`,
      )
    }
  assert.ok(seen > 10)
})

test('the pages load the scripts and styles the build writes, and have no repeated ids', () => {
  const outs = new Set(['splash.js', 'splash.css', 'game.js', 'game.css'])
  for (const page of ['public/splash.html', 'public/game.html']) {
    const html = read(page)
    for (const m of html.matchAll(/(?:src|href)="([^"/:#][^"]*)"/g))
      assert.ok(
        outs.has(m[1] ?? ''),
        `${page} loads ${m[1]}, which the build doesn't write`,
      )
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1])
    const twice = ids.filter((id, i) => ids.indexOf(id) !== i)
    assert.deepEqual(twice, [], `${page} repeats ids`)
  }
})
