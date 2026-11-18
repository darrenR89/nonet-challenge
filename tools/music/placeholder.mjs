// Writes stand-in music loops to public/music/ so the layered music can be
// heard before the real tracks exist. Every loop is 8 beats (two bars of 4/4)
// at 100 BPM, in the yo scale on D (D E G A B). Swap any file for a real stem
// of the same length and tempo, keeping the name.
//
//   node tools/music/placeholder.mjs
import {mkdirSync, writeFileSync} from 'node:fs'

const RATE = 22050
const BPM = 100
const BEAT = 60 / BPM
const BEATS = 8
const LEN = Math.round(BEATS * BEAT * RATE)

const midi = n => 440 * 2 ** ((n - 69) / 12)
// note names to MIDI numbers, octave included: 'D4' is 62
const N = name => {
  const base = {C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11}[name[0]]
  return 12 * (Number(name.slice(1)) + 1) + base
}

/** Adds one note to the buffer, with an attack and an exponential decay. */
function note(buf, {at, len, freq, vol, wave = 'sine', attack = 0.005, decay}) {
  const start = Math.round(at * BEAT * RATE)
  const n = Math.round(len * BEAT * RATE)
  for (let i = 0; i < n; i++) {
    const t = i / RATE
    const env =
      Math.min(1, t / attack) *
      (decay ? Math.exp(-t / decay) : Math.min(1, (n - i) / (0.08 * RATE)))
    const ph = (t * freq) % 1
    let v
    if (wave === 'sine') v = Math.sin(2 * Math.PI * ph)
    else if (wave === 'tri') v = 1 - 4 * Math.abs(ph - 0.5)
    else if (wave === 'bell')
      v =
        Math.sin(2 * Math.PI * ph) +
        0.4 * Math.sin(2 * Math.PI * t * freq * 2.76) * Math.exp(-t * 6)
    else v = Math.sin(2 * Math.PI * ph) + 0.3 * Math.sin(4 * Math.PI * ph)
    const j = (start + i) % LEN // wrap so a tail rings into the loop's start
    buf[j] += v * env * vol
  }
}

/** A soft kick: a sine that drops in pitch. */
function kick(buf, at, vol) {
  const start = Math.round(at * BEAT * RATE)
  for (let i = 0; i < 0.25 * RATE; i++) {
    const t = i / RATE
    const f = 50 + 90 * Math.exp(-t * 30)
    buf[(start + i) % LEN] +=
      Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 14) * vol
  }
}

/** A shaker: short bursts of noise, softened by a one-pole filter. */
function shaker(buf, at, vol, seed) {
  const start = Math.round(at * BEAT * RATE)
  let s = seed
  let lp = 0
  for (let i = 0; i < 0.06 * RATE; i++) {
    s = (s * 16807) % 2147483647
    const noise = (s / 2147483647) * 2 - 1
    lp += 0.5 * (noise - lp)
    buf[(start + i) % LEN] += (noise - lp) * Math.exp(-i / (0.015 * RATE)) * vol
  }
}

const layers = {
  // Line up: a held chord and plucks, then bells once half the clues are home
  pad(b) {
    // voiced in the middle so phone and laptop speakers can carry it
    for (const n of ['D4', 'A4', 'E5'])
      note(b, {
        at: 0,
        len: 4,
        freq: midi(N(n)),
        vol: 0.1,
        wave: 'organ',
        attack: 0.3,
      })
    for (const n of ['G3', 'D4', 'B4'])
      note(b, {
        at: 4,
        len: 4,
        freq: midi(N(n)),
        vol: 0.1,
        wave: 'organ',
        attack: 0.3,
      })
  },
  pulse(b) {
    const seq = ['D4', 'A4', 'E4', 'A4', 'D4', 'A4', 'E4', 'B4']
    for (let i = 0; i < 16; i++)
      note(b, {
        at: i / 2,
        len: 0.5,
        freq: midi(N(seq[i % 8])),
        vol: 0.1,
        wave: 'tri',
        decay: 0.12,
      })
  },
  bells(b) {
    for (const [at, n] of [
      [0, 'B5'],
      [1.5, 'A5'],
      [3, 'E5'],
      [4.5, 'D6'],
      [6, 'B5'],
    ])
      note(b, {
        at,
        len: 2,
        freq: midi(N(n)),
        vol: 0.08,
        wave: 'bell',
        decay: 0.5,
      })
  },
  // Fill in: a bass and a beat come in, then keys, an arpeggio and a melody
  bass(b) {
    for (const [at, n] of [
      [0, 'D2'],
      [1.5, 'D2'],
      [3, 'A2'],
      [4, 'G2'],
      [5.5, 'G2'],
      [7, 'A2'],
    ])
      note(b, {
        at,
        len: 1,
        freq: midi(N(n)),
        vol: 0.22,
        wave: 'organ',
        decay: 0.35,
      })
  },
  beat(b) {
    for (let i = 0; i < BEATS; i += 2) kick(b, i, 0.45)
    for (let i = 0; i < BEATS * 2; i++)
      shaker(b, i / 2 + 0.25, i % 2 ? 0.08 : 0.05, 1234 + i)
  },
  keys(b) {
    for (const at of [1, 3])
      for (const n of ['D4', 'G4', 'A4'])
        note(b, {
          at,
          len: 1,
          freq: midi(N(n)),
          vol: 0.06,
          wave: 'tri',
          decay: 0.3,
        })
    for (const at of [5, 7])
      for (const n of ['D4', 'G4', 'B4'])
        note(b, {
          at,
          len: 1,
          freq: midi(N(n)),
          vol: 0.06,
          wave: 'tri',
          decay: 0.3,
        })
  },
  arp(b) {
    const up = ['D5', 'E5', 'G5', 'A5', 'B5', 'A5', 'G5', 'E5']
    for (let i = 0; i < 32; i++)
      note(b, {
        at: i / 4,
        len: 0.25,
        freq: midi(N(up[i % 8])),
        vol: 0.04,
        wave: 'tri',
        decay: 0.07,
      })
  },
  lead(b) {
    for (const [at, len, n] of [
      [0, 1.5, 'A5'],
      [1.5, 0.5, 'B5'],
      [2, 2, 'D6'],
      [4, 1, 'E6'],
      [5, 1, 'D6'],
      [6, 2, 'B5'],
    ])
      note(b, {
        at,
        len,
        freq: midi(N(n)),
        vol: 0.07,
        wave: 'bell',
        attack: 0.02,
      })
  },
  // played once when the cube is solved: a run up the scale and a bright chord
  finale(b) {
    const run = [
      'D4',
      'E4',
      'G4',
      'A4',
      'B4',
      'D5',
      'E5',
      'G5',
      'A5',
      'B5',
      'D6',
      'E6',
    ]
    for (const [i, n] of run.entries())
      note(b, {
        at: i / 3,
        len: 0.5,
        freq: midi(N(n)),
        vol: 0.09,
        wave: 'tri',
        decay: 0.2,
      })
    for (const n of ['D3', 'A3', 'D4', 'E4', 'A4', 'D5'])
      note(b, {
        at: 4,
        len: 4,
        freq: midi(N(n)),
        vol: 0.08,
        wave: 'bell',
        decay: 1.4,
      })
    kick(b, 4, 0.5)
  },
}

/** 16-bit mono WAV bytes. */
function wav(samples) {
  const out = Buffer.alloc(44 + samples.length * 2)
  out.write('RIFF', 0)
  out.writeUInt32LE(36 + samples.length * 2, 4)
  out.write('WAVEfmt ', 8)
  out.writeUInt32LE(16, 16)
  out.writeUInt16LE(1, 20)
  out.writeUInt16LE(1, 22)
  out.writeUInt32LE(RATE, 24)
  out.writeUInt32LE(RATE * 2, 28)
  out.writeUInt16LE(2, 32)
  out.writeUInt16LE(16, 34)
  out.write('data', 36)
  out.writeUInt32LE(samples.length * 2, 40)
  samples.forEach((v, i) => {
    out.writeInt16LE(
      Math.round(Math.max(-1, Math.min(1, v)) * 32767),
      44 + i * 2,
    )
  })
  return out
}

const dir = new URL('../../public/music/', import.meta.url)
mkdirSync(dir, {recursive: true})
for (const [name, write] of Object.entries(layers)) {
  const buf = new Float32Array(LEN)
  write(buf)
  writeFileSync(new URL(`${name}.wav`, dir), wav(buf))
}
console.log(`Wrote ${Object.keys(layers).length} loops to public/music/`)
