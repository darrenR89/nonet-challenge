import assert from 'node:assert/strict'
import {test} from 'node:test'
import {fromStart, layersFor} from './music-layers.ts'

test('lining up starts with two layers and adds bells halfway home', () => {
  assert.deepEqual(layersFor({stage: 1, progress: 0}), ['pad', 'pulse'])
  assert.deepEqual(layersFor({stage: 1, progress: 0.4}), ['pad', 'pulse'])
  assert.deepEqual(layersFor({stage: 1, progress: 0.5}), [
    'pad',
    'pulse',
    'bells',
  ])
})

test('filling in starts fuller and builds to every layer but the bells', () => {
  assert.deepEqual(layersFor({stage: 2, progress: 0}), [
    'pad',
    'pulse',
    'bass',
    'beat',
  ])
  assert.equal(layersFor({stage: 2, progress: 0.3}).length, 5)
  assert.equal(layersFor({stage: 2, progress: 0.6}).length, 6)
  assert.deepEqual(layersFor({stage: 2, progress: 0.9}), [
    'pad',
    'pulse',
    'bass',
    'beat',
    'keys',
    'arp',
    'lead',
  ])
})

test('a solved cube, or progress out of range, never adds stray layers', () => {
  assert.deepEqual(layersFor({stage: 3, progress: 1}), [])
  assert.deepEqual(layersFor({stage: 1, progress: -1}), ['pad', 'pulse'])
  assert.equal(layersFor({stage: 2, progress: 5}).length, 7)
})

test('Line up counts from where the run started', () => {
  assert.equal(fromStart(0.75, 0.75), 0)
  assert.equal(fromStart(0.875, 0.75), 0.5)
  assert.equal(fromStart(1, 0.75), 1)
  assert.equal(fromStart(0.5, 0.75), 0) // a turn the wrong way
  assert.equal(fromStart(1, 1), 1)
})
