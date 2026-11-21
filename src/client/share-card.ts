// The share card: the player's result, drawn on a canvas in the Nonet look (graphite, washi, the
// yellow of a solved cube), with the points as the hero. Spoiler free, like the text line.

import {isJourney} from '../shared/result.ts'

export type ShareCard = {
  cubeNo: number | undefined
  /** Long date of the cube, e.g. "Friday 20 November 2026". Empty to leave out. */
  date: string
  /** Fill level 0 to 2 and its name. */
  level: number
  levelName: string
  /** "1 turn", "0 turns", "Practice"... */
  mode: string
  points: number
  /** Solve time, e.g. "4:07". */
  time: string
  stars: number
  wrong: number
  hints: number
  /** Today's rank, 0 when there is none. */
  rank: number
  /** Subreddit without the r/, or empty. */
  subreddit: string
  /** The journey line, a square per face in the order finished; drawn under the points. */
  journey?: string
  /** The player's crew today, for the crew version of the card. */
  crew?: CrewCard
}

/** A crew on the card: its name, today's crew points and streak, and each member's score. */
export type CrewCard = {
  name: string
  points: number
  streak: number
  members: {name: string; score: number | undefined}[]
}

export const CARD_W = 1080
export const CARD_H = 1350

// the wordmark's cells, from public/brand/nonet-wordmark.svg (X washi, Y the yellow dot)
const WORDMARK = [
  'XX.X.XXX.XX.X.XXX.XXX',
  'X.XX.X.X.X.XX.XX...X.',
  'X..X.XXX.X..X.XXX..X.',
  '.......Y.............',
]

const C = {
  sumi: '#121316',
  slate: '#1c1e23',
  edge: '#2c2f37',
  washi: '#eceae3',
  lead: '#8d919b',
  yellow: '#f5c12e',
  ai: '#8fb0ff',
}
const DISPLAY = '"DotGothic16","M PLUS 1 Code",ui-monospace,monospace'
const CODE = '"M PLUS 1 Code",ui-monospace,monospace'
const JP = '"IBM Plex Sans JP",system-ui,sans-serif'

/** The fonts the card uses, to load before drawing. */
export const CARD_FONTS = [
  `400 96px ${DISPLAY}`,
  `500 24px ${CODE}`,
  `700 24px ${CODE}`,
  `700 24px ${JP}`,
]

/** Characters to load the fonts for, so the kanji subsets come in too. */
export const CARD_GLYPHS = 'No.0123456789 日刊連'

type Ctx = CanvasRenderingContext2D

function roundRect(
  c: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  c.beginPath()
  c.roundRect(x, y, w, h, r)
}

function star(c: Ctx, x: number, y: number, r: number): void {
  c.beginPath()
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5
    const rr = k % 2 ? r * 0.45 : r
    c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr)
  }
  c.closePath()
}

/** Seeded noise, so every card gets the same paper grain. */
function grain(c: Ctx): void {
  const n = 192
  const tile = document.createElement('canvas')
  tile.width = tile.height = n
  const t = tile.getContext('2d')
  if (!t) return
  const img = t.createImageData(n, n)
  let s = 9
  for (let p = 0; p < n * n; p++) {
    s = (s * 1103515245 + 12345) >>> 0
    const v = (s >>> 16) & 255
    img.data.set([v, v, v, 22], p * 4)
  }
  t.putImageData(img, 0, 0)
  const pat = c.createPattern(tile, 'repeat')
  if (!pat) return
  c.save()
  c.globalCompositeOperation = 'overlay'
  c.fillStyle = pat
  c.fillRect(0, 0, CARD_W, CARD_H)
  c.restore()
}

function wordmark(c: Ctx, x: number, y: number, cell: number): void {
  const pitch = cell * 1.2
  WORDMARK.forEach((row, j) => {
    ;[...row].forEach((ch, i) => {
      if (ch === '.') return
      c.fillStyle = ch === 'Y' ? C.yellow : C.washi
      roundRect(c, x + i * pitch, y + j * pitch, cell, cell, cell * 0.175)
      c.fill()
    })
  })
}

function doubleRule(c: Ctx, y: number): void {
  c.fillStyle = C.washi
  c.fillRect(72, y, CARD_W - 144, 3)
  c.fillRect(72, y + 9, CARD_W - 144, 3)
}

// behind the hero: the brand's cells (rounded squares, 5 to 6 on pitch), lit at the centre and fading out in a
// circle, with a touch of a solved cube's yellow in the middle
function cellField(c: Ctx, cx: number, cy: number, bottom: number): void {
  const pitch = 36
  const cell = 30
  const radius = 420
  c.save()
  c.beginPath()
  c.rect(0, 334, CARD_W, bottom - 334)
  c.clip()
  const x0 = cx - pitch * Math.ceil(cx / pitch) - cell / 2
  const y0 = cy - pitch * Math.ceil(cy / pitch) - cell / 2
  for (let y = y0; y < CARD_H; y += pitch)
    for (let x = x0; x < CARD_W; x += pitch) {
      const d = Math.hypot(x + cell / 2 - cx, y + cell / 2 - cy) / radius
      if (d >= 1) continue
      const f = (1 - d) ** 1.6
      roundRect(c, x, y, cell, cell, 5)
      c.fillStyle = `rgba(236,234,227,${(0.11 * f).toFixed(3)})`
      c.fill()
      c.fillStyle = `rgba(245,193,46,${(0.2 * f ** 3).toFixed(3)})`
      c.fill()
    }
  c.restore()
}

// the hero: the points, big, over the cells, with no underline
function hero(c: Ctx, d: ShareCard, bottom: number): void {
  const cx = CARD_W / 2
  cellField(c, cx, 586, bottom)
  c.textAlign = 'center'
  c.fillStyle = C.lead
  c.font = `500 30px ${CODE}`
  c.fillText('POINTS', cx, 420)
  c.fillStyle = C.washi
  const pts = d.points.toLocaleString('en-GB')
  let size = 260
  c.font = `400 ${size}px ${DISPLAY}`
  const max = CARD_W - 280
  const w = c.measureText(pts).width
  if (w > max) {
    size = Math.floor((size * max) / w)
    c.font = `400 ${size}px ${DISPLAY}`
  }
  c.fillText(pts, cx, 700)
}

// the journey under the points: a square per face, in the order finished, coloured by how
// many wrong locks it took (the same marks as the text line)
const JOURNEY_COLOURS: Record<string, string> = {
  '🟨': '#f5c12e',
  '🟧': '#e8892b',
  '🟥': '#d9534f',
}
function journeyRow(c: Ctx, journey: string | undefined, y: number): void {
  if (!isJourney(journey)) return
  const marks = [...journey]
  const size = 36
  const gap = 12
  let x = (CARD_W - (marks.length * size + (marks.length - 1) * gap)) / 2
  for (const m of marks) {
    roundRect(c, x, y, size, size, 6)
    c.fillStyle = JOURNEY_COLOURS[m] ?? C.lead
    c.fill()
    x += size + gap
  }
}

// the numbers under the hero: time, the ★ openers, and today's rank, label over value
function stats(c: Ctx, d: ShareCard, y: number): void {
  const cols: [string, (x: number) => void][] = [
    ['Time', x => text(c, d.time, x, y + 120)],
    [
      'Lock-firsts won',
      x => {
        for (let k = 0; k < 3; k++) {
          star(c, x + (k - 1) * 76, y + 86, 32)
          if (k < d.stars) {
            c.fillStyle = C.yellow
            c.fill()
          } else {
            c.lineWidth = 3
            c.strokeStyle = C.lead
            c.stroke()
          }
        }
      },
    ],
  ]
  if (d.rank) cols.push(['Today', x => text(c, `#${d.rank}`, x, y + 120)])
  const w = (CARD_W - 144) / cols.length
  c.fillStyle = C.edge
  c.fillRect(72, y - 28, CARD_W - 144, 2)
  cols.forEach(([label, draw], k) => {
    const x = 72 + w * k + w / 2
    if (k) {
      c.fillStyle = C.edge
      c.fillRect(72 + w * k, y + 4, 2, 128)
    }
    c.fillStyle = C.lead
    c.font = `500 26px ${CODE}`
    c.textAlign = 'center'
    c.fillText(label.toUpperCase(), x, y + 24)
    c.fillStyle = C.washi
    c.font = `400 100px ${DISPLAY}`
    draw(x)
  })
}

function text(c: Ctx, s: string, x: number, y: number): void {
  c.fillText(s, x, y)
}

/** The line under the numbers: level, rotations, and how clean the fill was. */
export function detailLine(
  d: Pick<ShareCard, 'levelName' | 'mode' | 'wrong' | 'hints'>,
): string {
  const bits = [d.levelName, d.mode]
  bits.push(d.wrong ? `${d.wrong} wrong` : 'no wrong locks')
  bits.push(
    d.hints ? `${d.hints} helper${d.hints === 1 ? '' : 's'}` : 'no helpers',
  )
  return bits.join(' · ')
}

/** The crew's members and scores on one line, e.g. "u/ann 1,240 · u/bob 980 · u/cat –". */
export function crewMembersLine(k: Pick<CrewCard, 'members'>): string {
  return k.members
    .map(
      m =>
        `u/${m.name} ${m.score === undefined ? '–' : m.score.toLocaleString('en-GB')}`,
    )
    .join(' · ')
}

/** The crew's right-hand figure: crew points today, and the streak once it's going. */
export function crewFigure(k: Pick<CrewCard, 'points' | 'streak'>): string {
  const pts = `${k.points.toLocaleString('en-GB')} crew pts`
  return k.streak > 1 ? `${pts} · ${k.streak}-day streak` : pts
}

/** Fits text to a width by trimming it with an ellipsis. */
function fit(c: Ctx, s: string, max: number): string {
  if (c.measureText(s).width <= max) return s
  let t = s
  while (t.length > 1 && c.measureText(`${t}…`).width > max) t = t.slice(0, -1)
  return `${t}…`
}

// the crew band, between the numbers and the call to play: 連 and the crew's name, its points
// and streak, then each member's score
function crewBand(c: Ctx, k: CrewCard, y: number): void {
  const x0 = 72
  const w = CARD_W - 144
  c.fillStyle = C.slate
  roundRect(c, x0, y, w, 110, 12)
  c.fill()
  // outlined all round in the solved cube's yellow
  c.lineWidth = 3
  c.strokeStyle = C.yellow
  roundRect(c, x0 + 1.5, y + 1.5, w - 3, 107, 11)
  c.stroke()
  // the mark: 連 on a yellow cell
  c.fillStyle = C.yellow
  roundRect(c, x0 + 36, y + 18, 48, 48, 8)
  c.fill()
  c.fillStyle = C.sumi
  c.font = `400 38px ${DISPLAY}`
  c.textAlign = 'center'
  c.fillText('連', x0 + 60, y + 56)
  const figure = crewFigure(k)
  c.font = `500 26px ${CODE}`
  c.textAlign = 'right'
  c.fillStyle = C.washi
  c.fillText(figure, x0 + w - 36, y + 52)
  const fw = c.measureText(figure).width
  c.textAlign = 'left'
  c.font = `700 34px ${JP}`
  c.fillText(fit(c, k.name, w - 160 - fw), x0 + 100, y + 54)
  c.fillStyle = C.lead
  c.font = `500 24px ${CODE}`
  c.fillText(fit(c, crewMembersLine(k), w - 72), x0 + 36, y + 92)
}

/** Draws the card. Load CARD_FONTS first, or the browser's fallbacks are used. */
export function drawShareCard(canvas: HTMLCanvasElement, d: ShareCard): void {
  canvas.width = CARD_W
  canvas.height = CARD_H
  const c = canvas.getContext('2d')
  if (!c) return
  c.fillStyle = C.sumi
  c.fillRect(0, 0, CARD_W, CARD_H)
  c.textBaseline = 'alphabetic'

  // the masthead: the wordmark, and the date on the right
  wordmark(c, 72, 64, 16)
  c.fillStyle = C.lead
  c.font = `500 26px ${CODE}`
  c.textAlign = 'right'
  c.fillText(d.date, CARD_W - 72, 100)
  doubleRule(c, 166)

  // the issue row, as on the end card: 日刊 No.323, then the level pips and tag
  c.textAlign = 'left'
  c.fillStyle = C.washi
  c.font = `700 34px ${JP}`
  c.fillText('日刊', 72, 286)
  c.font = `500 34px ${CODE}`
  c.fillText('No.', 72 + 80, 286)
  c.font = `400 112px ${DISPLAY}`
  c.fillText(d.cubeNo === undefined ? '–' : String(d.cubeNo), 72 + 146, 290)
  c.font = `700 28px ${CODE}`
  const tag = d.levelName.toUpperCase()
  const tw = c.measureText(tag).width + 36
  const tx = CARD_W - 72 - tw
  c.fillStyle = C.washi
  roundRect(c, tx, 238, tw, 52, 8)
  c.fill()
  c.fillStyle = C.sumi
  c.textAlign = 'center'
  c.fillText(tag, tx + tw / 2, 274)
  for (let k = 0; k < 3; k++) {
    const px = tx - 24 - (3 - k) * 34
    roundRect(c, px, 250, 26, 26, 5)
    if (k <= d.level) {
      c.fillStyle = C.washi
      c.fill()
    } else {
      c.lineWidth = 3
      c.strokeStyle = C.washi
      c.stroke()
    }
  }
  c.fillStyle = C.edge
  c.fillRect(72, 330, CARD_W - 144, 2)

  // with a crew the numbers sit higher, to give the crew band room above and below
  const statsY = d.crew ? 834 : 870
  hero(c, d, statsY - 30)
  journeyRow(c, d.journey, d.crew ? 750 : 764)

  stats(c, d, statsY)
  c.fillStyle = C.lead
  c.font = `500 26px ${CODE}`
  c.textAlign = 'center'
  c.fillText(detailLine(d), CARD_W / 2, d.crew ? 998 : 1090)
  if (d.crew) crewBand(c, d.crew, 1026)
  c.textAlign = 'center'

  // the call to play, set as the game's primary button
  c.fillStyle = C.yellow
  roundRect(c, 72, 1166, CARD_W - 144, 96, 12)
  c.fill()
  c.fillStyle = C.sumi
  c.font = `700 36px ${CODE}`
  c.fillText("Can you beat it? Play today's cube", CARD_W / 2, 1227)
  c.fillStyle = C.lead
  c.font = `500 26px ${CODE}`
  c.fillText(
    d.subreddit ? `Daily on Reddit · r/${d.subreddit}` : 'Daily on Reddit',
    CARD_W / 2,
    1308,
  )
  grain(c)
}
