import {requestExpandedMode} from '@devvit/web/client'
import './nonet/fonts.css'
import './nonet/feed.css'
import {dayKey, kanjiNo, padNo, shortDate} from '../shared/scoring.ts'
import {getCard} from './api.ts'
import {foldIntro} from './nonet/splash.js'

// The feed card: the Nonet cube comes apart into the wordmark, then the date, how today
// is going, and Play, which opens the game.

const fold = document.getElementById('foldsvg')
if (fold) void foldIntro(fold)

const day = document.getElementById('day')
if (day)
  // the game's day (midnight to midnight Pacific), so the card matches the post title
  day.textContent = `Today's cube · ${shortDate(dayKey())}`

const startBtn = document.getElementById('start-btn') as HTMLButtonElement
startBtn.addEventListener('click', ev => requestExpandedMode(ev, 'game'))

const live = document.getElementById('live')

/** Builds an element with text, so nothing from the server is read as HTML. */
function el(tag: string, cls: string, text: string): HTMLElement {
  const e = document.createElement(tag)
  e.className = cls
  e.textContent = text
  return e
}

// The live line: filled in when the server answers, left as it is if it can't.
void getCard().then(card => {
  if (!card) return
  if (day) {
    day.replaceChildren(
      `No.${padNo(card.no)} `,
      el('span', 'kanji', kanjiNo(card.no)),
      ` · ${shortDate(card.day)}`,
    )
    day.setAttribute('aria-label', `Cube ${card.no}, ${shortDate(card.day)}`)
  }
  if (!live) return
  const parts: HTMLElement[] = []
  if (card.streak > 1)
    parts.push(el('span', 'streak', `${card.streak}-day streak`))
  const played = card.played ?? card.solves
  if (card.score !== undefined) {
    const at = card.rank ? ` · #${card.rank} today` : ''
    parts.push(
      el('span', '', `You scored ${card.score.toLocaleString('en-GB')}${at}`),
    )
    startBtn.textContent = 'See how you did'
  } else if (played > 0) {
    parts.push(el('span', '', `${played.toLocaleString('en-GB')} played today`))
  } else {
    parts.push(el('span', '', 'No one has played yet. Be the first.'))
  }
  live.replaceChildren(...parts)
})
