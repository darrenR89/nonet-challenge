// Builds one self-contained HTML file of the current game, with the stand-in server.
// node tools/standalone/build.mjs [out.html]
import {build} from 'esbuild'
import {readdirSync, readFileSync, writeFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const out = process.argv[2] ?? join(root, 'dist/nonet-prototype.html')
const r = await build({
  entryPoints: [join(root, 'tools/standalone/entry.ts')],
  bundle: true, minify: true, write: false, format: 'esm', target: 'es2022',
  platform: 'browser', conditions: ['browser'], outdir: 'x',
  // the page loads the full fonts from Google Fonts instead of the Reddit subsets
  plugins: [{name: 'nofonts', setup(b) { b.onLoad({filter: /fonts\.css$/}, () => ({contents: '', loader: 'css'})) }}],
  external: ['/brand/*'],
})
// the feed card, built on its own and shown first in an iframe, as Reddit shows it in the feed
const c = await build({
  entryPoints: [join(root, 'tools/standalone/card.ts')],
  bundle: true, minify: true, write: false, format: 'esm', target: 'es2022',
  platform: 'browser', conditions: ['browser'], outdir: 'x',
  plugins: [{name: 'nofonts', setup(b) { b.onLoad({filter: /fonts\.css$/}, () => ({contents: '', loader: 'css'})) }},
    {name: 'devvit-card', setup(b) { b.onResolve({filter: /^@devvit\/web\/client$/}, () => ({path: join(root, 'tools/standalone/devvit-card.ts')})) }}],
  external: ['/brand/*'],
})
const js = r.outputFiles.find(f => f.path.endsWith('.js')).text
let css = r.outputFiles.find(f => f.path.endsWith('.css'))?.text ?? ''
const b64 = p => readFileSync(join(root, p)).toString('base64')
// the cover's brand files, inlined so the page works on its own
const brand = t =>
  t
    .replaceAll('/brand/nonet-wordmark-vertical.svg', `data:image/svg+xml;base64,${b64('public/brand/nonet-wordmark-vertical.svg')}`)
    .replaceAll('/brand/paper.jpg', `data:image/jpeg;base64,${b64('public/brand/paper.jpg')}`)
    .replaceAll('/brand/harunobu-line.jpg', `data:image/jpeg;base64,${b64('public/brand/harunobu-line.jpg')}`)
css = brand(css).replaceAll('/brand/paper-overlay.webp', `data:image/webp;base64,${b64('public/brand/paper-overlay.webp')}`)
const fontsLink = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DotGothic16&family=IBM+Plex+Sans+JP:wght@400;500;700&family=M+PLUS+1+Code:wght@400;500;700&display=swap">`
const cardJs = c.outputFiles.find(f => f.path.endsWith('.js')).text
const cardCss = brand(c.outputFiles.find(f => f.path.endsWith('.css'))?.text ?? '')
  .replaceAll('/brand/paper-overlay.webp', `data:image/webp;base64,${b64('public/brand/paper-overlay.webp')}`)
const cardHtml = brand(readFileSync(join(root, 'public/splash.html'), 'utf8'))
  .replace(/<link rel="modulepreload"[^>]*>\n?/, '')
  .replace('<link rel="stylesheet" href="splash.css">', () => `${fontsLink}<style>${cardCss}</style>`)
  .replace('<script src="splash.js" type="module"></script>', () => `<script type="module">${cardJs.replaceAll('</script', '<\\/script')}</script>`)
const attr = t => t.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
const cardLayer = `<div class="feedcard" id="feedCard">
<iframe id="feedFrame" title="Nonet post card, as it shows in the feed" srcdoc="${attr(cardHtml)}"></iframe>
<div class="looks" role="group" aria-label="Prototype: card states"><span>Card</span><button type="button" data-look="" aria-pressed="true">Live</button><button type="button" data-look="first" aria-pressed="false">Quiet day</button><button type="button" data-look="played" aria-pressed="false">Played</button><button type="button" data-look="cycled" aria-pressed="false">Day 366</button></div>
</div>`
// the music loops, inlined so the page plays them without a server
const music = Object.fromEntries(readdirSync(join(root, 'public/music')).filter(f => f.endsWith('.wav'))
  .map(f => [f.slice(0, -4), `data:audio/wav;base64,${b64(`public/music/${f}`)}`]))
let html = brand(readFileSync(join(root, 'public/game.html'), 'utf8'))
html = html
  .replace(/<link rel="modulepreload"[^>]*>\n?/, '')
  .replace('<link rel="stylesheet" href="game.css">', () => `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DotGothic16&family=IBM+Plex+Sans+JP:wght@400;500;700&family=M+PLUS+1+Code:wght@400;500;700&display=swap">
<link rel="icon" href="data:image/svg+xml;base64,${b64('public/brand/nonet-icon.svg')}" type="image/svg+xml">
<style>${css}
.feedcard{position:fixed;inset:0;z-index:80;background:var(--sumi);transition:opacity .35s ease,visibility .35s}
.feedcard.gone{opacity:0;visibility:hidden}
.feedcard iframe{display:block;border:0;width:100%;height:100%}
.looks{position:absolute;left:50%;transform:translateX(-50%);bottom:max(10px,env(safe-area-inset-bottom,0px));display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:6px;width:max-content;max-width:calc(100% - 32px);font-family:var(--code);font-size:11px;color:var(--lead)}
.looks button{font:inherit;color:var(--lead);background:var(--slate);border:1px solid var(--edge);border-radius:6px;padding:4px 8px;min-height:28px;cursor:pointer}
.looks button[aria-pressed="true"]{color:var(--washi);border-color:var(--lead)}
@media (prefers-reduced-motion:reduce){.feedcard{transition:none}}
.demo{position:fixed;left:max(8px,env(safe-area-inset-left,0px));bottom:max(8px,env(safe-area-inset-bottom,0px));z-index:70;font-family:var(--code);font-size:11px;color:var(--lead);background:var(--slate);border:1px solid var(--edge);border-radius:6px;padding:4px 8px;min-height:0;opacity:.85}</style>`)
  .replace('/brand/nonet-wordmark.svg', `data:image/svg+xml;base64,${b64('public/brand/nonet-wordmark.svg')}`)
  .replace('<script src="game.js" type="module"></script>', () => `${cardLayer}
<button class="demo" id="resetDemo" type="button" title="Prototype: start today over in this browser">Reset demo</button>
<script>window.nonetMusic=${JSON.stringify(music)}</script>
<script type="module">${js.replaceAll('</script', '<\\/script')}</script>`)
writeFileSync(out, html)
console.log(`${out} ${(html.length / 1024).toFixed(1)} KB`)
