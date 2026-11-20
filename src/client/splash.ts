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
    setTimeout(end, 1300)
    svg.style.transform = `translate(${dx}px, ${dy}px) scale(${k})`
  })
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
  let skipped = false
  box.addEventListener('click', () => {
    skipped = true
    show()
  })
  await foldIntro(svg)
  await wait(650)
  if (skipped) return
  // the black lifts, the cells turn to ink, and the cover comes in around the flying wordmark
  box.classList.add('fd-lift')
  body.classList.add('fd-in', 'fd-hold')
  body.classList.remove('fd-pre')
  await flyToCover(svg, mark)
  if (!skipped) show()
}
void intro()
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
      el('small', '', `${t} rotation${t === 1 ? '' : 's'}`),
    )
    cells.push(li)
  }
  $('mults')?.replaceChildren(...cells)
  if (no !== undefined) {
    if ($('no')) ($('no') as HTMLElement).textContent = String(no)
    if ($('kanji')) ($('kanji') as HTMLElement).textContent = kanjiNo(no)
  }
  $('issue')?.setAttribute(
    'aria-label',
    `${no === undefined ? '' : `Cube ${no}. `}${LEVEL_NAMES[level]}. Max score ${max}.`,
  )
}

// the game's day (midnight to midnight Pacific), so the card matches the post title
showDay(dayKey(), undefined)

const startBtn = $('start-btn') as HTMLButtonElement
startBtn.addEventListener('click', ev => requestExpandedMode(ev, 'game'))
// the next steps open the game with that one ready, passed through this device's storage
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-open]'))
  b.addEventListener('click', ev => {
    try {
      localStorage.setItem('nonet-open', b.dataset.open ?? '')
    } catch {}
    requestExpandedMode(ev, 'game')
  })

/** A stat: a small label over a number. */
function stat(label: string, value: string): HTMLElement {
  const d = document.createElement('div')
  d.append(el('dt', '', label), el('dd', '', value))
  return d
}

// The live numbers: filled in when the server answers, left as they are if it can't.
void getCard().then(card => {
  if (!card) return
  showDay(card.day, card.no)
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
