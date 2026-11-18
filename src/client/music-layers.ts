// Which music layers play for where the player is. Pure, so it can be tested.
// Each name is a loop in public/music/ (see tools/music/placeholder.mjs).

export const LOOPS = [
  'pad',
  'pulse',
  'bells',
  'bass',
  'beat',
  'keys',
  'arp',
  'lead',
] as const
export type Loop = (typeof LOOPS)[number]

/** Where the player is: the stage, and how far through it (0 to 1). */
export type MusicState = {
  stage: number
  progress: number
}

/**
 * Line up (stage 1) starts on a held chord and adds a layer at each third of
 * the clues home. Fill in (stage 2) brings in the bass and beat, then adds keys,
 * an arpeggio and a melody as the squares fill. A solved cube plays none: the
 * finale takes over.
 */
export function layersFor({stage, progress}: MusicState): Loop[] {
  const p = Math.max(0, Math.min(1, progress))
  if (stage === 1) {
    const on: Loop[] = ['pad']
    if (p >= 1 / 3) on.push('pulse')
    if (p >= 2 / 3) on.push('bells')
    return on
  }
  if (stage === 2) {
    const on: Loop[] = ['pad', 'pulse', 'bass', 'beat']
    if (p >= 0.25) on.push('keys')
    if (p >= 0.5) on.push('arp')
    if (p >= 0.8) on.push('lead')
    return on
  }
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
