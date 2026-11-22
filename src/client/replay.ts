// The play of the week post: the week's best run, played back from its move log on the cube.
// It plays in the feed by itself, about 45 seconds whatever the run's length, and ends on
// "Play today's cube".
import {navigateToPost} from '@devvit/web/client'
import './nonet/fonts.css'
import './nonet/replay.css'
import type {ReplayRsp} from '../shared/api.ts'
import {cells, N, setLayout, turnArr} from '../shared/model.js'
import {decodeLog, type LogEvent} from '../shared/replay.ts'
import {LEVEL_NAMES, shortDate} from '../shared/scoring.ts'
import {getReplay} from './api.ts'

const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id)
  if (!el) throw Error(`no #${id}`)
  return el
}

/** How long a run takes to play at normal speed, in seconds. */
const TARGET = 45
/** Face order and transforms, as in shared/model.js: front, back, right, left, top, bottom. */
const FACES = [
  'translateZ(var(--h))',
  'rotateY(180deg) translateZ(var(--h))',
  'rotateY(90deg) translateZ(var(--h))',
  'rotateY(-90deg) translateZ(var(--h))',
  'rotateX(90deg) translateZ(var(--h))',
  'rotateX(-90deg) translateZ(var(--h))',
]
const SHADE = ['', '', 'r', 'l', '', '']
/** The view that shows each face, with a little of its neighbours. */
const VIEW: [number, number][] = [
  [-24, -28],
  [-24, 152],
  [-24, -118],
  [-24, 62],
  [-62, -28],
  [52, -28],
]

/** The cube after each event, and which squares were clues at that point. */
type Frame = {ev: LogEvent; vals: number[]; given: boolean[]}

function framesOf(start: number[], ev: LogEvent[]): Frame[] {
  let vals = start.slice()
  let given = start.map(Boolean)
  let dialled = false
  return ev.map(e => {
    if (e.kind === 'turn') {
      vals = turnArr(vals, ...e.move)
      given = vals.map(Boolean)
    } else if (e.kind === 'dial') {
      dialled = true
      given = vals.map(Boolean)
    } else if (dialled && (e.kind === 'lock' || e.kind === 'help-lock')) {
      vals = vals.slice()
      vals[e.cell] = e.digit
    }
    return {ev: e, vals, given}
  })
}

const clock = (tenths: number): string => {
  const s = Math.floor(tenths / 10)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

async function main(): Promise<void> {
  const rsp: ReplayRsp | undefined = await getReplay()
  const rp = $('rp')
  rp.removeAttribute('aria-busy')
  const play = rsp?.play
  const ev = play ? decodeLog(play.log) : undefined
  if (!play || !ev?.length) {
    for (const el of rp.children) (el as HTMLElement).hidden = true
    $('rpEmpty').hidden = false
    return
  }
  setLayout(play.layout)
  const frames = framesOf(play.start, ev)
  const END = ev.at(-1)?.t ?? 1
  const blanks = frames
    .find(f => f.ev.kind === 'dial')
    ?.vals.filter(v => !v).length
  const stars = new Set(ev.flatMap(e => (e.kind === 'star' ? [e.cell] : [])))
  const turnsTotal = ev.filter(e => e.kind === 'turn').length

  $('rpName').textContent = `u/${play.name}`
  $('rpMeta').textContent =
    `Cube #${play.cubeNo} · ${shortDate(play.day)} · ${LEVEL_NAMES[play.level] ?? ''} · ${play.tier} turn${play.tier === 1 ? '' : 's'}`

  // the cube
  const cube = $('rpCube')
  const st: HTMLElement[] = []
  FACES.forEach((t, fi) => {
    const f = document.createElement('div')
    f.className = `rp-face ${SHADE[fi]}`
    f.style.transform = t
    for (let k = 0; k < 9; k++) {
      const s = document.createElement('div')
      s.className = 'rp-st'
      f.append(s)
      st[fi * 9 + k] = s
    }
    cube.append(f)
  })
  let rx = -24
  let ry = -28
  const look = (fi: number): void => {
    const [x, y] = VIEW[fi] ?? [-24, -28]
    ry += ((((y - ry) % 360) + 540) % 360) - 180
    rx = x
    cube.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg)`
  }
  look(0)
  const faceOf = (c: number): number => Math.floor(c / 9)

  // the timeline, with a mark for each turn, the dial-in, each ★ lock and each miss
  const track = $('rpTrack')
  for (const e of ev) {
    const k =
      e.kind === 'turn'
        ? 't'
        : e.kind === 'dial'
          ? 's'
          : e.kind === 'miss'
            ? 'w'
            : e.kind === 'lock' && stars.has(e.cell)
              ? 'g'
              : ''
    if (!k) continue
    const m = document.createElement('i')
    m.className = k
    m.style.left = `${(e.t / END) * 100}%`
    track.insertBefore(m, $('rpKnob'))
  }

  const draw = (f: Frame | undefined): void => {
    const vals = f?.vals ?? play.start
    const given = f?.given ?? play.start.map(Boolean)
    for (let i = 0; i < N; i++) {
      const s = st[i]
      if (!s) continue
      const d = vals[i] ?? 0
      s.textContent = d ? String(d) : ''
      s.classList.toggle('given', !!d && !!given[i])
      s.classList.toggle('star', stars.has(i) && !d && f !== undefined)
      s.classList.remove('sel')
    }
  }
  const replay = (el: HTMLElement | undefined, cls: string): void => {
    if (!el) return
    el.classList.remove(cls)
    void el.offsetWidth
    el.classList.add(cls)
  }
  const caption = (i: number): string => {
    const f = frames[i]
    if (!f)
      return turnsTotal
        ? `Scrambled ${play.tier} turn${play.tier === 1 ? '' : 's'}.`
        : 'No turns: straight to the fill.'
    const e = f.ev
    const done = frames.slice(0, i + 1)
    const turns = done.filter(x => x.ev.kind === 'turn').length
    if (e.kind === 'turn') return `Turn ${turns}.`
    if (e.kind === 'dial')
      return `<b>Dialled in</b> at ${clock(e.t)}${turns ? ` in ${turns} turn${turns === 1 ? '' : 's'}` : ''}. Now the fill.`
    if (e.kind === 'star') return 'Three ★ squares to lock first.'
    if (e.kind === 'miss') return `Tried <b>${e.digit}</b>. A miss, 25 points.`
    if (e.kind === 'help') return 'Used a suggestion.'
    const locks = done.filter(
      x => x.ev.kind === 'lock' || x.ev.kind === 'help-lock',
    ).length
    if (locks === blanks) return `<b>Last square.</b> Solved in ${clock(e.t)}.`
    if (e.kind === 'help-lock') return `A suggestion locks ${e.digit}.`
    const starLocks = done.filter(
      x => x.ev.kind === 'lock' && stars.has(x.ev.cell),
    ).length
    if (stars.has(e.cell) && starLocks === locks)
      return `<b>★ ${starLocks} of 3</b> locked first.`
    return `Locked ${e.digit}.`
  }

  let shown = -2
  const render = (t: number, animate: boolean): void => {
    let i = -1
    while (i + 1 < frames.length && (frames[i + 1]?.ev.t ?? 0) <= t) i++
    if (i !== shown) {
      const f = frames[i]
      draw(f)
      const e = f?.ev
      if (e && animate) {
        if (e.kind === 'turn') {
          const [a, v] = e.move
          cells.forEach((x, c) => {
            if (x.c[a] === v) replay(st[c], 'flash')
          })
        } else if (e.kind === 'lock' || e.kind === 'help-lock') {
          replay(st[e.cell], 'pop')
          look(faceOf(e.cell))
        } else if (e.kind === 'miss') {
          const s = st[e.cell]
          if (s) s.textContent = String(e.digit)
          replay(s, 'wrong')
          look(faceOf(e.cell))
        }
      }
      if (
        e &&
        (e.kind === 'lock' || e.kind === 'help-lock' || e.kind === 'miss')
      )
        st[e.cell]?.classList.add('sel')
      const done = frames.slice(0, i + 1).map(x => x.ev.kind)
      $('rpTurns').textContent = String(done.filter(k => k === 'turn').length)
      $('rpLocked').textContent =
        `${done.filter(k => k === 'lock' || k === 'help-lock').length}/${blanks ?? 0}`
      $('rpMiss').textContent = String(done.filter(k => k === 'miss').length)
      $('rpCap').innerHTML = caption(i)
      shown = i
    }
    $('rpClock').textContent = clock(t)
    const pct = Math.min(100, (t / END) * 100)
    $('rpFill').style.width = `${pct}%`
    $('rpKnob').style.left = `${pct}%`
    track.setAttribute('aria-valuenow', String(Math.round(pct)))
  }

  // end card
  $('rpEndTime').textContent = `Solved in ${clock(play.time * 10)}`
  $('rpEndScore').textContent = `${play.score.toLocaleString('en-GB')} points`
  const starsLine = play.stars === 3 ? 'all three ★' : `${play.stars} ★`
  const misses =
    play.wrong === 0
      ? 'no misses'
      : `${play.wrong} miss${play.wrong === 1 ? '' : 'es'}`
  $('rpEndLine').textContent =
    `${turnsTotal} turn${turnsTotal === 1 ? '' : 's'} · ${starsLine} · ${misses}`
  const today = $('rpToday')
  if (rsp.todayPost)
    today.onclick = () => navigateToPost(rsp.todayPost as `t3_${string}`)
  else today.hidden = true

  // playback: speeds are set so the whole run takes about TARGET seconds at Normal
  const base = Math.max(1, END / 10 / TARGET)
  const SPEEDS: Record<string, number> = {
    slow: Math.max(1, base / 2),
    normal: base,
    fast: base * 2.5,
  }
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
  let t = 0
  let speed = base
  let playing = !reduce
  let last = performance.now()
  const end = $('rpEnd')
  const playBtn = $('rpPlay')
  const setPlaying = (p: boolean): void => {
    playing = p
    playBtn.textContent = p ? 'Pause' : 'Play'
  }
  const tick = (now: number): void => {
    const dt = now - last
    last = now
    if (playing) {
      // tenths of a second of run per millisecond of playback, times the speed
      t += (dt / 100) * speed
      if (t >= END) {
        t = END
        setPlaying(false)
        end.hidden = false
      }
    }
    render(t, playing)
    requestAnimationFrame(tick)
  }
  if (reduce) {
    t = END
    end.hidden = false
  }
  setPlaying(playing)
  requestAnimationFrame(tick)
  playBtn.onclick = () => {
    if (t >= END) {
      t = 0
      shown = -2
    }
    end.hidden = true
    setPlaying(!playing)
  }
  $('rpAgain').onclick = () => {
    t = 0
    shown = -2
    look(0)
    end.hidden = true
    setPlaying(true)
  }
  for (const b of document.querySelectorAll<HTMLElement>('[data-sp]'))
    b.onclick = () => {
      speed = SPEEDS[b.dataset.sp ?? ''] ?? base
      for (const x of document.querySelectorAll('[data-sp]'))
        x.setAttribute('aria-pressed', x === b ? 'true' : 'false')
    }
  const seekTo = (to: number): void => {
    t = Math.max(0, Math.min(END, to))
    shown = -2
    end.hidden = t < END
    render(t, false)
  }
  const seek = (e: PointerEvent): void => {
    const r = track.getBoundingClientRect()
    seekTo(((e.clientX - r.left) / r.width) * END)
  }
  track.addEventListener('pointerdown', e => {
    track.setPointerCapture(e.pointerId)
    seek(e)
    track.onpointermove = seek
  })
  track.addEventListener('pointerup', () => {
    track.onpointermove = null
  })
  track.addEventListener('keydown', e => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    seekTo(t + (e.key === 'ArrowRight' ? 50 : -50))
  })
}

void main()
