// The feed card's intro once today is done: in place of the cube coming apart, a burst of
// glitter in the cube's own pieces (washi and grey cells, yellow cells, thin streaks and
// twinkling glints). It is different every time: where it comes from, how much, the mix and
// the drift are all drawn at random. Part of it then breaks down into big square pixels,
// blurs and fades out, while the rest falls away over the finished cover.

type Kind = 'cell' | 'streak' | 'glint'
type Bit = {
  kind: Kind
  x: number
  y: number
  vx: number
  vy: number
  r: number
  vr: number
  size: number
  color: string
  flip: number
  vflip: number
  twinkle: number
  /** In the part that pixelates. */
  px: boolean
  born: number
}

// on the dark cover the pieces are washi and light greys; on the paper cover, ink and dark greys
const dark = (): boolean => matchMedia('(prefers-color-scheme: dark)').matches
const PAPERS = {
  dark: ['#eceae3', '#ffffff'],
  light: ['#23252b', '#3a3d45'],
} as const
const GREYS = {
  dark: ['#b4b3ad', '#8a8e98', '#d6d4cc'],
  light: ['#5b5f69', '#8a8e98', '#46494f'],
}
const YELLOWS = ['#f5c12e', '#ffd75a', '#e0a80f']

/** Times, in ms from the start. */
export const PARTY = {pixelFrom: 1100, pixelFor: 1100, end: 3000} as const

const pick = <T>(a: readonly T[]): T =>
  a[Math.floor(Math.random() * a.length)] as T
const rand = (lo: number, hi: number): number => lo + Math.random() * (hi - lo)

/**
 * The air the pieces fall through: drag slows them (a piece launched at v travels about
 * v / DRAG), and they settle to a gentle fall, so they hang over the cover like paper.
 */
const DRAG = rand(2.4, 3.2)

/** Where the pieces start and which way they go: a different shape of burst each time. */
function launch(
  w: number,
  h: number,
): Array<Pick<Bit, 'x' | 'y' | 'vx' | 'vy' | 'born'>> {
  const n = Math.round(
    rand(110, 170) * Math.min(1.4, Math.max(0.7, (w * h) / 250000)),
  )
  const mode = pick(['burst', 'cannons', 'fountain', 'rain', 'ring'] as const)
  const out: Array<Pick<Bit, 'x' | 'y' | 'vx' | 'vy' | 'born'>> = []
  const cx = w / 2 + rand(-0.08, 0.08) * w
  const cy = h * rand(0.3, 0.45)
  // how far a piece flies before the air takes it
  const reach = Math.hypot(w, h) * rand(0.4, 0.55)
  for (let i = 0; i < n; i++) {
    const born = rand(0, mode === 'rain' ? 600 : 160)
    if (mode === 'burst' || mode === 'ring') {
      const a = rand(0, Math.PI * 2)
      const v = DRAG * reach * (mode === 'ring' ? rand(0.8, 1) : rand(0.15, 1))
      out.push({
        x: cx,
        y: cy,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - DRAG * h * 0.12,
        born,
      })
    } else if (mode === 'cannons') {
      // from both bottom corners, up and in
      const left = i % 2 === 0
      const a = -Math.PI / 2 + (left ? 1 : -1) * rand(0.35, 0.85)
      const v = DRAG * reach * rand(0.8, 1.3)
      out.push({
        x: left ? -10 : w + 10,
        y: h * rand(0.8, 1),
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        born,
      })
    } else if (mode === 'fountain') {
      const a = -Math.PI / 2 + rand(-0.45, 0.45)
      const v = DRAG * h * rand(0.6, 1.05)
      out.push({
        x: cx + rand(-20, 20),
        y: h + 10,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        born,
      })
    } else {
      out.push({
        x: rand(0, w),
        y: rand(-h * 0.5, -10),
        vx: rand(-40, 40),
        vy: rand(0.4, 0.7) * h,
        born,
      })
    }
  }
  return out
}

function makeBits(w: number, h: number): Bit[] {
  // the mix changes too: some runs lean yellow, some lean glitter
  const yellowShare = rand(0.25, 0.45)
  const glintShare = rand(0.12, 0.28)
  const streakShare = rand(0.1, 0.25)
  // the part that pixelates: one side of the card, at a random angle
  const ang = rand(0, Math.PI * 2)
  const paper = dark() ? PAPERS.dark : PAPERS.light
  const greys = dark() ? GREYS.dark : GREYS.light
  const nx = Math.cos(ang)
  const ny = Math.sin(ang)
  return launch(w, h).map(p => {
    const u = Math.random()
    const kind: Kind =
      u < glintShare
        ? 'glint'
        : u < glintShare + streakShare
          ? 'streak'
          : 'cell'
    const yellow = Math.random() < yellowShare
    const color =
      kind === 'glint'
        ? Math.random() < 0.5
          ? paper[1]
          : pick(YELLOWS)
        : yellow
          ? pick(YELLOWS)
          : Math.random() < 0.5
            ? paper[0]
            : pick(greys)
    return {
      kind,
      ...p,
      r: rand(0, Math.PI * 2),
      vr: rand(-9, 9),
      size:
        kind === 'glint'
          ? rand(5, 10)
          : kind === 'streak'
            ? rand(10, 18)
            : rand(6, 12),
      color,
      flip: rand(0, Math.PI * 2),
      vflip: rand(4, 12),
      twinkle: rand(0, Math.PI * 2),
      // the pieces heading that way, and a few strays, are the ones that pixelate
      px: Math.random() < 0.15 || nx * (p.vx || 1) + ny * (p.vy || 1) > 0,
    }
  })
}

function drawBit(
  g: CanvasRenderingContext2D,
  b: Bit,
  alpha: number,
  t: number,
): void {
  g.save()
  g.globalAlpha = alpha
  g.translate(b.x, b.y)
  g.rotate(b.r)
  g.fillStyle = b.color
  if (b.kind === 'glint') {
    // a four-point star that twinkles
    const s = b.size * (0.55 + 0.45 * Math.abs(Math.sin(b.twinkle + t * 0.012)))
    g.beginPath()
    g.moveTo(0, -s)
    g.quadraticCurveTo(0, 0, s, 0)
    g.quadraticCurveTo(0, 0, 0, s)
    g.quadraticCurveTo(0, 0, -s, 0)
    g.quadraticCurveTo(0, 0, 0, -s)
    g.fill()
  } else {
    // cells and streaks tumble: squashed across as they turn over
    g.scale(Math.cos(b.flip), 1)
    if (b.kind === 'streak') g.fillRect(-1, -b.size / 2, 2.2, b.size)
    else {
      const s = b.size
      const rr = s * 0.2
      g.beginPath()
      g.roundRect(-s / 2, -s / 2, s, s, rr)
      g.fill()
    }
  }
  g.restore()
}

/** Plays the celebration in the box, over whatever is under it. Resolves when it is gone. */
export function celebrate(box: HTMLElement): Promise<void> {
  const w = innerWidth
  const h = innerHeight
  const dpr = Math.min(2, devicePixelRatio || 1)
  const layer = (): [HTMLCanvasElement, CanvasRenderingContext2D] => {
    const c = document.createElement('canvas')
    c.width = Math.round(w * dpr)
    c.height = Math.round(h * dpr)
    c.className = 'fd-party'
    box.appendChild(c)
    const g = c.getContext('2d') as CanvasRenderingContext2D
    g.scale(dpr, dpr)
    return [c, g]
  }
  const [, crisp] = layer()
  const [pxCanvas, px] = layer()
  // the pixelated part is drawn small, then blown up without smoothing
  const small = document.createElement('canvas')
  const sg = small.getContext('2d') as CanvasRenderingContext2D
  const bits = makeBits(w, h)
  // they settle to falling a quarter of the screen a second or so, on a little wind
  const fall = h * rand(0.2, 0.32)
  const wind = rand(-0.06, 0.06) * w
  return new Promise(res => {
    const t0 = performance.now()
    let last = t0
    const frame = (now: number): void => {
      const t = now - t0
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      crisp.clearRect(0, 0, w, h)
      // the pixel part fades in from crisp: block size and blur grow, opacity drops
      const k = Math.min(1, Math.max(0, (t - PARTY.pixelFrom) / PARTY.pixelFor))
      const block = 1 + Math.round(k * k * 14)
      small.width = Math.max(1, Math.ceil(w / block))
      small.height = Math.max(1, Math.ceil(h / block))
      sg.setTransform(1 / block, 0, 0, 1 / block, 0, 0)
      for (const b of bits) {
        if (t < b.born) continue
        const pull = Math.min(1, DRAG * dt)
        b.vx += (wind - b.vx) * pull
        b.vy += (fall - b.vy) * pull
        b.x += b.vx * dt
        b.y += b.vy * dt
        b.r += b.vr * dt
        b.flip += b.vflip * dt
        const fade = Math.min(1, Math.max(0, (PARTY.end - t) / 900))
        if (b.px && k > 0) drawBit(sg, b, 1, t)
        else drawBit(crisp, b, fade, t)
      }
      px.clearRect(0, 0, w, h)
      if (k > 0) {
        px.imageSmoothingEnabled = false
        px.drawImage(small, 0, 0, small.width * block, small.height * block)
        pxCanvas.style.opacity = String(1 - k)
        pxCanvas.style.filter = `blur(${(k * 6).toFixed(1)}px)`
      }
      if (t < PARTY.end) requestAnimationFrame(frame)
      else {
        crisp.canvas.remove()
        pxCanvas.remove()
        res()
      }
    }
    requestAnimationFrame(frame)
  })
}
