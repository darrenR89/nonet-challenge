import assert from 'node:assert/strict'
import {test} from 'node:test'
import {
  LOOP_BEATS,
  type LoopName,
  moodFor,
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
  for (const seed of [1, 7, 99]) {
    const m = moodFor(seed)
    for (const name of names) {
      const want = Math.round(((LOOP_BEATS[name] * 60) / m.bpm) * RATE)
      assert.equal(renderLoop(name, m).length, want, `${name} at ${m.bpm} BPM`)
    }
  }
})

test('all the layers together stay below clipping', () => {
  for (const seed of [3, 11, 2024]) {
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
