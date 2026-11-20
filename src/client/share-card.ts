// The share card: the player's result, drawn on a canvas in the Nonet look (graphite, washi, the
// yellow of a solved cube), with the points as the hero. Spoiler free, like the text line.

export type ShareCard = {
  cubeNo: number | undefined
  /** Long date of the cube, e.g. "Friday 20 November 2026". Empty to leave out. */
  date: string
  /** Fill level 0 to 2 and its name. */
  level: number
  levelName: string
  /** "1 rotation", "No rotations", "Practice"... */
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
function cellField(c: Ctx, cx: number, cy: number): void {
  const pitch = 36
  const cell = 30
  const radius = 420
  c.save()
  c.beginPath()
  c.rect(0, 334, CARD_W, 506)
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

// the hero: the points, big, over the cells
function hero(c: Ctx, d: ShareCard): void {
  const cx = CARD_W / 2
  cellField(c, cx, 586)
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
  // a yellow bar under the number, the cell shape
  c.fillStyle = C.yellow
  roundRect(c, cx - 60, 740, 120, 16, 5)
  c.fill()
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
    d.hints
      ? `${d.hints} suggestion${d.hints === 1 ? '' : 's'}`
      : 'no suggestions',
  )
  return bits.join(' · ')
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

  hero(c, d)

  stats(c, d, 870)
  c.fillStyle = C.lead
  c.font = `500 26px ${CODE}`
  c.textAlign = 'center'
  c.fillText(detailLine(d), CARD_W / 2, 1090)

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
