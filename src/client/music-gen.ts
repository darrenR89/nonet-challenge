// A new tune for each play. A seed picks a mood (key, scale, tempo, chords and
// patterns) and every loop is drawn from it, sample by sample. Pure, so the
// same seed always makes the same tune and it can be tested without a browser.
// These stand in for real stems until there is recorded music to use.

export const RATE = 22050

/** Each loop's length in beats. The finale is twice as long as the rest. */
export const LOOP_BEATS = {
  pad: 8,
  pulse: 8,
  bells: 8,
  bass: 8,
  beat: 8,
  keys: 8,
  arp: 8,
  lead: 8,
  finale: 16,
} as const
export type LoopName = keyof typeof LOOP_BEATS

// five-note scales, as semitones above the root
const SCALES = {
  yo: [0, 2, 5, 7, 9],
  in: [0, 1, 5, 7, 8],
  hirajoshi: [0, 2, 3, 7, 8],
  'minor pentatonic': [0, 3, 5, 7, 10],
  'major pentatonic': [0, 2, 4, 7, 9],
} as const
type ScaleName = keyof typeof SCALES
const NOTE_NAMES = [
  'C',
  'C♯',
  'D',
  'E♭',
  'E',
  'F',
  'F♯',
  'G',
  'A♭',
  'A',
  'B♭',
  'B',
]

export type Mood = {
  /** e.g. "E♭ yo, 96 BPM" */
  name: string
  bpm: number
  /** MIDI note of the root, around middle C */
  root: number
  scale: ScaleName
  /** the two chords, one a bar, as scale degrees */
  chords: [number, number]
  pulse: number[]
  bassHits: number[]
  kicks: number[]
  arp: number[]
  /** [beat, length in beats, scale degree] */
  melody: [number, number, number][]
  finale: [number, number, number][]
}

/** A small seeded random number generator (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pick<T>(r: () => number, from: readonly T[]): T {
  const v = from[Math.floor(r() * from.length)]
  if (v === undefined) throw new Error('pick from an empty list')
  return v
}

/** A melody that walks the scale, mostly in steps, landing on a chord tone. */
function walk(
  r: () => number,
  beats: number,
  low: number,
  chords: [number, number],
): [number, number, number][] {
  const lens = [0.5, 0.5, 1, 1, 1, 1.5, 2]
  const out: [number, number, number][] = []
  let deg = low + 2 + Math.floor(r() * 3)
  let at = 0
  while (at < beats) {
    const len = Math.min(pick(r, lens), beats - at)
    const bar = at < beats / 2 ? 0 : 1
    // the last note of each half lands on that bar's chord root
    const lastOfHalf = at + len >= (bar + 1) * (beats / 2)
    const d = lastOfHalf ? chords[bar] + low + 5 : deg
    if (r() > 0.15) out.push([at, len, d])
    deg += pick(r, [-2, -1, -1, 1, 1, 2])
    deg = Math.max(low, Math.min(low + 7, deg))
    at += len
  }
  return out
}

export function moodFor(seed: number): Mood {
  const r = rng(seed)
  const scale = pick(r, Object.keys(SCALES) as ScaleName[])
  const root = 60 + Math.floor(r() * 7) - 2 // A♯3 to E4
  const bpm = 88 + 4 * Math.floor(r() * 6) // 88 to 108
  const chords = pick(r, [
    [0, 3],
    [0, 4],
    [3, 0],
    [0, 2],
    [4, 3],
    [2, 0],
  ] as [number, number][])
  const tonic = NOTE_NAMES[((root % 12) + 12) % 12] ?? 'C'
  return {
    name: `${tonic} ${scale}, ${bpm} BPM`,
    bpm,
    root,
    scale,
    chords,
    pulse: pick(r, [
      [0, 2, 1, 2],
      [0, 1, 2, 4],
      [0, 2, 4, 2],
      [4, 2, 1, 0],
    ]),
    bassHits: pick(r, [
      [0, 1.5, 3],
      [0, 2, 2.5],
      [0, 0.5, 2, 3.5],
      [0, 3],
    ]),
    kicks: pick(r, [
      [0, 2],
      [0, 1.5, 2],
      [0, 2.5],
      [0, 1, 2, 3],
    ]),
    arp: pick(r, [
      [0, 1, 2, 3, 4, 5, 6, 7],
      [7, 6, 5, 4, 3, 2, 1, 0],
      [0, 2, 4, 6, 7, 5, 3, 1],
      [0, 4, 2, 5, 3, 6, 4, 7],
    ]),
    melody: walk(r, 8, 5, chords),
    finale: walk(r, 16, 7, chords),
  }
}

/** The mood's scale, as semitones above its root. */
export function scaleSteps(m: Mood): readonly number[] {
  return SCALES[m.scale]
}

type Wave = 'sine' | 'tri' | 'bell' | 'organ'

/** Draws the loop `name` for this mood: mono samples at RATE. */
export function renderLoop(name: LoopName, m: Mood): Float32Array<ArrayBuffer> {
  const beat = 60 / m.bpm
  const len = Math.round(LOOP_BEATS[name] * beat * RATE)
  const buf = new Float32Array(len)
  const scale = SCALES[m.scale]
  // scale degree to frequency: degree 0 is the root, 5 is an octave up
  const hz = (deg: number): number => {
    const oct = Math.floor(deg / 5)
    const step = scale[((deg % 5) + 5) % 5] ?? 0
    return 440 * 2 ** ((m.root + 12 * oct + step - 69) / 12)
  }
  const chordAt = (at: number): number => m.chords[Math.floor(at / 4) % 2] ?? 0

  const note = (
    at: number,
    beats: number,
    freq: number,
    vol: number,
    wave: Wave,
    {attack = 0.005, decay = 0}: {attack?: number; decay?: number} = {},
  ): void => {
    const start = Math.round(at * beat * RATE)
    const n = Math.round(beats * beat * RATE)
    for (let i = 0; i < n; i++) {
      const t = i / RATE
      const env =
        Math.min(1, t / attack) *
        (decay ? Math.exp(-t / decay) : Math.min(1, (n - i) / (0.08 * RATE)))
      const ph = (t * freq) % 1
      let v: number
      if (wave === 'sine') v = Math.sin(2 * Math.PI * ph)
      else if (wave === 'tri') v = 1 - 4 * Math.abs(ph - 0.5)
      else if (wave === 'bell')
        v =
          Math.sin(2 * Math.PI * ph) +
          0.4 * Math.sin(2 * Math.PI * t * freq * 2.76) * Math.exp(-t * 6)
      else v = Math.sin(2 * Math.PI * ph) + 0.3 * Math.sin(4 * Math.PI * ph)
      // a tail that runs past the end rings into the loop's start
      const j = (start + i) % len
      buf[j] = (buf[j] ?? 0) + v * env * vol
    }
  }
  const kick = (at: number, vol: number): void => {
    const start = Math.round(at * beat * RATE)
    for (let i = 0; i < 0.25 * RATE; i++) {
      const t = i / RATE
      const f = 55 + 95 * Math.exp(-t * 30)
      const j = (start + i) % len
      buf[j] =
        (buf[j] ?? 0) + Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 14) * vol
    }
  }
  const shaker = (at: number, vol: number, seed: number): void => {
    const start = Math.round(at * beat * RATE)
    const r = rng(seed)
    let lp = 0
    for (let i = 0; i < 0.06 * RATE; i++) {
      const noise = r() * 2 - 1
      lp += 0.5 * (noise - lp)
      const j = (start + i) % len
      buf[j] =
        (buf[j] ?? 0) + (noise - lp) * Math.exp(-i / (0.015 * RATE)) * vol
    }
  }

  switch (name) {
    case 'pad':
      for (const at of [0, 4])
        for (const d of [0, 2, 4])
          note(at, 4, hz(chordAt(at) + d), 0.1, 'organ', {attack: 0.3})
      break
    case 'pulse':
      for (let i = 0; i < 16; i++) {
        const at = i / 2
        const d = m.pulse[i % 4] ?? 0
        note(at, 0.5, hz(chordAt(at) + d + 5), 0.1, 'tri', {decay: 0.12})
      }
      break
    case 'bells': {
      const r = rng(m.bpm * 31 + m.root)
      for (let k = 0; k < 5; k++) {
        const at = Math.floor(r() * 16) / 2
        note(at, 2, hz(chordAt(at) + 10 + Math.floor(r() * 5)), 0.08, 'bell', {
          decay: 0.5,
        })
      }
      break
    }
    case 'bass':
      for (const bar of [0, 4])
        for (const hit of m.bassHits)
          note(bar + hit, 1, hz(chordAt(bar) - 5), 0.24, 'organ', {decay: 0.35})
      break
    case 'beat':
      for (const bar of [0, 4]) for (const k of m.kicks) kick(bar + k, 0.45)
      for (let i = 0; i < 16; i++)
        shaker(i / 2 + 0.25, i % 2 ? 0.08 : 0.05, 1234 + i)
      break
    case 'keys':
      for (const at of [1, 3, 5, 7])
        for (const d of [0, 2, 4])
          note(at, 1, hz(chordAt(at) + d + 5), 0.06, 'tri', {decay: 0.3})
      break
    case 'arp':
      for (let i = 0; i < 32; i++) {
        const at = i / 4
        const d = m.arp[i % 8] ?? 0
        note(at, 0.25, hz(chordAt(at) + d + 5), 0.045, 'tri', {decay: 0.07})
      }
      break
    case 'lead':
      for (const [at, beats, d] of m.melody)
        note(at, beats, hz(d), 0.07, 'bell', {attack: 0.02})
      break
    case 'finale':
      // a brighter tune over the full band, twice as long, for the results
      for (const [at, beats, d] of m.finale)
        note(at, beats, hz(d), 0.08, 'bell', {attack: 0.02})
      for (const at of [0, 4, 8, 12])
        note(at, 4, hz(chordAt(at) + 14), 0.03, 'sine', {attack: 0.2})
      break
  }
  // headroom, so every layer at once stays below clipping
  for (let i = 0; i < len; i++) buf[i] = (buf[i] ?? 0) * 0.7
  return buf
}
