// The share card: a picture of the solved cube with the player's result, drawn on a canvas in the
// Nonet look (graphite, washi, the yellow of a solved cube). It is spoiler free, like the text
// line: squares show who filled them (a clue, the player, a ★ opener) but never the digit.

/** What a square on the card shows. */
export type CellKind = 'clue' | 'fill' | 'star'

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
  /** One per square, 54 long, in the model's order. */
  cells: CellKind[]
  /** Subreddit without the r/, or empty. */
  subreddit: string
}

export const CARD_W = 1080
export const CARD_H = 1350

/** Which squares were clues, which the player filled, and the ★ openers they locked first. */
export function cellKinds(
  clue: readonly boolean[],
  starsWon: Iterable<number>,
): CellKind[] {
  const won = new Set(starsWon)
  return clue.map((c, i) => (won.has(i) ? 'star' : c ? 'clue' : 'fill'))
}

type V3 = [number, number, number]
type Face = {index: number; map: (i: number, j: number) => V3; shade: string}

// The three faces a viewer above, right and in front sees, as the model numbers them (see F in
// shared/model.js). Square (i, j) of face f is cell f*9 + j*3 + i. y points down.
const FACES: Face[] = [
  {index: 4, map: (i, j) => [i - 1, -1, j - 1], shade: '#3b3e47'},
  {index: 0, map: (i, j) => [i - 1, j - 1, 1], shade: '#272a31'},
  {index: 2, map: (i, j) => [1, j - 1, 1 - i], shade: '#30333b'},
]

const COS30 = Math.cos(Math.PI / 6)

/** Isometric projection, one unit per square: x runs right-down, z left-down, y down. */
export function iso([x, y, z]: V3): [number, number] {
  return [(x - z) * COS30, (x + z) / 2 + y]
}

/**
 * Where a face's 3 by 3 grid lands on the page, as a 2D affine transform [a, b, c, d, e, f]
 * (canvas setTransform order) from grid units (0 to 3 across, 0 to 3 down) to page pixels.
 */
export function faceTransform(
  map: Face['map'],
  size: number,
  cx: number,
  cy: number,
): [number, number, number, number, number, number] {
  // map() gives square centres with the face at ±1; the surface sits at ±1.5
  const at = (u: number, v: number): V3 => {
    const p = map(u - 0.5, v - 0.5)
    const n = map(1, 1)
    return p.map((c, k) => (n[k] !== 0 && c === n[k] ? c * 1.5 : c)) as V3
  }
  const o = iso(at(0, 0))
  const u = iso(at(1, 0))
  const v = iso(at(0, 1))
  return [
    (u[0] - o[0]) * size,
    (u[1] - o[1]) * size,
    (v[0] - o[0]) * size,
    (v[1] - o[1]) * size,
    cx + o[0] * size,
    cy + o[1] * size,
  ]
}

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

function cube(
  c: Ctx,
  cells: CellKind[],
  cx: number,
  cy: number,
  size: number,
): void {
  // the glow of a solved cube
  const g = c.createRadialGradient(cx, cy, size * 0.6, cx, cy, size * 4.2)
  g.addColorStop(0, 'rgba(245,193,46,.42)')
  g.addColorStop(0.45, 'rgba(245,193,46,.12)')
  g.addColorStop(1, 'rgba(245,193,46,0)')
  c.fillStyle = g
  c.fillRect(0, 0, CARD_W, CARD_H)
  for (const f of FACES) {
    c.save()
    c.setTransform(...faceTransform(f.map, size, cx, cy))
    // the gaps between squares light up yellow when the cube is solved
    c.fillStyle = C.yellow
    roundRect(c, 0, 0, 3, 3, 0.17)
    c.fill()
    for (let j = 0; j < 3; j++)
      for (let i = 0; i < 3; i++) {
        const kind = cells[f.index * 9 + j * 3 + i] ?? 'fill'
        const x = i + 5 / 60
        const y = j + 5 / 60
        const w = 50 / 60
        roundRect(c, x, y, w, w, 9 / 60)
        if (kind === 'star') {
          c.fillStyle = C.yellow
          c.fill()
          c.fillStyle = C.sumi
          star(c, i + 0.5, j + 0.5, 0.27)
          c.fill()
          continue
        }
        c.fillStyle = f.shade
        c.fill()
        c.fillStyle = 'rgba(245,193,46,.1)'
        c.fill()
        c.lineWidth = 2 / 60
        c.strokeStyle = 'rgba(245,193,46,.55)'
        roundRect(c, x + 1 / 60, y + 1 / 60, w - 2 / 60, w - 2 / 60, 8 / 60)
        c.stroke()
        // the digit, hidden: its 3 by 5 pixels, all lit, in the clue's washi or the player's blue
        c.fillStyle = kind === 'clue' ? C.washi : C.ai
        const px = 4.5 / 60
        const step = 5.4 / 60
        const gx = i + 0.5 - (2 * step + px) / 2
        const gy = j + 0.5 - (4 * step + px) / 2
        for (let r = 0; r < 5; r++)
          for (let q = 0; q < 3; q++) {
            roundRect(c, gx + q * step, gy + r * step, px, px, 1 / 60)
            c.fill()
          }
      }
    c.restore()
  }
}

function doubleRule(c: Ctx, y: number): void {
  c.fillStyle = C.washi
  c.fillRect(72, y, CARD_W - 144, 3)
  c.fillRect(72, y + 9, CARD_W - 144, 3)
}

function stats(c: Ctx, d: ShareCard, y: number): void {
  const cols: [string, (x: number) => void][] = [
    ['Points', x => text(c, d.points.toLocaleString('en-GB'), x, y + 96)],
    ['Time', x => text(c, d.time, x, y + 96)],
    [
      'Openers',
      x => {
        for (let k = 0; k < 3; k++) {
          star(c, x + (k - 1) * 62, y + 66, 26)
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
  if (d.rank) cols.push(['Today', x => text(c, `#${d.rank}`, x, y + 96)])
  const w = (CARD_W - 144) / cols.length
  cols.forEach(([label, draw], k) => {
    const x = 72 + w * k + w / 2
    if (k) {
      c.fillStyle = C.edge
      c.fillRect(72 + w * k, y + 4, 2, 104)
    }
    c.fillStyle = C.lead
    c.font = `500 24px ${CODE}`
    c.textAlign = 'center'
    c.fillText(label.toUpperCase(), x, y + 22)
    c.fillStyle = C.washi
    c.font = `400 76px ${DISPLAY}`
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

  cube(c, d.cells, CARD_W / 2, 652, 90)

  stats(c, d, 962)
  c.fillStyle = C.lead
  c.font = `500 26px ${CODE}`
  c.textAlign = 'center'
  c.fillText(detailLine(d), CARD_W / 2, 1120)

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
