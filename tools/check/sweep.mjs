// The pre-upload sweep: opens every screen of the prototype (the real client code with the
// stand-in server) at phone, tablet and desktop sizes, in light and dark, and fails on
//   - console errors, uncaught exceptions and requests for missing files
//   - broken images
//   - sideways scrolling, or content pushed off the side of the screen
//   - buttons and links that are off screen with no way to scroll to them
//   - accessibility problems axe-core finds (WCAG 2.2 A and AA)
//   - layout shift after the screen has settled
// Warnings (small tap targets, clipped text) are reported but don't fail.
//
// node tools/check/sweep.mjs [--quick] [--only=name] [--out=dir]

import {execFileSync} from 'node:child_process'
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {dirname, join} from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const [k, v] = a.replace(/^--/, '').split('=')
    return [k, v ?? true]
  }),
)
const out = join(root, typeof args.out === 'string' ? args.out : 'dist/sweep')
mkdirSync(out, {recursive: true})
const require = createRequire(import.meta.url)
let playwright
try {
  playwright = require('playwright')
} catch {
  console.error(
    'The sweep needs Playwright: npm ci, then npx playwright install chromium',
  )
  process.exit(2)
}
const axeSrc = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8')

// the prototype: one page with the feed card in an iframe over the game
const proto = join(out, 'proto.html')
execFileSync(
  process.execPath,
  [join(root, 'tools/standalone/build.mjs'), proto],
  {stdio: 'inherit'},
)
const url = pathToFileURL(proto).href
const fresh = readFileSync(
  join(root, 'tools/standalone/fresh.ts'),
  'utf8',
).match(/VERSION = '([^']+)'/)?.[1]

const SIZES = [
  {name: 'phone-se', width: 320, height: 568, mobile: true},
  {name: 'phone', width: 390, height: 844, mobile: true},
  {name: 'phone-land', width: 844, height: 390, mobile: true},
  {name: 'tablet', width: 768, height: 1024, mobile: true},
  {name: 'desktop', width: 1440, height: 900, mobile: false},
]
const sizes = args.quick
  ? SIZES.filter(s => s.name === 'phone' || s.name === 'desktop')
  : SIZES
const schemes = args.quick ? ['dark'] : ['dark', 'light']

/** Played today: a finished run in the stand-in server's store. */
const PLAYED = `(() => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(new Date()).map(x => [x.type, x.value]))
  const day = p.year + '-' + p.month + '-' + p.day
  const s = JSON.parse(localStorage.getItem('nonet-demo') || 'null') || {days: {}, streak: 2, best: 5, played: 11, last: day, notify: false}
  s.days[day] = {tier: 1, started: Date.now() - 300000, score: 1234, stars: 2, retries: 0}
  s.played = Math.max(s.played, 12)
  localStorage.setItem('nonet-demo', JSON.stringify(s))
  localStorage.setItem('nonet-practiced', '1')
})()`

const toGame = async page => {
  await page.evaluate(() =>
    document.getElementById('feedCard')?.classList.add('gone'),
  )
  await page.waitForFunction(() => {
    const s = document.getElementById('splash')
    return s && !s.hidden && !s.classList.contains('is-loading')
  })
}
const modal = page => page.waitForSelector('#modal:not([hidden])')

/** Each screen: how to get there, and which frame to check. */
const SCREENS = [
  ...['', 'first', 'played', 'cycled', 'past'].map(look => ({
    name: `card-${look || 'live'}`,
    session: {'nonet-card-look': look},
    frame: true,
    go: async page => {
      const f = page.frameLocator('#feedFrame')
      await f.locator('body:not(.is-loading)').waitFor()
    },
  })),
  {
    name: 'card-guest',
    session: {'nonet-guest': '1'},
    frame: true,
    go: async page => {
      await page
        .frameLocator('#feedFrame')
        .locator('body:not(.is-loading)')
        .waitFor()
    },
  },
  {
    name: 'game-cover',
    local: PLAYED.replace(
      's.days[day] = ',
      's.days[day] = s.days[day] || ',
    ).replace('{tier: 1', '({}) || {tier: 1'),
    go: toGame,
  },
  {name: 'game-done', local: PLAYED, go: toGame},
  ...['challenge', 'crew', 'team'].map(k => ({
    name: `panel-${k}`,
    local: PLAYED,
    go: async page => {
      await toGame(page)
      const b = page.locator(`[data-dn="${k}"]`)
      if (!(await b.count())) return 'skip'
      await b.click()
      await modal(page)
    },
  })),
  {
    name: 'boards',
    local: PLAYED,
    go: async page => {
      await toGame(page)
      await page.locator('[data-dn="boards"]').click()
      await page.waitForSelector('#lbView:not([hidden])')
    },
  },
  {
    name: 'rules',
    go: async page => {
      await toGame(page)
      await page.evaluate(() =>
        document
          .querySelector('[data-open="rules"], #spHelp')
          ?.dispatchEvent(new MouseEvent('click', {bubbles: true})),
      )
      await page
        .locator('#helpBtn')
        .click({trial: true})
        .catch(() => {})
      if (await page.locator('#modal:not([hidden])').count()) return
      await page
        .locator('#spHelp')
        .click()
        .catch(() => {})
      await modal(page)
    },
  },
  {
    name: 'setup',
    go: async page => {
      await toGame(page)
      await page.locator('#spPlay').click()
      await page
        .waitForSelector('#setup:not([hidden])', {timeout: 5000})
        .catch(() => {})
    },
  },
  {
    name: 'play',
    go: async page => {
      await toGame(page)
      await page.locator('#spPlay').click()
      const start = page.locator('#suStart')
      await start.waitFor({timeout: 5000}).catch(() => {})
      if (await start.isVisible()) await start.click()
      await page.waitForTimeout(2500)
    },
  },
  {
    name: 'practice',
    go: async page => {
      await toGame(page)
      await page.locator('#spPractice').click()
      await page.waitForTimeout(2500)
    },
  },
]
const screens =
  typeof args.only === 'string'
    ? SCREENS.filter(s => s.name.includes(args.only))
    : SCREENS

/** Runs in the page: overflow, off-screen controls, tap targets, clipped text, broken images. */
function inspect() {
  const W = innerWidth,
    H = innerHeight,
    de = document.documentElement
  const errors = [],
    warns = []
  const shown = el => {
    const cs = getComputedStyle(el)
    if (
      cs.visibility === 'hidden' ||
      cs.display === 'none' ||
      Number(cs.opacity) === 0
    )
      return false
    const r = el.getBoundingClientRect()
    // 1px boxes are text kept for screen readers only
    return (
      r.width > 1 &&
      r.height > 1 &&
      !el.closest('[hidden],[aria-hidden="true"],.vh,.sr-only')
    )
  }
  const name = el => {
    const t = (el.getAttribute('aria-label') || el.textContent || '')
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 40)
    return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.classList.length ? `.${[...el.classList].join('.')}` : ''}${t ? ` "${t}"` : ''}`
  }
  // a clipping or scrolling ancestor that keeps this element in check
  const clipped = el => {
    for (
      let p = el.parentElement;
      p && p !== document.body;
      p = p.parentElement
    ) {
      const cs = getComputedStyle(p)
      if (/hidden|clip|auto|scroll/.test(cs.overflowX + cs.overflow)) {
        const r = p.getBoundingClientRect()
        if (r.left >= -1 && r.right <= W + 1) return true
      }
      if (cs.position === 'fixed' && cs.transform !== 'none') return false
    }
    return false
  }
  // with a dialog open, only what's in it has to be reachable
  const dialog = [
    ...document.querySelectorAll('[role="dialog"], dialog[open], .modal'),
  ].find(d => !d.hidden && d.getBoundingClientRect().height > 0)
  if (de.scrollWidth > W + 1)
    errors.push(
      `page scrolls sideways: ${de.scrollWidth}px wide in a ${W}px screen`,
    )
  for (const el of document.querySelectorAll('body *')) {
    if (!shown(el) || (el.closest('svg') && el.tagName !== 'svg')) continue
    const r = el.getBoundingClientRect(),
      cs = getComputedStyle(el)
    // a scroll box that scrolls sideways when it shouldn't
    if (
      /auto|scroll/.test(cs.overflowX) &&
      el.scrollWidth > el.clientWidth + 1 &&
      !el.matches('[data-scroll-x],.bv-tabs,.rtabs')
    )
      errors.push(
        `scrolls sideways: ${name(el)} (${el.scrollWidth} > ${el.clientWidth})`,
      )
    // pushed off the side of the screen
    if (
      (r.right > W + 1 || r.left < -1) &&
      !clipped(el) &&
      cs.position !== 'fixed' &&
      r.width < W * 3
    )
      errors.push(
        `off the side: ${name(el)} spans ${Math.round(r.left)}..${Math.round(r.right)} of ${W}`,
      )
    if (
      el.matches(
        'button, a[href], input, select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])',
      ) &&
      !(dialog && !dialog.contains(el))
    ) {
      // reachable: on screen, or inside something that scrolls to it
      if (r.top >= H || r.bottom <= 0) {
        let scrolls =
          de.scrollHeight > H + 1 &&
          getComputedStyle(document.body).overflowY !== 'hidden'
        for (let p = el.parentElement; p && !scrolls; p = p.parentElement) {
          const pc = getComputedStyle(p)
          if (
            /auto|scroll/.test(pc.overflowY) &&
            p.scrollHeight > p.clientHeight
          )
            scrolls = true
        }
        if (!scrolls)
          errors.push(
            `can't be reached: ${name(el)} is at y=${Math.round(r.top)} in a ${H}px screen with nothing to scroll`,
          )
      }
      if (
        (r.width < 24 || r.height < 24) &&
        !el.closest('p, li') &&
        cs.display !== 'inline'
      )
        warns.push(
          `small tap target: ${name(el)} ${Math.round(r.width)}×${Math.round(r.height)}`,
        )
    }
    // text cut off by its own box, without an ellipsis on purpose
    if (
      cs.overflow === 'hidden' &&
      cs.textOverflow !== 'ellipsis' &&
      el.scrollHeight > el.clientHeight + 3 &&
      el.textContent.trim() &&
      !el.matches('.cv-kanji, [data-clip]') &&
      el.children.length < 4
    )
      warns.push(
        `text may be cut off: ${name(el)} (${el.scrollHeight} > ${el.clientHeight})`,
      )
    if (el.tagName === 'IMG' && el.complete && el.naturalWidth === 0)
      errors.push(`broken image: ${el.getAttribute('src')?.slice(0, 60)}`)
  }
  return {errors: [...new Set(errors)], warns: [...new Set(warns)]}
}

// Safari's engine matters most (Reddit's iOS app), so it runs too where it's installed
const engines = (
  typeof args.browsers === 'string' ? args.browsers : 'chromium,webkit'
).split(',')
const report = []
let failed = 0

// First, the sweep proves it can fail: a page with each kind of problem has to be caught.
{
  const browser = await playwright.chromium.launch()
  const page = await browser.newPage({viewport: {width: 390, height: 600}})
  await page.setContent(`<html lang="en"><body style="margin:0;overflow:hidden">
    <div style="width:600px">wide</div><img src="data:image/png;base64,AAAA" alt="x">
    <button style="position:absolute;top:900px">far</button><p style="color:#777;background:#666">dim</p></body></html>`)
  const r = await page.evaluate(inspect)
  const want = [
    'scrolls sideways',
    'off the side',
    'broken image',
    "can't be reached",
  ]
  const missed = want.filter(w => !r.errors.some(e => e.includes(w)))
  await browser.close()
  if (missed.length) {
    console.error(
      `The sweep's own check failed: it missed ${missed.join(', ')} on a page built to have them.`,
    )
    process.exit(1)
  }
}

/** Every screen at every size, then the card's intro with motion on, where the animation is the risk. */
const runs = []
for (const scheme of schemes)
  for (const size of sizes)
    if (scheme === 'dark' || size.name === 'phone' || size.name === 'desktop')
      for (const sc of screens) runs.push({scheme, size, sc, motion: false})
if (!args.quick)
  for (const sc of screens.filter(
    s => s.name === 'card-live' || s.name === 'card-played',
  ))
    for (const size of SIZES.filter(
      s => s.name === 'phone-se' || s.name === 'desktop',
    ))
      runs.push({scheme: 'dark', size, sc, motion: true})

for (const engine of engines) {
  let browser
  try {
    browser = await playwright[engine].launch()
  } catch {
    console.log(
      `(${engine} isn't installed here, skipped: npx playwright install ${engine})`,
    )
    continue
  }
  // a few screens at a time
  const queue = [...runs]
  const one = async ({scheme, size, sc, motion}) => {
    // WebKit has no isMobile; it gets the phone's size and touch
    const ctx = await browser.newContext({
      viewport: {width: size.width, height: size.height},
      ...(engine === 'chromium' ? {isMobile: size.mobile} : {}),
      hasTouch: size.mobile,
      colorScheme: scheme,
      reducedMotion: motion ? 'no-preference' : 'reduce',
    })
    await ctx.addInitScript(
      ([fresh, local, session]) => {
        if (sessionStorage.getItem('sweep-set')) return
        sessionStorage.setItem('sweep-set', '1')
        if (location.protocol !== 'file:' || window !== top) return
        localStorage.setItem('nonet-fresh', fresh)
        for (const [k, v] of Object.entries(session))
          sessionStorage.setItem(k, v)
        if (local) new Function(local)()
      },
      [fresh, sc.local ?? '', sc.session ?? {}],
    )
    const page = await ctx.newPage()
    const errors = [],
      warns = []
    const local = u => u.startsWith('file:') || u.startsWith('data:')
    page.on(
      'console',
      m =>
        m.type() === 'error' &&
        !/fonts\.g/.test(m.text()) &&
        errors.push(`console: ${m.text().slice(0, 200)}`),
    )
    page.on('pageerror', e =>
      errors.push(`exception: ${e.message.slice(0, 200)}`),
    )
    page.on(
      'requestfailed',
      r =>
        local(r.url()) && errors.push(`missing file: ${r.url().slice(0, 120)}`),
    )
    page.on(
      'response',
      r =>
        r.status() >= 400 &&
        local(r.url()) &&
        errors.push(`${r.status()}: ${r.url()}`),
    )
    const id = `${engine}/${scheme}/${size.name}/${sc.name}${motion ? '-motion' : ''}`
    let skipped = false
    try {
      await page.goto(url, {waitUntil: 'load'})
      skipped = (await sc.go(page)) === 'skip'
      // with motion on, the intro runs about 4s; look as it ends and once it has
      if (motion) {
        await page.waitForTimeout(2500)
        const mid = await (page.frames()[1] ?? page.mainFrame()).evaluate(
          inspect,
        )
        errors.push(...mid.errors.map(e => `during the intro: ${e}`))
        await page.waitForTimeout(2500)
      }
      await page.waitForTimeout(600)
      const target = sc.frame
        ? (page.frame({url: /^about:srcdoc/}) ?? page.frames()[1])
        : page.mainFrame()
      if (!skipped) {
        // layout shift once settled: watch for a second
        const cls = await target.evaluate(
          () =>
            new Promise(res => {
              let total = 0
              new PerformanceObserver(l => {
                for (const e of l.getEntries())
                  if (!e.hadRecentInput) total += e.value
              }).observe({type: 'layout-shift', buffered: false})
              setTimeout(() => res(total), 1000)
            }),
        )
        if (cls > 0.01)
          errors.push(`layout shifts after settling (CLS ${cls.toFixed(2)})`)
        const r = await target.evaluate(inspect)
        errors.push(...r.errors)
        warns.push(...r.warns)
        await target.evaluate(axeSrc)
        const axe = await target.evaluate(async () => {
          const res = await window.axe.run(document, {
            runOnly: {
              type: 'tag',
              values: [
                'wcag2a',
                'wcag2aa',
                'wcag21a',
                'wcag21aa',
                'wcag22aa',
                'best-practice',
              ],
            },
            rules: {region: {enabled: false}},
          })
          return res.violations.map(v => ({
            id: v.id,
            impact: v.impact,
            help: v.help,
            nodes: v.nodes
              .slice(0, 4)
              .map(
                n =>
                  n.target.join(' ') +
                  (n.any[0]?.message
                    ? ` (${n.any[0].message.slice(0, 120)})`
                    : ''),
              ),
          }))
        })
        for (const v of axe) {
          const line = `a11y ${v.id}: ${v.help} — ${v.nodes.join('; ')}`
          if (v.impact === 'serious' || v.impact === 'critical')
            errors.push(line)
          else warns.push(line)
        }
        mkdirSync(join(out, engine, scheme, size.name), {recursive: true})
        await page.screenshot({path: join(out, `${id}.png`)})
      }
    } catch (e) {
      errors.push(
        `couldn't reach the screen: ${String(e.message).split('\n')[0]}`,
      )
    }
    await ctx.close()
    if (skipped) return
    if (errors.length) failed++
    report.push({id, errors, warns})
    report.sort((a, b) => a.id.localeCompare(b.id))
    console.log(
      `${errors.length ? '✗' : '✓'} ${id}${errors.length ? `: ${errors.length} problem(s)` : ''}${warns.length ? `, ${warns.length} warning(s)` : ''}`,
    )
    for (const e of errors) console.log(`    ${e}`)
  }
  await Promise.all(
    Array.from({length: Number(args.jobs) || 4}, async () => {
      for (let r = queue.shift(); r; r = queue.shift()) await one(r)
    }),
  )
  await browser.close()
}
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2))
console.log(
  `\n${report.length - failed} of ${report.length} screens clean. Report and screenshots: ${out}`,
)
process.exit(failed ? 1 : 0)
