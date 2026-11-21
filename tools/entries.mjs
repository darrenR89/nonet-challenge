// The feed card opens the game on one thing (the practice cube, the rules, a next step) by
// opening a different entrypoint: Reddit's app keeps the card's and the game's storage apart,
// so a note left in localStorage doesn't reach the game. Each entrypoint is a copy of
// game.html, and the game reads which one it is from its own file name.
import {readFileSync, writeFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'

export const OPEN_ENTRIES = [
  'practice',
  'rules',
  'challenge',
  'crew',
  'boards',
  'pastboard',
]

const pub = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const game = readFileSync(join(pub, 'game.html'), 'utf8')
// each copy carries its own name in a meta tag in the head: the Devvit upload keeps only one
// of several files with the same contents (after it rewrites the page, which drops comments),
// and the others then aren't found on Reddit
if (!game.includes('<head>')) throw new Error('game.html has no <head>')
for (const k of OPEN_ENTRIES)
  writeFileSync(
    join(pub, `open-${k}.html`),
    game.replace('<head>', `<head>\n<meta name="nonet-entry" content="${k}">`),
  )
