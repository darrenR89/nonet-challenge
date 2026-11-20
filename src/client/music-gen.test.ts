import assert from 'node:assert/strict'
import {test} from 'node:test'
import {
  chordAt,
  freshMood,
  LOOP_BEATS,
  type LoopName,
  moodFor,
  moodKey,
  RATE,
  renderLoop,
} from './music-gen.ts'

const names = Object.keys(LOOP_BEATS) as LoopName[]

test('the same seed always makes the same tune', () => {
  assert.deepEqual(moodFor(42), moodFor(42))
  assert.deepEqual(
    renderLoop('lead', moodFor(42)),
    renderLoop('lead', moodFor(42)),
  )
})

test('different seeds give different moods', () => {
  const moods = new Set(Array.from({length: 20}, (_, i) => moodFor(i).name))
  assert.ok(moods.size >= 10, `only ${moods.size} moods from 20 seeds`)
})

test('every loop is exactly its beats long, so the layers stay in time', () => {
  for (const seed of [1, 7, 99, 5, 12, 31, 64, 250]) {
    const m = moodFor(seed)
    for (const name of names) {
      const want = Math.round(((LOOP_BEATS[name] * 60) / m.bpm) * RATE)
      assert.equal(renderLoop(name, m).length, want, `${name} at ${m.bpm} BPM`)
    }
  }
})

test('all the layers together stay below clipping', () => {
  for (let seed = 0; seed < 40; seed++) {
    const m = moodFor(seed)
    const len = renderLoop('pad', m).length
    const sum = new Float32Array(len)
    for (const name of names) {
      if (name === 'finale') continue
      renderLoop(name, m).forEach((v, i) => {
        sum[i] = (sum[i] ?? 0) + v
      })
    }
    const peak = sum.reduce((p, v) => Math.max(p, Math.abs(v)), 0)
    assert.ok(peak < 1, `peak ${peak} for ${m.name}`)
  }
})

test('tunes differ in more than key: chords, swing, sounds and patterns', () => {
  const moods = Array.from({length: 60}, (_, i) => moodFor(i))
  const kinds = (f: (m: (typeof moods)[number]) => unknown): number =>
    new Set(moods.map(m => JSON.stringify(f(m)))).size
  assert.ok(kinds(m => m.chords.length) === 2, 'two and four chord loops')
  assert.ok(kinds(m => m.swing) >= 3, 'straight and swung')
  assert.ok(kinds(m => m.voices.pad) >= 3, 'pad sounds')
  assert.ok(kinds(m => m.padHits.length > 0) === 2, 'held and plucked chords')
  assert.ok(kinds(m => m.voices.lead) >= 3, 'lead sounds')
  assert.ok(kinds(m => m.arpRate) === 3, 'arpeggio speeds')
  assert.ok(kinds(m => m.shaker) >= 3, 'shaker patterns')
})

test('the chords share out the 8 beats evenly and repeat after them', () => {
  assert.deepEqual(
    [0, 3.9, 4, 7.9, 8].map(at => chordAt([0, 3], at)),
    [0, 0, 3, 3, 0],
  )
  assert.deepEqual(
    [0, 2, 4, 6, 9].map(at => chordAt([0, 2, 3, 4], at)),
    [0, 2, 3, 4, 0],
  )
})

test('melodies stay inside their loop', () => {
  for (let seed = 0; seed < 30; seed++) {
    const m = moodFor(seed)
    for (const [tune, beats] of [
      [m.melody, 8],
      [m.finale, 16],
    ] as const)
      for (const [at, len] of tune) assert.ok(at >= 0 && at + len <= beats)
  }
})

test('the next play never repeats the last key and scale', () => {
  let r = 0
  const random = (): number => {
    r = (r + 0.137) % 1
    return r
  }
  let last: string | undefined
  for (let i = 0; i < 50; i++) {
    const m = freshMood(random, last)
    assert.notEqual(moodKey(m), last)
    last = moodKey(m)
  }
  // a generator stuck on one value still returns a tune
  assert.ok(freshMood(() => 0.5, moodKey(moodFor(2 ** 30))))
})
