// A new tune for each play. A seed picks a mood (key, scale, tempo, chords,
// patterns, swing and which instruments play the parts) and every loop is drawn
// from it, sample by sample. The sound stays in one family, soft pentatonic
// keys, plucks and bells, so each tune is different but the vibe is the same. Pure, so the
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

type Wave = 'sine' | 'tri' | 'bell' | 'organ' | 'koto' | 'flute' | 'choir'

export type Mood = {
  /** e.g. "E♭ yo, 96 BPM, koto, swung" */
  name: string
  bpm: number
  /** MIDI note of the root, around middle C */
  root: number
  scale: ScaleName
  /** the chords across the 8-beat loop, two or four, as scale degrees */
  chords: number[]
  /** how late the off-beats fall, in beats: 0 is straight */
  swing: number
  /** which sound plays each part */
  voices: {pad: Wave; pulse: Wave; lead: Wave}
  /**
   * The beats in each bar where the chords are plucked, or empty when they
   * are held as long notes underneath
   */
  padHits: number[]
  pulse: number[]
  bassHits: number[]
  kicks: number[]
  /** the shaker's beats within one bar */
  shaker: number[]
  arp: number[]
  /** arpeggio notes a beat: 2, 3 or 4 */
  arpRate: number
  /** seeds the bells' positions */
  bellSeed: number
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

/** The chord under beat `at`, as a scale degree. The chords fill 8 beats. */
export function chordAt(chords: readonly number[], at: number): number {
  const n = chords.length
  return chords[Math.floor(at / (8 / n)) % n] ?? 0
}

/** A melody that walks the scale, mostly in steps, landing on a chord tone. */
function walk(
  r: () => number,
  beats: number,
  low: number,
  chords: readonly number[],
): [number, number, number][] {
  const lens = [0.5, 0.5, 1, 1, 1, 1.5, 2]
  const out: [number, number, number][] = []
  const span = 8 / chords.length
  let deg = low + 2 + Math.floor(r() * 3)
  let at = 0
  while (at < beats) {
    const len = Math.min(pick(r, lens), beats - at)
    const seg = Math.floor(at / span)
    // the last note under each chord lands on that chord's root
    const lastOfChord = at + len >= (seg + 1) * span
    const d = lastOfChord ? chordAt(chords, at) + low + 5 : deg
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
  // from an unhurried 76 to a brisk 124, so some runs drift and some drive
  const bpm = 76 + 4 * Math.floor(r() * 13)
  // half the tunes change chord every bar, half every two beats. The sounds
  // lean to the original organ, plucks and bells, so most runs keep that feel
  const chords = pick(r, [
    [0, 3],
    [0, 4],
    [3, 0],
    [0, 2],
    [4, 3],
    [2, 0],
    [0, 3, 4, 0],
    [0, 2, 3, 4],
    [0, 0, 3, 2],
    [3, 4, 0, 0],
    [0, 4, 3, 2],
    [2, 3, 0, 4],
  ])
  const swing = pick(r, [0, 0, 0.08, 0.16])
  const voices = {
    pad: pick(r, ['organ', 'organ', 'choir', 'flute'] as const),
    pulse: pick(r, ['tri', 'tri', 'koto'] as const),
    lead: pick(r, ['bell', 'bell', 'koto', 'flute'] as const),
  }
  // about four in ten tunes pluck the chords on a rhythm instead of holding them
  const padHits = pick(r, [[], [], [], [], [0, 1.5, 3], [0, 2.5], [0, 0.75, 2]])
  const tonic = NOTE_NAMES[((root % 12) + 12) % 12] ?? 'C'
  const lead = voices.lead === 'bell' ? '' : `, ${voices.lead}`
  return {
    name: `${tonic} ${scale}, ${bpm} BPM${lead}${padHits.length ? ', plucked chords' : ''}${swing ? ', swung' : ''}`,
    bpm,
    root,
    scale,
    chords,
    swing,
    voices,
    padHits,
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
      [0, 0.75, 2, 2.5],
    ]),
    shaker: pick(r, [
      [0.5, 1.5, 2.5, 3.5],
      [0.25, 0.75, 1.25, 1.75, 2.25, 2.75, 3.25, 3.75],
      [0.5, 1, 1.5, 2.5, 3, 3.5],
      [1, 3],
    ]),
    arp: pick(r, [
      [0, 1, 2, 3, 4, 5, 6, 7],
      [7, 6, 5, 4, 3, 2, 1, 0],
      [0, 2, 4, 6, 7, 5, 3, 1],
      [0, 4, 2, 5, 3, 6, 4, 7],
      [0, 2, 1, 3, 2, 4, 3, 5],
    ]),
    arpRate: pick(r, [2, 3, 4, 4]),
    bellSeed: Math.floor(r() * 2 ** 31),
    melody: walk(r, 8, 5, chords),
    finale: walk(r, 16, 7, chords),
  }
}

/** Key and scale: two tunes with the same one sound alike. */
export function moodKey(m: Mood): string {
  return `${m.root} ${m.scale}`
}

/**
 * A mood for the next play that is not in the same key and scale as the last
 * one (`last` is that play's moodKey), so two plays in a row never sound alike.
 */
export function freshMood(random: () => number, last?: string): Mood {
  let m = moodFor(Math.floor(random() * 2 ** 31))
  for (let i = 0; i < 20 && moodKey(m) === last; i++)
    m = moodFor(Math.floor(random() * 2 ** 31))
  return m
}

/** The mood's scale, as semitones above its root. */
export function scaleSteps(m: Mood): readonly number[] {
  return SCALES[m.scale]
}

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
  const chord = (at: number): number => chordAt(m.chords, at)
  // off-beats fall late by the swing; a 16th between them by half as much
  const late = (at: number): number => {
    const f = at % 1
    if (Math.abs(f - 0.5) < 1e-6) return at + m.swing
    if (Math.abs(f - 0.25) < 1e-6 || Math.abs(f - 0.75) < 1e-6)
      return at + m.swing / 2
    return at
  }

  const note = (
    at: number,
    beats: number,
    freq: number,
    vol: number,
    wave: Wave,
    {attack = 0.005, decay = 0}: {attack?: number; decay?: number} = {},
  ): void => {
    const start = Math.round(late(at) * beat * RATE)
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
      else if (wave === 'koto')
        // a plucked string: bright at first, mellowing as it rings
        v =
          Math.sin(2 * Math.PI * ph) +
          0.5 * Math.sin(4 * Math.PI * ph) * Math.exp(-t * 8) +
          0.3 * Math.sin(6 * Math.PI * ph) * Math.exp(-t * 16)
      else if (wave === 'flute') {
        // breathy: a slow vibrato that comes in as the note is held
        const vib = 0.004 * Math.min(1, t / 0.3) * Math.sin(2 * Math.PI * 5 * t)
        const p = (ph + (vib * freq) / (2 * Math.PI * 5)) % 1
        v = Math.sin(2 * Math.PI * p) + 0.12 * Math.sin(4 * Math.PI * p)
      } else if (wave === 'choir')
        // two voices a hair apart, so the chord shimmers
        v =
          0.6 * Math.sin(2 * Math.PI * ph) +
          0.6 * Math.sin(2 * Math.PI * ((t * freq * 1.004) % 1))
      else v = Math.sin(2 * Math.PI * ph) + 0.3 * Math.sin(4 * Math.PI * ph)
      // a tail that runs past the end rings into the loop's start
      const j = (start + i) % len
      buf[j] = (buf[j] ?? 0) + v * env * vol
    }
  }
  const kick = (at: number, vol: number): void => {
    const start = Math.round(late(at) * beat * RATE)
    for (let i = 0; i < 0.25 * RATE; i++) {
      const t = i / RATE
      const f = 55 + 95 * Math.exp(-t * 30)
      const j = (start + i) % len
      buf[j] =
        (buf[j] ?? 0) + Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 14) * vol
    }
  }
  const shaker = (at: number, vol: number, seed: number): void => {
    const start = Math.round(late(at) * beat * RATE)
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
    case 'pad': {
      if (m.padHits.length) {
        // short chords, strummed low to high, on the tune's rhythm
        for (const bar of [0, 4])
          for (const hit of m.padHits)
            [0, 2, 4].forEach((d, k) => {
              const at = bar + hit
              note(at + k * 0.03, 1, hz(chord(at) + d), 0.1, 'koto', {
                decay: 0.45,
              })
            })
        break
      }
      const span = 8 / m.chords.length
      for (let at = 0; at < 8; at += span)
        for (const d of [0, 2, 4])
          note(at, span, hz(chord(at) + d), 0.1, m.voices.pad, {
            attack: span > 2 ? 0.3 : 0.15,
          })
      break
    }
    case 'pulse':
      for (let i = 0; i < 16; i++) {
        const at = i / 2
        const d = m.pulse[i % 4] ?? 0
        note(at, 0.5, hz(chord(at) + d + 5), 0.1, m.voices.pulse, {
          decay: 0.12,
        })
      }
      break
    case 'bells': {
      const r = rng(m.bellSeed)
      for (let k = 0; k < 5; k++) {
        const at = Math.floor(r() * 16) / 2
        note(at, 2, hz(chord(at) + 10 + Math.floor(r() * 5)), 0.08, 'bell', {
          decay: 0.5,
        })
      }
      break
    }
    case 'bass':
      for (const bar of [0, 4])
        for (const hit of m.bassHits)
          note(bar + hit, 1, hz(chord(bar + hit) - 5), 0.24, 'organ', {
            decay: 0.35,
          })
      break
    case 'beat':
      for (const bar of [0, 4]) for (const k of m.kicks) kick(bar + k, 0.45)
      for (const bar of [0, 4])
        m.shaker.forEach((at, i) => {
          shaker(bar + at, at % 1 ? 0.07 : 0.05, 1234 + bar + i)
        })
      break
    case 'keys':
      for (const at of [1, 3, 5, 7])
        for (const d of [0, 2, 4])
          note(at, 1, hz(chord(at) + d + 5), 0.06, 'tri', {decay: 0.3})
      break
    case 'arp':
      for (let i = 0; i < 8 * m.arpRate; i++) {
        const at = i / m.arpRate
        const d = m.arp[i % 8] ?? 0
        note(at, 1 / m.arpRate, hz(chord(at) + d + 5), 0.045, 'tri', {
          decay: 0.07,
        })
      }
      break
    case 'lead':
      for (const [at, beats, d] of m.melody)
        note(at, beats, hz(d), 0.07, m.voices.lead, {attack: 0.02})
      break
    case 'finale':
      // a brighter tune over the full band, twice as long, for the results
      for (const [at, beats, d] of m.finale)
        note(at, beats, hz(d), 0.08, m.voices.lead, {attack: 0.02})
      for (const at of [0, 4, 8, 12])
        note(at, 4, hz(chord(at) + 14), 0.03, 'sine', {attack: 0.2})
      break
  }
  // headroom, so every layer at once stays below clipping
  for (let i = 0; i < len; i++) buf[i] = (buf[i] ?? 0) * 0.7
  return buf
}
