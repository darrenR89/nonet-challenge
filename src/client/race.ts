// The weekly top nine post: the week's board played back a day at a time. The bars grow with each
// day's points and players swap places; the player's own bar is yellow, with the gap to ninth.
import './nonet/fonts.css'
import './nonet/race.css'
import type {RaceRow} from '../shared/api.ts'
import {addDays, shortDate} from '../shared/scoring.ts'
import {getRace} from './api.ts'

const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id)
  if (!el) throw Error(`no #${id}`)
  return el
}
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
/** Time on each day while the week plays. */
const STEP = 1100
const num = (n: number): string => n.toLocaleString('en-GB')
const ordinal = (n: number): string =>
  `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`
const sumTo = (r: RaceRow, d: number): number =>
  r.points.slice(0, d + 1).reduce((a, b) => a + b, 0)
const esc = (s: string): string =>
  s.replace(
    /[&<>"]/g,
    c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c] ?? c,
  )

async function main(): Promise<void> {
  const race = (await getRace())?.race
  const wr = $('wr')
  wr.removeAttribute('aria-busy')
  if (!race?.rows.length) {
    for (const el of wr.children) (el as HTMLElement).hidden = true
    $('wrEmpty').hidden = false
    return
  }
  $('wrTitle').textContent = race.final
    ? "The week's top nine"
    : "The week's top nine so far"
  $('wrMeta').textContent =
    `Week of ${shortDate(race.from)} · ${num(race.players)} played`

  // the bars: the top nine, then the asker below a dashed line when they're further down
  const rows: (RaceRow & {me?: boolean})[] = race.rows.map(r => ({
    ...r,
    me: r.name === race.myName,
  }))
  if (race.me) rows.push({...race.me, me: true})
  const list = $('wrRace')
  list.style.height = `calc(${rows.length} * var(--row))`
  const bars = rows.map(r => {
    const li = document.createElement('li')
    li.className = `wr-bar${r.me ? ' me' : ''}`
    li.innerHTML = `<span class="wr-rk"></span><div class="wr-lane"><div class="wr-len"></div><div class="wr-lbl"><span><span>${r.me ? 'You' : `u/${esc(r.name)}`}</span><span class="wr-mv"></span></span><em></em></div></div>`
    list.append(li)
    return li
  })
  // the last day with any points: a week so far stops there
  const lastDay = race.final
    ? 6
    : Math.max(0, ...rows.map(r => r.points.findLastIndex(p => p > 0)))

  const days = $('wrDays')
  const dayBtns = DAYS.map((name, i) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = name
    b.setAttribute('aria-label', `${name} ${shortDate(addDays(race.from, i))}`)
    b.setAttribute('aria-pressed', 'false')
    b.disabled = i > lastDay
    b.onclick = () => {
      stop()
      show(i, null)
    }
    days.append(b)
    return b
  })

  /** Ranks after day d: index into rows → place (0 is first). The asker's own row keeps its real rank. */
  const ranksAt = (d: number): number[] => {
    const order = rows
      .map((r, i) => ({
        i,
        v: sumTo(r, d),
        mine: !!race.me && i === rows.length - 1,
      }))
      .filter(x => !x.mine)
      .sort((a, b) => b.v - a.v || a.i - b.i)
    const out: number[] = []
    order.forEach((x, k) => {
      out[x.i] = k
    })
    if (race.me) out[rows.length - 1] = rows.length - 1
    return out
  }

  const show = (d: number, prev: number | null): void => {
    const rank = ranksAt(d)
    const was = prev === null ? null : ranksAt(prev)
    const max = Math.max(1, ...rows.map(r => sumTo(r, d)))
    bars.forEach((b, i) => {
      const r = rows[i]
      if (!r) return
      const k = rank[i] ?? i
      b.style.transform = `translateY(calc(${k} * var(--row)))`
      b.classList.toggle('cut', !!race.me && i === rows.length - 1)
      const rk = b.querySelector('.wr-rk')
      if (rk)
        rk.textContent =
          race.me && i === rows.length - 1 && d === lastDay
            ? String(race.me.rank)
            : race.me && i === rows.length - 1
              ? ''
              : String(k + 1)
      const len = b.querySelector<HTMLElement>('.wr-len')
      const w = (sumTo(r, d) / max) * 100
      if (len) len.style.width = `${w}%`
      // the total sits on the bar once the bar reaches it
      b.classList.toggle('full', w > 78)
      const em = b.querySelector('em')
      if (em) em.textContent = num(sumTo(r, d))
      const mv = b.querySelector('.wr-mv')
      const delta = was ? (was[i] ?? k) - k : 0
      if (mv) {
        mv.textContent = delta > 0 ? `↑${delta}` : delta < 0 ? `↓${-delta}` : ''
        mv.className = `wr-mv${delta > 0 ? ' up' : delta < 0 ? ' dn' : ''}`
      }
    })
    dayBtns.forEach((b, i) => {
      b.setAttribute('aria-pressed', i === d ? 'true' : 'false')
      b.classList.toggle('done', i < d)
    })
    const gap = $('wrGap')
    const ninth = race.rows.at(-1)
    if (race.me && ninth && d === lastDay)
      gap.innerHTML = `You're <b>${ordinal(race.me.rank)}</b>, <b>${num(sumTo(ninth, d) - sumTo(race.me, d))} points</b> off the board.`
    else if (race.myName && d === lastDay) {
      const i = rows.findIndex(r => r.me)
      gap.innerHTML = `You're <b>${ordinal((rank[i] ?? 0) + 1)}</b> this week.`
    } else gap.textContent = ''
  }

  // call-outs: biggest climber from Wednesday to the end, longest streak, top crew
  const trio: string[] = []
  if (lastDay >= 3) {
    const mid = ranksAt(2)
    const end = ranksAt(lastDay)
    let best: {name: string; up: number} | undefined
    race.rows.forEach((r, i) => {
      const up = (mid[i] ?? 0) - (end[i] ?? 0)
      if (up > (best?.up ?? 0)) best = {name: r.name, up}
    })
    if (best)
      trio.push(
        `<div>Biggest climber<b>u/${esc(best.name)} ↑${best.up}</b></div>`,
      )
  }
  if (race.streak && race.streak.days >= 2)
    trio.push(
      `<div>Longest streak<b>u/${esc(race.streak.name)} · ${race.streak.days} days</b></div>`,
    )
  if (race.crew)
    trio.push(`<div>Crew of the week<b>${esc(race.crew.name)}</b></div>`)
  $('wrTrio').innerHTML = trio.join('')
  $('wrTrio').hidden = !trio.length

  let timer = 0
  const stop = (): void => {
    clearInterval(timer)
    timer = 0
  }
  const play = (): void => {
    stop()
    let d = 0
    show(0, null)
    timer = window.setInterval(() => {
      if (d >= lastDay) {
        stop()
        return
      }
      d++
      show(d, d - 1)
    }, STEP)
  }
  $('wrPlay').onclick = play
  if (matchMedia('(prefers-reduced-motion: reduce)').matches)
    show(lastDay, null)
  else play()
}

void main()
