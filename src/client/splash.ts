import {requestExpandedMode} from '@devvit/web/client'
import './nonet/fonts.css'
import './nonet/cover.css'
import './nonet/feed.css'
import {
  dayKey,
  kanjiNo,
  LEVEL_NAMES,
  levelOf,
  maxTurns,
  multOf,
  scoreRun,
} from '../shared/scoring.ts'
import {getCard} from './api.ts'
import {celebrate, PARTY} from './confetti.ts'
import {foldIntro} from './nonet/splash.js'

// The feed card: the cover, with today's number, difficulty, the most a run can score,
// the rotation multipliers, and how today is going. Play opens the game.
// It opens on black: the cube comes apart into the wordmark, which then lands on the cover's.

const $ = (id: string): HTMLElement | null => document.getElementById(id)

const wait = (ms: number): Promise<void> =>
  new Promise(res => {
    setTimeout(res, ms)
  })

/** Where the intro's wordmark sits in its SVG: 1000 by 184 at (50, 168) in a 1100 by 520 box. */
const MARK = {x: 50, y: 168, w: 1000, box: [1100, 520]} as const

/** Moves the intro's wordmark onto the cover's, and resolves when it lands. */
function flyToCover(svg: SVGSVGElement, target: Element): Promise<void> {
  const r = svg.getBoundingClientRect()
  const t = target.getBoundingClientRect()
  // the SVG is letterboxed in its box: work out where its own wordmark is on screen
  const s = Math.min(r.width / MARK.box[0], r.height / MARK.box[1])
  const ox = (r.width - MARK.box[0] * s) / 2
  const oy = (r.height - MARK.box[1] * s) / 2
  const k = t.width / (MARK.w * s)
  const dx = t.left - r.left - k * (ox + MARK.x * s)
  const dy = t.top - r.top - k * (oy + MARK.y * s)
  return new Promise(res => {
    let done = false
    const end = (): void => {
      if (done) return
      done = true
      res()
    }
    svg.addEventListener('transitionend', e => e.target === svg && end())
    setTimeout(end, 1600)
    svg.style.transform = `translate(${dx}px, ${dy}px) scale(${k})`
  })
}

const DONE_KEY = 'nonet-card-done'
/** Whether this card last showed today as finished. Only a hint: the server's answer decides. */
function seenDone(): boolean {
  try {
    return localStorage.getItem(DONE_KEY) === dayKey()
  } catch {
    return false
  }
}

/** The intro, then the cover. Tapping the black, or reduced motion, goes straight to the cover. */
async function intro(): Promise<void> {
  const body = document.body
  const box = $('intro')
  const svg = document.getElementById('foldsvg') as SVGSVGElement | null
  const mark = document.querySelector('.cv-mark img')
  const show = (): void => {
    body.classList.remove('fd-pre', 'fd-hold')
    box?.remove()
  }
  if (
    !box ||
    !svg ||
    !mark ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    show()
    return
  }
  // Once today is played, the finished cover is there at once, with no cube and nothing
  // fading in, and glitter goes off over it. The card waits up to 1.5s for the answer, or 5s
  // when it last showed today as finished; any slower and the cube plays as usual.
  const card = await Promise.race([
    cardP,
    wait(seenDone() ? 5000 : 1500).then(() => undefined),
  ])
  if (card && card.score !== undefined && !card.past) {
    // the print behind the cover waits until the glitter clears, then fades up
    body.classList.add('fd-now', 'fd-print', 'fd-print-off')
    show()
    requestAnimationFrame(() => body.classList.remove('fd-now'))
    setTimeout(
      () => body.classList.remove('fd-print-off'),
      PARTY.pixelFrom + PARTY.pixelFor * 0.6,
    )
    await celebrate(body)
    return
  }
  let skipped = false
  box.addEventListener('click', () => {
    skipped = true
    show()
  })
  const formed = foldIntro(svg)
  // while the letters are still landing, the black lifts, the cells turn to ink, the cover
  // starts to come in, and the forming wordmark flies onto the cover's
  await wait(1700)
  if (skipped) return
  box.classList.add('fd-lift')
  body.classList.add('fd-in', 'fd-hold')
  body.classList.remove('fd-pre')
  await Promise.all([formed, flyToCover(svg, mark)])
  if (!skipped) show()
}
/**
 * Keeps the whole card in the post's height, as the card can't scroll (feed.css). It drops the
 * extras a step at a time (fit-1 to fit-3) until nothing reaches past the top or bottom. On a
 * tall post nothing is dropped. Waits while the intro still has the cover moved out of place.
 */
const FITS = ['fit-1', 'fit-2', 'fit-3']
function fitCard(): void {
  const body = document.body
  if (body.classList.contains('fd-pre') || body.classList.contains('fd-hold'))
    return
  const parts = document.querySelectorAll<HTMLElement>(
    '.cv-title > *, .cv-mid > *, .cv-mid .cv-links, .dn-acts',
  )
  const title = document.querySelector<HTMLElement>('.cv-title')
  // off the top or bottom of the post, or Play's block pushed up over the title block
  const spills = (): boolean => {
    const h = window.innerHeight
    const under = title?.getBoundingClientRect().bottom ?? 0
    for (const el of parts) {
      // the streak sticker is tilted over the top edge on purpose
      if (!el.offsetParent || el.matches('.cv-sr, .cv-streak')) continue
      const r = el.getBoundingClientRect()
      if (!r.height) continue
      if (r.bottom > h + 0.5 || r.top < -0.5) return true
      if (!title?.contains(el) && r.top < under - 0.5) return true
    }
    return false
  }
  body.classList.remove(...FITS)
  for (const f of FITS) {
    if (!spills()) return
    body.classList.add(f)
  }
}
let fitTimer = 0
/** Fits the card now, and again once anything still sliding in has landed. */
function refit(): void {
  fitCard()
  clearTimeout(fitTimer)
  fitTimer = window.setTimeout(fitCard, 2200)
}
window.addEventListener('resize', refit)
void document.fonts?.ready.then(refit)

// asked for straight away: the intro needs to know if today is already played
const cardP = getCard()
void intro().then(refit)
const MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ')
const WDAYS = 'Sun Mon Tue Wed Thu Fri Sat'.split(' ')

/** The most a run can score on a level: every point on offer at the most rotations, all three ★. */
function maxScore(level: number): number {
  const t = maxTurns(level)
  const stats = {
    turns: t,
    t1: 0,
    t2: 0,
    blanks: 1,
    wrong: 0,
    hintsUsed: 0,
    starsWon: 3,
  }
  return scoreRun(level, t, stats).total
}

/** Builds an element with text, so nothing from the server is read as HTML. */
function el(tag: string, cls: string, text: string): HTMLElement {
  const e = document.createElement(tag)
  e.className = cls
  e.textContent = text
  return e
}

/** The spine's date: "Sun", then "15 Nov" in yellow, the day number upright, then the year. */
function showDate(day: string): void {
  const d = new Date(`${day}T12:00:00Z`)
  const dm = el('span', 'cv-dm', '')
  dm.append(
    el('span', 'cv-tcy', String(d.getUTCDate())),
    ` ${MONTHS[d.getUTCMonth()]}`,
  )
  $('date')?.replaceChildren(
    `${WDAYS[d.getUTCDay()]} `,
    dm,
    ' ',
    el('span', 'cv-yr', String(d.getUTCFullYear())),
  )
}

function showDay(day: string, no: number | undefined): void {
  const level = levelOf(day)
  showDate(day)
  const max = maxScore(level).toLocaleString('en-GB')
  if ($('max')) ($('max') as HTMLElement).textContent = max
  if ($('level'))
    ($('level') as HTMLElement).textContent = LEVEL_NAMES[level] ?? ''
  $('pips')
    ?.querySelectorAll('i')
    .forEach((x, k) => {
      x.classList.toggle('on', k <= level)
    })
  const cells: HTMLElement[] = []
  for (let t = 0; t <= maxTurns(level); t++) {
    const li = el('li', t === maxTurns(level) ? 'max' : '', '')
    li.append(
      el('b', '', `×${multOf(level, t)}`),
      el('small', '', `${t} turn${t === 1 ? '' : 's'}`),
    )
    cells.push(li)
  }
  $('mults')?.replaceChildren(...cells)
  if (no !== undefined) {
    if ($('no')) ($('no') as HTMLElement).textContent = String(no)
    // one span per character, stacked down the spine
    $('kanji')?.replaceChildren(...[...kanjiNo(no)].map(c => el('span', '', c)))
  }
  $('issue')?.setAttribute(
    'aria-label',
    `${no === undefined ? '' : `Cube ${no}. `}${LEVEL_NAMES[level]}. Max score ${max}.`,
  )
}

// the game's day (midnight to midnight Pacific), so the card matches the post title
showDay(dayKey(), undefined)

const startBtn = $('start-btn') as HTMLButtonElement
/**
 * Opens the game on one thing: Play, or a next step. Each has its own entrypoint (a copy of the
 * game, see tools/entries.mjs), as Reddit's app keeps the card's storage apart from the game's.
 * The note in localStorage is for the prototype, where the two share it.
 */
const OPEN_ENTRIES = new Set([
  'practice',
  'rules',
  'challenge',
  'crew',
  'boards',
  'pastboard',
])
function openGame(ev: MouseEvent, what: string | undefined): void {
  if (what)
    try {
      localStorage.setItem('nonet-open', what)
    } catch {}
  requestExpandedMode(ev, what && OPEN_ENTRIES.has(what) ? what : 'game')
}
// Play, or on an older day's post its one button: that day's leaderboard
startBtn.addEventListener('click', ev => openGame(ev, startBtn.dataset.open))
for (const b of document.querySelectorAll<HTMLButtonElement>(
  '[data-open]:not(#start-btn)',
))
  b.addEventListener('click', ev => openGame(ev, b.dataset.open))

/**
 * Whether this device has had the guided practice, as the game keeps it. In demo mode a
 * moderator starts over each time they turn it on, so an earlier practice doesn't count.
 */
function practiced(asNew: number | undefined): boolean {
  try {
    if (asNew && localStorage.getItem('nonet-as-new-at') !== String(asNew))
      return false
    return !!localStorage.getItem('nonet-practiced')
  } catch {
    return false
  }
}

/** A new player: Play starts the one-minute guided practice, like the game's own cover. */
function showFirstTime(): void {
  startBtn.textContent = 'Learn to play · 1 min'
  startBtn.dataset.open = 'practice'
  const live = $('live')
  if (live)
    live.textContent =
      'New to Nonet? A guided practice cube shows you how to play, one step at a time.'
  const practice = document.querySelector<HTMLElement>(
    '[data-open="practice"]:not(#start-btn)',
  )
  practice?.closest('li')?.setAttribute('hidden', '')
  const rules = document.querySelector<HTMLElement>('[data-open="rules"]')
  if (rules) rules.textContent = 'Instructions'
}

/** A stat: a small label over a number. */
function stat(label: string, value: string): HTMLElement {
  const d = document.createElement('div')
  d.append(el('dt', '', label), el('dd', '', value))
  return d
}

// The live numbers: filled in when the server answers, left as they are if it can't.
void cardP.then(card => {
  // the numbers are in (or won't come): the drawn frame gives way to the cover
  document.body.classList.remove('is-loading')
  if (!card) return
  showDay(card.day, card.no)
  // an older day's post keeps its own date, can't be played, and only shows its leaderboard
  if (card.past) {
    const missed = $('missed')
    if (missed) {
      missed.textContent =
        card.score === undefined
          ? 'You missed this cube.'
          : `You scored ${card.score.toLocaleString('en-GB')} on this cube.`
      missed.hidden = false
    }
    startBtn.textContent = 'View leaderboard'
    startBtn.dataset.open = 'pastboard'
    document.body.classList.add('is-past')
    return
  }
  try {
    if (card.score === undefined) localStorage.removeItem(DONE_KEY)
    else localStorage.setItem(DONE_KEY, card.day)
  } catch {}
  if (card.firstTime && !practiced(card.asNew)) showFirstTime()
  if (card.streak > 1) {
    $('streak-n')?.replaceChildren(`${card.streak}-day streak`)
    $('streak')?.removeAttribute('hidden')
  }
  const stats = $('stats')
  if (!stats) return
  const mm = (secs: number): string =>
    `${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, '0')}`
  // before anyone has played, an invitation in place of the numbers
  if (!card.solves && !card.played && card.score === undefined) {
    $('first')?.removeAttribute('hidden')
    return
  }
  const parts = [
    stat('Played today', (card.played ?? card.solves).toLocaleString('en-GB')),
  ]
  if (card.fastest) parts.push(stat('Fastest', mm(card.fastest)))
  if (card.score !== undefined) {
    startBtn.textContent = 'See your solved cube'
    // done today: the card turns to how you did, and each next step opens the game on it
    $('dnScore')?.replaceChildren(card.score.toLocaleString('en-GB'))
    const rank = $('dnRank')
    if (rank && card.rank) {
      rank.textContent = `#${card.rank} today`
      rank.hidden = false
    }
    const streak = $('dnStreak')
    if (streak && card.streak) {
      streak.textContent = `${card.streak}-day streak`
      streak.hidden = false
    }
    if (card.rank) $('dnBoards')?.replaceChildren(`You're #${card.rank} today`)
    $('done')?.removeAttribute('hidden')
    document.body.classList.add('is-done')
  }
  stats.replaceChildren(...parts)
  stats.removeAttribute('hidden')
})
// the card's numbers and next steps change its height: fit it again once they're in
void cardP.then(() => requestAnimationFrame(refit))
