// Which music layers play for where the player is. Pure, so it can be tested.
// Each name is a loop drawn by music-gen.ts.
import type {LoopName} from './music-gen.ts'

/** Where the player is: the stage, how far through it (0 to 1), and whether they gave up. */
export type MusicState = {
  stage: number
  progress: number
  gaveUp?: boolean
}

/**
 * Line up (stage 1) starts on a held chord and plucks, and adds bells once
 * half the clues it needs are home. Fill in (stage 2) brings in the bass and
 * beat, then adds keys, an arpeggio and a melody as the squares fill. A solved
 * cube loops the finale over the band until the player leaves the results; a
 * cube given up goes quiet.
 */
export function layersFor({stage, progress, gaveUp}: MusicState): LoopName[] {
  const p = Math.max(0, Math.min(1, progress))
  if (stage === 1) {
    const on: LoopName[] = ['pad', 'pulse']
    if (p >= 0.5) on.push('bells')
    return on
  }
  if (stage === 2) {
    const on: LoopName[] = ['pad', 'pulse', 'bass', 'beat']
    if (p >= 0.25) on.push('keys')
    if (p >= 0.5) on.push('arp')
    if (p >= 0.8) on.push('lead')
    return on
  }
  if (stage === 3 && !gaveUp)
    return ['pad', 'bass', 'beat', 'keys', 'arp', 'finale']
  return []
}

/**
 * Progress through Line up counted from where the run started, since a lightly
 * turned cube can start with most clues already home.
 */
export function fromStart(progress: number, start: number): number {
  if (start >= 1) return 1
  return Math.max(0, (progress - start) / (1 - start))
}
